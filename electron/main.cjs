process.noDeprecation = true;

let globalPercentagesCache = {};

async function getGlobalRarities(appId) {
  if (globalPercentagesCache[appId]) return globalPercentagesCache[appId];
  try {
    const fetch = require('cross-fetch');
    const res = await fetch(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`);
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
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/stats/${appId}/?xml=1`;
    }

    const profileRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    if (!profileRes.ok) return null;
    let xml = await profileRes.text();
    if (xml.includes('<error>') || !xml.includes('<achievements>')) return null;

    const rarities = await getGlobalRarities(appId);

    // Parse each <achievement> node
    const achievementBlocks = [...xml.matchAll(/<achievement closed="([01])">([\s\S]*?)<\/achievement>/gi)];
    if (achievementBlocks.length === 0) return null;

    const achievements = achievementBlocks.map(match => {
      const isUnlocked = match[1] === "1";
      const block = match[2];

      const apiname = (block.match(/<apiname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/apiname>/i) || [])[1] || '';
      const name = (block.match(/<name>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/name>/i) || [])[1] || apiname;
      const description = (block.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/i) || [])[1] || '';
      const icon = (block.match(/<iconClosed>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/iconClosed>/i) || 
                    block.match(/<iconOpen>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/iconOpen>/i) || [])[1] || '';
      const unlockTimestamp = (block.match(/<unlockTimestamp>(\d+)<\/unlockTimestamp>/i) || [])[1];

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

const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, desktopCapturer, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;
let tray = null;

let localAuthPort = null;

let currentUiScale = 1.0;
let baseLogicalWidth = 550;
let baseLogicalHeight = 800;

// Auth Server
const authServer = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });
    res.end();
    return;
  }

  if (req.url === '/desktop-login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Quest Compendium - Desktop Login</title>
        <style>
          body { background: #070709; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .spinner { width: 40px; height: 40px; border: 3px solid #a87ffb; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h1 { margin-bottom: 10px; }
          p { color: #a1a1aa; }
        </style>
      </head>
      <body>
        <div class="spinner" id="spinner"></div>
        <h1 id="status">Opening Google Login...</h1>
        <p>Please complete the sign-in popup.</p>
        
        <script type="module">
          import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
          import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
          
          const firebaseConfig = {
            projectId: "gen-lang-client-0366642934",
            appId: "1:525238388984:web:714689b601aa7da3d9530d",
            apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
            authDomain: "gen-lang-client-0366642934.firebaseapp.com"
          };
          
          const app = initializeApp(firebaseConfig);
          const auth = getAuth(app);
          const provider = new GoogleAuthProvider();
          
          try {
            const result = await signInWithPopup(auth, provider);
            const credential = GoogleAuthProvider.credentialFromResult(result);
            if (credential && credential.idToken) {
              document.getElementById('status').innerText = 'Login successful! Syncing...';
              await fetch('http://127.0.0.1:${localAuthPort}/auth-callback', {
                method: 'POST',
                body: JSON.stringify({ idToken: credential.idToken })
              });
              document.getElementById('status').innerText = 'Done! You can close this window.';
              document.getElementById('spinner').style.display = 'none';
              setTimeout(() => window.close(), 1500);
            }
          } catch(err) {
            console.error(err);
            document.getElementById('spinner').style.display = 'none';
            document.getElementById('status').innerText = 'Login Failed';
            document.getElementById('status').style.color = '#ef4444';
          }
        </script>
      </body>
      </html>
    `);
    return;
  }
  
  if (req.url === '/auth-callback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const creds = JSON.parse(body);
        if (mainWindow && creds.idToken) {
          mainWindow.webContents.send('desktop-auth-success', creds.idToken);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(500); res.end();
      }
    });
  } else if (req.url.startsWith('/steam-return')) {
    const urlObj = new URL(req.url, `http://127.0.0.1:${localAuthPort}`);
    const claimedId = urlObj.searchParams.get('openid.claimed_id');
    let steamId = null;
    if (claimedId) {
      const match = claimedId.match(/\/id\/(\d+)/);
      if (match) steamId = match[1];
    }
    
    if (settingsWindow) {
      settingsWindow.webContents.send('desktop-steam-success', steamId);
    } else if (mainWindow) {
      mainWindow.webContents.send('desktop-steam-success', steamId);
    }
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><script>window.close();</script>Authentication successful. You may close this window.</body></html>');
    
    if (steamAuthWindow) {
      steamAuthWindow.close();
    }
    return;
  } else {
    res.writeHead(404); res.end();
  }
});

let steamAuthWindow = null;
authServer.listen(0, '127.0.0.1', () => {
  localAuthPort = authServer.address().port;
});

