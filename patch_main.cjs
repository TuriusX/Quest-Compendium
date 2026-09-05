const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf8');

// We need to add the fetching logic from the user's old build
const fetchLogic = `
let globalPercentagesCache = {};

async function getGlobalRarities(appId) {
  if (globalPercentagesCache[appId]) return globalPercentagesCache[appId];
  try {
    const fetch = require('cross-fetch');
    const res = await fetch(\`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=\${appId}&format=json\`);
    const data = await res.json();
    const list = data?.achievementpercentages?.achievements || [];
    const map = {};
    list.forEach(a => { map[a.name] = parseFloat(a.percent); });
    globalPercentagesCache[appId] = map;
    return map;
  } catch (e) {
    return {};
  }
}

async function fetchFullAchievementDetails(appId, steamId) {
  if (!steamId || !appId) return null;
  try {
    const fetch = require('cross-fetch');
    
    // Check if it's a numeric 64-bit ID or a vanity URL
    let url = '';
    if (/^\\d{17}$/.test(steamId)) {
      url = \`https://steamcommunity.com/profiles/\${steamId}/stats/\${appId}/?xml=1\`;
    } else {
      url = \`https://steamcommunity.com/id/\${steamId}/stats/\${appId}/?xml=1\`;
    }

    const profileRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    if (!profileRes.ok) return null;
    let xml = await profileRes.text();
    if (xml.includes('<error>') || !xml.includes('<achievements>')) return null;

    const rarities = await getGlobalRarities(appId);

    // Parse each <achievement> node
    const achievementBlocks = [...xml.matchAll(/<achievement closed="([01])">([\\s\\S]*?)<\\/achievement>/gi)];
    if (achievementBlocks.length === 0) return null;

    const achievements = achievementBlocks.map(match => {
      const isUnlocked = match[1] === "1";
      const block = match[2];

      const apiname = (block.match(/<apiname>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/apiname>/i) || [])[1] || '';
      const name = (block.match(/<name>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/name>/i) || [])[1] || apiname;
      const description = (block.match(/<description>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/description>/i) || [])[1] || '';
      const icon = (block.match(/<iconClosed>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/iconClosed>/i) || 
                    block.match(/<iconOpen>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/iconOpen>/i) || [])[1] || '';
      const unlockTimestamp = (block.match(/<unlockTimestamp>(\\d+)<\\/unlockTimestamp>/i) || [])[1];

      let unlockDate = null;
      if (isUnlocked && unlockTimestamp) {
        const d = new Date(parseInt(unlockTimestamp, 10) * 1000);
        unlockDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }

      const rarity = rarities[apiname.toLowerCase()] !== undefined ? Math.round(rarities[apiname.toLowerCase()] * 10) / 10 : null;

      let tier = 'bronze';
      if (rarity !== null) {
        if (rarity < 10) tier = 'gold';
        else if (rarity <= 30) tier = 'silver';
      }

      return {
        apiname,
        name,
        description,
        icon,
        unlocked: isUnlocked,
        unlockDate,
        rarity,
        tier
      };
    });

    return achievements;
  } catch (err) {
    return null;
  }
}
`;

code = code.replace("const { app, BrowserWindow", fetchLogic + "\nconst { app, BrowserWindow");

// Find where active-game-detected is sent
const activeGameSendRegex = /mainWindow\.webContents\.send\\('active-game-detected', activeSteamGame\\);/g;

code = code.replace(activeGameSendRegex, `mainWindow.webContents.send('active-game-detected', activeSteamGame);
                    // Also trigger a fetch request from the backend to get achievements if steamId is present
                    // Wait, we don't have steamId here. We can just wait for the renderer to ask for it, OR we can add an IPC handle.
`);

// Let's just add an IPC handle for fetching achievements locally
code += `
ipcMain.handle('fetch-achievements-locally', async (event, appId, steamId) => {
  return await fetchFullAchievementDetails(appId, steamId);
});

ipcMain.handle('fetch-news-locally', async (event, appId) => {
  try {
    const fetch = require('cross-fetch');
    const url = \`https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=\${appId}&count=3&maxlength=500&format=json\`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.appnews?.newsitems || [];
  } catch (e) {
    return [];
  }
});
`;

fs.writeFileSync('electron/main.cjs', code);
