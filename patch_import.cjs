const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase.ts', 'utf8');

code = code.replace(
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";',
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";'
);

fs.writeFileSync('src/lib/firebase.ts', code);
