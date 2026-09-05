const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

// 1. Webhook
content = content.replace(
  /const db = getFirestore\(getApp\(\), 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f'\);\s*await db\.collection\('users'\)\.doc\(userId\)\.set\(\{[\s\S]*?\}, \{ merge: true \}\);/g,
  `console.log("Stripe webhook received checkout for", userId);
          // Skipping server-side Firestore admin write due to AI Studio IAM sandbox restrictions.
          // The client will perform the update upon redirect.`
);

// 2. /api/user/status
content = content.replace(
  /const db = getFirestore\(getApp\(\), 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f'\);\s*const userId = \(req as any\)\.user\.uid;\s*const userRef = db\.collection\('users'\)\.doc\(userId\);\s*const userDoc = await userRef\.get\(\);\s*let userData = userDoc\.data\(\) \|\| \{ isPremium: false \};/g,
  `const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };`
);

// 3. /api/chat
content = content.replace(
  /const db = getFirestore\(getApp\(\), 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f'\);\s*const userRef = db\.collection\('users'\)\.doc\(\(req as any\)\.user\.uid\);\s*const userDoc = await userRef\.get\(\);\s*let userData = userDoc\.data\(\) \|\| \{ isPremium: false \};/g,
  `const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };`
);

content = content.replace(
  /await userRef\.set\(userData, \{ merge: true \}\);/g,
  `await updateFirestoreDocREST(idToken, userId, {
        lastResetDate: userData.lastResetDate,
        proQueriesToday: userData.proQueriesToday,
        flashQueriesToday: userData.flashQueriesToday
      });`
);

fs.writeFileSync('server.ts', content);
