with open('electron/main.cjs', 'r') as f:
    code = f.read()

bad = "ipcMain.on('set-dock-position'\n  currentDockPosition = pos;"
good = "ipcMain.on('set-dock-position', (event, pos) => {\n  currentDockPosition = pos;"

code = code.replace(bad, good)

with open('electron/main.cjs', 'w') as f:
    f.write(code)

