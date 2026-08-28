const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;

// Register custom protocol for auth redirect
const PROTOCOL = 'questcompendium';
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // commandLine has the url on Windows/Linux
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      handleAuthUrl(url);
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthUrl(url);
});

function handleAuthUrl(url) {
  try {
    const urlObj = new URL(url);
    const idToken = urlObj.searchParams.get('idToken');
    if (idToken && mainWindow) {
      mainWindow.webContents.send('desktop-auth-success', idToken);
    }
  } catch (error) {
    console.error('Failed to parse auth URL', error);
  }
}

// Disable features that break Firebase Auth popups (legacy)
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');

// Fix for Google Sign-In in Electron
app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Allow Firebase Auth popups to function normally
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
    // In production, spawn the bundled Express server
    const serverPath = path.join(__dirname, '../dist/server.cjs');
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: 3000
      }
    });

    serverProcess.stdout.on('data', (data) => console.log(`Server: ${data}`));
    serverProcess.stderr.on('data', (data) => console.error(`Server Error: ${data}`));

    // Wait a brief moment for the server to bind to the port
    setTimeout(createWindow, 1000);
  } else {
    // In dev, we assume 'npm run desktop:dev' is handling the server boot
    createWindow();
  }

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
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Example IPC handler for game detection (to be implemented locally)
ipcMain.handle('get-active-game', async () => {
  // Logic to read local processes using ffi-napi or similar would go here
  return null;
});

// Trigger external browser for login
ipcMain.on('start-desktop-login', () => {
  shell.openExternal('http://localhost:3000/desktop-login');
});
