const fs = require('fs');
let content = fs.readFileSync('electron/main.cjs', 'utf-8');

// Remove existing local desktop-login endpoint
const desktopLoginStart = content.indexOf("if (req.url === '/desktop-login') {");
const authCallbackIndex = content.indexOf("if (req.url === '/auth-callback' && req.method === 'POST') {");
if (desktopLoginStart !== -1 && authCallbackIndex !== -1) {
  content = content.slice(0, desktopLoginStart) + content.slice(authCallbackIndex);
}

// Remove the simple IPC handler
const ipcStart = content.indexOf("ipcMain.on('start-desktop-login', () => {");
const ipcEnd = content.indexOf("ipcMain.on('start-steam-login', (event) => {");
if (ipcStart !== -1 && ipcEnd !== -1) {
  content = content.slice(0, ipcStart) + content.slice(ipcEnd);
}

// Add the robust remote window handler
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
  
  firebaseAuthWindow.loadURL('https://gen-lang-client-0366642934.firebaseapp.com/');

  firebaseAuthWindow.webContents.on('did-finish-load', () => {
    // Only inject if we are on the firebaseapp domain (not on the google login page)
    const currentUrl = firebaseAuthWindow.webContents.getURL();
    if (currentUrl.includes('gen-lang-client-0366642934.firebaseapp.com')) {
      firebaseAuthWindow.webContents.executeJavaScript(\`
        document.body.innerHTML = '<div style="background:#070709;color:white;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;padding:20px;"><div><h1 id="status">Starting Google Login...</h1><p>Please wait, redirecting...</p></div></div>';
        
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js").then(({initializeApp}) => {
          import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js").then(({getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider}) => {
            const app = initializeApp({
              projectId: "gen-lang-client-0366642934",
              appId: "1:525238388984:web:714689b601aa7da3d9530d",
              apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
              authDomain: "gen-lang-client-0366642934.firebaseapp.com"
            });
            const auth = getAuth(app);
            
            getRedirectResult(auth).then(result => {
              if (result) {
                 document.getElementById('status').innerText = 'Success! Syncing with app...';
              } else {
                 const provider = new GoogleAuthProvider();
                 signInWithRedirect(auth, provider);
              }
            }).catch(err => {
               document.getElementById('status').innerText = 'Login Error: ' + err.message;
            });
          });
        });
      \`).catch(() => {});
    }
  });

  const pollInterval = setInterval(async () => {
    if (!firebaseAuthWindow || firebaseAuthWindow.isDestroyed()) {
      clearInterval(pollInterval);
      return;
    }
    
    try {
      const currentUrl = firebaseAuthWindow.webContents.getURL();
      if (!currentUrl.includes('gen-lang-client-0366642934.firebaseapp.com')) return;

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
});\n\n`;

content = content.replace("ipcMain.on('start-steam-login', (event) => {", newIpcHandler + "ipcMain.on('start-steam-login', (event) => {");

fs.writeFileSync('electron/main.cjs', content);
