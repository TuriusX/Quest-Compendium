const fs = require('fs');
let content = fs.readFileSync('electron/main.cjs', 'utf-8');

// Remove the existing IPC handler
const ipcStart = content.indexOf("let firebaseAuthWindow = null;");
const ipcEnd = content.indexOf("ipcMain.on('start-steam-login', (event) => {");
if (ipcStart !== -1 && ipcEnd !== -1) {
  content = content.slice(0, ipcStart) + content.slice(ipcEnd);
}

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
  
  // Allow the popup from signInWithPopup
  firebaseAuthWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'allow' };
  });

  firebaseAuthWindow.loadURL('https://gen-lang-client-0366642934.firebaseapp.com/');

  firebaseAuthWindow.webContents.on('did-finish-load', () => {
    const currentUrl = firebaseAuthWindow.webContents.getURL();
    if (currentUrl.includes('gen-lang-client-0366642934.firebaseapp.com')) {
      firebaseAuthWindow.webContents.executeJavaScript(\`
        document.body.innerHTML = \\\`
          <div style="background:#070709;color:white;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;padding:20px;margin:0;box-sizing:border-box;position:absolute;top:0;left:0;width:100%;">
            <h1 id="status" style="margin-bottom:10px;">Quest Compendium Auth</h1>
            <p id="desc" style="color:#a1a1aa;margin-bottom:24px;">Click below to sign in securely with Google.</p>
            <button id="loginBtn" style="background:white;color:black;border:none;padding:12px 24px;border-radius:24px;font-weight:bold;font-size:16px;cursor:pointer;">Sign in with Google</button>
          </div>
        \\\`;
        
        document.getElementById('loginBtn').addEventListener('click', () => {
          document.getElementById('loginBtn').style.display = 'none';
          document.getElementById('desc').style.display = 'none';
          document.getElementById('status').innerText = 'Opening Google Login...';
          
          import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js").then(({initializeApp}) => {
            import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js").then(({getAuth, signInWithPopup, GoogleAuthProvider}) => {
              const app = initializeApp({
                projectId: "gen-lang-client-0366642934",
                appId: "1:525238388984:web:714689b601aa7da3d9530d",
                apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
                authDomain: "gen-lang-client-0366642934.firebaseapp.com"
              });
              const auth = getAuth(app);
              const provider = new GoogleAuthProvider();
              
              signInWithPopup(auth, provider).then(result => {
                document.getElementById('status').innerText = 'Success! Syncing with app...';
              }).catch(err => {
                document.getElementById('status').innerText = 'Login Error: ' + err.message;
                document.getElementById('loginBtn').style.display = 'block';
                document.getElementById('desc').style.display = 'block';
              });
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
