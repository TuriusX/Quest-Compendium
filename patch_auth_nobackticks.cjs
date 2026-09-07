const fs = require('fs');

let content = fs.readFileSync('electron/main.cjs', 'utf-8');

const newHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Quest Compendium - Desktop Login</title>
        <style>
          body { background: #070709; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .spinner { width: 40px; height: 40px; border: 3px solid #a87ffb; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; display: none; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h1 { margin-bottom: 10px; }
          p { color: #a1a1aa; margin-bottom: 24px; text-align: center; max-width: 400px; }
          button { background: white; color: black; border: none; padding: 12px 24px; border-radius: 24px; font-weight: bold; font-size: 16px; cursor: pointer; transition: background 0.2s; }
          button:hover { background: #e4e4e7; }
        </style>
      </head>
      <body>
        <div class="spinner" id="spinner"></div>
        <h1 id="status">Quest Compendium Auth</h1>
        <p id="desc">Click the button below to sign in securely with Google.</p>
        <button id="loginBtn">Sign in with Google</button>
        
        <script type="module">
          import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
          import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
          
          const firebaseConfig = {
            projectId: "gen-lang-client-0366642934",
            appId: "1:525238388984:web:714689b601aa7da3d9530d",
            apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
            authDomain: "gen-lang-client-0366642934.firebaseapp.com"
          };
          
          const app = initializeApp(firebaseConfig);
          const auth = getAuth(app);
          const provider = new GoogleAuthProvider();
          
          document.getElementById('spinner').style.display = 'block';
          document.getElementById('loginBtn').style.display = 'none';
          document.getElementById('desc').style.display = 'none';
          document.getElementById('status').innerText = 'Checking login status...';
          
          try {
            const result = await getRedirectResult(auth);
            if (result) {
              const credential = GoogleAuthProvider.credentialFromResult(result);
              if (credential && credential.idToken) {
                document.getElementById('status').innerText = 'Login successful! Syncing...';
                await fetch('http://localhost:' + window.location.port + '/auth-callback', {
                  method: 'POST',
                  body: JSON.stringify({ idToken: credential.idToken })
                });
                document.getElementById('status').innerText = 'Done! You can close this window.';
                document.getElementById('spinner').style.display = 'none';
                setTimeout(() => window.close(), 1500);
                throw new Error("DONE");
              }
            } else {
              document.getElementById('spinner').style.display = 'none';
              document.getElementById('loginBtn').style.display = 'block';
              document.getElementById('desc').style.display = 'block';
              document.getElementById('status').innerText = 'Quest Compendium Auth';
            }
          } catch(err) {
            if (err.message !== "DONE") {
              console.error(err);
              document.getElementById('spinner').style.display = 'none';
              document.getElementById('loginBtn').style.display = 'block';
              document.getElementById('desc').style.display = 'block';
              document.getElementById('status').innerText = 'Login Failed';
              document.getElementById('status').style.color = '#ef4444';
              document.getElementById('desc').innerText = err.message || 'An error occurred. Please try again.';
            }
          }
          
          document.getElementById('loginBtn').addEventListener('click', async () => {
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('desc').style.display = 'none';
            document.getElementById('spinner').style.display = 'block';
            document.getElementById('status').innerText = 'Redirecting to Google...';
            document.getElementById('status').style.color = 'white';
            
            try {
              await signInWithRedirect(auth, provider);
            } catch(err) {
              console.error(err);
              document.getElementById('spinner').style.display = 'none';
              document.getElementById('loginBtn').style.display = 'block';
              document.getElementById('desc').style.display = 'block';
              document.getElementById('status').innerText = 'Redirect Failed';
              document.getElementById('status').style.color = '#ef4444';
              document.getElementById('desc').innerText = err.message || 'Please try again.';
            }
          });
        </script>
      </body>
      </html>
`;

// Replace the old res.end(`...`) block
const regex = /res\.end\(\`[\s\S]*?\`\);\s*return;\s*\}/;

const joinedHtml = "res.end([\n" + newHtml.split('\n').map(line => "          " + JSON.stringify(line)).join(',\n') + "\n        ].join('\\n'));\n    return;\n  }";

content = content.replace(regex, joinedHtml);

fs.writeFileSync('electron/main.cjs', content);
