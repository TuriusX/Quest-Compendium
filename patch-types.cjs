const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf-8');

const oldCode = `export interface AppSettings {
  aiMode: AiMode;
  theme: ColorTheme;`;

const newCode = `export interface AppSettings {
  language?: string;
  aiMode: AiMode;
  theme: ColorTheme;`;

if (code.includes(oldCode)) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/types.ts', code);
  console.log("Successfully updated types.ts");
} else {
  console.log("Could not find the target code string to replace in types.ts");
}
