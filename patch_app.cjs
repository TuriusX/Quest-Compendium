const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Remove import
code = code.replace("import { useGamepadShortcuts } from './hooks/useGamepadShortcuts';\n", "");

// Remove settings defaults
code = code.replace("  controllerVoiceShortcut: '4+8', // LB + Select\n", "");
code = code.replace("  controllerHideAppShortcut: '5+9', // RB + Start\n", "");

// Remove hook call
const hookCall = `
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
  );`;
if (code.includes(hookCall)) {
  code = code.replace(hookCall, "");
} else {
  console.log("Hook call not found exactly as expected, trying regex...");
  code = code.replace(/useGamepadShortcuts\([\s\S]*?\);\n/, "");
}

// Remove from updateShortcuts
code = code.replace("        controllerVoiceShortcut: settings.controllerVoiceShortcut,\n", "");
code = code.replace("        controllerHideAppShortcut: settings.controllerHideAppShortcut\n", "");
code = code.replace("    settings.controllerVoiceShortcut, \n", "");
code = code.replace("    settings.controllerHideAppShortcut\n", "");

fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx");
