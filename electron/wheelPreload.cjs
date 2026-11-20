// Bridge for the quick menu over the game (wheel.html): what to show, controller input, and what was picked.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcWheel', {
  onOpen: (cb) => ipcRenderer.on('wheel-open', (e, data) => cb(data || {})),
  onClose: (cb) => ipcRenderer.on('wheel-close', () => cb()),
  onInput: (cb) => ipcRenderer.on('wheel-input', (e, evt) => cb(evt || {})),
  choose: (key) => ipcRenderer.send('wheel-choose', String(key || '')),
  talk: (state) => ipcRenderer.send('wheel-talk', state === 'cancel' ? 'cancel' : 'end'),
  dismiss: () => ipcRenderer.send('wheel-dismiss'),
  // The fan from the orb (Nov 19 2026): the parts the mouse may reach, for the main process to hit-test.
  hits: (list) => ipcRenderer.send('wheel-hits', Array.isArray(list) ? list : []),
});
