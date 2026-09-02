const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// 1. Update pollGamepad to check all 4 slots
const oldPollGamepad = `async function pollGamepad() {
  if (!xinput) return;
  try {
    const state = await xinput.getState(0);
    const gamepad = state.gamepad;
    
    const isVoicePressed = isXinputComboPressed(currentVoiceShortcut, gamepad);
    if (isVoicePressed && !wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-start');
    } else if (!isVoicePressed && wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input-stop');
    }
    wasVoicePressed = isVoicePressed;

    const isHidePressed = isXinputComboPressed(currentHideAppShortcut, gamepad);
    if (isHidePressed && !wasHidePressed) {
      if (isAppVisible) slideOut(); else slideIn();
    }
    wasHidePressed = isHidePressed;
  } catch(e) {}
}`;

const newPollGamepad = `async function pollGamepad() {
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

if (code.includes(oldPollGamepad)) {
  code = code.replace(oldPollGamepad, newPollGamepad);
  console.log("Patched pollGamepad");
} else {
  console.log("Could not find old pollGamepad");
}

// 2. Update screenshot logic to be smaller and JPEG
const oldScreenshot = `    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1920, height: 1080 } 
    });
    const primaryScreen = sources[0]; 
    if (primaryScreen) {
      base64Image = primaryScreen.thumbnail.toDataURL();
    }`;

const newScreenshot = `    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1280, height: 720 } 
    });
    const primaryScreen = sources[0]; 
    if (primaryScreen) {
      // Use JPEG with 80% quality to drastically reduce payload size for the AI
      const buffer = primaryScreen.thumbnail.resize({ width: 1280 }).toJPEG(80);
      base64Image = 'data:image/jpeg;base64,' + buffer.toString('base64');
    }`;

if (code.includes(oldScreenshot)) {
  code = code.replace(oldScreenshot, newScreenshot);
  console.log("Patched screenshot logic");
} else {
  console.log("Could not find old screenshot logic");
}

fs.writeFileSync('electron/main.cjs', code);
