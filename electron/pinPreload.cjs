// The pin window's bar: close it and make it see-through (electron/pin.cjs).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pin', {
  close: () => ipcRenderer.send('pin-close'),
  opacity: (v) => ipcRenderer.send('pin-opacity', v),
});
