const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf8');

const resizeBlockStart = code.indexOf(`ipcMain.on('resize-window'`);
const setDockBlockStart = code.indexOf(`ipcMain.on('set-dock-position'`);

const newIpcCode = `ipcMain.on('set-ui-scale', (event, scale) => {
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
});\n\n`;

code = code.substring(0, resizeBlockStart) + newIpcCode + code.substring(setDockBlockStart);
fs.writeFileSync('electron/main.cjs', code);
