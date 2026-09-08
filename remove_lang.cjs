const fs = require('fs');
let code = fs.readFileSync('src/components/SettingsModal.tsx', 'utf-8');

const regex = /\/\* Language Settings \*\/(.|\n)*?<\/select>\n\s*<\/div>/;
code = code.replace(regex, '');

fs.writeFileSync('src/components/SettingsModal.tsx', code);
