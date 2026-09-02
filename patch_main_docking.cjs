const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// I will make sure the dock position correctly rounds out any weird errors.
const oldGetDockCoords = `function getDockCoords(isHidden = false) {
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
}`;

const newGetDockCoords = `function getDockCoords(isHidden = false) {
  if (!mainWindow) return { x: 0, y: 0 };
  const primaryDisplay = screen.getPrimaryDisplay();
  const sWidth = primaryDisplay.workAreaSize.width;
  const sHeight = primaryDisplay.workAreaSize.height;
  
  const bounds = mainWindow.getBounds();
  
  let targetX = bounds.x;
  let targetY = bounds.y;
  const hideMargin = 8;
  
  if (currentDockPosition === 'top-right') {
    targetX = isHidden ? sWidth - hideMargin : sWidth - bounds.width;
    targetY = 0;
  } else if (currentDockPosition === 'bottom-right') {
    targetX = isHidden ? sWidth - hideMargin : sWidth - bounds.width;
    targetY = sHeight - bounds.height;
  } else if (currentDockPosition === 'top-left') {
    targetX = isHidden ? hideMargin - bounds.width : 0;
    targetY = 0;
  } else if (currentDockPosition === 'bottom-left') {
    targetX = isHidden ? hideMargin - bounds.width : 0;
    targetY = sHeight - bounds.height;
  }
  return { x: targetX, y: targetY };
}`;

if (code.includes(oldGetDockCoords)) {
  code = code.replace(oldGetDockCoords, newGetDockCoords);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched dock coords");
}
