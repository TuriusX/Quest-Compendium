const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const oldCheck = `    // Automatically capture screen if none is attached
    if (!attachedImageRef.current && !isCapturingScreen) {
      pendingScreenshotRef.current = captureGameScreen();
    }`;

const newCheck = `    // Automatically capture screen if none is attached
    if (!attachedImageRef.current) {
      pendingScreenshotRef.current = captureGameScreen();
    }`;

if (code.includes(oldCheck)) {
  code = code.replace(oldCheck, newCheck);
  fs.writeFileSync('src/components/ChatArea.tsx', code);
  console.log("Patched ChatArea.tsx");
} else {
  console.log("Could not find check");
}
