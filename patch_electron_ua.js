const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf8');

const target = `function createWindow() {`;
const replacement = `// Fix for Google Sign-In in Electron
app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function createWindow() {`;

code = code.replace(target, replacement);

const windowTarget = `    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });`;

const windowReplacement = `    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Allow Firebase Auth popups to function normally
  win.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      }
    };
  });`;

code = code.replace(windowTarget, windowReplacement);

fs.writeFileSync('electron/main.cjs', code);
