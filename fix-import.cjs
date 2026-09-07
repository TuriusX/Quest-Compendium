const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace("  import crypto from 'crypto';", "");
code = "import crypto from 'crypto';\n" + code;

fs.writeFileSync('server.ts', code);
console.log("Fixed crypto import");
