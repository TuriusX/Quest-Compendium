const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase.ts', 'utf8');

code = code.replace(
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";',
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";'
);

code = code.replace(
  'const result = await signInWithPopup(auth, googleProvider);',
  '// Use signInWithRedirect instead of popup for better Electron compatibility\n    const result = await signInWithRedirect(auth, googleProvider);'
);

fs.writeFileSync('src/lib/firebase.ts', code);
