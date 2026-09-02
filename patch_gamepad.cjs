const fs = require('fs');
let code = fs.readFileSync('src/hooks/useGamepadShortcuts.ts', 'utf-8');

const oldCode = `export function useGamepadShortcuts(
  voiceShortcutCombo: string,
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

const oldCheck = `    const checkCombo = (comboStr: string, currentButtons: boolean[], previousButtons: boolean[]) => {
      if (!comboStr || comboStr === 'disabled' || !comboStr.includes('+')) return false;
      const parts = comboStr.split('+').map(p => parseInt(p, 10));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return false;
      
      const b1 = parts[0];
      const b2 = parts[1];
      
      // True if both are currently pressed, and at least one wasn't pressed last frame
      const bothPressedNow = currentButtons[b1] && currentButtons[b2];
      const bothPressedBefore = previousButtons[b1] && previousButtons[b2];
      
      return bothPressedNow && !bothPressedBefore;
    };`;

const newCheck = `    const checkComboState = (comboStr: string, currentButtons: boolean[], previousButtons: boolean[]) => {
      if (!comboStr || comboStr === 'disabled' || !comboStr.includes('+')) return 'none';
      const parts = comboStr.split('+').map(p => parseInt(p, 10));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 'none';
      
      const b1 = parts[0];
      const b2 = parts[1];
      
      const bothPressedNow = currentButtons[b1] && currentButtons[b2];
      const bothPressedBefore = previousButtons[b1] && previousButtons[b2];
      
      if (bothPressedNow && !bothPressedBefore) return 'pressed';
      if (!bothPressedNow && bothPressedBefore) return 'released';
      return 'none';
    };`;

code = code.replace(oldCheck, newCheck);

const oldPoll = `        // Check voice shortcut
        if (checkCombo(voiceShortcutCombo, currentButtons, previousButtons)) {
          onVoiceTrigger();
        }

        // Check hide app shortcut
        if (checkCombo(hideAppShortcutCombo, currentButtons, previousButtons)) {
          onHideAppTrigger();
        }`;

const newPoll = `        // Check voice shortcut
        const voiceState = checkComboState(voiceShortcutCombo, currentButtons, previousButtons);
        if (voiceState === 'pressed') {
          onVoiceStart();
        } else if (voiceState === 'released') {
          onVoiceStop();
        }

        // Check hide app shortcut
        if (checkComboState(hideAppShortcutCombo, currentButtons, previousButtons) === 'pressed') {
          onHideAppTrigger();
        }`;

code = code.replace(oldPoll, newPoll);

fs.writeFileSync('src/hooks/useGamepadShortcuts.ts', code);
console.log("Patched gamepad hook");
