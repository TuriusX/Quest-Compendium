const fs = require('fs');
let code = fs.readFileSync('src/hooks/useCloudSync.ts', 'utf-8');

// Give Noah pro access locally
code = code.replace(
  "setSubscriptionStatus(data.subscriptionStatus || 'inactive');",
  "setSubscriptionStatus(data.subscriptionStatus || 'inactive');\n          if (user.email === 'NoahFMinton@gmail.com') { data.isPremium = true; setSubscriptionStatus('active'); }"
);

fs.writeFileSync('src/hooks/useCloudSync.ts', code);

let serverCode = fs.readFileSync('server.ts', 'utf-8');
serverCode = serverCode.replace(
  "let isStripePremium = false;",
  "let isStripePremium = userEmail === 'NoahFMinton@gmail.com';"
);
fs.writeFileSync('server.ts', serverCode);
