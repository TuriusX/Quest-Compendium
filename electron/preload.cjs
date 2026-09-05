const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getActiveGame: () => ipcRenderer.invoke('get-active-game'),
  startDesktopLogin: () => ipcRenderer.send('start-desktop-login'),
  startSteamLogin: () => ipcRenderer.send('start-steam-login'),
  setUiScale: (scale) => ipcRenderer.send('set-ui-scale', scale),
  resizeWindow: (width) => ipcRenderer.send('resize-window', width),
  setDockPosition: (pos) => ipcRenderer.send('set-dock-position', pos),
  toggleSlide: () => ipcRenderer.send('toggle-slide'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  closeApp: () => ipcRenderer.send('close-app'),
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  closeSettingsWindow: () => ipcRenderer.send('close-settings-window'),
  forceFocus: () => ipcRenderer.send('force-focus'),
  updateShortcuts: (shortcuts) => ipcRenderer.send('update-shortcuts', shortcuts),
  onDesktopAuthSuccess: (callback) => ipcRenderer.on('desktop-auth-success', (event, token) => callback(token)),
  onDesktopSteamSuccess: (callback) => ipcRenderer.on('desktop-steam-success', (event, steamId) => callback(steamId)),
  onActiveGameDetected: (callback) => ipcRenderer.on('active-game-detected', (event, gameData) => callback(gameData)),
  onTriggerVoiceInputStart: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-start'); ipcRenderer.on('trigger-voice-input-start', () => callback()); },
  onTriggerVoiceInputStop: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-stop'); ipcRenderer.on('trigger-voice-input-stop', () => callback()); },
  onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); }
});
