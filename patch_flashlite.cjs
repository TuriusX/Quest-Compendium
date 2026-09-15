const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
const search = `          responseText = retryResponse.text || 'No response received.';
          modelUsed = 'Gemini 3.8 Flash (Fallback)';
          
          if (clientDisconnected) {
            console.log('Client disconnected during Fallback Flash query. Aborting.');
            return;
          }`;
const replace = `          responseText = retryResponse.text || '';
          modelUsed = 'Gemini 3.8 Flash (Fallback)';
          
          if (clientDisconnected) {
            console.log('Client disconnected during Fallback Flash query. Aborting.');
            return;
          }

          if (!responseText || responseText.trim().length === 0) {
             console.log('Emergency Flash Lite fallback returned empty text.');
             responseText = 'No response received. Please try asking again.';
          }`;
if (code.includes(search)) {
  fs.writeFileSync('server.ts', code.replace(search, replace));
  console.log('Patched Flash Lite block successfully');
} else {
  console.log('Could not find Flash Lite search block');
}
