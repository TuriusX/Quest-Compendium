/**
 * The objectives tracker: a small transparent always-on-top window (electron/tracker.html) that draws the current
 * answer's objectives straight onto the game, WoW-style. It never takes focus and is click-through except while the
 * mouse is over the text, so the game keeps playing underneath. Position, view (full / collapsed / away), text size,
 * transparency and backdrop are remembered per game in userData/tracker.json.
 *
 * It's the panel's minimized state: hidden (not closed) while the panel is open, back when the panel hides. Clicking
 * its header asks the app to open the panel (deps.onOpenPanel, with the tracker's bounds); the show/hide shortcut
 * (Ctrl+Space by default) opens it too, and the hint names that shortcut (setKeys). The tracker holds no keys itself.
 *
 * Wire it up from main.cjs:
 *   const tracker = require('./tracker.cjs');
 *   tracker.init({ app, ipcMain, screen, globalShortcut, getMainWindow: () => mainWindow });
 *   ... and tracker.setKeys(accelerator) whenever the show/hide shortcut is (re)registered ('' when there's none).
 */
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');

let deps = null;
let win = null;
let current = null; // { data, gameKey }
let suspended = false; // hidden while the panel is open (hideTemporarily / restore)
let captureHidden = false; // hidden for a moment while the app takes a screenshot for the AI
let inRecordings = true; // follows the markers' "show in recordings" setting (content protection when off)
let scale = 1; // the app's UI scale (Settings)
let store = null;   // per-game settings, loaded once
let storeFile = '';
let keys = 'CommandOrControl+Space'; // the show/hide shortcut, named in the hint ('' = none registered)
let saveTimer = null;
const MARGIN = 0;

const DEFAULTS = { view: 'full', size: 'medium', alpha: 100, backdrop: false, x: null, y: null, edge: 'right' };

function loadStore() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { store = {}; }
  if (!store || typeof store !== 'object') store = {};
  return store;
}
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(storeFile, JSON.stringify(store)); } catch (err) { console.warn('[tracker] save failed:', err && err.message); }
  }, 400);
}
const settingsFor = (gameKey) => ({ ...DEFAULTS, ...(loadStore()[gameKey || '_default'] || {}) });
function patchSettings(gameKey, patch) {
  const key = gameKey || '_default';
  loadStore()[key] = { ...settingsFor(key), ...patch };
  saveStore();
}

const alive = () => win && !win.isDestroyed();
const js = (code) => { if (alive()) win.webContents.executeJavaScript(code).catch(() => {}); };
const tell = (payload) => { const m = deps.getMainWindow(); if (m && !m.isDestroyed()) m.webContents.send('tracker-event', payload); };

function display() {
  const { screen } = deps;
  if (alive()) return screen.getDisplayMatching(win.getBounds());
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** Keep the window on its screen. In the away view it sits flush against the nearest left/right edge. */
function placeWindow(view) {
  if (!alive()) return;
  const b = win.getBounds();
  const wa = display().workArea;
  let { x, y } = b;
  if (view === 'away') {
    const edge = settingsFor(current && current.gameKey).edge;
    x = edge === 'left' ? wa.x : wa.x + wa.width - b.width;
  }
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - b.width));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - b.height));
  if (x !== b.x || y !== b.y) win.setPosition(Math.round(x), Math.round(y));
}

/** The screen a new tracker opens on: the one the last screenshot came from (the game's), else the cursor's. */
function startDisplay() {
  const d = deps.getDisplay && deps.getDisplay();
  return d || deps.screen.getDisplayNearestPoint(deps.screen.getCursorScreenPoint());
}

