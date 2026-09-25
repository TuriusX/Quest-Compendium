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
    const cacheBuster = `_t=${Date.now()}`;
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1&${cacheBuster}`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/stats/${appId}/?xml=1&${cacheBuster}`;
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
app.setName('Quest Compendium');
const path = require('path');
const { spawn } = require('child_process');
const { createControllerService } = require('./controller.cjs');
const { createFocusHelper } = require('./focus.cjs');
const focusHelper = createFocusHelper();
const http = require('http');

const isDev = !app.isPackaged;
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
    res.end([
      "<!DOCTYPE html>",
      "<html>",
      "<head>",
      "  <title>Quest Compendium - Desktop Login</title>",
      "  <style>",
      "    body { background: #070709; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }",
      "    .spinner { width: 40px; height: 40px; border: 3px solid #a87ffb; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; display: none; }",
      "    @keyframes spin { to { transform: rotate(360deg); } }",
      "    h1 { margin-bottom: 10px; }",
      "    p { color: #a1a1aa; margin-bottom: 24px; text-align: center; max-width: 400px; }",
      "    button { background: white; color: black; border: none; padding: 12px 24px; border-radius: 24px; font-weight: bold; font-size: 16px; cursor: pointer; transition: background 0.2s; }",
      "    button:hover { background: #e4e4e7; }",
      "  </style>",
      "</head>",
      "<body>",
      "  <div class=\"spinner\" id=\"spinner\"></div>",
      "  <h1 id=\"status\">Quest Compendium Auth</h1>",
      "  <p id=\"desc\">Click the button below to sign in securely with Google.</p>",
      "  <button id=\"loginBtn\">Sign in with Google</button>",
      "  ",
      "  <script type=\"module\">",
      "    import { initializeApp } from \"https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js\";",
      "    import { getAuth, signInWithPopup, GoogleAuthProvider } from \"https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js\";",
      "    ",
      "    const firebaseConfig = {",
      "      apiKey: \"AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY\",",
      "      authDomain: \"quest-compendium-1bccf.firebaseapp.com\",",
      "      projectId: \"quest-compendium-1bccf\",",
      "      storageBucket: \"quest-compendium-1bccf.firebasestorage.app\",",
      "      messagingSenderId: \"890629309063\",",
      "      appId: \"1:890629309063:web:87293cf13f922fd3edee22\",",
      "      measurementId: \"G-XX6RW18GHY\"",
      "    };",
      "    ",
      "    const app = initializeApp(firebaseConfig);",
      "    const auth = getAuth(app);",
      "    const provider = new GoogleAuthProvider();",
      "    provider.addScope('openid');",
      "    provider.addScope('email');",
      "    provider.addScope('profile');",
      "    provider.setCustomParameters({ prompt: 'select_account' });",
      "    ",
      "    document.getElementById('loginBtn').addEventListener('click', async () => {",
      "      document.getElementById('loginBtn').style.display = 'none';",
      "      document.getElementById('desc').style.display = 'none';",
      "      document.getElementById('spinner').style.display = 'block';",
      "      document.getElementById('status').innerText = 'Opening Google Login...';",
      "      ",
      "      try {",
      "        const result = await signInWithPopup(auth, provider);",
      "        const credential = GoogleAuthProvider.credentialFromResult(result);",
      "        const user = result.user;",
      "        const firebaseIdToken = await user.getIdToken(true);",
      "        const googleIdToken = credential ? credential.idToken : null;",
      "        const googleAccessToken = credential ? credential.accessToken : null;",
      "        document.getElementById('status').innerText = 'Login successful! Syncing...';",
      "        await fetch('http://localhost:' + window.location.port + '/auth-callback', {",
      "          method: 'POST',",
      "          headers: { 'Content-Type': 'application/json' },",
      "          body: JSON.stringify({",
      "            idToken: googleIdToken || firebaseIdToken,",
      "            googleIdToken: googleIdToken,",
      "            googleAccessToken: googleAccessToken,",
      "            firebaseIdToken: firebaseIdToken",
      "          })",
      "        });",
      "        document.getElementById('status').innerText = 'Done! You can close this window.';",
      "        document.getElementById('spinner').style.display = 'none';",
      "        setTimeout(() => window.close(), 1200);",
      "      } catch(err) {",
      "        console.error(err);",
      "        document.getElementById('spinner').style.display = 'none';",
      "        document.getElementById('loginBtn').style.display = 'block';",
      "        document.getElementById('desc').style.display = 'block';",
      "        document.getElementById('status').innerText = 'Login Failed';",
      "        document.getElementById('desc').innerText = err.message || 'Please complete the sign-in popup.';",
      "      }",
      "    });",
      "  </script>",
      "</body>",
      "</html>"
    ].join('\n'));
    return;
  }

  if (req.url === '/auth-callback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const creds = JSON.parse(body);
        if (mainWindow && (creds.idToken || creds.googleIdToken || creds.firebaseIdToken)) {
          mainWindow.webContents.send('desktop-auth-success', creds);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(500); res.end();
      }
    });
  } else if (req.url.startsWith('/steam-return')) {
    const urlObj = new URL(req.url, `http://localhost:${localAuthPort}`);
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
authServer.listen(0, 'localhost', () => {
  localAuthPort = authServer.address().port;
});

// Disable features that break Firebase Auth popups (legacy)
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('allow-file-access-from-files');

app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let isAppVisible = true;
let controllerService = null;
// The window (usually the game) that had focus before the overlay opened, so focus can be handed back.
let focusBeforeOverlay = null;
// Snapshot on open: some games pause as soon as they lose focus, so the overlay grabs a screenshot of the game
// *before* it opens and takes focus. Questions asked during that visit use this clean snapshot.
let snapshotOnOpen = true;
let stickyPointers = true; // markers follow what they point at as the game scrolls
let markersInRecordings = true; // markers show up in screenshots / OBS / Game Bar
let overlaySession = 0;
let openSnapshot = null; // { image: dataUrl, session }
let openingInProgress = false;
let lastSlideInAt = 0;
// On-screen pointers: markers drawn over the game on the monitor the screenshot came from.
let lastCaptureDisplay = null;
let lastCaptureSourceId = null; // the screen the last screenshot came from (for sticky markers)
let lastCaptureImage = null; // that screenshot, used as the reference when markers track
let pointerWindow = null;
let pointerTimer = null;
// The marker session currently on screen: which answer it belongs to, and the nearby-item checks it has made.
let pointerSession = null;
const LOCATE_MIN_INTERVAL_MS = 4000;
const LOCATE_MAX_PER_SESSION = 20;
let markerLifetimeMs = 120000; // how long markers stay on screen (0 = until hidden or the scene changes)
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

async function slideIn(opts = {}) {
  if (!mainWindow) return;
  if (!isAppVisible) {
    if (opts.snapshot) {
      openSnapshot = { image: opts.snapshot, session: overlaySession + 1 };
    } else if (snapshotOnOpen && !openingInProgress) {
      // Capture the game while it's still focused and running (a fraction of a second, capped at 700 ms).
      openingInProgress = true;
      try {
        const image = await Promise.race([
          captureScreenImage(),
          new Promise((resolve) => setTimeout(() => resolve(null), 700)),
        ]);
        openSnapshot = image ? { image, session: overlaySession + 1 } : null;
      } catch (err) {
        openSnapshot = null;
      } finally {
        openingInProgress = false;
      }
      if (!mainWindow || mainWindow.isDestroyed()) return;
    }
    overlaySession++;
  }
  lastSlideInAt = Date.now();
  isAppVisible = true;
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.focus();
  // Take focus from the game (Windows won't let a background app do this on its own when the overlay was
  // opened with a controller), so the game stops reacting to controller input while the overlay is open.
  const previous = focusHelper.take(mainWindow);
  if (previous) focusBeforeOverlay = previous;
  // macOS equivalent
  app.focus({ steal: true });
  
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(false);
    animateWindow(coords.x, coords.y, 150);
  }
}

