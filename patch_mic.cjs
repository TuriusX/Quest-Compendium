const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');
const patch = `
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });
`;
code = code.replace("const { session } = require('electron');", "const { session } = require('electron');\n" + patch);
fs.writeFileSync('electron/main.cjs', code);
