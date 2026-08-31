with open('electron/main.cjs', 'r') as f:
    code = f.read()

bad_str = "ipcMain.on('set-dock-position'  currentDockPosition = pos;"
good_str = """ipcMain.on('set-dock-position', (event, pos) => {
  currentDockPosition = pos;"""

if bad_str in code:
    code = code.replace(bad_str, good_str)
    code += """
ipcMain.on('toggle-slide', () => {
  if (isAppVisible) {
    slideOut();
  } else {
    slideIn();
  }
});
"""

with open('electron/main.cjs', 'w') as f:
    f.write(code)

