const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const oldSlideIn = `function slideIn() {
  if (!mainWindow) return;
  isAppVisible = true;
  mainWindow.show();
  mainWindow.focus();
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(false);
    animateWindow(coords.x, coords.y, 200);
  }
}`;

const newSlideIn = `function slideIn() {
  if (!mainWindow) return;
  isAppVisible = true;
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.focus();
  // Force focus for games
  app.focus({ steal: true });
  
  if (currentDockPosition !== 'undocked') {
    const coords = getDockCoords(false);
    animateWindow(coords.x, coords.y, 150);
  }
}`;

if (code.includes(oldSlideIn)) {
  code = code.replace(oldSlideIn, newSlideIn);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched slideIn");
}
