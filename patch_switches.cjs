const fs = require('fs');
let mainCode = fs.readFileSync('electron/main.cjs', 'utf8');

const target = `// Fix for Google Sign-In in Electron
app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";`;

const replacement = `// Disable features that break Firebase Auth popups
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');

// Fix for Google Sign-In in Electron
app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";`;

if (mainCode.includes(target)) {
  mainCode = mainCode.replace(target, replacement);
  fs.writeFileSync('electron/main.cjs', mainCode);
  console.log('Patched main.cjs switches');
}
