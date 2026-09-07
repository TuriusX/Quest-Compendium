const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldCheck1 = `      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today);
      const isPremium = userData.isPremium === true;`;

const newCheck1 = `      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      const userEmail = (req as any).user.email;
      let isStripePremium = false;
      try {
        const stripe = getStripe();
        const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
          isStripePremium = subs.data.length > 0;
        }
      } catch (e) {
         // fallback to db if Stripe fails to respond
         isStripePremium = userData.isPremium === true;
      }
      
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      const isPremium = isStripePremium;`;

code = code.replace(oldCheck1, newCheck1).replace(oldCheck1, newCheck1);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with Stripe Verification");
