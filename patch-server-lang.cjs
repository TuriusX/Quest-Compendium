const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldCode1 = `      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
      } = req.body;`;

const newCode1 = `      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
        language = 'English'
      } = req.body;`;

const oldCode2 = `4. CONTEXT INTEGRITY: Never force an assumed game onto a screenshot that clearly shows something else.\`;

      let situationalContext = '';`;

const newCode2 = `4. CONTEXT INTEGRITY: Never force an assumed game onto a screenshot that clearly shows something else.\`;

      systemInstruction += \`\n\n[USER LANGUAGE PREFERENCE]\nYou must respond entirely in \${language}. Do not use English unless the user's language preference is English or they specifically request it.\`;

      let situationalContext = '';`;

if (code.includes(oldCode1) && code.includes(oldCode2)) {
  code = code.replace(oldCode1, newCode1).replace(oldCode2, newCode2);
  fs.writeFileSync('server.ts', code);
  console.log("Successfully updated server.ts for language");
} else {
  console.log("Could not find the target code string to replace in server.ts");
}
