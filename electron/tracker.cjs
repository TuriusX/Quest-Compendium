/**
 * The objectives tracker: a small transparent always-on-top window (electron/tracker.html) that draws a quest log for
 * where the player is straight onto the game, WoW-style: sections the app builds from our guides and the latest
 * answer (src/utils/trackerPayload.ts). It never takes focus and is click-through except while the
 * mouse is over the text, so the game keeps playing underneath. Position, view (full / collapsed / away), text size,
 * transparency and backdrop are remembered per game in userData/tracker.json.
 *
 * It's the panel's minimized state: its window is closed while the panel is open (the data, settings and position
 * stay here) and a fresh one opens when the panel hides. A window reused across panel cycles lost the button-down of
 * every click after the first hide/show, so it's never reused that way. The book icon at
 * the right end of its header asks the app to open the panel (deps.onOpenPanel, with the tracker's bounds); clicking
 * the title folds the log to its header line. The show/hide shortcut (Ctrl+Space by default) opens the panel too, and
 * the hint names that shortcut (setKeys). The tracker holds no keys itself. An entry's expanded details can open the
 * panel at that guide entry (open-entry) or with a question about it in the box (ask-about).
 *
 * Wire it up from main.cjs:
 *   const tracker = require('./tracker.cjs');
 *   tracker.init({ app, ipcMain, screen, globalShortcut, getMainWindow: () => mainWindow });
 *   ... and tracker.setKeys(accelerator) whenever the show/hide shortcut is (re)registered ('' when there's none).
 */
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const { formatAccelerator } = require('./accelerator.cjs');

let deps = null;
let win = null;
let current = null; // { data, gameKey }
let suspended = false; // the panel is open: no window, the data waits in current (hideTemporarily / restore)
let lastSpot = null; // where the window was when the panel opened: the fresh window opens there
let creating = null; // the window being created (its page load), shared by show() and restore()
let revealPending = false, revealTimer = null; // a new window shows once its page has reported its size
let captureHidden = false; // invisible (opacity 0) for a moment while the app takes a screenshot for the AI
let inRecordings = true; // follows the markers' "show in recordings" setting (content protection when off)
let scale = 1; // the app's UI scale (Settings)
let store = null;   // per-game settings, loaded once
let storeFile = '';
let keys = 'CommandOrControl+Space'; // the show/hide shortcut, named in the hint ('' = none registered)
let saveTimer = null;
// Click-through except while the cursor is over the window. The main process hit-tests the cursor itself: on Windows,
// setIgnoreMouseEvents(false) fires a mouseleave in the page, so page-driven enter/leave flipped straight back to
// click-through (hover showed, clicks fell through to the game). pressed: a press started on the tracker (a header
// drag or the transparency slider) keeps clicks on until it ends, even outside the window.
// mouseOn is null right after the window is shown again: Windows' real click-through state after a hide/show isn't
// known, so the next tick of the watch applies it for real instead of trusting the last value.
let mouseOn = false, pressed = false, mouseTimer = null;
const MARGIN = 0;

// Per game: collapsed (sections folded by their heading: { [section id]: true }), hidden (entries hidden with their ×,
// by id: ids carry the area, so it's per area), limits (entries shown per section: 3, 6 or 0 = all; unset = 12),
// backdrop (how dark the soft backdrop is, 0 = off to 95).
const DEFAULTS = { view: 'full', size: 'medium', alpha: 100, backdrop: 45, x: null, y: null, edge: 'right', collapsed: {}, hidden: [], limits: {} };
const MAX_HIDDEN = 600;
/** The tracker grows with its content up to this share of the screen's height, then scrolls inside. */
const MAX_HEIGHT_SHARE = 0.7;
const maxHeight = () => Math.round(display().workArea.height * MAX_HEIGHT_SHARE);

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
function settingsFor(gameKey) {
  const s = { ...DEFAULTS, ...(loadStore()[gameKey || '_default'] || {}) };
  // Saved before the backdrop slider: on was the old fixed shade (45%), off is 0.
  if (typeof s.backdrop === 'boolean') s.backdrop = s.backdrop ? 45 : 0;
  s.backdrop = Number.isFinite(s.backdrop) ? Math.max(0, Math.min(95, Math.round(s.backdrop))) : DEFAULTS.backdrop;
  if (!Array.isArray(s.hidden)) s.hidden = [];
  if (!s.limits || typeof s.limits !== 'object') s.limits = {};
  return s;
}
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

