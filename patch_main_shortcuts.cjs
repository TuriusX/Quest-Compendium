const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const oldShortcut = `  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    currentVoiceShortcut = shortcuts.controllerVoiceShortcut;
    currentHideAppShortcut = shortcuts.controllerHideAppShortcut;
    globalShortcut.unregisterAll();
    
    if (shortcuts.hideAppShortcut) {
      try {
        globalShortcut.register(shortcuts.hideAppShortcut, () => {
          if (isAppVisible) {
            slideOut();
          } else {
            slideIn();
          }
        });
      } catch (err) {
        console.error("Failed to register hideAppShortcut", err);
      }
    }
    
    if (shortcuts.voiceInputShortcut) {
      try {
        globalShortcut.register(shortcuts.voiceInputShortcut, () => {
          if (mainWindow) {
            mainWindow.webContents.send('trigger-voice-input');
          }
        });
      } catch (err) {
        console.error("Failed to register voiceInputShortcut", err);
      }
    }
  });`;

const newShortcut = `  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    currentVoiceShortcut = shortcuts.controllerVoiceShortcut;
    currentHideAppShortcut = shortcuts.controllerHideAppShortcut;
    globalShortcut.unregisterAll();
    
    // Always ensure a fallback shortcut exists
    const hideAppCmd = shortcuts.hideAppShortcut || 'CommandOrControl+Space';
    
    try {
      globalShortcut.register(hideAppCmd, () => {
        if (isAppVisible) {
          slideOut();
        } else {
          slideIn();
        }
      });
    } catch (err) {
      console.error("Failed to register hideAppShortcut", err);
      try {
        globalShortcut.register('CommandOrControl+Space', () => {
          if (isAppVisible) slideOut(); else slideIn();
        });
      } catch(e) {}
    }
    
    const voiceCmd = shortcuts.voiceInputShortcut || 'CommandOrControl+Shift+V';
    try {
      globalShortcut.register(voiceCmd, () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-voice-input');
        }
      });
    } catch (err) {
      console.error("Failed to register voiceInputShortcut", err);
    }
  });`;

if (code.includes(oldShortcut)) {
  code = code.replace(oldShortcut, newShortcut);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched shortcuts");
}
