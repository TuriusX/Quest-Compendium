const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf8');

const target = `app.whenReady().then(() => {`;
const replacement = `app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['unsafe-none'],
        'Cross-Origin-Embedder-Policy': ['unsafe-none']
      }
    });
  });
`;

code = code.replace(target, replacement);
fs.writeFileSync('electron/main.cjs', code);
