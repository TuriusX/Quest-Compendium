const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// 1. Fix Screenshot
const oldScreenshot = `      // Use JPEG with 80% quality to drastically reduce payload size for the AI
      const buffer = primaryScreen.thumbnail.resize({ width: 1280 }).toJPEG(80);
      base64Image = 'data:image/jpeg;base64,' + buffer.toString('base64');`;

const newScreenshot = `      // Use JPEG with 80% quality to drastically reduce payload size for the AI
      const buffer = primaryScreen.thumbnail.toJPEG(80);
      base64Image = 'data:image/jpeg;base64,' + buffer.toString('base64');`;

if (code.includes(oldScreenshot)) {
  code = code.replace(oldScreenshot, newScreenshot);
}

// 2. Fix Polling to use recursive setTimeout instead of setInterval
const oldPollStart = `if (process.platform === 'win32') {
  setInterval(pollGamepad, 50);
}`;
const newPollStart = `if (process.platform === 'win32') {
  setTimeout(pollGamepad, 50);
}`;
if (code.includes(oldPollStart)) {
  code = code.replace(oldPollStart, newPollStart);
}

// 3. Fix pollGamepad function to schedule itself
const oldPollGamepad = `async function pollGamepad() {
  if (!xinput) return;
  
  let anyVoicePressed = false;
  let anyHidePressed = false;
  
  for (let i = 0; i < 4; i++) {
    try {
      const state = await xinput.getState(i);
      const gamepad = state.gamepad;
      
      if (isXinputComboPressed(currentVoiceShortcut, gamepad)) anyVoicePressed = true;
      if (isXinputComboPressed(currentHideAppShortcut, gamepad)) anyHidePressed = true;
    } catch(e) {
      // Controller not connected at this index
    }
  }

  if (anyVoicePressed && !wasVoicePressed) {
    if (mainWindow) mainWindow.webContents.send('trigger-voice-input-start');
  } else if (!anyVoicePressed && wasVoicePressed) {
    if (mainWindow) mainWindow.webContents.send('trigger-voice-input-stop');
  }
  wasVoicePressed = anyVoicePressed;

  if (anyHidePressed && !wasHidePressed) {
    if (isAppVisible) slideOut(); else slideIn();
  }
  wasHidePressed = anyHidePressed;
}`;

const newPollGamepad = `async function pollGamepad() {
  if (!xinput) {
    setTimeout(pollGamepad, 50);
    return;
  }
  
  try {
    let anyVoicePressed = false;
    let anyHidePressed = false;
    
    for (let i = 0; i < 4; i++) {
      try {
        const state = await xinput.getState(i);
        const gamepad = state.gamepad;
        
        if (isXinputComboPressed(currentVoiceShortcut, gamepad)) anyVoicePressed = true;
        if (isXinputComboPressed(currentHideAppShortcut, gamepad)) anyHidePressed = true;
      } catch(e) {
        // Controller not connected at this index
      }
    }

    if (anyVoicePressed && !wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-start');
    } else if (!anyVoicePressed && wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-stop');
    }
    wasVoicePressed = anyVoicePressed;

    if (anyHidePressed && !wasHidePressed) {
      if (isAppVisible) slideOut(); else slideIn();
    }
    wasHidePressed = anyHidePressed;
  } catch (err) {
    console.error("pollGamepad fatal error:", err);
  }

  setTimeout(pollGamepad, 50);
}`;

if (code.includes(oldPollGamepad)) {
  code = code.replace(oldPollGamepad, newPollGamepad);
}

fs.writeFileSync('electron/main.cjs', code);
console.log("Patched main.cjs");