/**
 * Where a new tracker opens (and where it goes back to when its saved spot is reset): the right edge, about a third
 * of the way down, under where minimaps usually sit.
 */
const defaultSpot = (wa, width = 420) => ({ x: wa.x + wa.width - width - 20, y: wa.y + Math.round(wa.height * 0.35) });

function setMouse(on) {
  if (!alive() || (typeof mouseOn === 'boolean' && on === mouseOn)) return;
  mouseOn = on;
  win.setIgnoreMouseEvents(!on, { forward: true });
  console.log(`[tracker] mouse ${on ? 'on' : 'off'}`);
}
function startMouseWatch() {
  clearInterval(mouseTimer);
  mouseTimer = setInterval(() => {
    if (!alive() || !win.isVisible() || captureHidden) { setMouse(false); return; } // off screen, or invisible for a capture
    if (pressed) { setMouse(true); return; }
    const p = deps.screen.getCursorScreenPoint(), b = win.getBounds();
    setMouse(p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height);
  }, 40);
}
function stopMouseWatch() {
  clearInterval(mouseTimer);
  mouseTimer = null; mouseOn = false; pressed = false;
}

/**
 * Just shown again (showInactive): re-apply the click-through state on the next tick of the mouse watch, and put the
 * tracker back on top, above the panel window even if the panel was raised while it was open.
 */
