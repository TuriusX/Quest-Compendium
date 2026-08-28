import fs from 'fs';
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
/const initialGame = POPULAR_STEAM_GAMES\[0\];/,
\`const initialGame = null;\`
);

code = code.replace(
/id: 'tab-elden-ring',[\s\S]*?name: 'Elden Ring',/,
\`id: 'tab-default',
        name: 'New Session',\`
);

code = code.replace(
/### ⚔️ Welcome, Tarnished, to the Quest Compendium!/,
\`### ⚔️ Welcome to the Quest Compendium!\`
);

code = code.replace(
/I stand ready to guide your journey through the \*\*Lands Between\*\*. /,
\`I stand ready to guide your journey. \`
);

fs.writeFileSync(file, code);
