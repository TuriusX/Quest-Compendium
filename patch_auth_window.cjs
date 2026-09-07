const fs = require('fs');
let content = fs.readFileSync('electron/main.cjs', 'utf-8');

// 1. Remove the entire /desktop-login route
const desktopLoginStart = content.indexOf("if (req.url === '/desktop-login') {");
const desktopLoginEnd = content.indexOf("if (req.url === '/auth-callback' && req.method === 'POST') {");
if (desktopLoginStart !== -1 && desktopLoginEnd !== -1) {
  content = content.slice(0, desktopLoginStart) + content.slice(desktopLoginEnd);
}

// 2. Replace start-desktop-login ipc handler
const ipcStartStr = "ipcMain.on('start-desktop-login', () => {";
const ipcStart = content.indexOf(ipcStartStr);
const ipcEnd = content.indexOf("});", ipcStart) + 3;

const newIpcHandler = `let firebaseAuthWindow = null;
ipcMain.on('start-desktop-login', () => {
  if (firebaseAuthWindow) {
    firebaseAuthWindow.focus();
    return;
  }
  
  firebaseAuthWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  firebaseAuthWindow.webContents.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  
  firebaseAuthWindow.loadURL('https://ais-pre-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app');

  firebaseAuthWindow.webContents.on('did-finish-load', () => {
    firebaseAuthWindow.webContents.executeJavaScript(\`
      const banner = document.createElement('div');
      banner.style.position = 'fixed';
      banner.style.top = '0';
      banner.style.left = '0';
      banner.style.width = '100%';
      banner.style.background = '#a87ffb';
      banner.style.color = 'white';
      banner.style.padding = '12px';
      banner.style.textAlign = 'center';
      banner.style.zIndex = '999999';
      banner.style.fontWeight = 'bold';
      banner.innerHTML = 'Desktop Login: Please sign in using the app below to connect your account.';
      document.body.appendChild(banner);
    \`).catch(() => {});
  });

  const pollInterval = setInterval(async () => {
    if (!firebaseAuthWindow || firebaseAuthWindow.isDestroyed()) {
      clearInterval(pollInterval);
      return;
    }
    
    try {
      const token = await firebaseAuthWindow.webContents.executeJavaScript(\`
        new Promise((resolve) => {
          try {
            const req = indexedDB.open('firebaseLocalStorageDb');
            req.onsuccess = (e) => {
              const db = e.target.result;
              try {
                const tx = db.transaction('firebaseLocalStorage', 'readonly');
                const store = tx.objectStore('firebaseLocalStorage');
                const getReq = store.getAll();
                getReq.onsuccess = (e) => {
                  const result = e.target.result;
                  if (result && result.length > 0) {
                    resolve(result[0].value.stsTokenManager.accessToken);
                  } else {
                    resolve(null);
                  }
                };
                getReq.onerror = () => resolve(null);
              } catch (err) {
                resolve(null);
              }
            };
            req.onerror = () => resolve(null);
          } catch(err) {
            resolve(null);
          }
        })
      \`);
      
      if (token && mainWindow) {
        mainWindow.webContents.send('desktop-auth-success', token);
        clearInterval(pollInterval);
        if (firebaseAuthWindow && !firebaseAuthWindow.isDestroyed()) {
          firebaseAuthWindow.close();
          firebaseAuthWindow = null;
        }
      }
    } catch (err) {
      // ignore
    }
  }, 2000);

  firebaseAuthWindow.on('closed', () => {
    firebaseAuthWindow = null;
    clearInterval(pollInterval);
  });
});`;

if (ipcStart !== -1 && ipcEnd !== -1) {
  content = content.slice(0, ipcStart) + newIpcHandler + content.slice(ipcEnd);
}

fs.writeFileSync('electron/main.cjs', content);
