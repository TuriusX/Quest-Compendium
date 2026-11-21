/**
 * Quest Compendium for SteamOS (owner, Nov 20 2026): the companion app. A SteamOS handheld (Steam Deck, Legion Go S and
 * others) is the second screen (and, later, the controller) for a game played on a PC: ask by voice, read the answer, see the quest log, full screen.
 * See docs/proposals/deck-controller-pilot.md. Milestone 1: the companion screen on its own, through the account.
 *
 * One full-screen window with the app's own page (the same build as the desktop app's panel) in its companion layout
 * (src/utils/companion.ts): no overlay, no quest-log window, no orb, no capture of this device's screen. The page gets
 * `window.qcCompanion` (not `electronAPI`: none of the desktop overlay's calls exist here), so it runs as it does in a
 * browser, where the controller already works through the Gamepad API.
 *
 * Added to Steam as a non-Steam game, Steam gives it the controller and the whole screen. Run with --windowed (or
 * QC_COMPANION_WINDOWED=1) for a 1280x800 window on a desktop, to work on the layout.
 */
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const windowed = process.argv.includes('--windowed') || process.env.QC_COMPANION_WINDOWED === '1';
let win = null;

// One copy: Steam starting it twice brings the first to the front.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });

// Its own profile, so a desktop install of the full app on the same machine keeps its own sign-in and settings.
app.setName('Quest Compendium Companion');
app.setPath('userData', path.join(app.getPath('appData'), 'Quest Compendium Companion'));

function create() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !windowed,
    frame: windowed,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e15',
    show: false,
    title: 'Quest Compendium',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'companionPreload.cjs'), additionalArguments: [`--qc-version=${app.getVersion()}`] },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  // Sized for a 7-inch screen held in the hands: the page is laid out 853 units wide (the desktop panel's 550 plus the
  // quest log's 300) and scaled up to the screen (1.5x at 1280 x 800, 2.25x at 1920 x 1200), so text and buttons are touch-sized.
  const fit = () => { if (!win.isDestroyed()) win.webContents.setZoomFactor(Math.max(1, Math.min(3, win.getContentSize()[0] / 853))); };
  win.webContents.on('did-finish-load', fit);
  win.on('resize', fit);
  // Links to other sites open in their own window here (Game Mode has no browser to hand them to); B / Esc closes it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
    if (windowed) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow', overrideBrowserWindowOptions: { fullscreen: true, autoHideMenuBar: true, backgroundColor: '#0d0e15', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
  });
  app.on('web-contents-created', (e, wc) => {
    if (wc === win.webContents) return;
    wc.on('before-input-event', (ev, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { const w = BrowserWindow.fromWebContents(wc); if (w && w !== win) w.close(); } });
  });
  if (isDev && process.env.QC_COMPANION_URL) win.loadURL(`${process.env.QC_COMPANION_URL}#companion`);
  else if (isDev) win.loadURL('http://localhost:3000/#companion');
  else win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'companion' });
}

app.whenReady().then(() => {
  // The microphone for voice questions: the page's own, and nothing else (no camera, no screen capture, no location).
  const ours = (wc) => !!win && !win.isDestroyed() && wc === win.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(ours(wc) && permission === 'media' && !(details && Array.isArray(details.mediaTypes) && details.mediaTypes.includes('video')));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ours(wc) && permission === 'media');
  ipcMain.on('companion-quit', (e) => { if (ours(e.sender)) app.quit(); });
  create();
});
app.on('window-all-closed', () => app.quit());