// Disable features that break Firebase Auth popups (legacy)
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let isAppVisible = true;
let currentDockPosition = "top-right";
let animationInterval = null;

function getDockCoords(isHidden = false) {
  if (!mainWindow) return { x: 0, y: 0 };
  const primaryDisplay = screen.getPrimaryDisplay();
  const sWidth = primaryDisplay.workAreaSize.width;
  const sHeight = primaryDisplay.workAreaSize.height;
  const bounds = mainWindow.getBounds();
  
  let targetX = bounds.x;
  let targetY = bounds.y;
  
  if (currentDockPosition === 'top-right') {
    targetX = isHidden ? sWidth - 8 : sWidth - bounds.width;
    targetY = 0;
  } else if (currentDockPosition === 'bottom-right') {
    targetX = isHidden ? sWidth - 8 : sWidth - bounds.width;
    targetY = sHeight - bounds.height;
  } else if (currentDockPosition === 'top-left') {
    targetX = isHidden ? 8 - bounds.width : 0;
    targetY = 0;
  } else if (currentDockPosition === 'bottom-left') {
    targetX = isHidden ? 8 - bounds.width : 0;
    targetY = sHeight - bounds.height;
  }
  return { x: targetX, y: targetY };
}

function animateWindow(targetX, targetY, durationMs = 200) {
  return new Promise((resolve) => {
    if (!mainWindow) return resolve();
    
    const bounds = mainWindow.getBounds();
    const startX = bounds.x;
    const startY = bounds.y;
    const distanceX = targetX - startX;
    const distanceY = targetY - startY;
    
    if (distanceX === 0 && distanceY === 0) return resolve();

    const steps = 15;
    const stepTime = durationMs / steps;
    let currentStep = 0;

    if (animationInterval) clearInterval(animationInterval);

    animationInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const newX = Math.round(startX + (distanceX * easeOut));
      const newY = Math.round(startY + (distanceY * easeOut));
      
      const currentBounds = mainWindow.getBounds();
      mainWindow.setBounds({ x: newX, y: newY, width: currentBounds.width, height: currentBounds.height });

      if (currentStep >= steps) {
        clearInterval(animationInterval);
        mainWindow.setBounds({ x: targetX, y: targetY, width: currentBounds.width, height: currentBounds.height });
        resolve();
      }
    }, stepTime);
  });
}

function slideIn() {
  if (!mainWindow) return;
  isAppVisible = true;
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.focus();
  // Force focus for games
  app.focus({ steal: true });
  
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(false);
    animateWindow(coords.x, coords.y, 150);
  }
}

function slideOut() {
  if (!mainWindow) return;
  isAppVisible = false;
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(true);
    animateWindow(coords.x, coords.y, 150);
  } else {
    mainWindow.hide(); // if undocked, just hide it
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenWidth = primaryDisplay.workAreaSize.width;
  const windowWidth = 550;
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: 800,
    x: screenWidth - windowWidth,
    y: 0,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    icon: path.join(__dirname, isDev ? '../public/app-icon.ico' : '../dist/app-icon.ico'),
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      }
    };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}


app.whenReady().then(() => {
  // Setup System Tray
  const iconPath = path.join(__dirname, isDev ? '../public/app-icon.png' : '../dist/app-icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Quest Compendium');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => { slideIn(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (isAppVisible) {
      slideOut();
    } else {
      slideIn();
    }
  });
  const { session } = require('electron');

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  // Initialize AdBlocker for the webview partition
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  const fetch = require('cross-fetch');
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    // blocker.enableBlockingInSession(session.defaultSession); // Removed to prevent double IPC registration crash
    blocker.enableBlockingInSession(session.fromPartition('persist:browser_session'));
    console.log("Adblocker enabled for browser sessions");
  }).catch((err) => console.error("Adblocker failed:", err));
  } catch(e) { console.error("Adblocker module missing, skipping adblocker initialization."); }

  
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    Object.keys(responseHeaders).forEach((key) => {
      if (key.toLowerCase() === 'cross-origin-opener-policy' || key.toLowerCase() === 'cross-origin-embedder-policy') {
        delete responseHeaders[key];
      }
    });
    responseHeaders['Cross-Origin-Opener-Policy'] = ['unsafe-none'];
    responseHeaders['Cross-Origin-Embedder-Policy'] = ['unsafe-none'];
    callback({ responseHeaders });
  });

  if (!isDev) {
    setTimeout(createWindow, 1000);
  } else {
    createWindow();
  }

  // Register default hotkey
  globalShortcut.register('CommandOrControl+Space', () => {
    if (isAppVisible) {
      slideOut();
    } else {
      slideIn();
    }
  });

  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    globalShortcut.unregisterAll();
    
    // Always ensure a fallback shortcut exists
    const hideAppCmd = shortcuts.hideAppShortcut || 'CommandOrControl+Space';
    
    try {
      globalShortcut.register(hideAppCmd, () => {
        if (isAppVisible) {
          slideOut();
        } else {
          slideIn();
        }
      });
    } catch (err) {
      console.error("Failed to register hideAppShortcut", err);
      try {
        globalShortcut.register('CommandOrControl+Space', () => {
          if (isAppVisible) slideOut(); else slideIn();
        });
      } catch(e) {}
    }
    
    const voiceCmd = shortcuts.voiceInputShortcut || 'CommandOrControl+Shift+V';
    try {
      globalShortcut.register(voiceCmd, () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-voice-input');
        }
      });
    } catch (err) {
      console.error("Failed to register voiceInputShortcut", err);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
  globalShortcut.unregisterAll();
});

