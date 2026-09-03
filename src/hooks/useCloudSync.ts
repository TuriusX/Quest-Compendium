import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { AppSettings, GameTab } from '../types';

const APP_VERSION = 1;

export function useCloudSync(
  localSettings: AppSettings,
  localGameTabs: GameTab[],
  setLocalSettings: (s: AppSettings) => void,
  setLocalGameTabs: (t: GameTab[]) => void
) {
  const [user, setUser] = useState<User | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'inactive' | 'beta' | 'loading'>('loading');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isOutdated, setIsOutdated] = useState(false);

  // App Version Check
  useEffect(() => {
    const configRef = doc(db, 'config', 'desktop_client');
    const unsub = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.minVersion && data.minVersion > APP_VERSION) {
          setIsOutdated(true);
        } else {
          setIsOutdated(false);
        }
      }
    });
    return () => unsub();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setSubscriptionStatus('loading');
        setIsInitializing(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen to User Profile (Subscription & Settings Sync)
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    
    // First, ensure the document exists, then subscribe
    const initializeUserDoc = async () => {
      const docSnap = await getDoc(userRef);
      if (!docSnap.exists()) {
        await setDoc(userRef, {
          email: user.email || null,
          subscriptionStatus: 'beta',
          settings: JSON.parse(JSON.stringify(localSettings)),
          tabs: JSON.parse(JSON.stringify(localGameTabs)),
          updatedAt: Date.now()
        });
      }
    };

    let unsubscribe = () => {};
    let isCancelled = false;

    initializeUserDoc().then(() => {
      if (isCancelled) return;
      unsubscribe = onSnapshot(userRef, (docSnap) => {
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
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [user]);

  // Sync Local to Cloud whenever settings or tabs change
  useEffect(() => {
    if (!user || (subscriptionStatus !== 'active' && subscriptionStatus !== 'beta') || isInitializing) return;

    const syncTimeout = setTimeout(() => {
      const userRef = doc(db, 'users', user.uid);
      setDoc(userRef, {
        settings: JSON.parse(JSON.stringify(localSettings)),
        tabs: JSON.parse(JSON.stringify(localGameTabs)),
        updatedAt: Date.now()
      }, { merge: true }).catch(err => console.error("Sync error", err));
    }, 1500); // Debounce syncs by 1.5 seconds

    return () => clearTimeout(syncTimeout);
  }, [localSettings, localGameTabs, user, subscriptionStatus, isInitializing]);

  return { user, subscriptionStatus, isInitializing, isOutdated };
}
