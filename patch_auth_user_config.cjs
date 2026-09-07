const fs = require('fs');

// --- 1. PATCH src/lib/firebase.ts ---
let firebaseTs = fs.readFileSync('src/lib/firebase.ts', 'utf-8');

firebaseTs = firebaseTs.replace(
  /const firebaseConfig = {[\s\S]*?};/,
  `const firebaseConfig = {
  apiKey: "AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY",
  authDomain: "quest-compendium-1bccf.firebaseapp.com",
  projectId: "quest-compendium-1bccf",
  storageBucket: "quest-compendium-1bccf.firebasestorage.app",
  messagingSenderId: "890629309063",
  appId: "1:890629309063:web:87293cf13f922fd3edee22",
  measurementId: "G-XX6RW18GHY"
};`
);

// Remove the AI Studio specific database ID binding so it uses the user's default database
firebaseTs = firebaseTs.replace(
  /export const db = getFirestore\(app, "ai-studio[^"]+"\);/,
  'export const db = getFirestore(app);'
);

fs.writeFileSync('src/lib/firebase.ts', firebaseTs);

// --- 2. PATCH electron/main.cjs ---
let mainCjs = fs.readFileSync('electron/main.cjs', 'utf-8');

mainCjs = mainCjs.replace(
  /const firebaseConfig = {[\s\S]*?};/,
  `const firebaseConfig = {
      apiKey: "AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY",
      authDomain: "quest-compendium-1bccf.firebaseapp.com",
      projectId: "quest-compendium-1bccf",
      storageBucket: "quest-compendium-1bccf.firebasestorage.app",
      messagingSenderId: "890629309063",
      appId: "1:890629309063:web:87293cf13f922fd3edee22",
      measurementId: "G-XX6RW18GHY"
    };`
);

fs.writeFileSync('electron/main.cjs', mainCjs);