function afterShow() {
  if (!alive()) return;
  mouseOn = null;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The screen a new tracker opens on: the one the last screenshot came from (the game's), else the cursor's. */
function startDisplay() {
  const d = deps.getDisplay && deps.getDisplay();
  return d || deps.screen.getDisplayNearestPoint(deps.screen.getCursorScreenPoint());
}

/** A new window, created hidden at (x, y); it shows once its page has reported its size (reveal). */
function createWindow(x, y) {
  win = new BrowserWindow({
    x: Math.round(x), y: Math.round(y), width: 420, height: 300,
    // Never focusable and only ever shown with showInactive: the game keeps keyboard focus, always.
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
    // A window closed on purpose (the panel opened, or hide()) is already detached: nothing to clean up here.
    if (win !== w) return;
    if (deps.onWindow) deps.onWindow(null);
    win = null; current = null; stopMouseWatch();
  });
  if (deps.onWindow) deps.onWindow(win);
  win.webContents.on('console-message', (e, level, message) => {
    if (typeof message === 'string' && message.startsWith('[tracker]')) console.log(message);
  });
  win.loadFile(path.join(__dirname, 'tracker.html'));
  startMouseWatch();
  // Settles when the page has loaded, or when the window is closed first (the panel opened while it loaded).
  return new Promise((resolve) => { w.webContents.once('did-finish-load', resolve); w.once('closed', resolve); });
}

/** Close the window but keep the data (current), the settings and suspended: the panel opened, or a reset. */
function dropWindow() {
  const w = win;
  win = null;
  revealPending = false; clearTimeout(revealTimer);
  captureHidden = false; pressed = false;
  stopMouseWatch();
  if (w && !w.isDestroyed()) {
    if (deps.onWindow) deps.onWindow(null);
    w.destroy();
  }
}

/** Where a new window opens: the spot it had when the panel opened, else the game's saved spot, else the default. */
function spotFor(spot) {
  if (spot) return { x: spot.x, y: spot.y };
  const wa = startDisplay().workArea;
  let s = settingsFor(current.gameKey);
  // The saved spot is for this game; on a different screen now (another monitor), start at the default spot on this one.
  if ((Number.isFinite(s.x) || Number.isFinite(s.y)) && !onScreen(s, wa)) {
    patchSettings(current.gameKey, { x: null, y: null });
    s = settingsFor(current.gameKey);
  }
  return Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : defaultSpot(wa);
}

/**
 * Make sure there's a window showing current (unless the panel is open): create one if needed (one at a time, shared
 * by show() and restore()), hand it the data and settings, and show it once its page has laid out.
 */
async function open(spot) {
  if (!alive() && !creating) {
    const at = spotFor(spot);
    creating = createWindow(at.x, at.y).finally(() => { creating = null; });
  }
  if (creating) await creating;
  if (!alive() || !current) return false;
  if (suspended) { lastSpot = lastSpot || win.getBounds(); dropWindow(); return false; } // the panel opened meanwhile
  const s = settingsFor(current.gameKey);
  js(`window.qcTrackerShow(${JSON.stringify(current.data)}, ${JSON.stringify({ view: s.view, size: s.size, alpha: s.alpha, backdrop: s.backdrop, edge: s.edge, scale, keys: keysLabel(), collapsed: s.collapsed || {}, hidden: s.hidden, limits: s.limits, maxHeight: maxHeight() })})`);
  if (!win.isVisible() && !revealPending) {
    revealPending = true;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, 500); // in case the page never reports its size
  }
  return true;
}

/** Show the new window (its size report arrived): no flash at a default spot or size first. */
function reveal() {
  revealPending = false; clearTimeout(revealTimer);
  if (!alive() || suspended || captureHidden || win.isVisible()) return;
  win.showInactive();
  afterShow();
}

/** What the page gets: only known fields, trimmed to length. */
const SECTION_IDS = ['answer', 'missable', 'noreturn', 'collect', 'ach'];
function cleanData(data) {
  const str = (v, n) => String(v || '').slice(0, n);
  return {
    id: str(data && data.id, 80),
    accent: /^#[0-9a-fA-F]{3,8}$/.test((data && data.accent) || '') ? data.accent : '#a87ffb',
    quest: str(data && data.quest, 120),
    warning: str(data && data.warning, 200),
    place: data && data.place && data.place.name ? {
      name: str(data.place.name, 60), story: str(data.place.story, 80), sure: !!data.place.sure,
    } : null,
    // Sections, in the order the app built them; each item is one line (ticks go back to the app by item id).
    sections: (Array.isArray(data && data.sections) ? data.sections : []).filter((x) => x && SECTION_IDS.includes(x.id)).slice(0, 8).map((x) => ({
      id: x.id,
      title: str(x.title, 60),
      tone: x.tone === 'amber' ? 'amber' : '',
      icon: x.icon === 'warn' ? 'warn' : '',
      items: (Array.isArray(x.items) ? x.items : []).slice(0, 120).map((o) => ({
        id: str(o && o.id, 200), label: str(o && o.label, 140), where: str(o && o.where, 160),
        done: !!(o && o.done), missable: !!(o && o.missable), tick: !!(o && o.tick),
        badge: Number.isInteger(o && o.badge) ? o.badge : 0,
        // Everything the guide has on the entry, untrimmed, for its expanded details on the tracker.
        detail: cleanDetail(o && o.detail),
      })).filter((o) => o.label && o.id),
    })).filter((x) => x.items.length),
    next: data && data.next && data.next.name ? { name: str(data.next.name, 60) } : null,
    // The guide's areas in order and where the player is among them (the ‹ › arrows and the area list).
    areas: data && data.areas && Array.isArray(data.areas.names) && Number.isInteger(data.areas.index)
      ? { names: data.areas.names.slice(0, 200).map((n) => str(n, 80)), index: data.areas.index }
      : null,
    locating: !!(data && data.locating),
    notice: str(data && data.notice, 200),
    source: str(data && data.source, 120), // "From the guide: <area> (closest match)" when the place isn't an area by name
    labels: cleanLabels(data && data.labels),
  };
}

/** An entry's details: its full text, where, how (requirements), why it's missable, notes. */
function cleanDetail(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of ['full', 'where', 'how', 'missable', 'notes']) if (typeof d[k] === 'string' && d[k].trim()) out[k] = d[k].trim().slice(0, 900);
  return Object.keys(out).length ? out : null;
}

/** The page's words in the app's language: short strings only, for the keys the page knows. */
const LABEL_KEYS = ['title', 'confirm', 'missable', 'placeHint', 'confirmHint', 'away', 'size', 'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone', 'empty', 'secAnswer', 'secMissable', 'secNoReturn', 'secCollect', 'secAch', 'more', 'next', 'closest', 'showHidden', 'hideEntry', 'limitHint', 'prevArea', 'nextArea', 'areaList', 'locate', 'locating',
  'hintBook', 'hintBookNoKeys', 'headFold', 'openBook', 'foldHint', 'detWhere', 'detHow', 'detMissable', 'detNotes', 'openInGuide', 'askAbout',
  'expandHint', 'spine', 'choice'];
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
 * Show (or replace) the tracker.
 * data: { id, quest, place?: {name, story, sure}, sections: [{id, title, tone?, icon?, items: [{id, label, where?, done?,
 *         missable?, badge?, tick?}]}], next?: {name}, warning?, accent, labels }
 */
