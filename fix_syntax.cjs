const fs = require('fs');
let content = fs.readFileSync('electron/main.cjs', 'utf-8');

const startIdx = content.indexOf("if (req.url === '/desktop-login') {");
const endIdx = content.indexOf("if (req.url === '/auth-callback' && req.method === 'POST') {");

if (startIdx !== -1 && endIdx !== -1) {
  // Replace the broken block
  const newEndpoint = `if (req.url === '/desktop-login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end([
      "<!DOCTYPE html>",
      "<html>",
      "<head>",
      "  <title>Quest Compendium - Desktop Login</title>",
      "  <style>",
      "    body { background: #070709; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }",
      "    .spinner { width: 40px; height: 40px; border: 3px solid #a87ffb; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; display: none; }",
      "    @keyframes spin { to { transform: rotate(360deg); } }",
      "    h1 { margin-bottom: 10px; }",
      "    p { color: #a1a1aa; margin-bottom: 24px; text-align: center; max-width: 400px; }",
      "    button { background: white; color: black; border: none; padding: 12px 24px; border-radius: 24px; font-weight: bold; font-size: 16px; cursor: pointer; transition: background 0.2s; }",
      "    button:hover { background: #e4e4e7; }",
      "  </style>",
      "</head>",
      "<body>",
      "  <div class=\\"spinner\\" id=\\"spinner\\"></div>",
      "  <h1 id=\\"status\\">Quest Compendium Auth</h1>",
      "  <p id=\\"desc\\">Click the button below to sign in securely with Google.</p>",
      "  <button id=\\"loginBtn\\">Sign in with Google</button>",
      "  ",
      "  <script type=\\"module\\">",
      "    import { initializeApp } from \\"https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js\\";",
      "    import { getAuth, signInWithPopup, GoogleAuthProvider } from \\"https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js\\";",
      "    ",
      "    const firebaseConfig = {",
      "      apiKey: \\"AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY\\",",
      "      authDomain: \\"quest-compendium-1bccf.firebaseapp.com\\",",
      "      projectId: \\"quest-compendium-1bccf\\",",
      "      storageBucket: \\"quest-compendium-1bccf.firebasestorage.app\\",",
      "      messagingSenderId: \\"890629309063\\",",
      "      appId: \\"1:890629309063:web:87293cf13f922fd3edee22\\",",
      "      measurementId: \\"G-XX6RW18GHY\\"",
      "    };",
      "    ",
      "    const app = initializeApp(firebaseConfig);",
      "    const auth = getAuth(app);",
      "    const provider = new GoogleAuthProvider();",
      "    ",
      "    document.getElementById('loginBtn').addEventListener('click', async () => {",
      "      document.getElementById('loginBtn').style.display = 'none';",
      "      document.getElementById('desc').style.display = 'none';",
      "      document.getElementById('spinner').style.display = 'block';",
      "      document.getElementById('status').innerText = 'Opening Google Login...';",
      "      ",
      "      try {",
      "        const result = await signInWithPopup(auth, provider);",
      "        const credential = GoogleAuthProvider.credentialFromResult(result);",
      "        if (credential && credential.idToken) {",
      "          document.getElementById('status').innerText = 'Login successful! Syncing...';",
      "          await fetch('http://localhost:' + window.location.port + '/auth-callback', {",
      "            method: 'POST',",
      "            body: JSON.stringify({ idToken: credential.idToken })",
      "          });",
      "          document.getElementById('status').innerText = 'Done! You can close this window.';",
      "          document.getElementById('spinner').style.display = 'none';",
      "          setTimeout(() => window.close(), 1500);",
      "        }",
      "      } catch(err) {",
      "        console.error(err);",
      "        document.getElementById('spinner').style.display = 'none';",
      "        document.getElementById('loginBtn').style.display = 'block';",
      "        document.getElementById('desc').style.display = 'block';",
      "        document.getElementById('status').innerText = 'Login Failed';",
      "        document.getElementById('desc').innerText = err.message || 'Please complete the sign-in popup.';",
      "      }",
      "    });",
      "  </script>",
      "</body>",
      "</html>"
    ].join('\\n'));
    return;
  }

  `;
  
  content = content.slice(0, startIdx) + newEndpoint + content.slice(endIdx);
  fs.writeFileSync('electron/main.cjs', content);
}
