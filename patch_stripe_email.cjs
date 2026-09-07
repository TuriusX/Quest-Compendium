const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf-8');
serverCode = serverCode.replace(
  /const customers = await stripe\.customers\.list\(\{ email: userEmail, limit: 1 \}\);/g,
  "const customers = await stripe.customers.list({ email: userEmail.toLowerCase(), limit: 1 });"
);
fs.writeFileSync('server.ts', serverCode);
console.log("Patched server.ts");
