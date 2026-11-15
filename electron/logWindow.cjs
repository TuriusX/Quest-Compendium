/**
 * The popped-out quest log (owner, Nov 15 2026): the app's own quest log, drawn by the panel's page into a window of
 * its own over the game (window.open('', 'qc-log') + a React portal), so popped out and docked are the same log.
 * The old popped-out page (tracker.html) keeps only its edge ribbon and heads-ups.
 *
 * Like the tracker it never takes focus (the game keeps the keyboard) and stays above the game. It opens where it was
 * last, else beside the panel; dragged back against the panel's edge it docks again (the app is told: log-snap).
 */
const fs = require('fs');
const path = require('path');

const NAME = 'qc-log';
const W = 320;
const SNAP = 36; // px from the panel's edge that counts as "dropped back on it"
let deps = null;
let win = null;
let saved = null; // { x, y, width, height }
let file = '';
let captureHidden = false;
let inRecordings = true;
let saveTimer = null;

const alive = () => !!win && !win.isDestroyed();

function load() {
  if (saved) return saved;
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) saved = s; } catch { /* first time */ }
  return saved;
}
function save() {
  if (!alive()) return;
  saved = win.getBounds();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(file, JSON.stringify(saved)); } catch { /* ignore */ } }, 400);
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Where it opens: its last spot if that's still on a screen and clear of the panel, else beside the panel. */
function spot() {
  const { screen } = deps;
  const p = deps.getPanelRect();
  const s = load();
  if (s) {
    const wa = screen.getDisplayMatching(s).workArea;
    const on = s.x >= wa.x - 8 && s.y >= wa.y - 8 && s.x + s.width <= wa.x + wa.width + 8 && s.y + s.height <= wa.y + wa.height + 8;
    if (on && !(p && overlaps(s, p))) return s;
  }
  const ref = p || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const wa = screen.getDisplayMatching(ref).workArea;
  const height = Math.min(Math.round((p ? p.height : wa.height) * 0.8), 760);
  const width = (s && s.width) || W;
  const GAP = 12;
  let x;
  if (p) {
    const roomLeft = p.x - wa.x, roomRight = wa.x + wa.width - (p.x + p.width);
    x = roomLeft >= roomRight ? p.x - width - GAP : p.x + p.width + GAP;
  } else x = wa.x + wa.width - width - 24;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min((p ? p.y : wa.y) + 40, wa.y + wa.height - height));
  return { x, y, width, height };
}

/** setWindowOpenHandler: the quest log's window, or null for anything else. */
function openOptions(details) {
  if (!details || details.frameName !== NAME) return null;
  const b = spot();
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height),
      minWidth: 260, minHeight: 240,
      frame: false, resizable: true, movable: true, focusable: false, skipTaskbar: true, show: false,
      minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
      backgroundColor: '#121119', title: 'Quest log',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    },
  };
}

/** did-create-window: keep it above the game, follow the recordings setting, remember where it's put. */
function adopt(w, details) {
  if (!details || details.frameName !== NAME) return false;
  win = w;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setContentProtection(!inRecordings);
  w.setMenu(null);
  // This window, not just "a" log window: it can close before these fire (the page reloads, the log docks at once).
  const live = () => !w.isDestroyed();
  w.once('ready-to-show', () => { if (live() && !w.isVisible()) { w.showInactive(); w.moveTop(); } });
  // Shown even if ready-to-show already went by (about:blank loads at once).
  setTimeout(() => { if (live() && !w.isVisible()) { w.showInactive(); w.moveTop(); } }, 120);
  w.on('resized', () => { if (w === win && alive()) save(); });
  w.on('moved', () => {
    if (w !== win || !alive()) return;
    save();
    // Dropped back against the panel's side: docks again.
    const p = deps.getPanelRect();
    if (!p || !alive()) return;
    const b = win.getBounds();
    const vert = b.y < p.y + p.height && p.y < b.y + b.height;
    const nearLeft = Math.abs(b.x + b.width - p.x) <= SNAP || (b.x < p.x && b.x + b.width > p.x);
    const nearRight = Math.abs(b.x - (p.x + p.width)) <= SNAP || (b.x < p.x + p.width && b.x + b.width > p.x + p.width);
    if (vert && (nearLeft || nearRight)) deps.tell({ type: 'log-snap' });
  });
  w.on('closed', () => { if (win === w) win = null; });
  return true;
}

function hideForCapture() {
  if (!alive() || captureHidden || !win.isVisible()) return false;
  captureHidden = true;
  win.setOpacity(0);
  return true;
}
function showAfterCapture() {
  if (!captureHidden) return;
  captureHidden = false;
  if (alive()) win.setOpacity(1);
}
/** For the markers' exclude list. */
const getBounds = () => (alive() && win.isVisible() && !captureHidden ? win.getBounds() : null);
function setVisibleInRecordings(on) {
  inRecordings = !!on;
  if (alive()) win.setContentProtection(!inRecordings);
}
/** Above the panel's spine and other always-on-top windows. */
function raise() { if (alive() && win.isVisible()) win.moveTop(); }

function init(d) {
  deps = d;
  file = path.join(d.app.getPath('userData'), 'quest-log-window.json');
}

module.exports = { init, openOptions, adopt, hideForCapture, showAfterCapture, getBounds, setVisibleInRecordings, raise };
