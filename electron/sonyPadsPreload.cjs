// Bridge for the hidden PlayStation controller reader (sonyPads.html): its reports go to the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcSonyPads', {
  report: (r) => ipcRenderer.send('sony-pad-report', r),
  log: (msg) => ipcRenderer.send('sony-pad-log', String(msg || '')),
});
