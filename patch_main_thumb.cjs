const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const oldThumb = `thumbnailSize: { width: 1280, height: 720 }`;
const newThumb = `thumbnailSize: { width: 1920, height: 1080 }`;

if (code.includes(oldThumb)) {
  code = code.replace(oldThumb, newThumb);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched thumbnail size");
}
