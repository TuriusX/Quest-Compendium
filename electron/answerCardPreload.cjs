// Bridge for the answer card over the game (answerCard.html): what to show, and when to fade. Nothing goes back.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcCard', {
  onShow: (cb) => ipcRenderer.on('card-show', (e, data) => cb(data || {})),
  onHide: (cb) => ipcRenderer.on('card-hide', () => cb()),
});
