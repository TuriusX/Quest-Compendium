const fs = require('fs');
let code = fs.readFileSync('src/components/SettingsModal.tsx', 'utf-8');

code = code.replace(/\{\s*\{\/\* Voice Profile \*\//g, '{/* Voice Profile */');

fs.writeFileSync('src/components/SettingsModal.tsx', code);
