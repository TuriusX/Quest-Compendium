const fs = require('fs');
let code = fs.readFileSync('electron/preload.cjs', 'utf-8');

if (!code.includes("onTriggerVoiceInput: (callback)")) {
  code = code.replace(
    "});",
    "  onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); }\n});"
  );
  fs.writeFileSync('electron/preload.cjs', code);
  console.log("Patched preload.cjs");
}
