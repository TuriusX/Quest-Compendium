const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldCode = `          aiMode: settings.aiMode,
          isGameRunningLocally: globalActiveGame !== null,`;

const newCode = `          aiMode: settings.aiMode,
          language: settings.language,
          isGameRunningLocally: globalActiveGame !== null,`;

if (code.includes(oldCode)) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Successfully updated App.tsx API call");
} else {
  console.log("Could not find the target code string to replace in App.tsx");
}
