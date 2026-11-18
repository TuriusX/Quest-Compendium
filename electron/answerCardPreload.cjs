// Bridge for the pop-up answer over the game (answerCard.html): what to show, More, the timer, and back: its size,
// whether More has more, the mouse over it, and its buttons (More / Open / ✕).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcCard', {
  onShow: (cb) => ipcRenderer.on('card-show', (e, data) => cb(data || {})),
  onHide: (cb) => ipcRenderer.on('card-hide', () => cb()),
  onMore: (cb) => ipcRenderer.on('card-more', () => cb()),
  onTimer: (cb) => ipcRenderer.on('card-timer', (e, t) => cb(t || {})),
  size: (h) => ipcRenderer.send('card-size', Number(h) || 0),
  state: (s) => ipcRenderer.send('card-state', s || {}),
  mouse: (over) => ipcRenderer.send('card-mouse', !!over),
  action: (what) => ipcRenderer.send('card-action', String(what || '')),
});
