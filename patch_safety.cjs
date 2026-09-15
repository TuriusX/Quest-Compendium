const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const safetyConfig = `              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],`;

code = code.replace(/systemInstruction,\n\s*tools: \[\{ googleSearch: \{\} \}\],/g, `systemInstruction,\n              tools: [{ googleSearch: {} }],\n${safetyConfig}`);
code = code.replace(/systemInstruction,\n\s*\}/g, `systemInstruction,\n${safetyConfig}\n            }`);

fs.writeFileSync('server.ts', code);
console.log('Patched safety settings');
