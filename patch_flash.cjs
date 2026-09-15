const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
const search = `          if (clientDisconnected) {
            console.log('Client disconnected during Flash query. Aborting before deducting credit.');
            return;
          }

          userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
          userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1; // legacy
        }`;
const replace = `          if (clientDisconnected) {
            console.log('Client disconnected during Flash query. Aborting before deducting credit.');
            return;
          }

          if (responseText && responseText.trim().length > 0) {
            userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
            userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1; // legacy
          } else {
            console.log('Fallback Flash query returned empty text. Not deducting credit.');
            responseText = 'No response received. Please try asking again.';
          }
        }`;
if (code.includes(search)) {
  fs.writeFileSync('server.ts', code.replace(search, replace));
  console.log('Patched Flash block successfully');
} else {
  console.log('Could not find search block');
}
