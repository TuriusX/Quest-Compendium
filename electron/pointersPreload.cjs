// Bridge for the on-screen marker page (pointers.html): lets it tell the app when the player has walked far enough
// for another area check. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcBridge', {
  moved: () => ipcRenderer.send('pointers-moved'),
});
