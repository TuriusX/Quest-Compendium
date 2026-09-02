const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldEffect = `  useEffect(() => {
    if ((window as any).electronAPI?.onTriggerVoiceInputStart) {
      (window as any).electronAPI.onTriggerVoiceInputStart(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-start'));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInputStop) {
      (window as any).electronAPI.onTriggerVoiceInputStop(() => {
        window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
      });
    }
  }, []);`;

const newEffect = `  useEffect(() => {
    if ((window as any).electronAPI?.onTriggerVoiceInputStart) {
      (window as any).electronAPI.onTriggerVoiceInputStart(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-start'));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInputStop) {
      (window as any).electronAPI.onTriggerVoiceInputStop(() => {
        window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInput) {
      (window as any).electronAPI.onTriggerVoiceInput(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-record'));
        }, 100);
      });
    }
  }, []);`;

if (code.includes(oldEffect)) {
  code = code.replace(oldEffect, newEffect);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Patched App.tsx");
}
