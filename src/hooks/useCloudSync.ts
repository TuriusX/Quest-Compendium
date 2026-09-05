import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { AppSettings, GameTab } from '../types';

const APP_VERSION = 1;

function sanitizeTabsForCloud(tabs: GameTab[]): GameTab[] {
  return tabs.map(tab => {
    const sanitizedTab = { ...tab };
    
    // Strip large message data (base64 audio/images)
    if (sanitizedTab.messages) {
      sanitizedTab.messages = sanitizedTab.messages.map(msg => {
        const newMsg = { ...msg };
        if (newMsg.audioBase64) delete newMsg.audioBase64;
        if (newMsg.imageUrl && newMsg.imageUrl.length > 2000) delete newMsg.imageUrl;
        return newMsg;
      });
    }
    
    // Strip heavy active game data (achievements/patch notes)
    if (sanitizedTab.activeSteamGame) {
       const safeGame = { ...sanitizedTab.activeSteamGame };
       if (safeGame.achievements) delete safeGame.achievements;
       if (safeGame.patchNotes) delete safeGame.patchNotes;
       sanitizedTab.activeSteamGame = safeGame;
    }

    return sanitizedTab;
  });
}

export function useCloudSync(
  localSettings: AppSettings,
  localGameTabs: GameTab[],
  setLocalSettings: (s: AppSettings) => void,
  setLocalGameTabs: (t: GameTab[]) => void
) {
  const [user, setUser] = useState<User | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'inactive' | 'beta' | 'loading'>('loading');
  const [userData, setUserData] = useState<any>(null);
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
          tabs: JSON.parse(JSON.stringify(sanitizeTabsForCloud(localGameTabs))),
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
          setUserData(data);
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
        tabs: JSON.parse(JSON.stringify(sanitizeTabsForCloud(localGameTabs))),
        updatedAt: Date.now()
      }, { merge: true }).catch(err => console.error("Sync error", err));
    }, 1500); // Debounce syncs by 1.5 seconds

    return () => clearTimeout(syncTimeout);
  }, [localSettings, localGameTabs, user, subscriptionStatus, isInitializing]);

  return { user, subscriptionStatus, userData, isInitializing, isOutdated };
}
