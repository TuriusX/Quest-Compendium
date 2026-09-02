const fs = require('fs');
let code = fs.readFileSync('src/hooks/useGamepadShortcuts.ts', 'utf-8');

const oldCode = `export function useGamepadShortcuts(
  voiceShortcutCombo: string, // e.g. "4+5" or "8+9"
  hideAppShortcutCombo: string,
  onVoiceTrigger: () => void,
  onHideAppTrigger: () => void
) {`;

const newCode = `export function useGamepadShortcuts(
  voiceShortcutCombo: string,
  hideAppShortcutCombo: string,
  onVoiceStart: () => void,
  onVoiceStop: () => void,
  onHideAppTrigger: () => void
) {`;

code = code.replace(oldCode, newCode);
code = code.replace(', onVoiceTrigger, onHideAppTrigger]);', ', onVoiceStart, onVoiceStop, onHideAppTrigger]);');

fs.writeFileSync('src/hooks/useGamepadShortcuts.ts', code);
console.log("Patched gamepad hook signature");
