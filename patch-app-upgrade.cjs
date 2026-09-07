const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldCode = `      if (urlParams.get('upgrade') === 'success') {
        const upgradeUser = async () => {
          try {
            await setDoc(doc(db, 'users', user.uid), {
              isPremium: true,
              subscriptionStatus: 'active'
            }, { merge: true });
            console.log('Successfully upgraded user to Premium locally!');
            // Remove the param from URL
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (e) {
            console.error('Failed to update premium status:', e);
          }
        };
        upgradeUser();
      }`;

const newCode = `      if (urlParams.get('upgrade') === 'success') {
        console.log('Subscription completed. Server will verify via Stripe.');
        window.history.replaceState({}, document.title, window.location.pathname);
      }`;

if (code.includes('upgradeUser();')) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Patched App.tsx upgrade bypass");
}
