// Bridge for the pop-up answer over the game (answerCard.html): what to show, More, the timer, and back: its size,
// whether More has more, and its buttons (More / Open / ✕); what the mouse is over (the main process hit-tests it
// against the parts the page reports). The orb (Nov 19 2026): its state, and back: its clicks and its menu.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcCard', {
  onShow: (cb) => ipcRenderer.on('card-show', (e, data) => cb(data || {})),
  onHide: (cb) => ipcRenderer.on('card-hide', () => cb()),
  onMore: (cb) => ipcRenderer.on('card-more', () => cb()),
  onTimer: (cb) => ipcRenderer.on('card-timer', (e, t) => cb(t || {})),
  size: (h) => ipcRenderer.send('card-size', Number(h) || 0),
  state: (s) => ipcRenderer.send('card-state', s || {}),
  action: (what) => ipcRenderer.send('card-action', String(what || '')),
  onOrb: (cb) => ipcRenderer.on('orb-state', (e, s) => cb(s || {})),
  onHover: (cb) => ipcRenderer.on('orb-hover', (e, id) => cb(String(id || ''))),
  hits: (list) => ipcRenderer.send('orb-hits', Array.isArray(list) ? list : []),
  orb: (what) => ipcRenderer.send('orb-action', String(what || '')),
  // The quick menu's fan is out of the orb (Nov 19 2026): the orb glows brighter.
  onFan: (cb) => ipcRenderer.on('orb-fan', (e, on) => cb(!!on)),
});
