import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { AppSettings, GameTab, CloudSyncDiagnostics, SyncEventLog } from '../types';
import { getApiBaseUrl } from '../utils/api';

const APP_VERSION = 1;

function sanitizeTabsForCloud(tabs: GameTab[]): GameTab[] {
  return tabs.map(tab => {
    const sanitizedTab = { ...tab };
    
    // Strip large message data (base64 audio/images/banners)
    if (sanitizedTab.messages) {
      sanitizedTab.messages = sanitizedTab.messages.map(msg => {
        const newMsg = { ...msg };
        if (newMsg.audioBase64) delete newMsg.audioBase64;
        if (newMsg.imageUrl && newMsg.imageUrl.length > 2000) delete newMsg.imageUrl;
        if (newMsg.bannerImageUrl && newMsg.bannerImageUrl.length > 2000) delete newMsg.bannerImageUrl;
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
  const [user, setUser] = useState<any | null>(null);
  const [guestUser, setGuestUser] = useState<any | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('quest_guest_session');
      if (saved) {
        return {
          uid: saved,
          email: null,
          displayName: 'Guest Explorer',
          getIdToken: async () => saved,
          isGuest: true
        };
      }
    }
    return null;
  });
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'inactive' | 'beta' | 'loading'>('loading');
  const [userData, setUserData] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isOutdated, setIsOutdated] = useState(false);

  // Cloud Sync Diagnostics State
  const [isListenerAttached, setIsListenerAttached] = useState(false);
  const [lastSnapshotTime, setLastSnapshotTime] = useState<number | null>(null);
  const [lastSnapshotFromCache, setLastSnapshotFromCache] = useState<boolean | null>(null);
  const [lastSnapshotPendingWrites, setLastSnapshotPendingWrites] = useState<boolean | null>(null);
  const [cloudTabsCount, setCloudTabsCount] = useState<number | null>(null);
  const [lastSuccessfulWriteTime, setLastSuccessfulWriteTime] = useState<number | null>(null);
  const [lastWriteError, setLastWriteError] = useState<{ code?: string; message: string; timestamp: number } | null>(null);
  const [eventLogs, setEventLogs] = useState<SyncEventLog[]>([]);

  const addEvent = useCallback((type: string, details: string, isError = false) => {
    const now = Date.now();
    const timeFormatted = new Date(now).toLocaleTimeString();
    const event: SyncEventLog = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      timeFormatted,
      type,
      details,
      isError
    };
    if (isError) {
      console.error(`[CloudSync] [${timeFormatted}] [${type}] ${details}`);
    } else {
      console.log(`[CloudSync] [${timeFormatted}] [${type}] ${details}`);
    }
    setEventLogs(prev => [event, ...prev].slice(0, 20));
  }, []);

  // Compute estimated payload size that would be written to Firestore
  const { estimatedUploadSizeBytes, estimatedUploadSizeKb } = useMemo(() => {
    try {
      const payload = {
        settings: localSettings,
        tabs: sanitizeTabsForCloud(localGameTabs),
        updatedAt: Date.now()
      };
      const jsonStr = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(jsonStr).length;
      const kb = Math.round((bytes / 1024) * 10) / 10;
      return { estimatedUploadSizeBytes: bytes, estimatedUploadSizeKb: kb };
    } catch {
      return { estimatedUploadSizeBytes: 0, estimatedUploadSizeKb: 0 };
    }
  }, [localSettings, localGameTabs]);

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

  // Listen to custom quest_auth_change events (e.g., entering or leaving guest mode)
  useEffect(() => {
    const handleAuthChange = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('quest_guest_session');
        if (saved) {
          setGuestUser({
            uid: saved,
            email: null,
            displayName: 'Guest Explorer',
            getIdToken: async () => saved,
            isGuest: true
          });
        } else {
          setGuestUser(null);
        }
      }
    };

    window.addEventListener('quest_auth_change', handleAuthChange);
    window.addEventListener('storage', handleAuthChange);
    return () => {
      window.removeEventListener('quest_auth_change', handleAuthChange);
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);

  // Listen for manual quota updates (e.g., from chat responses)
  useEffect(() => {
    const handleQuotaUpdate = (e: any) => {
      if (e.detail) {
        setUserData((prev: any) => ({
          ...prev,
          ...e.detail
        }));
      }
    };
    window.addEventListener('quest_quota_updated', handleQuotaUpdate);
    return () => window.removeEventListener('quest_quota_updated', handleQuotaUpdate);
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const savedGuest = typeof window !== 'undefined' ? localStorage.getItem('quest_guest_session') : null;
      
      // If a guest session is explicitly active, do NOT allow a cached Google user to take over
      if (savedGuest) {
        if (currentUser) {
          // Explicitly sign out of Firebase so the Google account is detached from guest sessions
          signOut(auth).catch(() => {});
        }
        setUser(null);
        setSubscriptionStatus('beta');
        setUserData({
          isPremium: false,
          proQueriesAvailable: 5,
          flashQueriesAvailable: 5,
          isGuest: true
        });
        setIsInitializing(false);
        addEvent('AUTH_GUEST', `Guest session active (UID: ...${savedGuest.slice(-6)})`);

        // Sync with server guest status, clamping to 5 maximum
        fetch(`${getApiBaseUrl()}/api/user/status`, {
          headers: { Authorization: `Bearer ${savedGuest}` }
        })
          .then(res => res.json())
          .then(data => {
            if (data && typeof data.proQueriesAvailable === 'number') {
              setUserData({
                isPremium: false,
                proQueriesAvailable: Math.min(5, data.proQueriesAvailable),
                flashQueriesAvailable: Math.min(5, data.flashQueriesAvailable ?? 5),
                isGuest: true
              });
            }
          })
          .catch(() => {});
        return;
      }

      setUser(currentUser);
      if (!currentUser) {
        setSubscriptionStatus('loading');
        setIsInitializing(false);
        addEvent('AUTH_LOGOUT', 'User signed out / no active session');
      } else {
        // We are logging in with full account, hold initialization true until cloud fetch finishes
        setIsInitializing(true);
        addEvent('AUTH_LOGIN', `Signed in as ${currentUser.email || 'no-email'} (UID: ...${currentUser.uid.slice(-6)})`);
      }
    });
    return () => unsubscribe();
  }, [addEvent]);

  // Effect to populate guest state when guestUser changes
  useEffect(() => {
    if (guestUser) {
      if (auth.currentUser) {
        signOut(auth).catch(() => {});
      }
      setSubscriptionStatus('beta');
      setUserData({
        isPremium: false,
        proQueriesAvailable: 5,
        flashQueriesAvailable: 5,
        isGuest: true
      });
      setIsInitializing(false);

      fetch(`${getApiBaseUrl()}/api/user/status`, {
        headers: { Authorization: `Bearer ${guestUser.uid}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data && typeof data.proQueriesAvailable === 'number') {
            setUserData({
              isPremium: false,
              proQueriesAvailable: Math.min(5, data.proQueriesAvailable),
              flashQueriesAvailable: Math.min(5, data.flashQueriesAvailable ?? 5),
              isGuest: true
            });
          }
        })
        .catch(() => {});
    }
  }, [guestUser]);

  // Listen to User Profile (Subscription & Settings Sync)
  useEffect(() => {
    if (!user || (user as any).isGuest) return;
    const userRef = doc(db, 'users', user.uid);
    
    let unsubscribe = () => {};
    let isCancelled = false;

    // Use a ref to guarantee we know when the first load happened
    let hasDoneInitialCloudLoad = false;

    const initializeUserDoc = async () => {
      addEvent('INIT_DOC_START', `Checking user doc in Firestore (users/...${user.uid.slice(-6)})`);
      try {
        const docSnap = await getDoc(userRef);
        if (!docSnap.exists()) {
          const initialSettingsStr = JSON.stringify(localDataRef.current.settings);
          const initialTabsStr = JSON.stringify(sanitizeTabsForCloud(localDataRef.current.tabs));
          
          lastSyncedData.current = { settings: initialSettingsStr, tabs: initialTabsStr };
          addEvent('INIT_DOC_CREATING', `Doc does not exist. Creating with ${localDataRef.current.tabs.length} local tabs (${estimatedUploadSizeKb} KB)...`);

          await setDoc(userRef, {
            email: user.email || null,
            subscriptionStatus: 'beta',
            settings: JSON.parse(initialSettingsStr),
            tabs: JSON.parse(initialTabsStr),
            updatedAt: Date.now()
          });
          const now = Date.now();
          setLastSuccessfulWriteTime(now);
          addEvent('INIT_DOC_SUCCESS', `Initial user doc created in Firestore`);
        } else {
          addEvent('INIT_DOC_EXISTS', `User doc exists in Firestore`);
        }
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const message = err?.message || String(err);
        setLastWriteError({ code, message, timestamp: Date.now() });
        addEvent('INIT_DOC_ERROR', `Error checking/creating user doc: [${code}] ${message}`, true);
        throw err;
      }
    };

    initializeUserDoc()
      .catch(err => {
        console.warn("[CloudSync] initializeUserDoc caught:", err);
      })
      .then(() => {
        if (isCancelled) return;
        setIsListenerAttached(true);
        addEvent('LISTENER_ATTACH', `Attaching onSnapshot listener to users/...${user.uid.slice(-6)}`);

        unsubscribe = onSnapshot(userRef, (docSnap) => {
          const now = Date.now();
          setLastSnapshotTime(now);
          setLastSnapshotFromCache(docSnap.metadata.fromCache);
          setLastSnapshotPendingWrites(docSnap.metadata.hasPendingWrites);

          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserData(data);
            
            // CRITICAL FIX: If subscriptionStatus is missing, assume 'beta' so they can upload.
            setSubscriptionStatus(data.subscriptionStatus || 'beta');
            
            const cloudSettingsStr = JSON.stringify(data.settings || {});
            const cloudTabs = data.tabs;
            const cloudTabsStr = JSON.stringify(cloudTabs || []);
            const cloudCount = Array.isArray(cloudTabs) ? cloudTabs.length : 0;
            setCloudTabsCount(cloudCount);

            addEvent(
              'SNAPSHOT_RECEIVED',
              `exists=true, fromCache=${docSnap.metadata.fromCache}, pendingWrites=${docSnap.metadata.hasPendingWrites}, cloudTabsCount=${cloudCount}`
            );

            // Robust check: ONLY update local state if the cloud has genuinely different data
            // By checking against lastSyncedData, we don't get trapped by React closures.
            let stateUpdated = false;
            
            if (!hasDoneInitialCloudLoad || cloudSettingsStr !== lastSyncedData.current.settings) {
              if (data.settings) {
                 setLocalSettings(data.settings);
                 stateUpdated = true;
              }
            }

            // Continuous bidirectional tabs synchronization
            if (!hasDoneInitialCloudLoad || cloudTabsStr !== lastSyncedData.current.tabs) {
              if (Array.isArray(cloudTabs) && cloudTabs.length > 0) {
                setLocalGameTabs(cloudTabs);
                stateUpdated = true;
                addEvent('TABS_LOADED_FROM_CLOUD', `Applied ${cloudTabs.length} tabs from cloud to local state`);
                try {
                  localStorage.setItem(`quest_compendium_tabs_${user.uid}`, cloudTabsStr);
                  localStorage.setItem('quest_compendium_tabs', cloudTabsStr);
                } catch {}
              } else if (!hasDoneInitialCloudLoad && (!cloudTabs || cloudTabs.length === 0)) {
                // Cloud has no tabs yet, but local might already have tabs created by user!
                if (localDataRef.current.tabs && localDataRef.current.tabs.length > 0) {
                  // Upload local tabs to cloud so they are saved
                  const localTabsStr = JSON.stringify(sanitizeTabsForCloud(localDataRef.current.tabs));
                  lastSyncedData.current.tabs = localTabsStr;
                  addEvent('WRITE_START', `Initial upload of ${localDataRef.current.tabs.length} local tabs to empty cloud doc (${estimatedUploadSizeKb} KB)...`);
                  setDoc(userRef, {
                    tabs: JSON.parse(localTabsStr),
                    updatedAt: Date.now()
                  }, { merge: true })
                    .then(() => {
                      const writeNow = Date.now();
                      setLastSuccessfulWriteTime(writeNow);
                      addEvent('WRITE_SUCCESS', `Initial tab upload succeeded (${localDataRef.current.tabs.length} tabs)`);
                    })
                    .catch(err => {
                      const code = (err as any)?.code || 'unknown';
                      const message = (err as any)?.message || String(err);
                      setLastWriteError({ code, message, timestamp: Date.now() });
                      addEvent('WRITE_ERROR', `Initial tab upload failed: [${code}] ${message}`, true);
                      console.error("Initial tab upload error", err);
                    });
                }
              } else if (hasDoneInitialCloudLoad && Array.isArray(cloudTabs) && cloudTabs.length === 0) {
                // Remote explicitly deleted all tabs
                setLocalGameTabs([]);
                stateUpdated = true;
                addEvent('TABS_CLEARED_REMOTE', 'Remote cloud tabs emptied; cleared local tabs');
              }
            }

            if (stateUpdated || !hasDoneInitialCloudLoad) {
              lastSyncedData.current = { settings: cloudSettingsStr, tabs: cloudTabsStr };
            }

            hasDoneInitialCloudLoad = true;
            setIsInitializing(false); // Only allow local->cloud writes after this completes
          } else {
            setCloudTabsCount(0);
            const meta = (docSnap as any).metadata;
            addEvent('SNAPSHOT_RECEIVED', `exists=false, fromCache=${meta?.fromCache}, pendingWrites=${meta?.hasPendingWrites}`);
          }
        }, (error) => {
          const code = (error as any)?.code || 'unknown';
          const message = (error as any)?.message || String(error);
          setLastWriteError({ code, message, timestamp: Date.now() });
          addEvent('SNAPSHOT_ERROR', `Snapshot listener error: [${code}] ${message}`, true);
        });
      });

    return () => {
      isCancelled = true;
      setIsListenerAttached(false);
      addEvent('LISTENER_DETACH', `Detached snapshot listener for users/...${user.uid.slice(-6)}`);
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, addEvent]);

  // Sync Local to Cloud whenever settings or tabs change
  useEffect(() => {
    if (!user || user.isGuest || (subscriptionStatus !== 'active' && subscriptionStatus !== 'beta') || isInitializing) return;

    const currentSettingsStr = JSON.stringify(localSettings);
    const currentTabsStr = JSON.stringify(sanitizeTabsForCloud(localGameTabs));

    // Prevent loop: Only upload if the local data has actually changed compared to the last sync
    if (currentSettingsStr === lastSyncedData.current.settings && 
        currentTabsStr === lastSyncedData.current.tabs) {
      return;
    }

    const flushSync = () => {
      lastSyncedData.current = { settings: currentSettingsStr, tabs: currentTabsStr };
      const userRef = doc(db, 'users', user.uid);
      addEvent('WRITE_START', `Sync write starting: ${localGameTabs.length} tabs (${estimatedUploadSizeKb} KB)...`);
      setDoc(userRef, {
        settings: JSON.parse(currentSettingsStr),
        tabs: JSON.parse(currentTabsStr),
        updatedAt: Date.now()
      }, { merge: true })
        .then(() => {
          const now = Date.now();
          setLastSuccessfulWriteTime(now);
          addEvent('WRITE_SUCCESS', `Successfully synced ${localGameTabs.length} tabs to cloud`);
        })
        .catch(err => {
          const code = (err as any)?.code || 'unknown';
          const message = (err as any)?.message || String(err);
          setLastWriteError({ code, message, timestamp: Date.now() });
          addEvent('WRITE_ERROR', `Sync write error: [${code}] ${message}`, true);
          console.error("Sync error", err);
          // Reset lastSyncedData on failure so retry happens
          lastSyncedData.current = { settings: '', tabs: '' };
        });
    };

    const syncTimeout = setTimeout(flushSync, 1000);

    const handleBeforeUnloadOrFlush = () => {
      clearTimeout(syncTimeout);
      flushSync();
    };

    window.addEventListener('beforeunload', handleBeforeUnloadOrFlush);
    window.addEventListener('quest_flush_sync', handleBeforeUnloadOrFlush);

    return () => {
      clearTimeout(syncTimeout);
      window.removeEventListener('beforeunload', handleBeforeUnloadOrFlush);
      window.removeEventListener('quest_flush_sync', handleBeforeUnloadOrFlush);
    };
  }, [localSettings, localGameTabs, user, subscriptionStatus, isInitializing, addEvent, estimatedUploadSizeKb]);

  const effectiveUser = guestUser ? guestUser : user;
  const currentUid = user?.uid || guestUser?.uid || null;
  const currentEmail = user?.email || (guestUser ? 'Guest User' : null);

  const syncDiagnostics: CloudSyncDiagnostics = useMemo(() => {
    const getSummaryText = () => {
      const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
      const lines = [
        `=== QUEST COMPENDIUM CLOUD SYNC DIAGNOSTICS ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Platform: ${isElectron ? 'Desktop (Electron)' : 'Web Browser'}`,
        `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
        `Account Email: ${currentEmail || 'Not signed in'}`,
        `Account UID: ${currentUid || 'None'} (Last 6: ${currentUid ? currentUid.slice(-6) : 'N/A'})`,
        `Is Guest: ${Boolean(guestUser || user?.isGuest)}`,
        `Subscription Status: ${subscriptionStatus}`,
        `Is Initializing: ${isInitializing}`,
        `Snapshot Listener Attached: ${isListenerAttached}`,
        `Last Snapshot Time: ${lastSnapshotTime ? new Date(lastSnapshotTime).toLocaleTimeString() : 'Never'}`,
        `Last Snapshot fromCache: ${lastSnapshotFromCache === null ? 'N/A' : String(lastSnapshotFromCache)}`,
        `Last Snapshot hasPendingWrites: ${lastSnapshotPendingWrites === null ? 'N/A' : String(lastSnapshotPendingWrites)}`,
        `Local Tabs Count: ${localGameTabs.length}`,
        `Cloud Snapshot Tabs Count: ${cloudTabsCount === null ? 'N/A' : String(cloudTabsCount)}`,
        `Estimated Upload Payload Size: ${estimatedUploadSizeKb} KB (${estimatedUploadSizeBytes} bytes)`,
        `Firestore 1MB Limit Usage: ${((estimatedUploadSizeBytes / 1048576) * 100).toFixed(2)}% of 1024 KB`,
        `Last Successful Write Time: ${lastSuccessfulWriteTime ? new Date(lastSuccessfulWriteTime).toLocaleTimeString() : 'Never'}`,
        `Last Write Error: ${lastWriteError ? `[Code: ${lastWriteError.code || 'unknown'}] ${lastWriteError.message} at ${new Date(lastWriteError.timestamp).toLocaleTimeString()}` : 'None'}`,
        ``,
        `=== RECENT SYNC EVENTS (Last 20) ===`,
        ...(eventLogs.length > 0 
          ? eventLogs.map(e => `[${e.timeFormatted}] [${e.type}] ${e.details}`)
          : ['(No sync events logged yet)'])
      ];
      return lines.join('\n');
    };

    const copyDiagnostics = async (): Promise<boolean> => {
      const summary = getSummaryText();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(summary);
          return true;
        }
      } catch (err) {
        console.warn('[CloudSync] Clipboard API write failed, falling back to textarea execCommand', err);
      }
      try {
        const textArea = document.createElement('textarea');
        textArea.value = summary;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        return success;
      } catch (fallbackErr) {
        console.error('[CloudSync] Fallback copy failed', fallbackErr);
        return false;
      }
    };

    return {
      accountEmail: currentEmail,
      uid: currentUid,
      uidLast6: currentUid ? currentUid.slice(-6) : null,
      subscriptionStatus,
      isInitializing,
      isListenerAttached,
      lastSnapshotTime,
      lastSnapshotFromCache,
      lastSnapshotPendingWrites,
      localTabsCount: localGameTabs.length,
      cloudTabsCount,
      estimatedUploadSizeBytes,
      estimatedUploadSizeKb,
      lastSuccessfulWriteTime,
      lastWriteError,
      eventLogs,
      copyDiagnostics,
      getSummaryText
    };
  }, [
    currentEmail,
    currentUid,
    guestUser,
    user,
    subscriptionStatus,
    isInitializing,
    isListenerAttached,
    lastSnapshotTime,
    lastSnapshotFromCache,
    lastSnapshotPendingWrites,
    localGameTabs.length,
    cloudTabsCount,
    estimatedUploadSizeBytes,
    estimatedUploadSizeKb,
    lastSuccessfulWriteTime,
    lastWriteError,
    eventLogs
  ]);

  // Expose to window.__questSyncDiagnostics for quick devtools console inspection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__questSyncDiagnostics = syncDiagnostics;
    }
  }, [syncDiagnostics]);

  return { user: effectiveUser, subscriptionStatus, userData, isInitializing, isOutdated, syncDiagnostics };
}
