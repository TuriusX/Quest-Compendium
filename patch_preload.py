import re
with open('electron/preload.cjs', 'r') as f:
    code = f.read()

if "forceFocus:" not in code:
    code = code.replace("closeApp: () => ipcRenderer.send('close-app'),", "closeApp: () => ipcRenderer.send('close-app'),\n  forceFocus: () => ipcRenderer.send('force-focus'),")
    with open('electron/preload.cjs', 'w') as f:
        f.write(code)
    print("Patched preload.cjs")
else:
    print("Already patched")