function slideOut() {
  if (!mainWindow) return;
  isAppVisible = false;
  // Hand focus back to the game so it gets the controller again.
  focusHelper.restore(mainWindow, focusBeforeOverlay);
  focusBeforeOverlay = null;
  openSnapshot = null; // the snapshot only lives for one visit
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
      webSecurity: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // If the player clicks back into the game while the overlay stays open, the opening snapshot is stale:
  // the next question takes a fresh screenshot instead. (Focus changes right after opening are ignored.)
  mainWindow.on('blur', () => {
    if (isAppVisible && Date.now() - lastSlideInAt > 1000) openSnapshot = null;
  });

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      baseLogicalHeight = bounds.height / currentUiScale;
    }
  });

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
    createWindow();
  } else {
    createWindow();
  }

  // Controller support: show/hide with a held button chord (even while a game is focused), and drive the
  // overlay with the controller while it's visible. See controller.cjs.
  controllerService = createControllerService({
    isVisible: () => !!mainWindow && !mainWindow.isDestroyed() && isAppVisible && mainWindow.isVisible(),
    onToggle: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (isAppVisible) {
        slideOut();
      } else {
        Promise.resolve(slideIn()).then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('controller-activated');
        });
      }
    },
    onInput: (evt) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('controller-input', evt);
    },
  });

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

    const autoScreenshotCmd = shortcuts.autoScreenshotShortcut || 'CommandOrControl+Shift+S';
    try {
      globalShortcut.register(autoScreenshotCmd, () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-auto-screenshot');
        }
      });
    } catch (err) {
      console.error("Failed to register autoScreenshotShortcut", err);
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
  if (controllerService) controllerService.stop();
  globalShortcut.unregisterAll();
});

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
let lastRunningAppId = 0;
let activeSteamGame = null;
let activeNameResolved = true;
let lastNameAttempt = 0;

