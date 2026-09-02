const fs = require('fs');
let code = fs.readFileSync('electron/preload.cjs', 'utf-8');
code = code.replace(
  "onTriggerVoiceInput: (callback) => ipcRenderer.on('trigger-voice-input', () => callback())",
  "onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); }"
);
fs.writeFileSync('electron/preload.cjs', code);