const { exec } = require('child_process');
let lastRunningAppId = 0;
let activeSteamGame = null;

// Checks the local Windows Registry for Steam's active game ID every 3 seconds
if (process.platform === 'win32') {
  setInterval(() => {
    exec('reg query HKCU\\Software\\Valve\\Steam /v RunningAppId', (error, stdout) => {
      if (error) {
        // Steam closed or registry key missing -> reset active game immediately
        if (lastRunningAppId !== 0 || activeSteamGame !== null) {
          lastRunningAppId = 0;
          activeSteamGame = null;
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('active-game-detected', null);
          }
        }
        return;
      }
      
      const match = stdout.match(/0x([0-9a-fA-F]+)/);
      if (match) {
        const currentAppId = parseInt(match[1], 16);
        
        if (currentAppId !== lastRunningAppId) {
          lastRunningAppId = currentAppId;
          
          if (currentAppId === 0) {
            activeSteamGame = null;
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('active-game-detected', null);
            }
          } else {
            // A game launched! Look up its name from Steam API
            fetch(`https://store.steampowered.com/api/appdetails?appids=${currentAppId}`)
              .then(res => res.json())
              .then(data => {
                if (data[currentAppId] && data[currentAppId].success) {
                  activeSteamGame = { name: data[currentAppId].data.name, appId: currentAppId };
                  if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('active-game-detected', activeSteamGame);
                  }
                } else {
                  // Fallback for non-Steam shortcuts or games missing store entries
                  activeSteamGame = { name: `Steam Game (${currentAppId})`, appId: currentAppId };
                  if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('active-game-detected', activeSteamGame);
                  }
                }
              }).catch(() => {});
          }
        }
      } else {
        // No match found -> clear active game
        if (lastRunningAppId !== 0 || activeSteamGame !== null) {
          lastRunningAppId = 0;
          activeSteamGame = null;
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('active-game-detected', null);
          }
        }
      }
    });
  }, 3000);
}

ipcMain.handle('get-active-game', async () => {
  return activeSteamGame;
});

// Trigger external browser for login
ipcMain.on('start-desktop-login', () => {
  shell.openExternal(`http://127.0.0.1:${localAuthPort}/desktop-login`);
});

ipcMain.on('start-steam-login', (event) => {
  if (steamAuthWindow) {
    steamAuthWindow.focus();
    return;
  }
  
  const returnUrl = `http://127.0.0.1:${localAuthPort}/steam-return`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': `http://127.0.0.1:${localAuthPort}`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  
  const steamLoginUrl = `https://steamcommunity.com/openid/login?${params.toString()}`;
  
  steamAuthWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Steam Login',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  steamAuthWindow.loadURL(steamLoginUrl);
  
  steamAuthWindow.on('closed', () => {
    steamAuthWindow = null;
  });
});

ipcMain.on('set-ui-scale', (event, scale) => {
  currentUiScale = scale;
  if (mainWindow) {
    mainWindow.webContents.setZoomFactor(scale);
    const bounds = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenWidth = primaryDisplay.workAreaSize.width;
    const sHeight = primaryDisplay.workAreaSize.height;

    const newWidth = Math.round(baseLogicalWidth * scale);
    const newHeight = Math.round(baseLogicalHeight * scale);

    let newX = bounds.x;
    let newY = bounds.y;

    if (currentDockPosition === 'top-right' || currentDockPosition === 'bottom-right') {
      newX = screenWidth - newWidth;
    } else if (currentDockPosition === 'top-left' || currentDockPosition === 'bottom-left') {
      newX = 0;
    }

    if (currentDockPosition === 'top-right' || currentDockPosition === 'top-left') {
      newY = 0;
    } else if (currentDockPosition === 'bottom-right' || currentDockPosition === 'bottom-left') {
      newY = sHeight - newHeight;
    }

    mainWindow.setBounds({
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    });
  }
});

