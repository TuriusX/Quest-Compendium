import { useEffect, useRef } from 'react';

export function useGamepadShortcuts(
  voiceShortcutCombo: string, // e.g. "4+5" or "8+9"
  hideAppShortcutCombo: string,
  onVoiceTrigger: () => void,
  onHideAppTrigger: () => void
) {
  const previousButtonsRef = useRef<boolean[][]>([]);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    const handleConnect = (e: GamepadEvent) => {
      console.log('Gamepad connected:', e.gamepad.id);
      hasConnectedRef.current = true;
    };
    window.addEventListener('gamepadconnected', handleConnect);

    let animationFrameId: number;

    const checkComboState = (comboStr: string, currentButtons: boolean[], previousButtons: boolean[]) => {
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
    };

    const pollGamepads = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;
        if (!hasConnectedRef.current) {
           hasConnectedRef.current = true; // Mark as connected if we found one
        }

        const previousButtons = previousButtonsRef.current[i] || [];
        const currentButtons = gp.buttons.map(b => b.pressed);

        // Check voice shortcut
        const voiceState = checkComboState(voiceShortcutCombo, currentButtons, previousButtons);
        if (voiceState === 'pressed') {
          onVoiceStart();
        } else if (voiceState === 'released') {
          onVoiceStop();
        }

        // Check hide app shortcut
        if (checkComboState(hideAppShortcutCombo, currentButtons, previousButtons) === 'pressed') {
          onHideAppTrigger();
        }

        previousButtonsRef.current[i] = currentButtons;
      }

      animationFrameId = requestAnimationFrame(pollGamepads);
    };

    animationFrameId = requestAnimationFrame(pollGamepads);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnect);
      cancelAnimationFrame(animationFrameId);
    };
  }, [voiceShortcutCombo, hideAppShortcutCombo, onVoiceTrigger, onHideAppTrigger]);
}
