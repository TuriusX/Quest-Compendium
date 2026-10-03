const { contextBridge, ipcRenderer } = require('electron');

// The hidden panel's book spine (electron/spine.html): a click asks the app to open the panel.
contextBridge.exposeInMainWorld('qcSpine', {
  open: () => ipcRenderer.send('spine-msg', { type: 'open' }),
});
