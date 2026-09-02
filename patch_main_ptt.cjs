const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// Replace the pollGamepad logic
code = code.replace(
  /const isVoicePressed = isXinputComboPressed\(currentVoiceShortcut, gamepad\);[\s\S]*?wasVoicePressed = isVoicePressed;/,
  `const isVoicePressed = isXinputComboPressed(currentVoiceShortcut, gamepad);
    if (isVoicePressed && !wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-start');
    } else if (!isVoicePressed && wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-stop');
    }
    wasVoicePressed = isVoicePressed;`
);

fs.writeFileSync('electron/main.cjs', code);
console.log("Patched main.cjs for PTT");
