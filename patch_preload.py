with open('electron/preload.cjs', 'r') as f:
    code = f.read()

code = code.replace(
    "setDockPosition: (pos) => ipcRenderer.send('set-dock-position', pos),",
    "setDockPosition: (pos) => ipcRenderer.send('set-dock-position', pos),\n  toggleSlide: () => ipcRenderer.send('toggle-slide'),"
)

with open('electron/preload.cjs', 'w') as f:
    f.write(code)

