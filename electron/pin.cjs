/**
 * Pin beside the game (owner, Nov 15 2026; roadmap item 30, step 3): a video or picture from an answer in a small
 * always-on-top window over the game. Drag it by its bar, resize it from its edges, make it see-through, pause with
 * the player's own controls, close it. One pin at a time: pinning another replaces it, in the same place and size.
 * The video plays in the same youtube-nocookie player as the overlay (the session's Referer rule covers it).
 */
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

let win = null;
let bounds = null; // where the last pin was, for the next one (this run of the app)

function open(item) {
  const kind = item && item.kind === 'picture' ? 'picture' : 'video';
  const query = kind === 'video'
    ? { kind, id: String(item.videoId || '').replace(/[^\w-]/g, '').slice(0, 20), start: String(Math.max(0, Math.round(Number(item.start) || 0))), title: String(item.title || '').slice(0, 200) }
    : { kind, url: String(item.url || '').slice(0, 2000), title: String(item.alt || item.title || '').slice(0, 200) };
  if (kind === 'video' && !query.id) return false;
  if (kind === 'picture' && !/^https:\/\//.test(query.url)) return false;
  if (win && !win.isDestroyed()) {
    win.loadFile(path.join(__dirname, 'pin.html'), { query });
    win.showInactive();
    return true;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const b = bounds || { width: 480, height: 300, x: area.x + area.width - 480 - 24, y: area.y + 24 };
  win = new BrowserWindow({
    ...b, minWidth: 240, minHeight: 170, frame: false, resizable: true, skipTaskbar: true, show: false,
    alwaysOnTop: true, backgroundColor: '#0b0a10', title: 'Quest Compendium: pinned',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'pinPreload.cjs') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  const w = win;
  const remember = () => { if (!w.isDestroyed()) bounds = w.getBounds(); };
  w.on('moved', remember);
  w.on('resized', remember);
  w.on('closed', () => { if (win === w) win = null; });
  w.once('ready-to-show', () => w.showInactive());
  w.loadFile(path.join(__dirname, 'pin.html'), { query });
  return true;
}

function close() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

function register() {
  ipcMain.handle('pin-visual', (_e, item) => open(item));
  ipcMain.on('pin-close', () => close());
  ipcMain.on('pin-opacity', (_e, v) => { const n = Number(v); if (win && !win.isDestroyed() && n >= 0.3 && n <= 1) win.setOpacity(n); });
}

module.exports = { register, close, open };
