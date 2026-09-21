import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { AppSettings, GameTab, CloudSyncDiagnostics, SyncEventLog } from '../types';
import { getApiBaseUrl } from '../utils/api';

const APP_VERSION = 1;

/**
 * Deterministic JSON stringifier with sorted object keys to ensure stable
 * serialization regardless of property insertion order in local state vs Firestore.
 */
export function canonicalStringify(obj: any): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalStringify(obj[key])).join(',') + '}';
}

export interface TabMergeResult {
  merged: GameTab[];
  hasChangesFromCloud: boolean;
  hasChangesFromLocal: boolean;
  reason: string;
}

export function isLegacyWelcomeTab(tab: GameTab): boolean {
  if (!tab) return false;
  return tab.id === 'guest-welcome-compendium' || tab.name === 'Welcome, Explorer';
}

/**
 * Merges local and cloud tabs without destroying local-only tabs.
 * - Unions tabs by ID.
 * - Filters out legacy Welcome Explorer tabs completely.
 * - Respects locally deleted tabs and purges them from cloud state.
 * - When same ID exists on both sides, keeps the one with the larger lastActive timestamp.
 * - Preserves rich local attributes (such as audioBase64 or local images/achievements) so sanitization does not degrade local state.
 * - Never discards local-only tabs.
 */
export function mergeGameTabs(localTabs: GameTab[], cloudTabs: GameTab[]): TabMergeResult {
  let deletedIds = new Set<string>();
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('quest_deleted_tab_ids') : null;
    if (raw) {
      deletedIds = new Set(JSON.parse(raw));
    }
  } catch {}

  const rawLocal = Array.isArray(localTabs) ? localTabs : [];
  const rawCloud = Array.isArray(cloudTabs) ? cloudTabs : [];

  const cleanLocal = rawLocal.filter(t => t && !isLegacyWelcomeTab(t) && !deletedIds.has(t.id));
  const cleanCloud = rawCloud.filter(t => t && !isLegacyWelcomeTab(t) && !deletedIds.has(t.id));

  const localHadUnwanted = cleanLocal.length !== rawLocal.length;
  const cloudHadUnwanted = cleanCloud.length !== rawCloud.length;

  if (cleanLocal.length === 0 && cleanCloud.length === 0) {
    return {
      merged: [],
      hasChangesFromCloud: localHadUnwanted,
      hasChangesFromLocal: cloudHadUnwanted,
      reason: 'Zero active tabs'
    };
  }

  if (cleanLocal.length === 0) {
    return {
      merged: cleanCloud,
      hasChangesFromCloud: true,
      hasChangesFromLocal: cloudHadUnwanted,
      reason: `Adopted ${cleanCloud.length} cloud tabs into empty local state`
    };
  }

  if (cleanCloud.length === 0) {
    return {
      merged: cleanLocal,
      hasChangesFromCloud: localHadUnwanted,
      hasChangesFromLocal: true,
      reason: `Preserved ${cleanLocal.length} local tabs for empty cloud document`
    };
  }

  const cloudTabMap = new Map<string, GameTab>();
  for (const t of cleanCloud) {
    if (t && t.id) {
      cloudTabMap.set(t.id, t);
    }
  }

  const mergedTabs: GameTab[] = [];
  const processedIds = new Set<string>();
  let hasChangesFromCloud = localHadUnwanted;
  let hasChangesFromLocal = cloudHadUnwanted;

  // Process all local tabs to preserve existing local tab order
  for (const localTab of cleanLocal) {
    if (!localTab || !localTab.id) continue;
    processedIds.add(localTab.id);

    const cloudTab = cloudTabMap.get(localTab.id);
    if (!cloudTab) {
      // Local-only tab! Keep it and mark for cloud upload
      mergedTabs.push(localTab);
      hasChangesFromLocal = true;
    } else {
      // Tab exists on both sides: compare activity timestamps
      const localTime = localTab.lastActive || localTab.createdAt || 0;
      const cloudTime = cloudTab.lastActive || cloudTab.createdAt || 0;

      if (localTime >= cloudTime) {
        // Local is newer or identical. Keep localTab!
        mergedTabs.push(localTab);
        if (localTime > cloudTime) {
          hasChangesFromLocal = true;
        }
      } else {
        // Cloud is newer. Use cloudTab, but preserve local-only enrichments
        // (e.g. audioBase64, local image URLs, achievements caches)
        const enrichedFromLocal: GameTab = { ...cloudTab };

        if (localTab.messages && enrichedFromLocal.messages) {
          const localMsgMap = new Map(localTab.messages.map(m => [m.id, m]));
          enrichedFromLocal.messages = enrichedFromLocal.messages.map(cloudMsg => {
            const localMsg = localMsgMap.get(cloudMsg.id);
            if (!localMsg) return cloudMsg;
            return {
              ...cloudMsg,
              audioBase64: localMsg.audioBase64 || (cloudMsg as any).audioBase64,
              imageUrl: (cloudMsg.imageUrl && cloudMsg.imageUrl.length > 0) ? cloudMsg.imageUrl : localMsg.imageUrl,
              bannerImageUrl: (cloudMsg.bannerImageUrl && cloudMsg.bannerImageUrl.length > 0) ? cloudMsg.bannerImageUrl : localMsg.bannerImageUrl,
            };
          });
        }

        if (localTab.activeSteamGame && enrichedFromLocal.activeSteamGame) {
          if (localTab.activeSteamGame.appId === enrichedFromLocal.activeSteamGame.appId) {
            enrichedFromLocal.activeSteamGame = {
              ...enrichedFromLocal.activeSteamGame,
              achievements: localTab.activeSteamGame.achievements || enrichedFromLocal.activeSteamGame.achievements,
              patchNotes: localTab.activeSteamGame.patchNotes || enrichedFromLocal.activeSteamGame.patchNotes
            };
          }
        }

        mergedTabs.push(enrichedFromLocal);
        hasChangesFromCloud = true;
      }
    }
  }

  // Add any tabs that exist only in cloud
  for (const cloudTab of cleanCloud) {
    if (!cloudTab || !cloudTab.id) continue;
    if (!processedIds.has(cloudTab.id)) {
      mergedTabs.push(cloudTab);
      hasChangesFromCloud = true;
    }
  }

  return {
    merged: mergedTabs,
    hasChangesFromCloud,
    hasChangesFromLocal,
    reason: `Merged ${cleanLocal.length} local and ${cleanCloud.length} cloud tabs (total: ${mergedTabs.length})`
  };
}

