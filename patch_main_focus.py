import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

if "ipcMain.on('force-focus'" not in code:
    code += "\nipcMain.on('force-focus', () => { if (mainWindow) { mainWindow.focus(); mainWindow.webContents.focus(); } });\n"
    with open('electron/main.cjs', 'w') as f:
        f.write(code)
    print("Patched main.cjs with force-focus")
else:
    print("Already patched")
