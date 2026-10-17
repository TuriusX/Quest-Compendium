// Bridge for the owner's capture window (capture.html): receives the screenshot and what the app suggests it shows, and
// says when it's done. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcCapture', {
  onInit: (cb) => ipcRenderer.on('capture-init', (_e, data) => cb(data)),
  done: (saved) => ipcRenderer.send('capture-done', !!saved),
});
