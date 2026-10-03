/**
 * The hidden panel: a small book spine (electron/spine.html) peeking from the screen edge on the dock side, vertically
 * centred on where the docked panel sits. A click opens the panel. It replaces the strip of the panel window that used
 * to stay on screen: while the spine shows, the panel window itself is hidden.
 *
 * Like the objectives tracker it never takes focus (the game keeps it) and a fresh window opens each time it's shown.
 * It keeps clear of the tracker: if they'd overlap it moves just below (or above) the tracker, and if there's no room
 * the tracker stays on top.
 *
 *   const spine = require('./spine.cjs');
 *   spine.init({ ipcMain, screen, onOpen, getDock, getTrackerBounds, raiseTracker, getLook });
 *   spine.show() when the docked panel has slid away, spine.hide() when it opens or is undocked.
 */
const path = require('path');
const { BrowserWindow } = require('electron');

const W = 34; // the spine is 26 px; the other 8 are room for it to slide out on hover
const H = 120;
let deps = null;
let win = null;
let watch = null;
let shown = false;

const alive = () => win && !win.isDestroyed();
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Where it goes: flush with the dock's screen edge, centred on the docked panel's height, moved below or above the
 * tracker when they'd overlap (and it fits there).
 */
function spot() {
  const { position, panelHeight, workArea: wa } = deps.getDock();
  const right = !String(position).endsWith('left');
  const x = right ? wa.x + wa.width - W : wa.x;
  const h = Math.min(panelHeight || wa.height, wa.height);
  const centre = String(position).startsWith('bottom') ? wa.y + wa.height - h / 2 : wa.y + h / 2;
  let y = Math.round(centre - H / 2);
  const t = deps.getTrackerBounds && deps.getTrackerBounds();
  let clash = false;
  if (overlaps({ x, y, width: W, height: H }, t)) {
    const below = t.y + t.height + 8, above = t.y - 8 - H;
    if (below + H <= wa.y + wa.height) y = below;
    else if (above >= wa.y) y = above;
    else clash = true;
  }
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - H));
  return { x, y, right, clash };
}

function place() {
  if (!alive()) return;
  const s = spot();
  const b = win.getBounds();
  if (b.x !== s.x || b.y !== s.y) win.setBounds({ x: s.x, y: s.y, width: W, height: H });
  if (s.clash && deps.raiseTracker) deps.raiseTracker(); // no room to keep clear: the tracker stays on top
}

function drop() {
  clearInterval(watch);
  watch = null;
  const w = win;
  win = null;
  if (w && !w.isDestroyed()) w.destroy();
}

/** The docked panel slid away: show the spine (a fresh window). */
function show() {
  if (!deps) return;
  shown = true;
  drop();
  const s = spot();
  const look = (deps.getLook && deps.getLook()) || {};
  win = new BrowserWindow({
    x: s.x, y: s.y, width: W, height: H,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'spinePreload.cjs') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  const w = win;
  win.loadFile(path.join(__dirname, 'spine.html'), {
    query: { edge: s.right ? 'right' : 'left', accent: look.accent || '', label: look.label || '' },
  });
  win.webContents.once('did-finish-load', () => {
    if (win !== w || !shown || w.isDestroyed()) return;
    w.showInactive();
    place();
    if (deps.raiseTracker) deps.raiseTracker(); // never above the quest log
  });
  // The tracker can be moved or resized while the spine shows: keep clear of it.
  watch = setInterval(place, 800);
}

/** The panel opened (or was undocked): no spine. */
function hide() {
  shown = false;
  drop();
}

function init(d) {
  deps = d;
  d.ipcMain.on('spine-msg', (e, msg) => {
    if (!alive() || e.sender !== win.webContents || !msg || msg.type !== 'open') return;
    deps.onOpen();
  });
}

module.exports = { init, show, hide, isShowing: () => shown && alive(), bounds: () => (alive() ? win.getBounds() : null) };
