import re
with open('electron/preload.cjs', 'r') as f:
    code = f.read()

old_code = "toggleSlide: () => ipcRenderer.send('toggle-slide'),"
new_code = "toggleSlide: () => ipcRenderer.send('toggle-slide'),\n  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),"

if old_code in code:
    code = code.replace(old_code, new_code)
    with open('electron/preload.cjs', 'w') as f:
        f.write(code)
    print("Patched electron/preload.cjs")
else:
    print("Could not find toggleSlide in preload.cjs")
