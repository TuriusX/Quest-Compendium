// Bridge for the quick menu over the game (wheel.html): what to show, controller input, and what was picked.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcWheel', {
  onOpen: (cb) => ipcRenderer.on('wheel-open', (e, data) => cb(data || {})),
  onClose: (cb) => ipcRenderer.on('wheel-close', () => cb()),
  onInput: (cb) => ipcRenderer.on('wheel-input', (e, evt) => cb(evt || {})),
  choose: (key) => ipcRenderer.send('wheel-choose', String(key || '')),
  talk: (state) => ipcRenderer.send('wheel-talk', state === 'cancel' ? 'cancel' : 'end'),
  dismiss: () => ipcRenderer.send('wheel-dismiss'),
});