// Steam tools that show up as the "running app" but aren't games.
const NON_GAME_APP_IDS = new Set([
  228980,  // Steamworks Common Redistributables (runs installers when a game launches)
  250820,  // SteamVR
  1070560, 1391110, 1628350, // Steam Linux Runtime
  1493710, 961940, 1887720, 2348590, // Proton versions
]);

const gameNameCache = new Map();

/** Steam's install folder(s) and every library folder, so names can be read from local manifests. */
function steamLibraryFolders() {
  const roots = [];
  if (process.platform === 'win32') {
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    try {
      const out = require('child_process').execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath', { encoding: 'utf8', timeout: 3000, windowsHide: true });
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
      if (m) roots.unshift(m[1].trim().replace(/\//g, '\\'));
    } catch (_) { /* fall back to default locations */ }
  } else {
    roots.push(path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local', 'share', 'Steam'));
  }
  const libs = new Set();
  for (const root of roots) {
    const steamapps = path.join(root, 'steamapps');
    if (!fs.existsSync(steamapps)) continue;
    libs.add(steamapps);
    try {
      const vdf = fs.readFileSync(path.join(steamapps, 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        libs.add(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'));
      }
    } catch (_) { /* no library file */ }
  }
  return [...libs];
}

/** The game's name from its local Steam manifest (fast, works offline, no rate limits). */
function nameFromManifest(appId) {
  for (const lib of steamLibraryFolders()) {
    try {
      const acf = fs.readFileSync(path.join(lib, `appmanifest_${appId}.acf`), 'utf8');
      const m = acf.match(/"name"\s+"([^"]+)"/);
      if (m && m[1].trim()) return m[1].trim();
    } catch (_) { /* not in this library */ }
  }
  return null;
}

/** The game's name from the Steam store (for games whose manifest can't be read). */
async function nameFromStore(appId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=english`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data && data[appId];
    return entry && entry.success && entry.data && entry.data.name ? entry.data.name : null;
  } catch (_) {
    return null;
  }
}

async function lookupGameName(appId) {
  if (gameNameCache.has(appId)) return gameNameCache.get(appId);
  const name = nameFromManifest(appId) || (await nameFromStore(appId));
  if (name) gameNameCache.set(appId, name);
  return name;
}

function sendActiveGame() {
  if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('active-game-detected', activeSteamGame);
}

async function resolveActiveName(appId) {
  lastNameAttempt = Date.now();
  const name = await lookupGameName(appId);
  if (appId !== lastRunningAppId) return; // a different game started meanwhile
  activeNameResolved = !!name;
  activeSteamGame = { name: name || `Steam Game (${appId})`, appId };
  sendActiveGame();
  console.log(`[detect] running app ${appId}: ${name || 'name not found yet, will retry'}`);
}

function processNewAppId(currentAppId) {
  // Launch helpers (redistributable installers, runtimes) aren't the game: keep whatever we had.
  if (NON_GAME_APP_IDS.has(currentAppId)) return;

  if (currentAppId !== lastRunningAppId) {
    lastRunningAppId = currentAppId;
    if (currentAppId === 0) {
      activeSteamGame = null;
      activeNameResolved = true;
      sendActiveGame();
    } else {
      resolveActiveName(currentAppId);
    }
    return;
  }

  // Same game, but its name couldn't be found yet (offline, store hiccup): try again every 20 seconds.
  if (currentAppId !== 0 && !activeNameResolved && Date.now() - lastNameAttempt > 20000) {
    resolveActiveName(currentAppId);
  }
}

// Checks the local Windows Registry or Linux VDF for Steam's active game ID every 3 seconds
setInterval(() => {
  if (process.platform === 'win32') {
    exec('reg query HKCU\\Software\\Valve\\Steam /v RunningAppId', (error, stdout) => {
      if (error) {
        processNewAppId(0);
        return;
      }
      const match = stdout.match(/0x([0-9a-fA-F]+)/);
      if (match) {
        processNewAppId(parseInt(match[1], 16));
      } else {
        processNewAppId(0);
      }
    });
  } else if (process.platform === 'linux') {
    const registryPaths = [
      path.join(os.homedir(), '.steam', 'registry.vdf'),
      path.join(os.homedir(), '.local', 'share', 'Steam', 'registry.vdf'),
      path.join(os.homedir(), '.steam', 'steam', 'registry.vdf')
    ];
    let currentAppId = 0;
    for (const p of registryPaths) {
      if (fs.existsSync(p)) {
        try {
          const data = fs.readFileSync(p, 'utf8');
          // Match "RunningAppID" "12345" or "RunningAppID"		"12345"
          const match = data.match(/"RunningAppID"\s+"?(\d+)"?/i);
          if (match) {
            currentAppId = parseInt(match[1], 10);
            break;
          }
        } catch(e) {}
      }
    }
    processNewAppId(currentAppId);
  }
}, 3000);

ipcMain.handle('get-active-game', async () => {
  return activeSteamGame;
});

// Trigger external browser for login
ipcMain.on('start-desktop-login', () => {
  shell.openExternal(`http://localhost:${localAuthPort}/desktop-login`);
});

ipcMain.on('start-steam-login', (event) => {
  if (steamAuthWindow) {
    steamAuthWindow.focus();
    return;
  }
  
  const returnUrl = `http://localhost:${localAuthPort}/steam-return`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': `http://localhost:${localAuthPort}`,
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
      height: bounds.height
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

ipcMain.on('set-overlay-options', (event, opts) => {
  if (opts && typeof opts.snapshotOnOpen === 'boolean') snapshotOnOpen = opts.snapshotOnOpen;
  if (opts && typeof opts.stickyPointers === 'boolean') stickyPointers = opts.stickyPointers;
  if (opts && typeof opts.markersInRecordings === 'boolean') markersInRecordings = opts.markersInRecordings;
  if (opts && Number.isFinite(opts.markerLifetimeMs) && opts.markerLifetimeMs >= 0) {
    markerLifetimeMs = opts.markerLifetimeMs;
    // Apply to markers already on screen too.
    if (pointerWindow && !pointerWindow.isDestroyed() && pointerSession && pointerSession.ready) {
      pointerWindow.webContents.executeJavaScript(`window.qcSetLifetime(${markerLifetimeMs})`).catch(() => {});
      if (pointerTimer) clearTimeout(pointerTimer);
      pointerTimer = null;
    }
  }
  if (!snapshotOnOpen) openSnapshot = null;
});

ipcMain.on('set-controller-config', (event, cfg) => {
  if (controllerService) controllerService.setConfig(cfg || {});
});

ipcMain.handle('get-controller-status', async () => ({ available: !!(controllerService && controllerService.available) }));

ipcMain.on('toggle-slide', () => {
  if (isAppVisible) {
    slideOut();
  } else {
    slideIn();
  }
});



/** Capture the screen the cursor is on (the game), as a JPEG data URL. Returns null on failure. */
async function captureScreenImage() {
  // Never capture our own on-screen pointers in the next screenshot.
  closeScreenPointers();
  let base64Image = null;
  {
    let sources = [];
    const getSourcesPromise = desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1280, height: 720 } 
    });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('desktopCapturer timeout')), 2500)
    );
    
    try {
      sources = await Promise.race([getSourcesPromise, timeoutPromise]);
    } catch (e) {
      console.warn('Screen capture primary failed or timed out:', e);
    }

    // Fallback to screen + window if screen alone returned no sources
    if (!sources || sources.length === 0) {
      try {
        sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 1280, height: 720 }
        });
      } catch (e) {
        console.warn('Fallback screen capture failed:', e);
      }
    }

    if (sources && sources.length > 0) {
      // Pick the display where the cursor is currently located (the active monitor)
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      
      // Match by display_id if available, otherwise fallback to active display or first screen
      let targetSource = sources.find(s => s.display_id === activeDisplay.id.toString());
      lastCaptureSourceId = targetSource ? targetSource.id : null;
      lastCaptureDisplay = targetSource && targetSource.display_id === activeDisplay.id.toString()
        ? activeDisplay
        : (screen.getAllDisplays().find(d => targetSource && d.id.toString() === targetSource.display_id) || activeDisplay);
      if (!targetSource) {
        targetSource = sources.find(s => !s.name?.toLowerCase().includes('quest compendium')) || sources[0];
      }

      if (targetSource && targetSource.thumbnail && !targetSource.thumbnail.isEmpty()) {
        // Use JPEG with 80% quality to drastically reduce payload size for the AI
        const buffer = targetSource.thumbnail.toJPEG(80);
        if (buffer && buffer.length > 0) {
          base64Image = 'data:image/jpeg;base64,' + buffer.toString('base64');
        }
      }
    }
  }
  lastCaptureImage = base64Image || lastCaptureImage;
  return base64Image;
}

