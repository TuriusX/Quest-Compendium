const fs = require('fs');

// 1. Revert firebase.ts back to signInWithPopup
let firebaseCode = fs.readFileSync('src/lib/firebase.ts', 'utf8');
firebaseCode = firebaseCode.replace(
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";',
  'import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";'
);
firebaseCode = firebaseCode.replace(
  '// Use signInWithRedirect instead of popup for better Electron compatibility\n    const result = await signInWithRedirect(auth, googleProvider);',
  'const result = await signInWithPopup(auth, googleProvider);'
);
fs.writeFileSync('src/lib/firebase.ts', firebaseCode);

// 2. Fix Electron main.cjs headers correctly
let mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
const oldHeaderCode = `  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['unsafe-none'],
        'Cross-Origin-Embedder-Policy': ['unsafe-none']
      }
    });
  });`;

const newHeaderCode = `  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    Object.keys(responseHeaders).forEach((key) => {
      if (key.toLowerCase() === 'cross-origin-opener-policy' || key.toLowerCase() === 'cross-origin-embedder-policy') {
        delete responseHeaders[key];
      }
    });
    responseHeaders['Cross-Origin-Opener-Policy'] = ['unsafe-none'];
    responseHeaders['Cross-Origin-Embedder-Policy'] = ['unsafe-none'];
    callback({ responseHeaders });
  });`;

if (mainCode.includes(oldHeaderCode)) {
  mainCode = mainCode.replace(oldHeaderCode, newHeaderCode);
  fs.writeFileSync('electron/main.cjs', mainCode);
  console.log('Patched main.cjs headers');
} else if (!mainCode.includes('Object.keys(responseHeaders).forEach')) {
  console.log('Could not find old header code in main.cjs');
}

