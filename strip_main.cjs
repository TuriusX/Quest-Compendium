const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

// I will rebuild main.cjs by just downloading the original one or manually fixing it.
// Actually, it's easier to find the exact block and use regex with [\s\S]*
code = code.replace(/try\s*\{\s*koffi\.alias\('DWORD', 'uint32'\);\s*\}\s*catch\(e\)\{\}\s*try\s*\{\s*koffi\.alias\('BYTE', 'uint8'\);\s*\}\s*catch\(e\)\{\}\s*try\s*\{\s*koffi\.alias\('SHORT', 'int16'\);\s*\}\s*catch\(e\)\{\}\s*try\s*\{\s*koffi\.alias\('WCHAR', 'char16_t'\);\s*\}\s*catch\(e\)\{\}\s*xinput = require\('xinput-ffi'\);\s*\}\s*catch\(e\)\s*\{\s*console\.error\("xinput-ffi load error", e\);\s*\}/, "");

code = code.replace(/console\.error\("isXinputComboPressed error", e\);/, "");
code = code.replace(/const state = await xinput\.getState\(i\);/, "");
code = code.replace(/if \(isXinputComboPressed\(currentVoiceShortcut, gamepad\)\) anyVoicePressed = true;/, "");
code = code.replace(/if \(isXinputComboPressed\(currentHideAppShortcut, gamepad\)\) anyHidePressed = true;/, "");

fs.writeFileSync('electron/main.cjs', code);
