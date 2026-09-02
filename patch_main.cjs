const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// 1. Add fake UI for media stream
code = code.replace(
  "app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');",
  "app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');\napp.commandLine.appendSwitch('use-fake-ui-for-media-stream');\n"
);

// 2. Add XInput logic
const xinputLogic = `
let xinput = null;
if (process.platform === 'win32') {
  try {
    xinput = require('xinput-ffi');
  } catch(e) { console.error("xinput-ffi load error", e); }
}

let currentVoiceShortcut = null;
let currentHideAppShortcut = null;

const XINPUT_MAP = {
  '4': { type: 'button', name: 'XINPUT_GAMEPAD_LEFT_SHOULDER' },
  '5': { type: 'button', name: 'XINPUT_GAMEPAD_RIGHT_SHOULDER' },
  '6': { type: 'trigger', name: 'bLeftTrigger' },
  '7': { type: 'trigger', name: 'bRightTrigger' },
  '8': { type: 'button', name: 'XINPUT_GAMEPAD_BACK' },
  '9': { type: 'button', name: 'XINPUT_GAMEPAD_START' },
  '10': { type: 'button', name: 'XINPUT_GAMEPAD_LEFT_THUMB' },
  '11': { type: 'button', name: 'XINPUT_GAMEPAD_RIGHT_THUMB' },
  '12': { type: 'button', name: 'XINPUT_GAMEPAD_DPAD_UP' },
  '13': { type: 'button', name: 'XINPUT_GAMEPAD_DPAD_DOWN' },
  '14': { type: 'button', name: 'XINPUT_GAMEPAD_DPAD_LEFT' },
  '15': { type: 'button', name: 'XINPUT_GAMEPAD_DPAD_RIGHT' }
};

function isXinputComboPressed(comboStr, gamepad) {
  if (!comboStr || comboStr === 'disabled' || !comboStr.includes('+')) return false;
  const parts = comboStr.split('+');
  for (const part of parts) {
    const map = XINPUT_MAP[part];
    if (!map) return false;
    if (map.type === 'button') {
      if (!gamepad.wButtons.includes(map.name)) return false;
    } else if (map.type === 'trigger') {
      if (gamepad[map.name] < 30) return false;
    }
  }
  return true;
}

let wasVoicePressed = false;
let wasHidePressed = false;

async function pollGamepad() {
  if (!xinput) return;
  try {
    const state = await xinput.getState(0);
    const gamepad = state.gamepad;
    
    const isVoicePressed = isXinputComboPressed(currentVoiceShortcut, gamepad);
    if (isVoicePressed && !wasVoicePressed) {
      if (mainWindow) mainWindow.webContents.send('trigger-voice-input');
    }
    wasVoicePressed = isVoicePressed;

    const isHidePressed = isXinputComboPressed(currentHideAppShortcut, gamepad);
    if (isHidePressed && !wasHidePressed) {
      if (isAppVisible) slideOut(); else slideIn();
    }
    wasHidePressed = isHidePressed;
  } catch(e) {}
}

if (process.platform === 'win32') {
  setInterval(pollGamepad, 50);
}
`;

// Insert the logic before app.whenReady()
code = code.replace("app.whenReady().then(() => {", xinputLogic + "\napp.whenReady().then(() => {");

// 3. Update ipcMain.on('update-shortcuts') to capture controller shortcuts
code = code.replace(
  "ipcMain.on('update-shortcuts', (event, shortcuts) => {",
  "ipcMain.on('update-shortcuts', (event, shortcuts) => {\n    currentVoiceShortcut = shortcuts.controllerVoiceShortcut;\n    currentHideAppShortcut = shortcuts.controllerHideAppShortcut;"
);

fs.writeFileSync('electron/main.cjs', code);
console.log("Patched successfully");
