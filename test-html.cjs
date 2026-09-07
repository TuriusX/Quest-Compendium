const fs = require('fs');
const content = fs.readFileSync('electron/main.cjs', 'utf-8');
const regex = /res\.end\(\`([\s\S]*?)\`\);\s*return;\s*\}/;
const match = content.match(regex);
if (match) {
  console.log("HTML length:", match[1].length);
  console.log("Includes signInWithRedirect?", match[1].includes("signInWithRedirect"));
} else {
  console.log("No match found!");
}
