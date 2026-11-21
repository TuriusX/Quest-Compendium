// The companion app's page (electron/companion.cjs): it only learns that it is the companion, its version and how to
// quit. Deliberately not `electronAPI`: the desktop overlay's calls don't exist here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcCompanion', {
  version: ((process.argv.find((a) => a.startsWith('--qc-version=')) || '').split('=')[1]) || '',
  platform: process.platform,
  quit: () => ipcRenderer.send('companion-quit'),
});
