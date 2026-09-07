const fs = require('fs');
const content = fs.readFileSync('electron/main.cjs', 'utf-8');
const lines = content.split('\n').slice(121, 222);
lines.forEach((line, i) => {
  if (line.includes('`')) console.log(i + 122, line);
});
