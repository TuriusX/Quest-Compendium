const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldCode = `const DEFAULT_SETTINGS: AppSettings = {
  aiMode: 'standard',`;

const newCode = `const DEFAULT_SETTINGS: AppSettings = {
  language: 'English',
  aiMode: 'standard',`;

if (code.includes(oldCode)) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Successfully updated App.tsx");
} else {
  console.log("Could not find the target code string to replace in App.tsx");
}
