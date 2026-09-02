const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// Remove xinput var and initialization
code = code.replace(/let xinput = null;\nif \(process\.platform === 'win32'\) \{[\s\S]*?\}\n/, "");

// Remove shortcut state
code = code.replace("let currentVoiceShortcut = null;\nlet currentHideAppShortcut = null;\n", "");

// Remove XINPUT_MAP
code = code.replace(/const XINPUT_MAP = \{[\s\S]*?\};\n/, "");

// Remove isXinputComboPressed
code = code.replace(/function isXinputComboPressed\(comboStr, gamepad\) \{[\s\S]*?\}\n/, "");

// Remove wasVoicePressed / wasHidePressed
code = code.replace("let wasVoicePressed = false;\nlet wasHidePressed = false;\n", "");

// Remove pollGamepad
code = code.replace(/async function pollGamepad\(\) \{[\s\S]*?\}\n/, "");

// Remove initial pollTimeout call
code = code.replace("if (process.platform === 'win32') {\n  setTimeout(pollGamepad, 50);\n}\n", "");

// Remove from update-shortcuts listener
code = code.replace("    currentVoiceShortcut = shortcuts.controllerVoiceShortcut;\n", "");
code = code.replace("    currentHideAppShortcut = shortcuts.controllerHideAppShortcut;\n", "");

fs.writeFileSync('electron/main.cjs', code);
console.log("Patched main.cjs");