/** Close the on-screen pointers, if any. */
function sendPointerState(id, active) {
  if (id && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pointers-state', { id, active });
}

function closeScreenPointers() {
  if (pointerTimer) clearTimeout(pointerTimer);
  pointerTimer = null;
  if (pointerWindow && !pointerWindow.isDestroyed()) pointerWindow.destroy();
  pointerWindow = null;
  if (pointerSession) sendPointerState(pointerSession.id, false);
  pointerSession = null;
}

/**
 * Draw markers over the game (electron/pointers.html). Points are 0-1 fractions of the captured screen.
 * The window is transparent, click-through and never takes focus, so the game keeps playing. It shows up in screen
 * recordings unless the player turns that off.
 * Sticky mode keeps each marker on its spot as the game scrolls (pointerTracker.js), for up to 2 minutes.
 */
function showScreenPointers(points, accent, opts = {}) {
  closeScreenPointers();
  const valid = (Array.isArray(points) ? points : [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    .slice(0, 5)
    .map((p) => ({ x: p.x, y: p.y, label: String(p.label || '').slice(0, 40) }));
  if (!valid.length) return false;
  const display = lastCaptureDisplay || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.bounds;
  const refImage = typeof opts.refImage === 'string' && opts.refImage.startsWith('data:image/') ? opts.refImage : lastCaptureImage;
  const sticky = (typeof opts.sticky === 'boolean' ? opts.sticky : stickyPointers) && !!lastCaptureSourceId && !!refImage;
  const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : null;
  const watchNearby = sticky && opts.watchNearby === true;
  const payload = {
    hidden: Array.isArray(opts.hidden) ? opts.hidden.filter((n) => Number.isInteger(n)) : [],
    // Items found earlier by area checks, each tracked against the screenshot it was found in.
    extra: (Array.isArray(opts.extra) ? opts.extra : []).map(cleanAdd).filter(Boolean).slice(0, 6),
    watchMoves: watchNearby,
    points: valid,
    accent: /^#[0-9a-fA-F]{3,8}$/.test(accent || '') ? accent : '#a87ffb',
    sticky,
    sourceId: lastCaptureSourceId,
    refImage: sticky ? refImage : null,
    selfVisible: markersInRecordings,
    lifetimeMs: markerLifetimeMs,
    // Our own overlay panel doesn't move with the game: keep the camera tracker from using it as background.
    exclude: (() => {
      try {
        if (!mainWindow || mainWindow.isDestroyed() || !isAppVisible) return [];
        const b = mainWindow.getBounds();
        return [{ x0: (b.x - x) / width, y0: (b.y - y) / height, x1: (b.x + b.width - x) / width, y1: (b.y + b.height - y) / height }];
      } catch (_) {
        return [];
      }
    })(),
    fixedMs: 8000,
  };
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'pointersPreload.cjs'),
    },
  });
  pointerWindow = win;
  pointerSession = { id: sessionId, win, watch: watchNearby, checks: 0, lastCheck: 0, inFlight: false, sourceId: lastCaptureSourceId, ready: false, queue: [] };
  const session = pointerSession;
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  // Either hidden from all screen capture, or visible in recordings (then the tracker ignores its own markers).
  // The app's own screenshots for the AI never include them either way: pointers are closed before capturing.
  win.setContentProtection(!markersInRecordings);
  win.on('closed', () => {
    if (pointerWindow === win) {
      pointerWindow = null;
      if (pointerTimer) clearTimeout(pointerTimer);
      pointerTimer = null;
      if (pointerSession && pointerSession.win === win) {
        sendPointerState(pointerSession.id, false);
        pointerSession = null;
      }
    }
  });
  // The marker page's "[markers] ..." diagnostics go to the app's log (visible in the desktop:dev output).
  win.webContents.on('console-message', (event, level, message) => {
    if (typeof message === 'string' && message.startsWith('[markers]')) console.log(message);
  });
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.executeJavaScript(`window.qcStart(${JSON.stringify(payload)})`).catch(() => {});
    win.showInactive();
    sendPointerState(sessionId, true);
    // Found items that arrived while the page was loading.
    session.ready = true;
    for (const add of session.queue) win.webContents.executeJavaScript(`window.qcAddPoints(${JSON.stringify(add)})`).catch(() => {});
    session.queue = [];
    for (const js of session.queueJs || []) win.webContents.executeJavaScript(js).catch(() => {});
    session.queueJs = [];
  });
  win.loadFile(path.join(__dirname, 'pointers.html'));
  // Safety net in case the page can't close itself.
  const safety = sticky ? payload.lifetimeMs : payload.fixedMs;
  if (safety > 0) pointerTimer = setTimeout(() => { if (pointerWindow === win) closeScreenPointers(); }, safety + 5000);
  return true;
}

