const fs = require('fs');
let code = fs.readFileSync('src/components/SettingsModal.tsx', 'utf-8');

const startTag = '<div className="space-y-4">';
const endTag = '</div>\n                </div>\n              </div>';

const idx1 = code.indexOf(startTag, code.indexOf('Controller Shortcuts'));
// Actually, it's safer to use regex to remove that block.

code = code.replace(/<div className="space-y-4">\s*<label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">\s*<Gamepad className="w-4 h-4 text-\[var\(--accent-color\)]" \/>\s*<span>Controller Shortcuts<\/span>\s*<\/label>[\s\S]*?Map these to unused controller buttons \(like Select or Start\). Triggers instantly when pressed.\s*<\/p>\s*<\/div>\s*<\/div>/, "");

fs.writeFileSync('src/components/SettingsModal.tsx', code);
console.log("Patched Modal");
