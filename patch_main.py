import re

with open('electron/main.cjs', 'r') as f:
    code = f.read()

# Make the dock leave 24px visible when hidden, so the tab can fit nicely.
code = code.replace('targetX = isHidden ? sWidth - 8 : sWidth - bounds.width;', 'targetX = isHidden ? sWidth - 28 : sWidth - bounds.width;')
code = code.replace('targetX = isHidden ? 8 - bounds.width : 0;', 'targetX = isHidden ? 28 - bounds.width : 0;')

# Add IPC handler for toggle-slide
ipc_code = """ipcMain.on('set-dock-position', (event, pos) => {
  currentDockPosition = pos;
  if (mainWindow) {
    if (pos === 'undocked') {
      // allow dragging
      mainWindow.setIgnoreMouseEvents(false);
    } else {
      const coords = getDockCoords(!isAppVisible);
      animateWindow(coords.x, coords.y, 150);
    }
  }
});

ipcMain.on('toggle-slide', () => {
  if (isAppVisible) {
    slideOut();
  } else {
    slideIn();
  }
});
"""

code = code.replace("ipcMain.on('set-dock-position', (event, pos) => {", ipc_code.split("ipcMain.on('set-dock-position'")[0] + "ipcMain.on('set-dock-position'")

with open('electron/main.cjs', 'w') as f:
    f.write(code)