ipcMain.on('resize-window', (event, width) => {
  baseLogicalWidth = width;
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenWidth = primaryDisplay.workAreaSize.width;
    const scaledWidth = Math.round(width * currentUiScale);
    const scaledHeight = Math.round(baseLogicalHeight * currentUiScale);
    
    let newX = bounds.x;
    if (currentDockPosition === 'top-right' || currentDockPosition === 'bottom-right') {
      newX = screenWidth - scaledWidth;
    } else if (currentDockPosition === 'top-left' || currentDockPosition === 'bottom-left') {
      newX = 0;
    }
    
    mainWindow.setBounds({
      x: newX,
      y: bounds.y,
      width: scaledWidth,
      height: scaledHeight
    });
  }
});

ipcMain.on('set-dock-position', (event, pos) => {
  currentDockPosition = pos;
  if (mainWindow) {
    if (pos === 'undocked') {
      // allow dragging
      mainWindow.setIgnoreMouseEvents(false);
    } else {
      const coords = getDockCoords(!isAppVisible);
      animateWindow(coords.x, coords.y, 150);
    }
  }
});

ipcMain.on('toggle-slide', () => {
  if (isAppVisible) {
    slideOut();
  } else {
    slideIn();
  }
});


ipcMain.handle('take-screenshot', async () => {
  const wasVisible = isAppVisible;
  
  if (wasVisible) {
    if (currentDockPosition !== 'undocked') {
      const coords = getDockCoords(true);
      await animateWindow(coords.x, coords.y, 150);
    } else {
      mainWindow.hide();
    }
    // Give window time to hide and OS to redraw the desktop / game screen
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  let base64Image = null;
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1280, height: 720 } 
    });
    
    // Pick the display where the cursor is currently located (the active monitor)
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    
    // Match by display_id if available, otherwise fallback to the first screen
    let targetSource = sources.find(s => s.display_id === activeDisplay.id.toString());
    if (!targetSource) {
      targetSource = sources[0];
    }

    if (targetSource && targetSource.thumbnail) {
      // Use JPEG with 80% quality to drastically reduce payload size for the AI
      const buffer = targetSource.thumbnail.toJPEG(80);
      base64Image = 'data:image/jpeg;base64,' + buffer.toString('base64');
    }
  } catch (error) {
    console.error('Screenshot failed:', error);
  }

  if (wasVisible) {
    if (currentDockPosition !== 'undocked') {
      const coords = getDockCoords(false);
      await animateWindow(coords.x, coords.y, 200);
    } else {
      mainWindow.show();
    }
  }
  return base64Image;
});

let settingsWindow = null;

ipcMain.on('open-settings-window', () => {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  
  settingsWindow = new BrowserWindow({
    width: 850,
    height: 700,
    backgroundColor: '#0c0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, isDev ? '../public/app-icon.ico' : '../dist/app-icon.ico')
  });

  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      }
    };
  });

  if (isDev) {
    settingsWindow.loadURL('http://localhost:3000/#settings');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'settings' });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
});

ipcMain.on('close-settings-window', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('close-app', () => { app.quit(); });

ipcMain.on('force-focus', () => { if (mainWindow) { mainWindow.focus(); mainWindow.webContents.focus(); } });

ipcMain.handle('fetch-achievements-locally', async (event, appId, steamId) => {
  return await fetchFullAchievementDetails(appId, steamId);
});

ipcMain.handle('fetch-steam-profile-locally', async (event, steamId) => {
  if (!steamId) return null;
  try {
    const fetch = require('cross-fetch');
    let url = '';
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/?xml=1`;
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) return null;
    let xml = await res.text();
    
    const steamIDMatch = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/) || xml.match(/<steamID>(.*?)<\/steamID>/);
    const avatarIconMatch = xml.match(/<avatarIcon><!\[CDATA\[(.*?)\]\]><\/avatarIcon>/) || xml.match(/<avatarIcon>(.*?)<\/avatarIcon>/);
    const avatarMediumMatch = xml.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/) || xml.match(/<avatarMedium>(.*?)<\/avatarMedium>/);
    const avatarFullMatch = xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/) || xml.match(/<avatarFull>(.*?)<\/avatarFull>/);
    
    return {
      steamName: steamIDMatch ? steamIDMatch[1] : undefined,
      avatarIcon: avatarIconMatch ? avatarIconMatch[1] : undefined,
      avatarMedium: avatarMediumMatch ? avatarMediumMatch[1] : undefined,
      avatarFull: avatarFullMatch ? avatarFullMatch[1] : undefined
    };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('fetch-news-locally', async (event, appId) => {
  try {
    const fetch = require('cross-fetch');
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appId}&count=3&maxlength=500&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.appnews?.newsitems || [];
  } catch (e) {
    return [];
  }
});
