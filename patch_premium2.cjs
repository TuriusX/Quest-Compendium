const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf-8');
serverCode = serverCode.replace(
  /let isStripePremium = false;/g,
  "let isStripePremium = userEmail === 'NoahFMinton@gmail.com';"
);
fs.writeFileSync('server.ts', serverCode);
