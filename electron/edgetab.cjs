/**
 * The tuck-away tab: a slim pixel pull-tab (electron/edgetab.html) sticking out of the open docked panel's inner edge,
 * outside its frame (the dock side is the screen edge, so there's no room there), vertically centred on the panel. A
 * click tucks the panel away, like the shortcut. It's its own small window, like the book spine, so nothing
 * transparent of the panel window sits over the game to catch clicks.
 *
 * It keeps clear of the quest log on the same edge (the attached log, or its bookmark): below it, else above it, else
 * it stays hidden (the header's tuck button does the same).
 *
 *   const edgetab = require('./edgetab.cjs');
 *   edgetab.init({ ipcMain, screen, getPanelRect, getDock, getTrackerBounds, onTuck, getLook });
 *   edgetab.sync() whenever the panel opens, hides, moves, or the dock changes.
 */
const path = require('path');
const { BrowserWindow } = require('electron');

const W = 18; // the tab is 12 px; 6 more for it to slide out on hover
const H = 64;
const GAP = 6;
let deps = null;
let win = null;
let watch = null;
let captureHidden = false;
let lastEdge = '';

const alive = () => win && !win.isDestroyed();
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Where it goes (null: nowhere, e.g. undocked, the panel away, or no room beside the quest log). */
function spot() {
  const p = deps.getPanelRect && deps.getPanelRect();
  const dock = String(deps.getDock ? deps.getDock() : '');
  if (!p || dock === 'undocked' || !dock) return null;
  const right = !dock.endsWith('left'); // docked right: the tab sticks out of the panel's left edge
  const x = right ? p.x - W : p.x + p.width;
  const wa = deps.screen.getDisplayMatching(p).workArea;
  const fits = (y) => y >= Math.max(wa.y, p.y) && y + H <= Math.min(wa.y + wa.height, p.y + p.height);
  let y = Math.round(p.y + p.height / 2 - H / 2);
  const t = deps.getTrackerBounds && deps.getTrackerBounds();
  if (overlaps({ x, y, width: W, height: H }, t)) {
    const below = t.y + t.height + GAP, above = t.y - GAP - H;
    if (fits(below)) y = below;
    else if (fits(above)) y = above;
    else return null;
  }
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - H));
  return { x, y, right };
}

function drop() {
  clearInterval(watch);
  watch = null;
  const w = win;
  win = null;
  lastEdge = '';
  if (w && !w.isDestroyed()) w.destroy();
}

/** Show, move or remove the tab for where the panel is now. */
function sync() {
  if (!deps) return;
  const s = spot();
  if (!s) { if (alive()) win.setOpacity(0); if (!(deps.getPanelRect && deps.getPanelRect())) drop(); return; }
  const edge = s.right ? 'right' : 'left';
  if (alive() && edge !== lastEdge) drop(); // a new dock side: drawn again, facing the other way
  if (!alive()) {
    const look = (deps.getLook && deps.getLook()) || {};
    win = new BrowserWindow({
      x: s.x, y: s.y, width: W, height: H,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'spinePreload.cjs') },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    lastEdge = edge;
    const w = win;
    win.loadFile(path.join(__dirname, 'edgetab.html'), { query: { edge, accent: look.accent || '', label: look.label || '' } });
    win.webContents.once('did-finish-load', () => {
      if (win !== w || w.isDestroyed()) return;
      w.setOpacity(captureHidden ? 0 : 1);
      w.showInactive();
    });
    // The quest log can grow, shrink or slide out beside it: keep clear.
    watch = setInterval(sync, 400);
    return;
  }
  const b = win.getBounds();
  if (b.x !== s.x || b.y !== s.y || b.width !== W || b.height !== H) win.setBounds({ x: s.x, y: s.y, width: W, height: H });
  win.setOpacity(captureHidden ? 0 : 1);
}

/** Out of the picture for a screenshot for the AI, then back. */
function setCaptureHidden(on) {
  captureHidden = !!on;
  if (alive()) win.setOpacity(captureHidden ? 0 : 1);
}

function init(d) {
  deps = d;
  d.ipcMain.on('spine-msg', (e, msg) => {
    if (!alive() || e.sender !== win.webContents || !msg) return;
    if (msg.type === 'open') deps.onTuck();
  });
}

module.exports = { init, sync, hide: drop, setCaptureHidden, bounds: () => (alive() ? win.getBounds() : null) };