ipcMain.handle('show-screen-pointers', async (event, payload) => {
  try {
    return showScreenPointers(payload && payload.points, payload && payload.accent, (payload && payload.opts) || {});
  } catch (err) {
    console.warn('[pointers] failed:', err && err.message);
    return false;
  }
});

ipcMain.on('hide-screen-pointers', () => closeScreenPointers());

// The player switched individual markers on or off in the answer's list.
ipcMain.on('pointers-hidden', (event, { id, hidden } = {}) => {
  if (!pointerSession || pointerSession.id !== id || !pointerWindow || pointerWindow.isDestroyed()) return;
  const list = Array.isArray(hidden) ? hidden.filter((n) => Number.isInteger(n)) : [];
  pointerWindow.webContents.executeJavaScript(`window.qcSetHidden(${JSON.stringify(list)})`).catch(() => {});
});

/** A screenshot of the marker session's screen, with our markers kept out of it. */
async function captureForLocate(session) {
  const win = session.win;
  try {
    if (win && !win.isDestroyed()) win.setContentProtection(true);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    const source = sources.find((s) => s.id === session.sourceId) || sources[0];
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return null;
    return 'data:image/jpeg;base64,' + source.thumbnail.toJPEG(75).toString('base64');
  } catch (err) {
    console.warn('[pointers] locate capture failed:', err && err.message);
    return null;
  } finally {
    if (win && !win.isDestroyed()) win.setContentProtection(!markersInRecordings);
  }
}

