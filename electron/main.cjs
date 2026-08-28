const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;

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
let animationInterval = null;

function getDockCoords(isHidden = false) {
  if (!mainWindow) return { x: 0, y: 0 };
  const primaryDisplay = screen.getPrimaryDisplay();
  const sWidth = primaryDisplay.workAreaSize.width;
  const sHeight = primaryDisplay.workAreaSize.height;
  const bounds = mainWindow.getBounds();
  
  const targetX = isHidden ? sWidth - 8 : sWidth - bounds.width;
  const targetY = 0; // Dock top right

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
  const coords = getDockCoords(false);
  animateWindow(coords.x, coords.y, 200);
}

function slideOut() {
  if (!mainWindow) return;
  isAppVisible = false;
  const coords = getDockCoords(true);
  animateWindow(coords.x, coords.y, 150);
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
  const { session } = require('electron');
  
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

ipcMain.handle('get-active-game', async () => {
  return null;
});

// Trigger external browser for login
ipcMain.on('start-desktop-login', () => {
  shell.openExternal(`https://ais-dev-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app/desktop-login?port=${localAuthPort}`);
});
