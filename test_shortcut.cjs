const { app, globalShortcut } = require('electron');
app.whenReady().then(() => {
  try {
    const res = globalShortcut.register('CmdOrCtrl+Shift+H', () => {});
    console.log("CmdOrCtrl+Shift+H:", res);
  } catch(e) {
    console.log("Error 1", e.message);
  }
  try {
    const res = globalShortcut.register('CommandOrControl+Shift+H', () => {});
    console.log("CommandOrControl+Shift+H:", res);
  } catch(e) {
    console.log("Error 2", e.message);
  }
  app.quit();
});
