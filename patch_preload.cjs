const fs = require('fs');
let code = fs.readFileSync('electron/preload.cjs', 'utf8');

code = code.replace(
  "getActiveGame: () => ipcRenderer.invoke('get-active-game'),",
  "getActiveGame: () => ipcRenderer.invoke('get-active-game'),\n  fetchAchievementsLocally: (appId, steamId) => ipcRenderer.invoke('fetch-achievements-locally', appId, steamId),\n  fetchNewsLocally: (appId) => ipcRenderer.invoke('fetch-news-locally', appId),"
);

fs.writeFileSync('electron/preload.cjs', code);
