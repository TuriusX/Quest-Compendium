import re

with open('electron/main.cjs', 'r') as f:
    code = f.read()

# 1. Update imports
import_old = "const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, desktopCapturer } = require('electron');"
import_new = "const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, desktopCapturer, Tray, Menu, nativeImage } = require('electron');"
code = code.replace(import_old, import_new)

# 2. Add global tray variable
code = code.replace("let mainWindow = null;", "let mainWindow = null;\nlet tray = null;")

# 3. Add Tray initialization in app.whenReady()
ready_pattern = r"app\.whenReady\(\)\.then\(\(\) => \{"
tray_init = """app.whenReady().then(() => {
  // Setup System Tray
  const iconPath = path.join(__dirname, isDev ? '../public/book.bmp' : '../dist/book.bmp');
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
  });"""

code = code.replace("app.whenReady().then(() => {", tray_init)

with open('electron/main.cjs', 'w') as f:
    f.write(code)

print("Patched main.cjs with Tray")