async function show(data, gameKey) {
  if (!deps) throw new Error('tracker.init() first');
  const clean = cleanData(data);
  if (!clean.sections.length && !clean.quest && !clean.place) { hide(); return false; }
  current = { data: clean, gameKey: gameKey || '_default' };
  // While the panel is open there's no window: the data waits for restore().
  if (deps.isPanelOpen && deps.isPanelOpen()) {
    suspended = true;
    if (alive()) { lastSpot = win.getBounds(); dropWindow(); }
    return true;
  }
  suspended = false;
  return open(null);
}

/**
 * New data (a new place, ticks, a newer answer): replaces what's shown entirely, cleaned like show(), so nothing from
 * the previous place or answer stays. Kept while the panel is open (no window).
 */
function update(patch, gameKey) {
  if (!current) {
    // No tracker data yet (or it was put away), and the panel is open: keep this, so a newly finished answer is on the
    // tracker the moment the panel hides (and the app's next show() starts from it).
    if (deps.isPanelOpen && deps.isPanelOpen() && gameKey) {
      const clean = cleanData(patch || {});
      if (clean.sections.length || clean.quest || clean.place) {
        current = { data: clean, gameKey };
        suspended = true;
        console.log(`[tracker] data kept while the panel is open (${clean.sections.map((x) => `${x.id} ${x.items.length}`).join(', ') || 'no sections'})`);
      }
    }
    return;
  }
  current.data = cleanData(patch || {});
  js(`window.qcTrackerShow(${JSON.stringify(current.data)})`);
  if (suspended) console.log(`[tracker] updated while the panel is open (${current.data.sections.map((x) => `${x.id} ${x.items.length}`).join(', ') || 'no sections'})`);
}

function hide() {
  current = null; suspended = false; lastSpot = null;
  dropWindow();
}

/** The panel opened: close the window, keeping the data, settings and position for restore(). */
function hideTemporarily() {
  suspended = true;
  pressed = false;
  if (!alive()) return;
  lastSpot = win.getBounds();
  dropWindow();
}

/** The panel hid again: a fresh window, where the last one was. */
function restore() {
  if (!suspended) return;
  suspended = false;
  if (!current) return;
  const spot = lastSpot;
  lastSpot = null;
  open(spot).then((ok) => {
    if (!ok) return;
    // Once the panel has finished sliding back to its dock (150 ms), log where both are; the panel must not cover it.
    setTimeout(() => {
      if (!alive() || suspended) return;
      const t = win.getBounds();
      const m = deps.getMainWindow && deps.getMainWindow();
      const p = m && !m.isDestroyed() ? m.getBounds() : null;
      console.log(`[tracker] restored at ${t.x},${t.y} (${t.width}x${t.height}); panel at ${p ? `${p.x},${p.y} (${p.width}x${p.height})` : 'none'}${overlaps(t, p) ? ': the panel overlaps the tracker (the tracker is kept on top)' : ''}`);
    }, 300);
  }).catch((err) => console.warn('[tracker] restore failed:', err && err.message));
}

/** Header click (or the controller's open button): open the panel at the tracker. */
function openPanel() {
  if (alive() && deps.onOpenPanel) deps.onOpenPanel(win.getBounds());
}

/**
 * Around a screenshot for the AI: out of the picture, then back. Separate from hideTemporarily/restore, so a capture
 * while the panel is opening never brings the tracker back on top of the panel. Returns whether it was hidden.
 * Fully transparent rather than hidden: a hide()/showInactive() cycle loses the button-down of every later click (the
 * same failure as reusing the window across panel cycles), and captures happen often (the markers' nearby check).
 */
function hideForCapture() {
  if (!alive() || suspended || captureHidden || !win.isVisible()) return false;
  captureHidden = true;
  pressed = false;
  win.setOpacity(0);
  return true;
}
function showAfterCapture() {
  if (!captureHidden) return;
  captureHidden = false;
  if (alive() && !suspended) win.setOpacity(1);
}

/** Put the tracker above other always-on-top windows (the hidden panel's spine never covers it). */
function raise() {
  if (alive() && !suspended && win.isVisible()) win.moveTop();
}

