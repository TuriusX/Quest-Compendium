const { contextBridge, ipcRenderer } = require('electron');

// The objectives tracker page (electron/tracker.html) talks to the app through this one channel.
contextBridge.exposeInMainWorld('qcTracker', {
  send: (msg) => ipcRenderer.send('tracker-msg', msg),
});
