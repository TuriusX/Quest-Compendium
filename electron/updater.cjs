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
 */
const START_DELAY_MS = 30 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

function initUpdater({ app, ipcMain, getMainWindow }) {
  const feed = process.env.QC_UPDATE_FEED || '';
  const state = { state: 'idle', version: '' };
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

  const tell = () => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send('app-update', state);
  };
  autoUpdater.on('update-available', (info) => console.log(`[update] ${info && info.version} available, downloading`));
  autoUpdater.on('update-not-available', () => console.log('[update] up to date'));
  autoUpdater.on('error', (err) => console.warn('[update] check failed:', err && (err.message || err)));
  autoUpdater.on('update-downloaded', (info) => {
    state.state = 'ready';
    state.version = String((info && info.version) || '');
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
    if (state.state === 'ready') return; // downloaded already: it installs on quit
    autoUpdater.checkForUpdates().catch((err) => console.warn('[update] check failed:', err && err.message));
  };
  setTimeout(check, Number(process.env.QC_UPDATE_DELAY_MS) || START_DELAY_MS);
  setInterval(check, EVERY_MS);
}

module.exports = { initUpdater };
