const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const oldIsXinput = `function isXinputComboPressed(comboStr, gamepad) {
  if (!comboStr || comboStr === 'disabled' || !comboStr.includes('+')) return false;
  const parts = comboStr.split('+');
  for (const part of parts) {
    const map = XINPUT_MAP[part];
    if (!map) return false;
    if (map.type === 'button') {
      if (!gamepad.wButtons.includes(map.name)) return false;
    } else if (map.type === 'trigger') {
      if (gamepad[map.name] < 30) return false;
    }
  }
  return true;
}`;

const newIsXinput = `function isXinputComboPressed(comboStr, gamepad) {
  if (!comboStr || comboStr === 'disabled' || !comboStr.includes('+')) return false;
  try {
    const parts = comboStr.split('+');
    for (const part of parts) {
      const map = XINPUT_MAP[part];
      if (!map) return false;
      if (map.type === 'button') {
        const buttons = Array.isArray(gamepad.wButtons) ? gamepad.wButtons : [];
        if (!buttons.includes(map.name)) return false;
      } else if (map.type === 'trigger') {
        if ((gamepad[map.name] || 0) < 30) return false;
      }
    }
    return true;
  } catch(e) {
    console.error("isXinputComboPressed error", e);
    return false;
  }
}`;

if (code.includes(oldIsXinput)) {
  code = code.replace(oldIsXinput, newIsXinput);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched combo logic");
}
