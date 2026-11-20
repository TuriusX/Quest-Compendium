/**
 * Updates for the direct-download app (electron-updater against the GitHub releases of TuriusX/Quest-Compendium):
 * checks a little after launch and every 6 hours, downloads a new version quietly, then tells the app
 * ('app-update' { state: 'ready', version }) so it can show a non-blocking "Version X is ready, restart to update"
 * with a Later button. Restart installs it now (install-update); otherwise it installs when the app quits.
 * Errors (offline, a release without latest.yml) are logged and otherwise ignored.
 *
 * Not for the Microsoft Store package (the Store updates it) or a dev build. For testing, QC_UPDATE_FEED points it
 * at a generic feed (a folder with latest.yml and the installer, e.g. served by python -m http.server) instead of
 * GitHub, also in a dev build; QC_UPDATE_DELAY_MS shortens the first check and QC_UPDATE_TEST_INSTALL=1 installs as
 * soon as it's downloaded (what Restart to update does). Test builds need their own name, or they share the real
 * app's settings: docs/RELEASING.md.
 *
 * Release routine and rollback: docs/RELEASING.md.
 *
 * Owner, Nov 20 2026 ("the update seems to take a while"): the first check comes a few seconds after launch (it runs
 * in the background, startup never waits on it), and every window hears 'app-update' while a new version comes down
 * ({ state: 'downloading', version, percent }), so Settings can show checking -> downloading -> Restart now in place.
 */
const START_DELAY_MS = 5 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

function initUpdater({ app, ipcMain }) {
  const { BrowserWindow } = require('electron');
  const feed = process.env.QC_UPDATE_FEED || '';
  const state = { state: 'idle', version: '', percent: 0 };
  // Every window (the panel and Settings) hears where an update is.
  const tell = () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('app-update', { ...state });
  };
  ipcMain.handle('get-update-state', () => state);
  ipcMain.on('install-update', () => {});
  // Settings' "Check for updates": { state: 'current' | 'downloading' | 'ready' | 'failed' | 'store' | 'dev', version,
  // current }. 'downloading': a newer version was found and is coming down; "Version X is ready" follows when it's done.
  let autoUpdater = null;
  ipcMain.handle('check-for-updates', async () => {
    const current = app.getVersion();
    if (process.windowsStore === true) return { state: 'store', current };
    if (!autoUpdater) return { state: 'dev', current };
    if (state.state === 'ready') return { state: 'ready', version: state.version, current };
    if (state.state === 'downloading') return { state: 'downloading', version: state.version, percent: state.percent, current };
    try {
      const r = await autoUpdater.checkForUpdates();
      const v = String((r && r.updateInfo && r.updateInfo.version) || '');
      // currentVersion is electron-updater's SemVer of the installed app.
      const newer = !!v && !!autoUpdater.currentVersion && autoUpdater.currentVersion.compare(v) < 0;
      console.log(`[update] checked by hand: installed ${current}, latest ${v || '?'}`);
      return newer ? { state: 'downloading', version: v, current } : { state: 'current', version: v, current };
    } catch (err) {
      console.warn('[update] check by hand failed:', err && (err.message || err));
      return { state: 'failed', current };
    }
  });
  if (process.windowsStore === true) return console.log('[update] Store build: the Store updates it');
  if (!app.isPackaged && !feed) return console.log('[update] dev build: no update checks');

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    autoUpdater = null;
    return console.warn('[update] electron-updater unavailable:', err && err.message);
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = { info: (m) => console.log('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.warn('[update]', m), debug: () => {} };
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    console.log(`[update] test feed: ${feed}`);
  }

  autoUpdater.on('update-available', (info) => {
    console.log(`[update] ${info && info.version} available, downloading`);
    if (state.state === 'ready') return;
    state.state = 'downloading';
    state.version = String((info && info.version) || '');
    state.percent = 0;
    tell();
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.max(0, Math.min(100, Math.floor(Number(p && p.percent) || 0)));
    if (state.state !== 'downloading' || pct === state.percent) return;
    if (Math.floor(pct / 25) !== Math.floor(state.percent / 25)) console.log(`[update] downloading: ${pct}%`);
    state.percent = pct;
    tell();
  });
  autoUpdater.on('update-not-available', () => console.log('[update] up to date'));
  autoUpdater.on('error', (err) => {
    console.warn('[update] check failed:', err && (err.message || err));
    // A download that broke off: back to idle (the next check tries again); the windows stop showing progress.
    if (state.state === 'downloading') { state.state = 'failed'; state.percent = 0; tell(); state.state = 'idle'; }
  });
  autoUpdater.on('update-downloaded', (info) => {
    state.state = 'ready';
    state.version = String((info && info.version) || '');
    state.percent = 100;
    console.log(`[update] ${state.version} downloaded: installs on quit, or now with Restart`);
    tell();
    // Tests only (QC_UPDATE_TEST_INSTALL=1, with a test feed): install straight away, as Restart to update would.
    if (feed && process.env.QC_UPDATE_TEST_INSTALL === '1') setTimeout(() => autoUpdater.quitAndInstall(true, true), 1000);
  });

  ipcMain.removeAllListeners('install-update');
  ipcMain.on('install-update', () => {
    if (state.state !== 'ready') return;
    console.log('[update] restarting to install');
    app.isQuiting = true;
    // Silent install, and the app starts again afterwards.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  const check = () => {
    if (state.state === 'ready' || state.state === 'downloading') return; // downloaded already (installs on quit) or coming
    autoUpdater.checkForUpdates().catch((err) => console.warn('[update] check failed:', err && err.message));
  };
  setTimeout(check, Number(process.env.QC_UPDATE_DELAY_MS) || START_DELAY_MS);
  setInterval(check, EVERY_MS);
}

module.exports = { initUpdater };
