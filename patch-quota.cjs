const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldCode1 = `      } else {
        userData.proQueriesAvailable = 3;
        userData.flashQueriesAvailable = 3;
      }`;
const newCode1 = `      } else {
        userData.proQueriesAvailable = 5;
        userData.flashQueriesAvailable = 5;
      }`;

const oldCode2 = `      if (userData.proQueriesAvailable === undefined) {
        userData.proQueriesAvailable = Math.max(0, (isPremium ? 40 : 3) - (userData.proQueriesToday || 0));
      }
      if (userData.flashQueriesAvailable === undefined) {
        userData.flashQueriesAvailable = Math.max(0, (isPremium ? 1000 : 3) - (userData.flashQueriesToday || 0));
      }`;
const newCode2 = `      if (userData.proQueriesAvailable === undefined) {
        userData.proQueriesAvailable = Math.max(0, (isPremium ? 40 : 5) - (userData.proQueriesToday || 0));
      }
      if (userData.flashQueriesAvailable === undefined) {
        userData.flashQueriesAvailable = Math.max(0, (isPremium ? 1000 : 5) - (userData.flashQueriesToday || 0));
      }`;

if (code.includes(oldCode1) && code.includes(oldCode2)) {
  code = code.replace(oldCode1, newCode1).replace(oldCode2, newCode2);
  fs.writeFileSync('server.ts', code);
  console.log("Successfully updated server.ts quotas.");
} else {
  console.log("Could not find quota strings.");
}
