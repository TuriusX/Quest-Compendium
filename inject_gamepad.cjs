const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

if (!code.includes('useGamepadShortcuts(')) {
  const insertIndex = code.indexOf('  // Global focus fix for Electron');
  if (insertIndex > -1) {
    const injection = `
  useGamepadShortcuts(
    settings.controllerVoiceShortcut,
    settings.controllerHideAppShortcut,
    () => {
      window.dispatchEvent(new CustomEvent('trigger-voice-start'));
    },
    () => {
      window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
    },
    () => {
      if ((window as any).electronAPI?.toggleSlide) {
        (window as any).electronAPI.toggleSlide();
      }
    }
  );
`;
    code = code.slice(0, insertIndex) + injection + code.slice(insertIndex);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Injected useGamepadShortcuts into App.tsx");
  } else {
    console.log("Could not find insertion point!");
  }
} else {
  console.log("Already present.");
}
