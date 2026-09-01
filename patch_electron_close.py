import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

if "ipcMain.on('close-app'" not in code:
    code += "\nipcMain.on('close-app', () => { app.quit(); });\n"
    with open('electron/main.cjs', 'w') as f:
        f.write(code)
        
with open('electron/preload.cjs', 'r') as f:
    preload = f.read()

if "closeApp: () =>" not in preload:
    preload = preload.replace("takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),", "takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),\n  closeApp: () => ipcRenderer.send('close-app'),")
    with open('electron/preload.cjs', 'w') as f:
        f.write(preload)
print("Patched electron for close-app")
