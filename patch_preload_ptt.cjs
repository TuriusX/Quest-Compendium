const fs = require('fs');
let code = fs.readFileSync('electron/preload.cjs', 'utf-8');

code = code.replace(
  "onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); }",
  "onTriggerVoiceInputStart: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-start'); ipcRenderer.on('trigger-voice-input-start', () => callback()); },\n  onTriggerVoiceInputStop: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-stop'); ipcRenderer.on('trigger-voice-input-stop', () => callback()); }"
);

fs.writeFileSync('electron/preload.cjs', code);
console.log("Patched preload.cjs for PTT");