/** The accent colour and the spine's hover label, in the app's language (from the last tracker data). */
function getLook() {
  const d = current && current.data;
  return { accent: (d && d.accent) || '#a87ffb', label: (d && d.labels && d.labels.spine) || 'Open Quest Compendium' };
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
const keysLabel = () => formatAccelerator(keys);

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
      const h = Math.max(40, Math.min(maxHeight() + 12, Math.round(msg.height || 0)));
      const b = win.getBounds();
      if (w !== b.width || h !== b.height) win.setBounds({ x: b.x, y: b.y, width: w, height: h });
      placeWindow(msg.view);
      // A new window's first layout with the data: show it now, already at its size and spot.
      if (revealPending && msg.hasData) reveal();
      break;
    }
    case 'press':
      pressed = !!msg.down;
      if (pressed) setMouse(true);
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
      if (Number.isFinite(msg.backdrop)) p.backdrop = Math.max(0, Math.min(95, Math.round(msg.backdrop)));
      patchSettings(gameKey, p);
      break;
    }
    case 'tick': {
      // A guide entry or an answer marker ticked on the tracker: the app saves it where the guide page and the
      // checklist keep theirs, and sends the rebuilt tracker back.
      const item = current && current.data.sections.flatMap((x) => x.items).find((o) => o.id === msg.item && o.tick);
      if (!item) break;
      item.done = !!msg.done;
      tell({ type: 'tick', item: item.id, done: item.done });
      break;
    }
    case 'section':
      // A section folded or opened by its heading: remembered for this game.
      if (typeof msg.id === 'string' && SECTION_IDS.includes(msg.id)) {
        const folded = { ...(settingsFor(gameKey).collapsed || {}) };
        if (msg.collapsed) folded[msg.id] = true;
        else delete folded[msg.id];
        patchSettings(gameKey, { collapsed: folded });
      }
      break;
    case 'goto-area':
      // The ‹ › arrows or the area list: the app makes that guide area the player's place and rebuilds the tracker.
      if (typeof msg.name === 'string' && current && current.data.areas && current.data.areas.names.includes(msg.name)) {
        tell({ type: 'goto-area', name: msg.name });
      }
      break;
    case 'locate':
      // "Locate me": the app takes a screenshot (the tracker made invisible for it) and asks which area this is.
      tell({ type: 'locate' });
      break;
    case 'hide-item': {
      // An entry's ×, or "Show N hidden" (hidden: false): remembered for this game (ids carry the area).
      const ids = (Array.isArray(msg.ids) ? msg.ids : [msg.id]).filter((id) => typeof id === 'string' && id).map((id) => id.slice(0, 200));
      if (!ids.length) break;
      const set = new Set(settingsFor(gameKey).hidden);
      for (const id of ids) {
        if (msg.hidden === false) set.delete(id);
        else set.add(id);
      }
      patchSettings(gameKey, { hidden: [...set].slice(-MAX_HIDDEN) });
      break;
    }
    case 'limit':
      // A section's count clicked: 3, 6 or all (0) entries shown, for this game.
      if (SECTION_IDS.includes(msg.section) && [0, 3, 6].includes(msg.limit)) {
        patchSettings(gameKey, { limits: { ...settingsFor(gameKey).limits, [msg.section]: msg.limit } });
      }
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
    case 'open-entry':
    case 'ask-about': {
      // An expanded entry's buttons: the panel opens at the tracker, then the app shows the entry in the guide, or puts a
      // question about it in the question box (not sent).
      const item = current && current.data.sections.flatMap((x) => x.items).find((o) => o.id === msg.item);
      if (!item) break;
      openPanel();
      tell({ type: msg.type, item: item.id, label: item.label });
      break;
    }
    default:
      break;
  }
}

function init(d) {
  deps = d;
  storeFile = path.join(d.app.getPath('userData'), 'tracker.json');
  d.ipcMain.on('tracker-msg', onMessage);
  d.ipcMain.handle('tracker-show', (e, payload) => show(payload && payload.data, payload && payload.gameKey).catch((err) => { console.warn('[tracker]', err && err.message); return false; }));
  d.ipcMain.on('tracker-update', (e, p) => update(p && p.data ? p.data : p, p && p.gameKey));
  d.ipcMain.on('tracker-hide', () => hide());
  d.ipcMain.on('tracker-peek', () => js('window.qcTrackerPeek()'));
  d.app.on('will-quit', hide);
}

module.exports = {
  init, show, update, hide, hideTemporarily, restore, setKeys, hideForCapture, showAfterCapture, getBounds,
  setVisibleInRecordings, setScale, openPanel, raise, getLook,
  isOpen: () => alive(),
  /** On screen right now (not hidden behind the open panel). */
  isShowing: () => alive() && !suspended && win.isVisible(),
};
