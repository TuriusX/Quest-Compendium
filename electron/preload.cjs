const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getActiveGame: () => ipcRenderer.invoke('get-active-game'),
  startDesktopLogin: () => ipcRenderer.send('start-desktop-login'),
  onDesktopAuthSuccess: (callback) => ipcRenderer.on('desktop-auth-success', (event, token) => callback(token))
});
