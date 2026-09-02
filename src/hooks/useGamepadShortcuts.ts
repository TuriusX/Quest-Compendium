import { useEffect, useRef } from 'react';

export function useGamepadShortcuts(
  voiceShortcutIndex: string,
  hideAppShortcutIndex: string,
  onVoiceTrigger: () => void,
  onHideAppTrigger: () => void
) {
  const previousButtonsRef = useRef<boolean[][]>([]);

  useEffect(() => {
    let animationFrameId: number;

    const pollGamepads = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;

        const previousButtons = previousButtonsRef.current[i] || [];
        const currentButtons = gp.buttons.map(b => b.pressed);

        // Check voice shortcut
        if (voiceShortcutIndex !== '' && voiceShortcutIndex !== 'disabled') {
          const vIndex = parseInt(voiceShortcutIndex, 10);
          if (!isNaN(vIndex) && currentButtons[vIndex] && !previousButtons[vIndex]) {
            onVoiceTrigger();
          }
        }

        // Check hide app shortcut
        if (hideAppShortcutIndex !== '' && hideAppShortcutIndex !== 'disabled') {
          const hIndex = parseInt(hideAppShortcutIndex, 10);
          if (!isNaN(hIndex) && currentButtons[hIndex] && !previousButtons[hIndex]) {
            onHideAppTrigger();
          }
        }

        previousButtonsRef.current[i] = currentButtons;
      }

      animationFrameId = requestAnimationFrame(pollGamepads);
    };

    animationFrameId = requestAnimationFrame(pollGamepads);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [voiceShortcutIndex, hideAppShortcutIndex, onVoiceTrigger, onHideAppTrigger]);
}
