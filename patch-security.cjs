const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldCodeSync = `  function syncUserLimits(userData: any, today: string) {
    const isPremium = userData.isPremium === true;
    if (userData.lastResetDate !== today) {`;

const newCodeSync = `  import crypto from 'crypto';

  function verifySeal(userData: any) {
    if (!userData.securitySeal) return false;
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'default_secret';
    const payload = \`\${userData.proQueriesAvailable}-\${userData.flashQueriesAvailable}-\${userData.lastResetDate}\`;
    const expectedSeal = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return userData.securitySeal === expectedSeal;
  }

  function generateSeal(userData: any) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'default_secret';
    const payload = \`\${userData.proQueriesAvailable}-\${userData.flashQueriesAvailable}-\${userData.lastResetDate}\`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  function syncUserLimits(userData: any, today: string, isStripePremium: boolean) {
    const isPremium = isStripePremium;

    // Security Verification: If tampering is detected, reset to 0
    if (userData.lastResetDate === today && userData.securitySeal && !verifySeal(userData)) {
       console.warn('SECURITY ALERT: Tampering detected for user. Resetting quotas.');
       userData.proQueriesAvailable = 0;
       userData.flashQueriesAvailable = 0;
       userData.securitySeal = generateSeal(userData);
       return userData;
    }

    if (userData.lastResetDate !== today) {`;

code = code.replace(oldCodeSync, newCodeSync);

fs.writeFileSync('server.ts', code);
console.log("Successfully patched syncUserLimits");
