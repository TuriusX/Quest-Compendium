import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf-8');

const replacement = `      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      
      const userEmail = req.user?.email || (req as any).user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {
           isStripePremium = userData.isPremium === true;
        }
      } else {
        isStripePremium = userData.isPremium === true;
      }
      
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      const isPremium = isStripePremium;`;

// Replace in /api/chat
const chatRegex = /let userData = await getFirestoreDocREST\(idToken, userId\) \|\| \{ isPremium: false \};\s+const today = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\];\s+userData = syncUserLimits\(userData, today\);\s+const isPremium = userData\.isPremium === true;/;

if (code.match(chatRegex)) {
  code = code.replace(chatRegex, replacement);
  console.log("Patched /api/chat");
} else {
  console.log("Could not find match for /api/chat");
}

// In /api/user/status we just need to pass isStripePremium to syncUserLimits
const statusRegex = /let userData = await getFirestoreDocREST\(idToken, userId\) \|\| \{ isPremium: false \};\s+const today = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\];\s+userData = syncUserLimits\(userData, today\);/;

const replacementStatus = `let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      
      const userEmail = req.user?.email || (req as any).user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {}
      }
      
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      // update the frontend object
      userData.isPremium = isStripePremium;
`;

if (code.match(statusRegex)) {
  code = code.replace(statusRegex, replacementStatus);
  console.log("Patched /api/user/status");
} else {
  console.log("Could not find match for /api/user/status");
}

fs.writeFileSync('server.ts', code);
