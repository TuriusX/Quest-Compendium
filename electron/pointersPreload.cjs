// Bridge for the on-screen marker page (pointers.html): lets it tell the app when the player has walked far enough
// for another area check. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcBridge', {
  // `occupied`: where markers are showing right now (0-1 fractions), so finds on top of them can be ignored.
  moved: (occupied) => ipcRenderer.send('pointers-moved', Array.isArray(occupied) ? occupied.slice(0, 20) : []),
  // The screen never matched the answer's screenshot: the app says so and offers the markers on the screenshot.
  unplaced: () => ipcRenderer.send('pointers-unplaced'),
  // Markers v2: the view changed and the screen is still now: find the markers again.
  refind: () => ipcRenderer.send('pointers-refind'),
  // A marker's ×: the mouse is over it (the window takes clicks only then), and the player closed that marker
  // (its index in the answer's list; -1 for one found later, which isn't in the list).
  mouse: (on) => ipcRenderer.send('pointers-mouse', !!on),
  dismissed: (index) => ipcRenderer.send('pointers-dismissed', Number.isInteger(index) ? index : -1),
});
