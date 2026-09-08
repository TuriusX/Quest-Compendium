import { useState, useEffect, useRef } from 'react';
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

  // Track last synced data to prevent infinite loops
  const lastSyncedData = useRef({ settings: '', tabs: '' });
  
  // Use a ref to guarantee we have the absolute latest local data in closures
  const localDataRef = useRef({ settings: localSettings, tabs: localGameTabs });
  useEffect(() => {
    localDataRef.current = { settings: localSettings, tabs: localGameTabs };
  }, [localSettings, localGameTabs]);

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
      } else {
        // We are logging in, hold initialization true until cloud fetch finishes
        setIsInitializing(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen to User Profile (Subscription & Settings Sync)
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    
    let unsubscribe = () => {};
    let isCancelled = false;

    // Use a ref to guarantee we know when the first load happened
    let hasDoneInitialCloudLoad = false;

    const initializeUserDoc = async () => {
      const docSnap = await getDoc(userRef);
      if (!docSnap.exists()) {
        const initialSettingsStr = JSON.stringify(localDataRef.current.settings);
        const initialTabsStr = JSON.stringify(sanitizeTabsForCloud(localDataRef.current.tabs));
        
        lastSyncedData.current = { settings: initialSettingsStr, tabs: initialTabsStr };

        await setDoc(userRef, {
          email: user.email || null,
          subscriptionStatus: 'beta',
          settings: JSON.parse(initialSettingsStr),
          tabs: JSON.parse(initialTabsStr),
          updatedAt: Date.now()
        });
      }
    };

    initializeUserDoc().then(() => {
      if (isCancelled) return;
      unsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setUserData(data);
          
          // CRITICAL FIX: If subscriptionStatus is missing, assume 'beta' so they can upload.
          setSubscriptionStatus(data.subscriptionStatus || 'beta');
          
          const cloudSettingsStr = JSON.stringify(data.settings || {});
          const cloudTabsStr = JSON.stringify(data.tabs || []);

          // Robust check: ONLY update local state if the cloud has genuinely different data
          // By checking against lastSyncedData, we don't get trapped by React closures.
          let stateUpdated = false;
          
          if (!hasDoneInitialCloudLoad || cloudSettingsStr !== lastSyncedData.current.settings) {
            if (data.settings) {
               setLocalSettings(data.settings);
               stateUpdated = true;
            }
          }

          if (!hasDoneInitialCloudLoad || cloudTabsStr !== lastSyncedData.current.tabs) {
            if (data.tabs && Array.isArray(data.tabs)) {
               setLocalGameTabs(data.tabs);
               stateUpdated = true;
            }
          }

          if (stateUpdated || !hasDoneInitialCloudLoad) {
            lastSyncedData.current = { settings: cloudSettingsStr, tabs: cloudTabsStr };
          }

          hasDoneInitialCloudLoad = true;
          setIsInitializing(false); // Only allow local->cloud writes after this completes
        }
      });
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Sync Local to Cloud whenever settings or tabs change
  useEffect(() => {
    if (!user || (subscriptionStatus !== 'active' && subscriptionStatus !== 'beta') || isInitializing) return;

    const currentSettingsStr = JSON.stringify(localSettings);
    const currentTabsStr = JSON.stringify(sanitizeTabsForCloud(localGameTabs));

    // Prevent loop: Only upload if the local data has actually changed compared to the last sync
    if (currentSettingsStr === lastSyncedData.current.settings && 
        currentTabsStr === lastSyncedData.current.tabs) {
      return;
    }

    const syncTimeout = setTimeout(() => {
      lastSyncedData.current = { settings: currentSettingsStr, tabs: currentTabsStr };
      const userRef = doc(db, 'users', user.uid);
      setDoc(userRef, {
        settings: JSON.parse(currentSettingsStr),
        tabs: JSON.parse(currentTabsStr),
        updatedAt: Date.now()
      }, { merge: true }).catch(err => console.error("Sync error", err));
    }, 1500); // Debounce syncs by 1.5 seconds

    return () => clearTimeout(syncTimeout);
  }, [localSettings, localGameTabs, user, subscriptionStatus, isInitializing]);

  return { user, subscriptionStatus, userData, isInitializing, isOutdated };
}
