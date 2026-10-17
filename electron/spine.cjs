/**
 * The hidden panel: a slim pixel spine (electron/spine.html, in the app's style and the current theme's accent) peeking
 * from the screen edge on the dock side, vertically centred on where the docked panel sits. A click opens the panel. It replaces the strip of the panel window that used
 * to stay on screen: while the spine shows, the panel window itself is hidden.
 *
 * Undocked, tucking the panel away leaves the spine where the panel was: on its edge nearer the screen's side, centred
 * on its height. The attached quest log (and its bookmark) sticks out of the spine's inner side while it shows
 * (anchor()).
 *
 * Like the objectives tracker it never takes focus (the game keeps it) and a fresh window opens each time it's shown.
 * It keeps clear of the tracker: if they'd overlap it moves just below (or above) the tracker, and if there's no room
 * the tracker stays on top.
 *
 *   const spine = require('./spine.cjs');
 *   spine.init({ ipcMain, screen, onOpen, getDock, getTrackerBounds, raiseTracker, getLook });
 *   spine.show() when the docked panel has slid away, spine.hide() when it opens or is undocked; spine.refresh() when
 *   its look changes (the app's theme or language).
 */
const path = require('path');
const { BrowserWindow } = require('electron');

const W = 26; // the spine is 20 px; the other 6 are room for it to slide out on hover
const H = 112;
const h = H;
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
  const dock = deps.getDock();
  const { position, panelHeight } = dock;
  let wa = dock.workArea;
  let right, x, y;
  const p = position === 'undocked' ? dock.panelRect : null;
  if (p) {
    // Where the undocked panel was: its edge nearer the side of its screen, centred on it.
    wa = deps.screen.getDisplayMatching(p).workArea;
    right = p.x + p.width / 2 >= wa.x + wa.width / 2;
    x = right ? p.x + p.width - W : p.x;
    y = Math.round(p.y + p.height / 2 - h / 2);
  } else {
    right = !String(position).endsWith('left');
    x = right ? wa.x + wa.width - W : wa.x;
    const ph = Math.min(panelHeight || wa.height, wa.height);
    const centre = String(position).startsWith('bottom') ? wa.y + wa.height - ph / 2 : wa.y + ph / 2;
    y = Math.round(centre - h / 2);
  }
  const t = deps.getTrackerBounds && deps.getTrackerBounds();
  let clash = false;
  if (overlaps({ x, y, width: W, height: h }, t)) {
    const below = t.y + t.height + 8, above = t.y - 8 - h;
    if (below + h <= wa.y + wa.height) y = below;
    else if (above >= wa.y) y = above;
    else clash = true;
  }
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  return { x, y, right, clash };
}

/** The uncollected count on the book (the attached quest log tucked in): sent when it changes. */
let lastBadge = -1;
function badge() {
  if (!alive() || !deps.getBadge) return;
  const n = Math.max(0, Number(deps.getBadge()) || 0);
  if (n === lastBadge) return;
  lastBadge = n;
  win.webContents.executeJavaScript(`window.qcSpineBadge && window.qcSpineBadge(${n})`).catch(() => {});
}

function place() {
  if (!alive()) return;
  badge();
  const s = spot();
  const b = win.getBounds();
  if (b.x !== s.x || b.y !== s.y || b.height !== h) win.setBounds({ x: s.x, y: s.y, width: W, height: h });
  if (s.clash && deps.raiseTracker) deps.raiseTracker(); // no room to keep clear: the tracker stays on top
}

function drop() {
  lastBadge = -1;
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
    x: s.x, y: s.y, width: W, height: h,
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
    if (deps.onShown) deps.onShown(); // an attached quest log moves to the spine
  });
  // The tracker can be moved or resized while the spine shows: keep clear of it.
  watch = setInterval(place, 800);
}

/** Its look changed (the app's theme or language): a spine on screen is drawn again. */
function refresh() {
  if (shown) show();
}

/** The panel opened (or was undocked): no spine. */
function hide() {
  shown = false;
  drop();
}

function init(d) {
  deps = d;
  d.ipcMain.on('spine-msg', (e, msg) => {
    if (!alive() || e.sender !== win.webContents || !msg) return;
    if (msg.type === 'open') deps.onOpen();
  });
}

/**
 * What an attached quest log sticks out of while the panel is away: the spine's window and which screen edge it's
 * flush with (right: the log goes on its left). null while no spine shows.
 */
function anchor() {
  if (!shown || !alive() || !win.isVisible()) return null;
  const b = win.getBounds();
  return { rect: { x: b.x, y: b.y, width: b.width, height: b.height }, right: !/[?&]edge=left/.test(win.webContents.getURL()) };
}

module.exports = { init, show, hide, refresh, anchor, isShowing: () => shown && alive(), bounds: () => (alive() ? win.getBounds() : null) };
