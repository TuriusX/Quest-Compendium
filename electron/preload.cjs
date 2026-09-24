const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getActiveGame: () => ipcRenderer.invoke('get-active-game'),
  fetchAchievementsLocally: (appId, steamId) => ipcRenderer.invoke('fetch-achievements-locally', appId, steamId),
  fetchSteamProfileLocally: (steamId) => ipcRenderer.invoke('fetch-steam-profile-locally', steamId),
  fetchNewsLocally: (appId) => ipcRenderer.invoke('fetch-news-locally', appId),
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
  onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); },
  onTriggerAutoScreenshot: (callback) => { ipcRenderer.removeAllListeners('trigger-auto-screenshot'); ipcRenderer.on('trigger-auto-screenshot', () => callback()); },
  // Controller support (see electron/controller.cjs)
  setOverlayOptions: (opts) => ipcRenderer.send('set-overlay-options', opts),
  // On-screen pointers (markers drawn over the game)
  showScreenPointers: (points, accent, opts) => ipcRenderer.invoke('show-screen-pointers', { points, accent, opts }),
  hideScreenPointers: () => ipcRenderer.send('hide-screen-pointers'),
  setControllerConfig: (cfg) => ipcRenderer.send('set-controller-config', cfg),
  getControllerStatus: () => ipcRenderer.invoke('get-controller-status'),
  onControllerInput: (callback) => { ipcRenderer.removeAllListeners('controller-input'); ipcRenderer.on('controller-input', (event, evt) => callback(evt)); },
  onControllerActivated: (callback) => { ipcRenderer.removeAllListeners('controller-activated'); ipcRenderer.on('controller-activated', () => callback()); }
});