function sanitizeTabsForCloud(tabs: GameTab[]): GameTab[] {
  let deletedIds = new Set<string>();
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('quest_deleted_tab_ids') : null;
    if (raw) {
      deletedIds = new Set(JSON.parse(raw));
    }
  } catch {}

  return tabs
    .filter(tab => tab && !isLegacyWelcomeTab(tab) && !deletedIds.has(tab.id))
    .map(tab => {
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
          const initialTabs = sanitizeTabsForCloud(localDataRef.current.tabs);
          const initialSettingsCanonical = canonicalStringify(localDataRef.current.settings);
          const initialTabsCanonical = canonicalStringify(initialTabs);
          
          lastSyncedData.current = { settings: initialSettingsCanonical, tabs: initialTabsCanonical };
          addEvent('INIT_DOC_CREATING', `Doc does not exist. Creating with ${localDataRef.current.tabs.length} local tabs (${estimatedUploadSizeKb} KB)...`);

          await setDoc(userRef, {
            email: user.email || null,
            subscriptionStatus: 'beta',
            settings: localDataRef.current.settings,
            tabs: initialTabs,
            updatedAt: Date.now()
          });
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
            setUserData(data);
            
            // Default to 'beta' if subscriptionStatus is unset so writes are permitted
            setSubscriptionStatus(data.subscriptionStatus || 'beta');
            
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

            // Continuous bidirectional tabs synchronization using MERGE:
            // Never discard local-only tabs; union by ID, keep newer lastActive, and preserve rich local fields
            const currentLocalTabs = localDataRef.current.tabs;
            const mergeResult = mergeGameTabs(currentLocalTabs, cloudTabs);

            if (mergeResult.hasChangesFromCloud) {
              setLocalGameTabs(mergeResult.merged);
              addEvent('TABS_MERGED_LOCAL', `${mergeResult.reason}; applied to local state`);
              try {
                const json = JSON.stringify(mergeResult.merged);
                localStorage.setItem(`quest_compendium_tabs_${user.uid}`, json);
                localStorage.setItem('quest_compendium_tabs', json);
                localStorage.setItem('quest_compendium_tabs_backup', json);
              } catch {}
            }

            // Update tracker so local debounced sync doesn't loop
            const sanitizedMerged = sanitizeTabsForCloud(mergeResult.merged);
            const canonicalMergedTabsStr = canonicalStringify(sanitizedMerged);
            lastSyncedData.current.tabs = canonicalMergedTabsStr;
            if (canonicalCloudSettingsStr) {
              lastSyncedData.current.settings = canonicalCloudSettingsStr;
            }

            // If local state had tabs or edits that cloud didn't have, push the merged set to cloud
            if (mergeResult.hasChangesFromLocal) {
              addEvent('MERGE_UPLOAD_START', `Local tabs contain newer/exclusive data. Uploading merged set (${mergeResult.merged.length} tabs)...`);
              setDoc(userRef, {
                tabs: sanitizedMerged,
                updatedAt: Date.now()
              }, { merge: true })
                .then(() => {
                  const writeNow = Date.now();
                  setLastSuccessfulWriteTime(writeNow);
                  addEvent('WRITE_SUCCESS', `Merged tabs successfully saved to cloud (${mergeResult.merged.length} tabs)`);
                })
                .catch(err => {
                  const code = (err as any)?.code || 'unknown';
                  const message = (err as any)?.message || String(err);
                  setLastWriteError({ code, message, timestamp: Date.now() });
                  addEvent('WRITE_ERROR', `Failed to upload merged tabs: [${code}] ${message}`, true);
                  console.error("[CloudSync] Failed to upload merged tabs", err);
                });
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
    const sanitizedTabs = sanitizeTabsForCloud(localGameTabs);
    const currentTabsCanonical = canonicalStringify(sanitizedTabs);

    // Prevent loop: Only upload if the canonical local data has actually changed compared to the last sync
    if (currentSettingsCanonical === lastSyncedData.current.settings && 
        currentTabsCanonical === lastSyncedData.current.tabs) {
      return;
    }

    const flushSync = () => {
      lastSyncedData.current = { settings: currentSettingsCanonical, tabs: currentTabsCanonical };
      const userRef = doc(db, 'users', user.uid);
      addEvent('WRITE_START', `Sync write starting: ${localGameTabs.length} tabs (${estimatedUploadSizeKb} KB)...`);
      setDoc(userRef, {
        settings: localSettings,
        tabs: sanitizedTabs,
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
          console.error("[CloudSync] Sync error", err);
          // Reset lastSyncedData on failure so retry happens on next edit
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

    const triggerSyncNow = async (): Promise<boolean> => {
      if (!user || user.isGuest) {
        addEvent('MANUAL_SYNC_SKIPPED', 'Cannot sync in guest mode or unauthenticated state');
        return false;
      }
      try {
        const userRef = doc(db, 'users', user.uid);
        const currentTabs = localDataRef.current.tabs;
        const currentSettings = localDataRef.current.settings;
        const sanitizedTabs = sanitizeTabsForCloud(currentTabs);
        const currentSettingsCanonical = canonicalStringify(currentSettings);
        const currentTabsCanonical = canonicalStringify(sanitizedTabs);

        addEvent('MANUAL_SYNC_START', `Manual push triggered: ${currentTabs.length} tabs (${estimatedUploadSizeKb} KB)...`);
        await setDoc(userRef, {
          settings: currentSettings,
          tabs: sanitizedTabs,
          updatedAt: Date.now()
        }, { merge: true });

        lastSyncedData.current = {
          settings: currentSettingsCanonical,
          tabs: currentTabsCanonical
        };
        const now = Date.now();
        setLastSuccessfulWriteTime(now);
        setLastWriteError(null);
        addEvent('WRITE_SUCCESS', `Manual sync succeeded (${currentTabs.length} tabs)`);
        return true;
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const message = err?.message || String(err);
        setLastWriteError({ code, message, timestamp: Date.now() });
        addEvent('WRITE_ERROR', `Manual sync failed: [${code}] ${message}`, true);
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
      triggerSyncNow
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
