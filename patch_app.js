const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
/const initialGame = POPULAR_STEAM_GAMES\[0\];[\s\S]*?id: 'msg-welcome'/,
\`const initialGame = null;
    return [
      {
        id: 'tab-default',
        name: 'New Session',
        activeSteamGame: initialGame,
        messages: [
          {
            id: 'msg-welcome'\`
);

fs.writeFileSync(file, code);
