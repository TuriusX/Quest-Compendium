const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const startIdx = code.indexOf('mainWindow.loadURL(\'http://localhost:3000\');\n}');
const endIdx = code.indexOf('app.whenReady().then(() => {');

if (startIdx > -1 && endIdx > -1) {
  const newCode = code.slice(0, startIdx + 48) + '\n' + code.slice(endIdx);
  fs.writeFileSync('electron/main.cjs', newCode);
  console.log("Fixed main.cjs junk");
}
