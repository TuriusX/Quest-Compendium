const fs = require('fs');
let serverTs = fs.readFileSync('server.ts', 'utf-8');

serverTs = serverTs.replace(/gen-lang-client-0366642934/g, 'quest-compendium-1bccf');

fs.writeFileSync('server.ts', serverTs);
