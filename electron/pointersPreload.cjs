// Bridge for the on-screen marker page (pointers.html): lets it tell the app when the player has walked far enough
// for another area check. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcBridge', {
  // `occupied`: where markers are showing right now (0-1 fractions), so finds on top of them can be ignored.
  moved: (occupied) => ipcRenderer.send('pointers-moved', Array.isArray(occupied) ? occupied.slice(0, 20) : []),
});
