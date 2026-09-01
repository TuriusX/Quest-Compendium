import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

old_req = "const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen } = require('electron');"
new_req = "const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, desktopCapturer } = require('electron');"

if old_req in code:
    code = code.replace(old_req, new_req)
else:
    print("Could not find electron require")

screenshot_code = """
ipcMain.handle('take-screenshot', async () => {
  const wasVisible = isAppVisible;
  if (wasVisible) {
    if (currentDockPosition !== 'undocked') {
      const coords = getDockCoords(true);
      await animateWindow(coords.x, coords.y, 150);
    } else {
      mainWindow.hide();
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  let base64Image = null;
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1920, height: 1080 } 
    });
    const primaryScreen = sources[0]; 
    if (primaryScreen) {
      base64Image = primaryScreen.thumbnail.toDataURL();
    }
  } catch (error) {
    console.error('Screenshot failed:', error);
  }

  if (wasVisible) {
    if (currentDockPosition !== 'undocked') {
      const coords = getDockCoords(false);
      await animateWindow(coords.x, coords.y, 200);
    } else {
      mainWindow.show();
    }
  }
  return base64Image;
});
"""

code += "\n" + screenshot_code

with open('electron/main.cjs', 'w') as f:
    f.write(code)

print("Patched electron/main.cjs")
