import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

old_pref = """    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },"""

new_pref = """    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },"""

if old_pref in code:
    code = code.replace(old_pref, new_pref)
    with open('electron/main.cjs', 'w') as f:
        f.write(code)
    print("Patched main.cjs with webviewTag")
else:
    print("Could not find webPreferences block")