// The marker page says the player walked far enough: look for the answer's nearby items (free, rate-limited).
ipcMain.on('pointers-moved', async (event, occupied) => {
  const session = pointerSession;
  if (!session || !session.watch || !session.id || event.sender !== (session.win && !session.win.isDestroyed() && session.win.webContents)) return;
  const now = Date.now();
  if (session.inFlight || session.checks >= LOCATE_MAX_PER_SESSION || now - session.lastCheck < LOCATE_MIN_INTERVAL_MS) return;
  session.inFlight = true;
  session.lastCheck = now;
  session.checks++;
  const image = await captureForLocate(session);
  if (!image || pointerSession !== session || !mainWindow || mainWindow.isDestroyed()) {
    session.inFlight = false;
    return;
  }
  console.log(`[markers] area check ${session.checks} of ${LOCATE_MAX_PER_SESSION}`);
  const spots = (Array.isArray(occupied) ? occupied : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 20);
  mainWindow.webContents.send('locate-request', { id: session.id, image, occupied: spots });
  // If the app never answers (offline, closed), allow the next check anyway.
  setTimeout(() => { if (pointerSession === session) session.inFlight = false; }, 30000);
});

/** Validate markers found by an area check (points + the screenshot they were found in). */
function cleanAdd(add) {
  if (!add) return null;
  const valid = (Array.isArray(add.points) ? add.points : [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    .slice(0, 6)
    .map((p) => ({ x: p.x, y: p.y, label: String(p.label || '').slice(0, 40) }));
  if (!valid.length || typeof add.refImage !== 'string' || !add.refImage.startsWith('data:image/')) return null;
  return { points: valid, refImage: add.refImage, startIndex: Number.isInteger(add.startIndex) ? add.startIndex : 0 };
}

// Items found by an area check: add their markers to the session on screen (queued if the page is still loading).
ipcMain.on('pointers-add', (event, { id, points, refImage, startIndex } = {}) => {
  const session = pointerSession;
  if (!session || session.id !== id || !pointerWindow || pointerWindow.isDestroyed()) return;
  const payload = cleanAdd({ points, refImage, startIndex });
  if (!payload) return;
  payload.fromCheck = true; // found by an area check just now (placed from the camera movement since)
  console.log(`[markers] area check found: ${payload.points.map((p) => p.label).join(', ')}`);
  if (!session.ready) {
    session.queue.push(payload);
    return;
  }
  pointerWindow.webContents.executeJavaScript(`window.qcAddPoints(${JSON.stringify(payload)})`).catch(() => {});
});

// Precision pass: slide markers onto the exact object (queued if the page is still loading).
ipcMain.on('pointers-move', (event, { id, moves } = {}) => {
  const session = pointerSession;
  if (!session || session.id !== id || !pointerWindow || pointerWindow.isDestroyed()) return;
  const valid = (Array.isArray(moves) ? moves : [])
    .filter((m) => m && Number.isInteger(m.index) && Number.isFinite(m.x) && Number.isFinite(m.y) && m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)
    .slice(0, 5);
  if (!valid.length) return;
  const js = `window.qcMovePoints(${JSON.stringify({ moves: valid })})`;
  if (!session.ready) session.queueJs = [...(session.queueJs || []), js];
  else pointerWindow.webContents.executeJavaScript(js).catch(() => {});
});

// Diagnostics from the chat side (area checks, precision pass).
ipcMain.on('pointers-log', (event, message) => {
  if (typeof message === 'string') console.log(`[markers] ${message.slice(0, 300)}`);
});

// An area check finished: with nothing left to find, stop checking.
ipcMain.on('pointers-locate-done', (event, { id, remaining } = {}) => {
  const session = pointerSession;
  if (!session || session.id !== id) return;
  session.inFlight = false;
  if (!remaining) session.watch = false;
});

ipcMain.handle('take-screenshot', async () => {
  // A clean snapshot from when the overlay opened beats a fresh capture of a game that paused itself.
  if (isAppVisible && openSnapshot && openSnapshot.session === overlaySession) {
    return openSnapshot.image;
  }
  const wasVisible = isAppVisible;
  
  if (wasVisible) {
    try {
      if (currentDockPosition !== 'undocked') {
        const coords = getDockCoords(true);
        await animateWindow(coords.x, coords.y, 150);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    } catch (err) {
      console.warn('Failed to hide window for screenshot:', err);
    }
    // Give window time to hide and OS to redraw the desktop / game screen
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  let base64Image = null;
  try {
    base64Image = await captureScreenImage();
  } catch (error) {
    console.error('Screenshot failed:', error);
  } finally {
    try {
      // If the overlay was closed, this capture doubles as its "snapshot on open".
      slideIn({ snapshot: wasVisible ? undefined : base64Image });
    } catch (err) {
      console.error('Failed to slideIn window:', err);
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
      contextIsolation: true,
      webSecurity: false,
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