function createWindow(disp) {
  const wa = disp.workArea;
  // Top-right by default (the saved spot wins once the player has dragged it).
  win = new BrowserWindow({
    x: wa.x + wa.width - 440, y: wa.y + 24, width: 420, height: 300,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      preload: path.join(__dirname, 'trackerPreload.cjs'),
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Like the markers: in recordings (OBS, Game Bar) unless the player turned that off. The app's own screenshots for
  // the AI never include it either way (hideForCapture).
  win.setContentProtection(!inRecordings);
  win.setIgnoreMouseEvents(true, { forward: true });
  const w = win;
  win.on('closed', () => {
    if (deps.onWindow) deps.onWindow(null);
    if (win === w) { win = null; current = null; }
  });
  if (deps.onWindow) deps.onWindow(win);
  win.webContents.on('console-message', (e, level, message) => {
    if (typeof message === 'string' && message.startsWith('[tracker]')) console.log(message);
  });
  win.loadFile(path.join(__dirname, 'tracker.html'));
  return new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
}

/** What the page gets: only known fields, trimmed to length. */
function cleanData(data) {
  return {
    id: String((data && data.id) || ''),
    accent: /^#[0-9a-fA-F]{3,8}$/.test((data && data.accent) || '') ? data.accent : '#a87ffb',
    quest: String((data && data.quest) || '').slice(0, 120),
    warning: String((data && data.warning) || '').slice(0, 160),
    place: data && data.place && data.place.name ? {
      name: String(data.place.name).slice(0, 60), story: String(data.place.story || '').slice(0, 80), sure: !!data.place.sure,
    } : null,
    objectives: (Array.isArray(data && data.objectives) ? data.objectives : []).slice(0, 8).map((o) => ({
      label: String((o && o.label) || '').slice(0, 60), where: String((o && o.where) || '').slice(0, 80),
      done: !!(o && o.done), missable: !!(o && o.missable),
    })).filter((o) => o.label),
    labels: cleanLabels(data && data.labels),
  };
}

/** The page's words in the app's language: short strings only, for the keys the page knows. */
const LABEL_KEYS = ['title', 'confirm', 'missable', 'hint', 'hintNoKeys', 'headHint', 'placeHint', 'confirmHint', 'collapse', 'open', 'away', 'size', 'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone'];
function cleanLabels(labels) {
  const out = {};
  if (!labels || typeof labels !== 'object') return out;
  for (const k of LABEL_KEYS) if (typeof labels[k] === 'string' && labels[k].trim()) out[k] = labels[k].slice(0, 120);
  return out;
}

/** A saved spot only counts if it's on the screen the tracker opens on. */
function onScreen(s, wa) {
  return Number.isFinite(s.x) && Number.isFinite(s.y) && s.x >= wa.x && s.y >= wa.y && s.x + 60 <= wa.x + wa.width && s.y + 40 <= wa.y + wa.height;
}

/**
 * Show (or replace) the tracker for an answer.
 * data: { id, title?, quest?, place?: {name, story, sure}, objectives: [{label, where?, done?, missable?}], warning?, accent? }
 */
async function show(data, gameKey) {
  if (!deps) throw new Error('tracker.init() first');
  const clean = cleanData(data);
  if (!clean.objectives.length && !clean.quest) { hide(); return false; }
  const fresh = !alive();
  const disp = fresh ? startDisplay() : null;
  if (fresh) await createWindow(disp);
  if (!alive()) return false;
  current = { data: clean, gameKey: gameKey || '_default' };
  let s = settingsFor(current.gameKey);
  // The saved spot is for this game; on a different screen now (another monitor), start top-right on this one.
  if (fresh && (Number.isFinite(s.x) || Number.isFinite(s.y)) && !onScreen(s, disp.workArea)) {
    patchSettings(current.gameKey, { x: null, y: null });
    s = settingsFor(current.gameKey);
  }
  js(`window.qcTrackerShow(${JSON.stringify(clean)}, ${JSON.stringify({ view: s.view, size: s.size, alpha: s.alpha, backdrop: s.backdrop, edge: s.edge, scale, keys: keysLabel() })})`);
  if (fresh && Number.isFinite(s.x) && Number.isFinite(s.y)) win.setPosition(Math.round(s.x), Math.round(s.y));
  // Shown when the panel hides; while the panel is open it waits hidden with the new data.
  if (deps.isPanelOpen && deps.isPanelOpen()) suspended = true;
  else if (fresh || suspended || !win.isVisible()) { suspended = false; win.showInactive(); }
  return true;
}

/** New data for the answer on show (or a newer answer): replaces what's shown, cleaned like show(). */
function update(patch) {
  if (!alive() || !current) return;
  current.data = cleanData({ ...current.data, ...(patch || {}) });
  js(`window.qcTrackerShow(${JSON.stringify(current.data)})`);
}

function hide() {
  if (alive()) win.destroy();
  win = null; current = null; suspended = false; captureHidden = false;
}

/** The panel opened: hide without losing anything. */
function hideTemporarily() {
  if (!alive()) return;
  suspended = true;
  win.hide();
}

/** The panel hid again: back at its own saved spot. */
function restore() {
  if (!alive() || !suspended) return;
  suspended = false;
  const s = settingsFor(current && current.gameKey);
  if (s.view !== 'away' && Number.isFinite(s.x) && Number.isFinite(s.y)) win.setPosition(Math.round(s.x), Math.round(s.y));
  win.showInactive();
}

/** Header click (or the controller's open button): open the panel at the tracker. */
function openPanel() {
  if (alive() && deps.onOpenPanel) deps.onOpenPanel(win.getBounds());
}

/**
 * Around a screenshot for the AI: out of the picture, then back. Separate from hideTemporarily/restore, so a capture
 * while the panel is opening never brings the tracker back on top of the panel. Returns whether it was hidden.
 */
function hideForCapture() {
  if (!alive() || suspended || captureHidden || !win.isVisible()) return false;
  captureHidden = true;
  win.hide();
  return true;
}
function showAfterCapture() {
  if (!captureHidden) return;
  captureHidden = false;
  if (alive() && !suspended) win.showInactive();
}

/** Where the tracker is on screen, or null when it's closed or hidden (for the sticky markers' exclude list). */
function getBounds() {
  return alive() && !suspended && !captureHidden && win.isVisible() ? win.getBounds() : null;
}

/** The markers' "show in recordings" setting: off hides the tracker from all screen capture. */
function setVisibleInRecordings(on) {
  inRecordings = !!on;
  if (alive()) win.setContentProtection(!inRecordings);
}

/** The app's UI scale: the tracker's text grows with it. */
function setScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return;
  scale = Math.max(0.5, Math.min(3, v));
  js(`window.qcTrackerSettings(${JSON.stringify({ scale })})`);
}

/** The show/hide shortcut as the page shows it ("Ctrl+Space"), or '' when there's none. */
const keysLabel = () =>
  keys ? keys.replace(/(CommandOrControl|CmdOrCtrl)/g, process.platform === 'darwin' ? 'Cmd' : 'Ctrl') : '';

/** The show/hide shortcut changed (or couldn't be registered: ''): the hint follows. */
function setKeys(accelerator) {
  keys = typeof accelerator === 'string' ? accelerator.trim() : '';
  js(`window.qcTrackerSettings(${JSON.stringify({ keys: keysLabel() })})`);
}

function onMessage(event, msg) {
  if (!alive() || event.sender !== win.webContents || !msg || typeof msg !== 'object') return;
  const gameKey = current && current.gameKey;
  switch (msg.type) {
    case 'size': {
      const w = Math.max(60, Math.min(900, Math.round(msg.width || 0)));
      const h = Math.max(40, Math.min(1200, Math.round(msg.height || 0)));
      const b = win.getBounds();
      if (w !== b.width || h !== b.height) win.setBounds({ x: b.x, y: b.y, width: w, height: h });
      placeWindow(msg.view);
      break;
    }
    case 'mouse':
      win.setIgnoreMouseEvents(!msg.over, { forward: true });
      break;
    case 'drag': {
      const b = win.getBounds();
      win.setPosition(Math.round(b.x + (Number(msg.dx) || 0)), Math.round(b.y + (Number(msg.dy) || 0)));
      break;
    }
    case 'drag-end': {
      placeWindow('full');
      const b = win.getBounds();
      const wa = display().workArea;
      // Remember the spot, and which edge the away tab should use (the closer one).
      patchSettings(gameKey, { x: b.x, y: b.y, edge: b.x + b.width / 2 < wa.x + wa.width / 2 ? 'left' : 'right' });
      js(`window.qcTrackerEdge(${JSON.stringify(settingsFor(gameKey).edge)})`);
      break;
    }
    case 'view':
      if (['full', 'collapsed', 'away'].includes(msg.view)) {
        patchSettings(gameKey, { view: msg.view });
        if (msg.view !== 'away') {
          const s = settingsFor(gameKey);
          if (Number.isFinite(s.x) && Number.isFinite(s.y)) win.setPosition(Math.round(s.x), Math.round(s.y));
        }
      }
      break;
    case 'settings': {
      const p = {};
      if (['small', 'medium', 'large'].includes(msg.size)) p.size = msg.size;
      if (Number.isFinite(msg.alpha)) p.alpha = Math.max(30, Math.min(100, Math.round(msg.alpha)));
      if (typeof msg.backdrop === 'boolean') p.backdrop = msg.backdrop;
      patchSettings(gameKey, p);
      break;
    }
    case 'done':
      if (current && current.data.objectives[msg.index]) current.data.objectives[msg.index].done = !!msg.done;
      tell({ type: 'done', id: msg.id, index: msg.index, done: !!msg.done });
      break;
    case 'confirm-place':
      if (current && current.data.place) current.data.place.sure = true;
      tell({ type: 'confirm-place', id: msg.id, name: msg.name, story: msg.story });
      break;
    case 'peek':
      break;
    case 'open-panel':
      openPanel();
      break;
    default:
      break;
  }
}

function init(d) {
  deps = d;
  storeFile = path.join(d.app.getPath('userData'), 'tracker.json');
  d.ipcMain.on('tracker-msg', onMessage);
  d.ipcMain.handle('tracker-show', (e, payload) => show(payload && payload.data, payload && payload.gameKey).catch((err) => { console.warn('[tracker]', err && err.message); return false; }));
  d.ipcMain.on('tracker-update', (e, patch) => update(patch));
  d.ipcMain.on('tracker-hide', () => hide());
  d.ipcMain.on('tracker-peek', () => js('window.qcTrackerPeek()'));
  d.app.on('will-quit', hide);
}

module.exports = {
  init, show, update, hide, hideTemporarily, restore, setKeys, hideForCapture, showAfterCapture, getBounds,
  setVisibleInRecordings, setScale, openPanel,
  isOpen: () => alive(),
  /** On screen right now (not hidden behind the open panel). */
  isShowing: () => alive() && !suspended && win.isVisible(),
};
