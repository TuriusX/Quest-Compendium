const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The safety settings to revert
const safetyConfig = `              safetySettings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
              ],`;
code = code.replace(new RegExp(safetyConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?', 'g'), '');
fs.writeFileSync('server.ts', code);
console.log('Reverted safety settings');
