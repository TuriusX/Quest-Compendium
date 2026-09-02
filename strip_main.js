const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const toRemove = [
  "let xinput = null;",
  "    xinput = require('xinput-ffi');  } catch(e) { console.error(\"xinput-ffi load error\", e); }",
  "    console.error(\"isXinputComboPressed error\", e);",
  "        const state = await xinput.getState(i);",
  "        if (isXinputComboPressed(currentVoiceShortcut, gamepad)) anyVoicePressed = true;",
  "        if (isXinputComboPressed(currentHideAppShortcut, gamepad)) anyHidePressed = true;"
];

for (const line of toRemove) {
  code = code.replace(line, "");
}

fs.writeFileSync('electron/main.cjs', code);
