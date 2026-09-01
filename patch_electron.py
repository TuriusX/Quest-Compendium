import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

# Add desktopCapturer import
import_pattern = r"const \{ app, BrowserWindow, screen, ipcMain, shell, globalShortcut \} = require\('electron'\);"
if import_pattern not in code:
    # Just replace require('electron') globally for these if we don't know the exact string
    pass

