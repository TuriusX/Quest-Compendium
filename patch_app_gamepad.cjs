const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldAppCall = `  useGamepadShortcuts(
    settings.controllerVoiceShortcut,
    settings.controllerHideAppShortcut,
    () => {
      // onVoiceTrigger
      if (isRecording) {
        window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
      } else {
        window.dispatchEvent(new CustomEvent('trigger-voice-start'));
      }
    },
    () => {`;

const newAppCall = `  useGamepadShortcuts(
    settings.controllerVoiceShortcut,
    settings.controllerHideAppShortcut,
    () => {
      // onVoiceStart
      window.dispatchEvent(new CustomEvent('trigger-voice-start'));
    },
    () => {
      // onVoiceStop
      window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
    },
    () => {`;

code = code.replace(oldAppCall, newAppCall);
fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx");
