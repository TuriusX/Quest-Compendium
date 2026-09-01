process.noDeprecation = true;
const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, desktopCapturer, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;
let tray = null;

let localAuthPort = null;

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
  } else {
    res.writeHead(404); res.end();
  }
});
authServer.listen(0, '127.0.0.1', () => {
  localAuthPort = authServer.address().port;
});

// Disable features that break Firebase Auth popups (legacy)
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
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
  mainWindow.focus();
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(false);
    animateWindow(coords.x, coords.y, 200);
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
  const windowWidth = 450;
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: 800,
    x: screenWidth - windowWidth,
    y: 0,
    transparent: true,
    frame: false,
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

  mainWindow.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
  // Setup System Tray
  const iconPath = path.join(__dirname, isDev ? '../public/book.png' : '../dist/book.png');
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
  // Initialize AdBlocker for the webview partition
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  const fetch = require('cross-fetch');
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    // blocker.enableBlockingInSession(session.defaultSession); // Removed to prevent double IPC registration crash
    blocker.enableBlockingInSession(session.fromPartition('persist:browser_session'));
    console.log("Adblocker enabled for browser sessions");
  }).catch((err) => console.error("Adblocker failed:", err));

  
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
    const serverPath = path.join(__dirname, '../dist/server.cjs');
    serverProcess = spawn(process.execPath, [serverPath], {
      env: { ...process.env, NODE_ENV: 'production', PORT: 3000 }
    });
    serverProcess.stdout.on('data', (data) => console.log(`Server: ${data}`));
    serverProcess.stderr.on('data', (data) => console.error(`Server Error: ${data}`));
    setTimeout(createWindow, 1000);
  } else {
    createWindow();
  }

  // Register hotkey
  globalShortcut.register('CommandOrControl+Space', () => {
    if (isAppVisible) {
      slideOut();
    } else {
      slideIn();
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
      if (error) return;
      
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
                }
              }).catch(() => {});
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
  shell.openExternal(`https://ais-dev-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app/desktop-login?port=${localAuthPort}`);
});

ipcMain.on('resize-window', (event, width) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenWidth = primaryDisplay.workAreaSize.width;
    
    let newX = bounds.x;
    // Keep edge anchored
    if (currentDockPosition === 'top-right' || currentDockPosition === 'bottom-right') {
      newX = screenWidth - width;
    } else if (currentDockPosition === 'top-left' || currentDockPosition === 'bottom-left') {
      newX = 0;
    }
    // if undocked, maybe we just expand to the right. Or keep x the same.
    
    mainWindow.setBounds({
      x: newX,
      y: bounds.y,
      width: width,
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
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  let base64Image = null;
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1920, height: 1080 } 
    });
    const primaryScreen = sources[0]; 
    if (primaryScreen) {
      base64Image = primaryScreen.thumbnail.toDataURL();
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

ipcMain.on('close-app', () => { app.quit(); });

ipcMain.on('force-focus', () => { if (mainWindow) { mainWindow.focus(); mainWindow.webContents.focus(); } });
