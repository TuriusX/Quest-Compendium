const fs = require('fs');
const file = 'src/hooks/useCloudSync.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
`    initializeUserDoc().then(() => {
      const unsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setSubscriptionStatus(data.subscriptionStatus || 'inactive');
          setIsInitializing(false);

          // Sync cloud down to local state on initial load or remote change
          // For a robust app, we'd use timestamps to resolve conflicts.
          // Keeping it simple here.
          if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(localSettings)) {
            // setLocalSettings(data.settings); // In a fully synced app, uncomment this. But it might cause loops if not careful.
          }
        }
      });
      return unsubscribe;
    });`,
`    let unsubscribe = () => {};
    let isCancelled = false;

    initializeUserDoc().then(() => {
      if (isCancelled) return;
      unsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setSubscriptionStatus(data.subscriptionStatus || 'inactive');
          setIsInitializing(false);

          if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(localSettings)) {
            // setLocalSettings(data.settings);
          }
        }
      });
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };`
);
fs.writeFileSync(file, code);
