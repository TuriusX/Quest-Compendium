import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, User, signOut, getRedirectResult, browserPopupRedirectResolver } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc, runTransaction } from 'firebase/firestore';
import { AppSettings, GameTab, CloudSyncDiagnostics, SyncEventLog } from '../types';
import { getApiBaseUrl } from '../utils/api';
import {
  canonicalStringify, removeUndefinedFields, isLegacyWelcomeTab, sanitizeTabsForCloud,
  mergeTabState, readTombstones, writeTombstones, cleanTombstones, dropLegacyDeletedList, UploadGovernor,
  type TabState, type MergeOutcome
} from './tabMerge';

const APP_VERSION = 1;

const BUILD_INFO = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { version: 'dev', commit: 'unknown', builtAt: 'unknown' };

// The tab merge logic lives in ./tabMerge (pure, and unit-tested). Re-exported so existing imports keep working.
export { canonicalStringify, removeUndefinedFields, isLegacyWelcomeTab };

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
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'inactive' | 'beta' | 'loading'>('beta');
  const [userData, setUserData] = useState<any>(() => ({
    isPremium: false,
    proQueriesAvailable: 5,
    flashQueriesAvailable: 5,
    isGuest: false
  }));
  const [isInitializing, setIsInitializing] = useState(false);
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
  localDataRef.current = { settings: localSettings, tabs: localGameTabs };
  useEffect(() => {
    localDataRef.current = { settings: localSettings, tabs: localGameTabs };
  }, [localSettings, localGameTabs]);

  // One-time cleanup: the old per-device "deleted tab ids" list caused a cross-device write war and is no longer used.
  useEffect(() => {
    dropLegacyDeletedList();
    addEvent('BUILD_INFO', `Build v${BUILD_INFO.version} (${BUILD_INFO.commit}) built ${BUILD_INFO.builtAt}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Last line of defence: if uploads ever run away again, pause instead of hammering Firestore.
  const uploadGovernor = useRef(new UploadGovernor());

  /**
   * The ONLY way tabs are written to the cloud. Inside one Firestore transaction it reads the current SERVER copy, merges it
   * with this device's tabs and deletions (see tabMerge.ts), and writes only if the result differs from what the cloud already
   * holds. Merging against fresh server data means a stale cache, or another device, can never be overwritten with an
   * out-of-date list.
   */
  const pushTabs = async (uid: string, why: string): Promise<boolean> => {
    if (!uploadGovernor.current.allow()) {
      const message = 'Too many tab uploads in a short time. Sync paused for 30 seconds to protect your data.';
      setLastWriteError({ code: 'sync-loop-guard', message, timestamp: Date.now() });
      addEvent('SYNC_LOOP_GUARD', message, true);
      return false;
    }
    const userRef = doc(db, 'users', uid);
    const startTabs = localDataRef.current.tabs;
    try {
      let cloudCount = 0;
      const outcome: MergeOutcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        const data: any = snap.exists() ? snap.data() : {};
        const cloudTabs: any[] = Array.isArray(data.tabs) ? data.tabs : [];
        cloudCount = cloudTabs.length;
        const cloudState: TabState = { tabs: cloudTabs, deleted: cleanTombstones(data.deletedTabs) };
        const result = mergeTabState({ tabs: startTabs, deleted: readTombstones() }, cloudState);
        if (result.cloudChanged) {
          tx.set(userRef, removeUndefinedFields({
            tabs: sanitizeTabsForCloud(result.merged.tabs),
            deletedTabs: result.merged.deleted,
            updatedAt: Date.now()
          }), { mergeFields: ['tabs', 'deletedTabs', 'updatedAt'] });
        }
        return result;
      });

      // Apply the merged result locally, unless the user changed something while we were talking to the server
      // (in that case the next sync round handles it).
      if (outcome.localChanged && localDataRef.current.tabs === startTabs) {
        setLocalGameTabs(outcome.merged.tabs);
        try {
          const json = JSON.stringify(outcome.merged.tabs);
          localStorage.setItem(`quest_compendium_tabs_${uid}`, json);
          localStorage.setItem('quest_compendium_tabs', json);
          localStorage.setItem('quest_compendium_tabs_backup', json);
        } catch {}
      }
      writeTombstones(outcome.merged.deleted);
      lastSyncedData.current = { ...lastSyncedData.current, tabs: canonicalStringify(sanitizeTabsForCloud(outcome.merged.tabs)) };

      const summary = `cloud had ${cloudCount} tabs, this device had ${startTabs.length}, merged ${outcome.merged.tabs.length}`;
      if (outcome.cloudChanged) {
        setLastSuccessfulWriteTime(Date.now());
        setLastWriteError(null);
        addEvent('WRITE_SUCCESS', `${why}: ${summary}. Uploaded.`);
      } else {
        addEvent('SYNC_NOOP', `${why}: ${summary}. Cloud already up to date.`);
      }
      return true;
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      setLastWriteError({ code, message, timestamp: Date.now() });
      addEvent('WRITE_ERROR', `${why}: tab sync failed: [${code}] ${message}`, true);
      lastSyncedData.current = { ...lastSyncedData.current, tabs: '' }; // retry on the next change
      return false;
    }
  };

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
    // Check if returning from a redirect sign-in flow
    getRedirectResult(auth, browserPopupRedirectResolver)
      .then((result) => {
        if (result?.user) {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('quest_guest_session');
            window.dispatchEvent(new Event('quest_auth_change'));
          }
          setUser(result.user);
        }
      })
      .catch((err) => {
        console.warn('[CloudSync] Redirect result error:', err);
      });

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // 1. If an authenticated user is logged in, they take absolute priority!
      if (currentUser) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('quest_guest_session');
        }
        setGuestUser(null);
        setUser(currentUser);
        setIsInitializing(true);
        addEvent('AUTH_LOGIN', `Signed in as ${currentUser.email || 'no-email'} (UID: ...${currentUser.uid.slice(-6)})`);

        // Check if user was previously verified as Pro in this client
        const cachedPro = typeof window !== 'undefined' && localStorage.getItem(`quest_pro_${currentUser.uid}`) === 'true';
        if (cachedPro) {
          setSubscriptionStatus('active');
          setUserData((prev: any) => ({
            ...prev,
            isPremium: true,
            proQueriesAvailable: prev?.proQueriesAvailable ?? 40,
            flashQueriesAvailable: prev?.flashQueriesAvailable ?? 1000,
            isGuest: false
          }));
        }

        currentUser.getIdToken().then(token => {
          return fetch(`${getApiBaseUrl()}/api/user/status`, {
            headers: { Authorization: `Bearer ${token}` }
          });
        })
          .then(res => res.json())
          .then(data => {
            if (data && typeof data.proQueriesAvailable === 'number') {
              const isPrem = Boolean(data.isPremium || data.subscriptionStatus === 'active');
              if (isPrem && typeof window !== 'undefined') {
                localStorage.setItem(`quest_pro_${currentUser.uid}`, 'true');
              }
              setUserData((prev: any) => ({
                ...prev,
                ...data,
                isPremium: isPrem,
                proQueriesAvailable: data.proQueriesAvailable,
                flashQueriesAvailable: data.flashQueriesAvailable ?? (isPrem ? 1000 : 5),
                isGuest: false
              }));
              setSubscriptionStatus(isPrem ? 'active' : (data.subscriptionStatus || 'beta'));

              // Persist verified Pro status directly to Firestore user doc so onSnapshot also has it
              if (isPrem && currentUser) {
                setDoc(doc(db, 'users', currentUser.uid), { isPremium: true, subscriptionStatus: 'active' }, { merge: true }).catch(() => {});
              }
            }
            setIsInitializing(false);
          })
          .catch(() => {
            setIsInitializing(false);
          });
        return;
      }

      // 2. Only if no Google account is logged in, check for an explicit guest session
      const savedGuest = typeof window !== 'undefined' ? localStorage.getItem('quest_guest_session') : null;
      if (savedGuest) {
        setUser(null);
        setGuestUser({
          uid: savedGuest,
          email: null,
          displayName: 'Guest Explorer',
          getIdToken: async () => savedGuest,
          isGuest: true
        });
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

      // 3. Completely unauthenticated and no guest session
      setUser(null);
      setGuestUser(null);
      setSubscriptionStatus('beta');
      setIsInitializing(false);
      addEvent('AUTH_LOGOUT', 'User signed out / no active session');
    });

    return () => unsubscribe();
  }, [addEvent]);

  // Effect to populate guest state when guestUser changes
  useEffect(() => {
    // Only apply guest parameters if there is genuinely no logged-in Google account
    if (guestUser && !auth.currentUser) {
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
          const initialTabs = sanitizeTabsForCloud(localDataRef.current.tabs);
          const initialSettingsCanonical = canonicalStringify(localDataRef.current.settings);
          const initialTabsCanonical = canonicalStringify(initialTabs);
          
          lastSyncedData.current = { settings: initialSettingsCanonical, tabs: initialTabsCanonical };
          addEvent('INIT_DOC_CREATING', `Doc does not exist. Creating with ${localDataRef.current.tabs.length} local tabs (${estimatedUploadSizeKb} KB)...`);

          await setDoc(userRef, removeUndefinedFields({
            email: user.email || null,
            subscriptionStatus: userData?.isPremium ? 'active' : 'beta',
            isPremium: Boolean(userData?.isPremium),
            settings: localDataRef.current.settings,
            tabs: initialTabs,
            updatedAt: Date.now()
          }), { merge: true });
          const now = Date.now();
          setLastSuccessfulWriteTime(now);
          addEvent('INIT_DOC_SUCCESS', `Initial user doc created in Firestore with ${localDataRef.current.tabs.length} tabs`);
        } else {
          addEvent('INIT_DOC_EXISTS', `User doc exists in Firestore`);
        }
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const message = err?.message || String(err);
        setLastWriteError({ code, message, timestamp: Date.now() });
        addEvent('INIT_DOC_ERROR', `Error checking/creating user doc: [${code}] ${message}`, true);
        // Ensure initialization never remains blocked on error
        setIsInitializing(false);
      }
    };

    initializeUserDoc()
      .catch(err => {
        console.warn("[CloudSync] initializeUserDoc caught:", err);
        setIsInitializing(false);
      })
      .then(() => {
        if (isCancelled) return;
        setIsListenerAttached(true);
        addEvent('LISTENER_ATTACH', `Attaching onSnapshot listener to users/...${user.uid.slice(-6)}`);

        unsubscribe = onSnapshot(userRef, (docSnap) => {
          const now = Date.now();
          const meta = docSnap.metadata;
          setLastSnapshotTime(now);
          setLastSnapshotFromCache(meta.fromCache);
          setLastSnapshotPendingWrites(meta.hasPendingWrites);

          // CRITICAL: Ignore snapshots from our own pending writes in the local cache.
          // Overwriting local state with sanitized tabs from our own in-flight writes
          // would strip rich local attributes (audioBase64, full images, achievements).
          if (meta.hasPendingWrites) {
            addEvent('SNAPSHOT_SKIPPED_PENDING', `Ignoring local write acknowledgement (pendingWrites=true)`);
            return;
          }

          if (docSnap.exists()) {
            const data = docSnap.data();
            const cachedPro = typeof window !== 'undefined' && localStorage.getItem(`quest_pro_${user.uid}`) === 'true';
            
            setUserData((prev: any) => {
              const isEffectivePrem = Boolean(data.isPremium || data.subscriptionStatus === 'active' || prev?.isPremium || cachedPro);
              if (isEffectivePrem && typeof window !== 'undefined') {
                localStorage.setItem(`quest_pro_${user.uid}`, 'true');
              }
              return {
                ...prev,
                ...data,
                isPremium: isEffectivePrem,
                proQueriesAvailable: data.proQueriesAvailable ?? prev?.proQueriesAvailable ?? (isEffectivePrem ? 40 : 5),
                flashQueriesAvailable: data.flashQueriesAvailable ?? prev?.flashQueriesAvailable ?? (isEffectivePrem ? 1000 : 5),
                isGuest: false
              };
            });
            
            if (data.isPremium || data.subscriptionStatus === 'active' || cachedPro) {
              setSubscriptionStatus('active');
            } else {
              setSubscriptionStatus(data.subscriptionStatus || 'beta');
            }
            
            const cloudSettings = data.settings || null;
            const cloudTabs: GameTab[] = Array.isArray(data.tabs) ? data.tabs : [];
            const cloudCount = cloudTabs.length;
            setCloudTabsCount(cloudCount);

            const canonicalCloudSettingsStr = cloudSettings ? canonicalStringify(cloudSettings) : '';

            addEvent(
              'SNAPSHOT_RECEIVED',
              `exists=true, fromCache=${meta.fromCache}, pendingWrites=false, cloudTabsCount=${cloudCount}`
            );

            // Sync Settings if remote settings genuinely differ
            if (cloudSettings) {
              const currentLocalSettingsCanonical = canonicalStringify(localDataRef.current.settings);
              if (currentLocalSettingsCanonical !== canonicalCloudSettingsStr) {
                setLocalSettings(cloudSettings);
                lastSyncedData.current.settings = canonicalCloudSettingsStr;
                addEvent('SETTINGS_LOADED_FROM_CLOUD', 'Applied updated settings from cloud');
              }
            }

            // Tabs: merge with this device's tabs (see tabMerge.ts). Only write if the merged result differs from the cloud.
            const outcome = mergeTabState(
              { tabs: localDataRef.current.tabs, deleted: readTombstones() },
              { tabs: cloudTabs, deleted: cleanTombstones(data.deletedTabs) }
            );
            if (outcome.localChanged) {
              setLocalGameTabs(outcome.merged.tabs);
              addEvent('TABS_MERGED_LOCAL', `${outcome.reason}; applied to local state`);
              try {
                const json = JSON.stringify(outcome.merged.tabs);
                localStorage.setItem(`quest_compendium_tabs_${user.uid}`, json);
                localStorage.setItem('quest_compendium_tabs', json);
                localStorage.setItem('quest_compendium_tabs_backup', json);
              } catch {}
            }
            writeTombstones(outcome.merged.deleted);

            // Update trackers so the local debounced sync doesn't loop
            lastSyncedData.current.tabs = canonicalStringify(sanitizeTabsForCloud(outcome.merged.tabs));
            if (canonicalCloudSettingsStr) {
              lastSyncedData.current.settings = canonicalCloudSettingsStr;
            }

            if (outcome.cloudChanged) {
              addEvent('MERGE_UPLOAD_START', `This device has newer data than the cloud. Merging and uploading (${outcome.merged.tabs.length} tabs)...`);
              void pushTabs(user.uid, 'snapshot');
            }

            hasDoneInitialCloudLoad = true;
            setIsInitializing(false); // Enable local->cloud sync writes
          } else {
            setCloudTabsCount(0);
            addEvent('SNAPSHOT_RECEIVED', `exists=false, fromCache=${meta.fromCache}, pendingWrites=false`);
            setIsInitializing(false);
          }
        }, (error) => {
          const code = (error as any)?.code || 'unknown';
          const message = (error as any)?.message || String(error);
          setLastWriteError({ code, message, timestamp: Date.now() });
          addEvent('SNAPSHOT_ERROR', `Snapshot listener error: [${code}] ${message}`, true);
          // Always unblock isInitializing on snapshot error
          setIsInitializing(false);
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

  // Sync Local to Cloud whenever settings or tabs change (with debounce)
  useEffect(() => {
    if (!user || user.isGuest || (subscriptionStatus !== 'active' && subscriptionStatus !== 'beta') || isInitializing) return;

    const currentSettingsCanonical = canonicalStringify(localSettings);
    const currentTabsCanonical = canonicalStringify(sanitizeTabsForCloud(localGameTabs));

    // Prevent loop: only upload what actually changed compared to the last sync
    const settingsChanged = currentSettingsCanonical !== lastSyncedData.current.settings;
    const tabsChanged = currentTabsCanonical !== lastSyncedData.current.tabs;
    if (!settingsChanged && !tabsChanged) return;

    const flushSync = () => {
      if (settingsChanged) {
        lastSyncedData.current = { ...lastSyncedData.current, settings: currentSettingsCanonical };
        setDoc(doc(db, 'users', user.uid), removeUndefinedFields({ settings: localSettings, updatedAt: Date.now() }), { merge: true })
          .then(() => {
            setLastSuccessfulWriteTime(Date.now());
            addEvent('WRITE_SUCCESS', 'Settings synced to cloud');
          })
          .catch(err => {
            const code = (err as any)?.code || 'unknown';
            const message = (err as any)?.message || String(err);
            setLastWriteError({ code, message, timestamp: Date.now() });
            addEvent('WRITE_ERROR', `Settings sync error: [${code}] ${message}`, true);
            lastSyncedData.current = { ...lastSyncedData.current, settings: '' }; // retry on next edit
          });
      }
      if (tabsChanged) {
        void pushTabs(user.uid, 'edit');
      }
    };

    const syncTimeout = setTimeout(flushSync, 1000);

    const handleBeforeUnloadOrFlush = () => {
      clearTimeout(syncTimeout);
      flushSync();
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        clearTimeout(syncTimeout);
        flushSync();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnloadOrFlush);
    window.addEventListener('pagehide', handleBeforeUnloadOrFlush);
    window.addEventListener('quest_flush_sync', handleBeforeUnloadOrFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(syncTimeout);
      window.removeEventListener('beforeunload', handleBeforeUnloadOrFlush);
      window.removeEventListener('pagehide', handleBeforeUnloadOrFlush);
      window.removeEventListener('quest_flush_sync', handleBeforeUnloadOrFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        `Build: v${BUILD_INFO.version} (commit ${BUILD_INFO.commit}), built ${BUILD_INFO.builtAt}`,
        `Firebase project: ${(auth as any)?.app?.options?.projectId ?? 'unknown'}`,
        `API base URL: ${getApiBaseUrl() || '(same origin)'}`,
        `Page origin: ${typeof window !== 'undefined' ? window.location.origin : 'unknown'}`,
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

    const triggerSyncNow = async (): Promise<boolean> => {
      if (!user || user.isGuest) {
        addEvent('MANUAL_SYNC_SKIPPED', 'Cannot sync in guest mode or unauthenticated state');
        return false;
      }
      addEvent('MANUAL_SYNC_START', `Manual sync: merging ${localDataRef.current.tabs.length} local tabs with the cloud (${estimatedUploadSizeKb} KB)...`);
      const tabsOk = await pushTabs(user.uid, 'manual');
      try {
        const currentSettings = localDataRef.current.settings;
        await setDoc(doc(db, 'users', user.uid), removeUndefinedFields({ settings: currentSettings, updatedAt: Date.now() }), { merge: true });
        lastSyncedData.current = { ...lastSyncedData.current, settings: canonicalStringify(currentSettings) };
        return tabsOk;
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const message = err?.message || String(err);
        setLastWriteError({ code, message, timestamp: Date.now() });
        addEvent('WRITE_ERROR', `Manual settings sync failed: [${code}] ${message}`, true);
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
      getSummaryText,
      triggerSyncNow,
      addEvent
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
    eventLogs,
    addEvent
  ]);

  // Listen for custom diagnostics events from application features (e.g. chat auth errors)
  useEffect(() => {
    const handleLogEvent = (e: any) => {
      if (e?.detail?.type && e?.detail?.details) {
        addEvent(e.detail.type, e.detail.details, Boolean(e.detail.isError));
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('quest_diagnostics_event', handleLogEvent);
      return () => window.removeEventListener('quest_diagnostics_event', handleLogEvent);
    }
  }, [addEvent]);

  // Expose to window.__questSyncDiagnostics for quick devtools console inspection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__questSyncDiagnostics = syncDiagnostics;
    }
  }, [syncDiagnostics]);

  return { user: effectiveUser, subscriptionStatus, userData, isInitializing, isOutdated, syncDiagnostics };
}
