import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { balancesOf, deviceTimeZone, topUpLine, untilReset } from './utils/answerModel';
import { BookOpen, Plus, Sparkles, Gamepad2, Search, Camera, Mic, Moon, FileText, Globe } from './components/icons';
import { 
  GameTab, 
  SteamGameData, 
  AppSettings, 
  ChatMessage, 
  ScreenPoint,
  ColorTheme,
  DockPosition
} from './types';
import { POPULAR_STEAM_GAMES } from './data/mockGames';
import { HeaderBar } from './components/HeaderBar';
import { ChatArea } from './components/ChatArea';
import { AchievementsDrawer } from './components/AchievementsDrawer';
const PlaythroughNotepad = React.lazy(() => import('./components/PlaythroughNotepad').then(module => ({ default: module.PlaythroughNotepad })));
const PersonalQuestsModal = React.lazy(() => import('./components/PersonalQuestsModal').then(module => ({ default: module.PersonalQuestsModal })));
const GameGuidesBrowser = React.lazy(() => import('./components/GameGuidesBrowser').then(module => ({ default: module.GameGuidesBrowser })));
const EmailSignInPage = React.lazy(() => import('./components/EmailSignInPage').then(module => ({ default: module.EmailSignInPage })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then(module => ({ default: module.SettingsModal })));
const QuickGameSearchModal = React.lazy(() => import('./components/QuickGameSearchModal').then(module => ({ default: module.QuickGameSearchModal })));
const GameScreenModal = React.lazy(() => import('./components/GameScreenModal').then(module => ({ default: module.GameScreenModal })));
const AuthModal = React.lazy(() => import('./components/AuthModal').then(module => ({ default: module.AuthModal })));
const PaywallModal = React.lazy(() => import('./components/PaywallModal').then(module => ({ default: module.PaywallModal })));
const RenameModal = React.lazy(() => import('./components/RenameModal').then(module => ({ default: module.RenameModal })));
const UpdateRequiredModal = React.lazy(() => import('./components/UpdateRequiredModal').then(module => ({ default: module.UpdateRequiredModal })));
const BetaFeedbackModal = React.lazy(() => import('./components/BetaFeedbackModal').then(module => ({ default: module.BetaFeedbackModal })));
import { db } from './lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { getApiBaseUrl, DEFAULT_CLOUD_URL } from './utils/api';
import { playBlipSound } from './utils/audio';
import { samePlace, placeAfterMove, singleArea } from './utils/placeName';
import { addDone, doneForRequest, areaMovedPast, endedFight, type DoneKind } from './utils/progressMemory';
import { watchPlan, stopWatchingPlan } from './utils/billing';
import { useCloudSync } from './hooks/useCloudSync';
import { recordTombstone } from './hooks/tabMerge';
import pixelSceneUrl from './pixel-scene.png';
import { LOCALES, aiLanguageName, applyLocale, detectLocale, translate, useLocale, useT } from './i18n';
import { ControllerLayer } from './components/ControllerLayer';
import { markersActiveFor, activeMarkersId, rememberAreaFind, setPointersActive } from './components/pointerStore';
import { buildTrackerPayload, trackedMessage, trackerGameKey, trackerLabels, type TrackerData } from './utils/trackerPayload';
import { useTrackerGuide } from './utils/trackerGuide';
import { useGuidePictures, withPictures } from './utils/guidePictures';
import { useGuideSteps } from './utils/guideSteps';
import { AppUpdates } from './components/AppUpdates';
import { showFirstRunHints } from './utils/sessions';
import { formatShortcut } from './utils/shortcut';
import { setEntryDone, readDone, exportAllDone, importAllDone, GUIDE_DONE_EVENT } from './utils/guideProgress';
import { SPOT_EVENT, type SpotRequest } from './utils/spotIt';
import {
  addEntries, editEntry, removeEntry, clearPlaythrough, mergePlaythrough, playthroughForRequest, readLocal, writeLocal,
  emptyPlaythrough, OPEN_PLAYTHROUGH_EVENT, type Playthrough, type PlayKind,
} from './utils/playthrough';
import { readCloud, writeCloud } from './utils/playthroughCloud';
import { PlaythroughPanel } from './components/PlaythroughPanel';
import { appSource, isPhone } from './utils/source';
import { useGameArt } from './utils/gameArt';
import { sharpIgdb, steamHeader, useArt } from './utils/artCache';
import { closeAppAfterSync } from './utils/closeApp';
import { deviceId } from './utils/deviceId';
import { tabForGame } from './utils/runningGame';
import { DetectionLine, type Detection } from './components/DetectionLine';
import { gameSpacesOn, learn, resolveProgram, type ProgramGame } from './utils/learnedGames';
import { applyTabs, assignGame, emptySpaces, importPlan, newPlaythrough, playthroughsOf, readSpaces, renamePlaythrough, splitMerged, switchPlaythrough, toTabs, writeSpaces, type SpacesState } from './utils/spacesStore';
import { loadCloudSpaces, mergeSpaces, saveCloudSpaces } from './utils/spacesCloud';
import { planMigration, type CatalogGame } from './utils/gameSpaces';
import { resolveTabWithServer } from './utils/spacesResolve';
import { fetchGuideIndex } from './utils/guideIndex';
import { setTickScope } from './utils/guideProgress';
import { readTombstones } from './hooks/tabMerge';
import { MigrationNotice, WhichGamePrompt } from './components/SpacesNotice';
import { GameLine } from './components/GameLine';
import { QuestLog } from './components/QuestLog';
import { buildLogView, objectiveForRequest, nextLogState, answerTitle, type LogView } from './utils/questLogView';

/**
 * The running game's picture, sharp at any screen scale (utils/artCache.ts): IGDB's key art at 720p when its guide has
 * it, else Steam's header; hidden if neither loads.
 */
function RunningGameArt({ appId, name }: { appId: number; name?: string }) {
  const ig = useGameArt(appId, name);
  const src = useArt([ig.art && sharpIgdb(ig.art, 'wide'), steamHeader(appId)]);
  if (src === null) return null;
  return src ? (
    <img src={src} alt="" decoding="async" className="w-16 h-10 object-cover rounded-lg border border-white/10 flex-shrink-0" />
  ) : (
    <span className="w-16 h-10 rounded-lg border border-white/10 bg-white/5 flex-shrink-0" />
  );
}

const DEFAULT_SETTINGS: AppSettings = {
  aiMode: 'standard',
  theme: 'purple',
  chatFont: 'segoe',
  chatFontSize: 15,
  tabFontSize: 20,
  soundEnabled: true,
  dockPosition: 'top-right',
  windowOpacity: 96,
  steamId: '',
  ttsVoice: 'device', // the device's built-in voice (free); Gemini voices are an option
  customApiKey: '',
  hideAppShortcut: 'CmdOrCtrl+Space',
  voiceInputShortcut: 'CmdOrCtrl+Shift+V',
  autoScreenshotShortcut: 'CmdOrCtrl+Shift+S',
  trackerTickShortcut: 'CmdOrCtrl+Shift+Enter',
  trackerNextShortcut: 'CmdOrCtrl+Shift+Down',
  questLogShortcut: 'CmdOrCtrl+Shift+L',
  enableThematicBanners: false,
  uiStyle: 'lofi',
  language: detectLocale(),
  controllerEnabled: true,
  controllerToggle: 'back+start',
  snapshotOnOpen: true,
  showPointersOnScreen: true,
  stickyPointers: true,
  markersInRecordings: true,
  markerLifetime: 120,
};

const THEME_STYLES: Record<ColorTheme, { color: string; dim: string; border: string; glow: string }> = {
  purple: { color: '#a87ffb', dim: 'rgba(168, 127, 251, 0.15)', border: 'rgba(168, 127, 251, 0.3)', glow: 'rgba(168, 127, 251, 0.4)' },
  red: { color: '#E52521', dim: 'rgba(229, 37, 33, 0.15)', border: 'rgba(229, 37, 33, 0.3)', glow: 'rgba(229, 37, 33, 0.4)' },
  cyan: { color: '#00f0ff', dim: 'rgba(0, 240, 255, 0.15)', border: 'rgba(0, 240, 255, 0.3)', glow: 'rgba(0, 240, 255, 0.4)' },
  blue: { color: '#1E63F8', dim: 'rgba(30, 99, 248, 0.15)', border: 'rgba(30, 99, 248, 0.3)', glow: 'rgba(30, 99, 248, 0.4)' },
  amber: { color: '#ffb84d', dim: 'rgba(255, 184, 77, 0.15)', border: 'rgba(255, 184, 77, 0.3)', glow: 'rgba(255, 184, 77, 0.4)' },
  luigi: { color: '#55D731', dim: 'rgba(85, 215, 49, 0.15)', border: 'rgba(85, 215, 49, 0.3)', glow: 'rgba(85, 215, 49, 0.4)' },
  masterchief: { color: '#6A7D51', dim: 'rgba(106, 125, 81, 0.15)', border: 'rgba(106, 125, 81, 0.3)', glow: 'rgba(106, 125, 81, 0.4)' },
  gold: { color: '#ffd700', dim: 'rgba(255, 215, 0, 0.15)', border: 'rgba(255, 215, 0, 0.3)', glow: 'rgba(255, 215, 0, 0.4)' },
  pink: { color: '#ff69b4', dim: 'rgba(255, 105, 180, 0.15)', border: 'rgba(255, 105, 180, 0.3)', glow: 'rgba(255, 105, 180, 0.4)' },
  silver: { color: '#c0c0c0', dim: 'rgba(192, 192, 192, 0.15)', border: 'rgba(192, 192, 192, 0.3)', glow: 'rgba(192, 192, 192, 0.4)' },
};


/** "CmdOrCtrl+Shift+S" -> "Ctrl + Shift + S" (shown as Cmd on a Mac), for sentences (utils/shortcut). */
const prettyShortcut = (accel?: string): string => formatShortcut(accel, { spaced: true });
/** The panel's "Mouse unlocked" toast shows the first this-many times the shortcut opens it. */
const MOUSE_TOAST_TIMES = 10;

/** Apply the interface style: <html data-ui> switches the Lo-fi pixel layer in index.css on or off. */
function applyUiStyle(style: AppSettings['uiStyle'], accentHex: string) {
  const html = document.documentElement;
  html.dataset.ui = style === 'classic' ? 'classic' : 'lofi';
  const hex = accentHex.replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
  if (!Number.isNaN(n)) {
    const dark = (v: number) => Math.round(v * 0.45);
    html.style.setProperty('--accent-dark', `rgb(${dark((n >> 16) & 255)}, ${dark((n >> 8) & 255)}, ${dark(n & 255)})`);
  }
}

const DesktopLogin = React.lazy(() => import('./components/DesktopLogin').then(module => ({ default: module.DesktopLogin })));

function SettingsStandalone() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_settings');
      let parsed = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
      const validVoices = ['device', 'puck', 'charon', 'fenrir', 'kore', 'aoede'];
      if (!validVoices.includes(parsed.ttsVoice)) {
        parsed = { ...parsed, ttsVoice: 'device' };
        localStorage.setItem('quest_compendium_settings', JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const updateSettings = (updated: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updated };
    setSettings(newSettings);
    localStorage.setItem('quest_compendium_settings', JSON.stringify(newSettings));
  };

  const closeWindow = () => {
    if ((window as any).electronAPI?.closeSettingsWindow) {
      (window as any).electronAPI.closeSettingsWindow();
    } else {
      window.close();
    }
  };

  useEffect(() => {
    // If running from file:// (Electron packaged), add transparent background
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      document.body.classList.remove('bg-[#0c0d14]');
      document.body.classList.add('bg-transparent');
    }
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quest_compendium_settings' && e.newValue) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) });
      }
    };
    window.addEventListener('storage', handleStorage);
    
    if ((window as any).electronAPI && (window as any).electronAPI.onDesktopSteamSuccess) {
      (window as any).electronAPI.onDesktopSteamSuccess((steamId: string) => {
        if (steamId) {
          updateSettings({ steamId });
        }
      });
    }

    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const t = THEME_STYLES[settings.theme] || THEME_STYLES.purple;
    document.documentElement.style.setProperty('--accent-color', t.color);
    document.documentElement.style.setProperty('--accent-dim', t.dim);
    document.documentElement.style.setProperty('--accent-border', t.border);
    document.documentElement.style.setProperty('--accent-glow', t.glow);
    applyUiStyle(settings.uiStyle, t.color);
    applyLocale(settings.language);
  }, [settings.uiStyle, settings.theme, settings.language]);

  return (
    <div className="w-screen h-screen bg-[#0c0d14] text-zinc-100 overflow-auto">
      <SettingsModal 
        isOpen={true} 
        onClose={closeWindow}
        settings={settings}
        onUpdateSettings={updateSettings}
        soundEnabled={settings.soundEnabled}
        syncDiagnostics={typeof window !== 'undefined' ? (window as any).__questSyncDiagnostics : undefined}
      />
    </div>
  );
}

export default function App() {
  const tr = useT();
  if (window.location.hash === '#settings') {
    return <Suspense fallback={<div className="w-screen h-screen bg-[#0c0d14]" />}><SettingsStandalone /></Suspense>;
  }

  // The email's sign-in link (components/EmailSignInPage.tsx).
  if (window.location.pathname === '/email-signin') {
    return <Suspense fallback={<div className="w-screen h-screen bg-[#0c0d14]" />}><EmailSignInPage /></Suspense>;
  }

  if (window.location.pathname === '/desktop-login') {
    return <Suspense fallback={<div className="w-screen h-screen bg-[#0c0d14]" />}><DesktopLogin /></Suspense>;
  }

  // --- Persistent State ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_settings');
      let parsed = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
      const validVoices = ['device', 'puck', 'charon', 'fenrir', 'kore', 'aoede'];
      if (!validVoices.includes(parsed.ttsVoice)) {
        parsed = { ...parsed, ttsVoice: 'device' };
        localStorage.setItem('quest_compendium_settings', JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [legacyTabs, setLegacyTabs] = useState<GameTab[]>(() => {
    try {
      const isGuest = typeof window !== 'undefined' && Boolean(localStorage.getItem('quest_guest_session'));
      if (isGuest) {
        const guestSaved = localStorage.getItem('quest_guest_tabs');
        if (guestSaved) {
          const parsed = JSON.parse(guestSaved);
          if (Array.isArray(parsed)) {
            return parsed.filter(t => t && t.id !== 'guest-welcome-compendium' && t.name !== 'Welcome, Explorer');
          }
        }
        return [];
      }
      const saved = localStorage.getItem('quest_compendium_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(t => t && t.id !== 'guest-welcome-compendium' && t.name !== 'Welcome, Explorer');
        }
      }

      // Also check user-specific keys if saved was empty
      if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('quest_compendium_tabs_')) {
            const val = localStorage.getItem(key);
            if (val) {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) {
                return parsed.filter(t => t && t.id !== 'guest-welcome-compendium' && t.name !== 'Welcome, Explorer');
              }
            }
          }
        }
      }
    } catch {}
    return [];
  });

  // One space per game (games-not-tabs, behind the qc-game-spaces flag; utils/spacesStore.ts): with the flag on, the
  // app's tabs are the player's games, each showing its current playthrough, and what the app changes goes back to the
  // game or the playthrough. The compendium tabs above stay as they were (the migration's backup, synced as before).
  // spaces is null until this device's are ready (the compendium tabs show meanwhile).
  const spacesOn = useMemo(() => gameSpacesOn(), []);
  const [spaces, setSpaces] = useState<SpacesState | null>(null);
  const spacesRef = useRef<SpacesState | null>(null);
  spacesRef.current = spaces;
  const unknownName = tr('spaces.whichGame');
  const spaceTabs = useMemo(() => (spaces ? toTabs(spaces, unknownName) : null), [spaces, unknownName]);
  const tabs: GameTab[] = spacesOn && spaceTabs ? spaceTabs : legacyTabs;
  const setTabs: React.Dispatch<React.SetStateAction<GameTab[]>> = useCallback((u: React.SetStateAction<GameTab[]>) => {
    if (spacesOn && spacesRef.current) setSpaces((cur) => (cur ? applyTabs(cur, typeof u === 'function' ? u(toTabs(cur, unknownName)) : u) : cur));
    else setLegacyTabs(u);
  }, [spacesOn, unknownName]);

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || '';
  });

  // Ensure activeTabId always resolves to a valid tab when tabs exist, or resets when tabs is empty
  useEffect(() => {
    if (tabs.length > 0) {
      if (!tabs.some(t => t.id === activeTabId)) {
        // A game the app added that already had a space: show that space (spacesStore applyTabs alias).
        const alias = spaces?.alias?.[activeTabId];
        setActiveTabId(alias && tabs.some((t) => t.id === alias) ? alias : tabs[0].id);
      }
    } else if (activeTabId !== '') {
      setActiveTabId('');
    }
  }, [tabs, activeTabId]);

  // --- UI Drawer & Modal States ---
  const [isAchDrawerOpen, setIsAchDrawerOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isQuestsOpen, setIsQuestsOpen] = useState(false);
  const [isBrowserMode, setIsBrowserMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGameSearchOpen, setIsGameSearchOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | null>(null);
  /** Sign-in from inside the app (a guest's header button, the sign-in card, Premium for a guest). */
  const openSignIn = () => {
    setIsPaywallOpen(false);
    setAuthModalMessage(null);
    setIsAuthModalOpen(true);
  };
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameModalMode, setRenameModalMode] = useState<'create' | 'rename'>('create');
  const [renameModalTabId, setRenameModalTabId] = useState<string | null>(null);
  const [renameModalInitialValue, setRenameModalInitialValue] = useState('');
  // The compact view (desktop). The player's choice is remembered per game (qc_view_by_game); a game with no choice
  // yet opens compact while it is running. viewNow is this session's view (an answer opening the full view, or a
  // choice made with no game running), cleared when the running game changes.
  const [viewByGame, setViewByGame] = useState<Record<string, 'compact' | 'full'>>(() => {
    try {
      return JSON.parse(localStorage.getItem('qc_view_by_game') || '{}') || {};
    } catch {
      return {};
    }
  });
  const [viewNow, setViewNow] = useState<'compact' | 'full' | null>(null);
  const [examinedImageUrl, setExaminedImageUrl] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [steamGame, setGlobalActiveGame] = useState<SteamGameData | null>(null);
  // Detection beyond Steam (games-not-tabs, behind the qc-game-spaces flag; utils/learnedGames.ts): a launcher's game,
  // an emulator's or a program the player named is the running game while Steam runs nothing. Unknown ones are asked
  // about once (the detection line) and remembered; until then the game last picked stays open.
  const [programGame, setProgramGame] = useState<ProgramGame | null>(null);
  const programVerdict = useMemo(() => resolveProgram(spacesOn ? programGame : null, settings.learnedPrograms), [spacesOn, programGame, settings.learnedPrograms]);
  const globalActiveGame: SteamGameData | null = steamGame || (programVerdict.state === 'game' ? programVerdict.game : null);

  // --- Resizing States ---
  const [achDrawerWidth, setAchDrawerWidth] = useState(384);
  const [isDraggingAch, setIsDraggingAch] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { startX, startWidth } = dragStartRef.current;
      
      if (isDraggingAch) {
        const delta = startX - e.clientX;
        setAchDrawerWidth(Math.max(250, Math.min(800, startWidth + delta)));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingAch(false);
      dragStartRef.current = null;
    };

    if (isDraggingAch) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingAch]);

  const { user, subscriptionStatus, userData, isInitializing, isOutdated, syncDiagnostics } = useCloudSync(settings, legacyTabs, setSettings, setLegacyTabs);

  // Switch and isolate tabs when user transitions between Guest and Authenticated User
  const lastUserIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (isInitializing) return;
    const currentIdentity = user ? (user.isGuest ? 'guest' : user.uid) : 'unauthed';
    if (lastUserIdentityRef.current !== currentIdentity) {
      if (user?.isGuest) {
        // Switching to guest session - isolate completely from Google account tabs
        try {
          const saved = localStorage.getItem('quest_guest_tabs');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              const cleaned = parsed.filter(t => t && t.id !== 'guest-welcome-compendium' && t.name !== 'Welcome, Explorer');
              setLegacyTabs(cleaned);
              setActiveTabId(cleaned[0]?.id || '');
              lastUserIdentityRef.current = currentIdentity;
              return;
            }
          }
        } catch {}
        setLegacyTabs([]);
        setActiveTabId('');
      } else if (user && !user.isGuest) {
        // Switching to Google account: restore user-specific tabs if local is empty/default
        try {
          const userKey = `quest_compendium_tabs_${user.uid}`;
          const saved = localStorage.getItem(userKey) || localStorage.getItem('quest_compendium_tabs');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              const cleaned = parsed.filter(t => t && t.id !== 'guest-welcome-compendium' && t.name !== 'Welcome, Explorer');
              setLegacyTabs(cleaned);
              setActiveTabId(cleaned[0]?.id || '');
            }
          }
        } catch {}
      }
    }
    lastUserIdentityRef.current = currentIdentity;
  }, [user, isInitializing]);

  // Subscription Success Handling
  useEffect(() => {
    if (user && !isInitializing) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('upgrade') === 'success') {
        // Premium is granted by the server after it verifies the payment with Stripe (the app can't set it).
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (urlParams.get('downgrade') === 'true') {
        // Subscription changes are applied by the server from Stripe.
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [user, isInitializing]);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;

  // ---- Game spaces (flag on): this device's, merged with the account's, then the compendium tabs migrated in (safe on
  // every start: only what's missing is added, nothing is removed, the tabs stay as they were). A failed check or no
  // connection leaves the compendiums showing; it's tried again on the next start. ----
  const spacesOwner = user && !user.isGuest ? user.uid : 'guest';
  const [spacesCatalog, setSpacesCatalog] = useState<CatalogGame[]>([]);
  useEffect(() => {
    if (!spacesOn || isInitializing) return;
    let live = true;
    setSpaces(null);
    (async () => {
      let s = readSpaces(spacesOwner) || emptySpaces();
      if (user && !user.isGuest) {
        try {
          s = mergeSpaces(s, await loadCloudSpaces(user.uid));
        } catch (e: any) {
          console.warn('[spaces] the account copy could not be read:', e?.message);
        }
      }
      const catalog = (await fetchGuideIndex().catch(() => [])).map((g) => ({ id: g.key, name: g.game }));
      if (live) setSpacesCatalog(catalog);
      try {
        const plan = await planMigration(legacyTabs, readTombstones(), resolveTabWithServer, catalog, s.tabMap);
        if (plan.ok) s = importPlan(s, plan);
        else console.warn('[spaces] the migration check failed; the compendiums stay:', plan.problems.join('; '));
        if (!plan.ok && !s.games.length) return;
      } catch (e: any) {
        console.warn('[spaces] the migration waits for a connection:', e?.message);
        if (!s.games.length) return;
      }
      if (live) setSpaces(s);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacesOn, isInitializing, spacesOwner]);
  // Saved on this computer at once, and on the account a few seconds after the last change (only what changed).
  const spacesSaved = useRef(new Map<string, string>());
  useEffect(() => { spacesSaved.current = new Map(); }, [spacesOwner]);
  useEffect(() => {
    if (!spaces) return;
    writeSpaces(spacesOwner, spaces);
    if (!user || user.isGuest) return;
    const uid = user.uid;
    const t = setTimeout(() => {
      saveCloudSpaces(uid, spaces, spacesSaved.current).catch((e) => console.warn('[spaces] not saved to the account:', e?.message));
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);
  // A later playthrough has its own guide ticks (utils/guideProgress.ts); the first keeps the guide's.
  const ptId = spacesOn ? activeTab?.playthrough?.id : undefined;
  useEffect(() => setTickScope(ptId && ptId !== 'pt1' ? `~${ptId}` : ''), [ptId]);
  const playthroughMenu = spacesOn && spaces && activeTab
    ? {
        current: activeTab.playthrough?.id || 'pt1',
        list: playthroughsOf(spaces, activeTab.id).map((p) => ({ id: p.id, name: p.name })),
        onNew: () => setSpaces((cur) => (cur ? newPlaythrough(cur, activeTab.id) : cur)),
        onSwitch: (id: string) => setSpaces((cur) => (cur ? switchPlaythrough(cur, activeTab.id, id) : cur)),
        onRename: (id: string, name: string) => setSpaces((cur) => (cur ? renamePlaythrough(cur, activeTab.id, id, name) : cur)),
      }
    : undefined;
  
  // The running game's compendium, and whether it's the open one. Questions are about the open compendium's game;
  // the running game's live data (achievements, news, "running now") joins in only on its own compendium.
  const runningTab = tabForGame(tabs, globalActiveGame);
  const runningOpen = !!runningTab && runningTab.id === activeTab?.id;
  let activeGame = activeTab?.activeSteamGame?.isAutoDetected ? null : activeTab?.activeSteamGame || null;
  if (globalActiveGame && runningOpen) {
    const autoHeaderImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${globalActiveGame.appId}/header.jpg`;
    activeGame = {
      ...globalActiveGame,
      isAutoDetected: true,
      headerImage: activeGame?.headerImage || autoHeaderImage,
      achievements: (globalActiveGame as any).achievements || activeGame?.achievements,
      patchNotes: (globalActiveGame as any).patchNotes || activeGame?.patchNotes
    } as SteamGameData;
  }
  // What the app sees on Steam, said plainly under the header: the running game (with Switch when another compendium
  // is open) or "No game detected".
  const detection: Detection = {
    running: globalActiveGame?.name || '',
    open: runningOpen,
    available: typeof window !== 'undefined' && !!(window as any).electronAPI,
    onSwitch: () => {
      if (!globalActiveGame) return;
      if (runningTab) handleSelectTab(runningTab.id);
      else handleCreateTab(globalActiveGame.name, { ...globalActiveGame, isAutoDetected: false });
    },
    ...(programVerdict.state === 'ask' && !steamGame && programGame
      ? {
          confirm: {
            guess: programVerdict.guess,
            via: programVerdict.via,
            onAnswer: (name: string | null) => setSettings((s) => ({ ...s, learnedPrograms: learn(s.learnedPrograms, programGame.key, name) })),
          },
        }
      : {}),
  };
  // A Steam app that holds several games with guides (Mass Effect Legendary Edition, the Kingdom Hearts collections):
  // its games, so the detection line can ask once which one this compendium is (guidesApi.ts guideCollection).
  const [collection, setCollection] = useState<{ appId: number; games: { key: string; game: string }[] } | null>(null);
  const runningAppId = Number(globalActiveGame?.appId) || 0;
  useEffect(() => {
    if (!runningAppId) { setCollection(null); return; }
    let alive = true;
    fetch(`${getApiBaseUrl()}/api/guides/collection?appId=${runningAppId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setCollection({ appId: runningAppId, games: Array.isArray(j?.games) ? j.games : [] }))
      .catch(() => alive && setCollection(null));
    return () => { alive = false; };
  }, [runningAppId]);
  /** This compendium is that game of the collection (or none: asked again). Bumps lastActive, so the choice syncs. */
  const chooseCollectionGame = (tabId: string, key: string | undefined) =>
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, guideKey: key, lastActive: Date.now() } : t)));
  // Ctrl+Shift+S photographs the running game, so it asks in that game's compendium (opened or started first).
  const toRunningForShot = useRef<() => boolean>(() => false);
  toRunningForShot.current = () => {
    if (!globalActiveGame || runningOpen) return false;
    detection.onSwitch();
    return true;
  };


  // Global focus fix for Electron webview stealing focus
  useEffect(() => {
    const handleAppInteraction = (e: Event) => {
      // Don't steal focus if they are actually interacting with the webview
      if (e.target && (e.target as HTMLElement).tagName === 'WEBVIEW') return;
      
      // If we are clicking anywhere else, force the main window to regain focus
      // from the webview at the OS level using the desktop trick.
      if ((window as any).electronAPI?.forceFocus) {
        (window as any).electronAPI.forceFocus();
      }
    };

    window.addEventListener('mousedown', handleAppInteraction, true);
    
    return () => {
      window.removeEventListener('mousedown', handleAppInteraction, true);
    };
  }, []);

  // Listen for local Steam game detection from Electron
  useEffect(() => {
    if ((window as any).electronAPI?.onActiveGameDetected) {
      (window as any).electronAPI.onActiveGameDetected((gameData: any) => {
        setGlobalActiveGame(gameData);
      });
      // Also fetch the initial state in case the game was already running
      (window as any).electronAPI.getActiveGame().then((gameData: any) => {
        setGlobalActiveGame(gameData);
      });
    }
  }, []);
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!spacesOn || !api?.setDetectBeyondSteam) return;
    api.setDetectBeyondSteam(true);
    api.onProgramDetected?.((g: ProgramGame | null) => setProgramGame(g));
    api.getProgramGame?.().then((g: ProgramGame | null) => setProgramGame(g)).catch(() => {});
  }, [spacesOn]);


  // Sync Dock Position to Electron
  useEffect(() => {
    if ((window as any).electronAPI?.setDockPosition) {
      (window as any).electronAPI.setDockPosition(settings.dockPosition);
    }
  }, [settings.dockPosition]);

  // Sync UI Scale to Electron
  useEffect(() => {
    if ((window as any).electronAPI?.setUiScale) {
      (window as any).electronAPI.setUiScale(settings.uiScale || 1.0);
    }
  }, [settings.uiScale]);

  // Sync Shortcuts to Electron and Listen for triggers
  useEffect(() => {
    if ((window as any).electronAPI?.updateShortcuts) {
      (window as any).electronAPI.updateShortcuts({
        hideAppShortcut: settings.hideAppShortcut,
        voiceInputShortcut: settings.voiceInputShortcut,
        autoScreenshotShortcut: settings.autoScreenshotShortcut,
        trackerTickShortcut: settings.trackerTickShortcut || 'CmdOrCtrl+Shift+Enter',
        trackerNextShortcut: settings.trackerNextShortcut || 'CmdOrCtrl+Shift+Down',
        questLogShortcut: settings.questLogShortcut || 'CmdOrCtrl+Shift+L',
        // The owner's picture capture for the guides (admins only).
        ownerCaptureShortcut: userData?.isAdmin ? 'CmdOrCtrl+Shift+P' : '',
      });
    }
  }, [
    settings.hideAppShortcut, 
    settings.voiceInputShortcut,
    settings.autoScreenshotShortcut,
    settings.trackerTickShortcut,
    settings.trackerNextShortcut,
    settings.questLogShortcut,
    userData?.isAdmin,
  ]);

  // Controller: tell the desktop app which chord shows / hides the overlay.
  useEffect(() => {
    (window as any).electronAPI?.setControllerConfig?.({
      enabled: settings.controllerEnabled !== false,
      toggle: settings.controllerToggle || 'hold-view-menu',
      custom: settings.controllerCustom,
      talk: settings.controllerTalk || 'y',
      trackerTick: settings.controllerTick || 'off',
      trackerNext: settings.controllerNext || 'off',
    });
  }, [settings.controllerEnabled, settings.controllerToggle, settings.controllerCustom, settings.controllerTalk, settings.controllerTick, settings.controllerNext]);

  // Snapshot on open (desktop): capture the game before the overlay takes focus.
  useEffect(() => {
    (window as any).electronAPI?.setOverlayOptions?.({ snapshotOnOpen: settings.snapshotOnOpen !== false, stickyPointers: settings.stickyPointers !== false, markersInRecordings: settings.markersInRecordings !== false, markerLifetimeMs: Math.max(0, settings.markerLifetime ?? 120) * 1000 });
  }, [settings.snapshotOnOpen, settings.stickyPointers, settings.markersInRecordings, settings.markerLifetime]);

  /** Update one message wherever it is (used by the marker features). */
  // Bumps the tab's lastActive: a sync keeps whichever copy of a tab is newer, so an edit made after the answer was
  // saved (like the precision pass removing a marker) must count as newer, or the cloud copy would bring it back.
  /**
   * Guide-backed markers (roadmap item 7): the first time a player sees one, its note says it comes from the guide and
   * may be a little off (after that, the amber style and book icon say it).
   */
  const withGuideNote = (points: ScreenPoint[]): ScreenPoint[] => {
    if (!points.some((p) => p.guideId)) return points;
    let seen = true;
    try {
      seen = localStorage.getItem('qc-guide-marker-seen') === '1';
      if (!seen) localStorage.setItem('qc-guide-marker-seen', '1');
    } catch {}
    return seen ? points : points.map((p) => (p.guideId ? { ...p, note: tr('marker.guideFirst') } : p));
  };
  const updateMessageById = (msgId: string, fn: (m: ChatMessage) => ChatMessage) =>
    setTabs((prev) =>
      prev.map((t) =>
        t.messages.some((m) => m.id === msgId) ? { ...t, messages: t.messages.map((m) => (m.id === msgId ? fn(m) : m)), lastActive: Date.now() } : t,
      ),
    );

  /** The player picked or confirmed where they are (under an answer, or on the objectives tracker). */
  const handleSetPlace = (name: string) => {
    if (!activeTab) return;
    const next = { ...(activeTab.place || {}), name, confirmed: true };
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: next, lastActive: Date.now() } : t)));
    rememberGameProgress(activeTab, next);
    noteAreaChange(activeTab, activeTab.place?.name, name);
  };

  // ---- The objectives tracker: the panel's minimized state (desktop, electron/tracker.cjs) ----
  // A quest log for where the player is, filled from our own guides (utils/trackerPayload): it shows when the active
  // tab has a known place or an answer with markers. Hiding the panel shows it; opening the panel hides it (main.cjs).
  // The latest finished answer's markers are one section of it, or the answer picked with "Track on screen" until a
  // newer answer arrives.
  const [trackerPickId, setTrackerPickId] = useState<string | null>(null);
  const trackerPickRef = useRef<string | null>(null);
  const pickTracked = (id: string | null) => {
    trackerPickRef.current = id;
    setTrackerPickId(id);
  };
  const trackerAccent = (THEME_STYLES[settings.theme] || THEME_STYLES.purple).color;
  const trackerKeyOfGame = trackerGameKey(activeTab, activeTab?.activeSteamGame || (runningOpen ? globalActiveGame : null));
  const trackerWords = trackerLabels(tr); // the tracker's words follow the app language
  // Where the player is: the tab's place, else the place saved for this game.
  // (The same key as gameProgressKey below, which is declared later in this component.)
  const trackerPlace = activeTab
    ? activeTab.place || settings.gameProgress?.[(activeTab.memoryKey || activeTab.activeSteamGame?.name || activeTab.name || '').trim().toLowerCase()]
    : undefined;
  const trackerGame = useTrackerGuide(activeTab ? activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name : undefined, trackerPlace?.name, trackerPlace?.story, useLocale(), Number(activeTab?.activeSteamGame?.appId || activeGame?.appId) || 0, activeTab?.name, activeTab?.guideKey);
  const trackerGameRef = useRef(trackerGame);
  trackerGameRef.current = trackerGame;
  // "Which game?": only while this compendium is the running collection's, and neither its pick nor its name says which.
  if (runningOpen && activeTab && collection?.appId === runningAppId && collection.games.length > 1 && !activeTab.guideKey && !trackerGame.guideKey) {
    detection.choose = { games: collection.games, onPick: (key) => chooseCollectionGame(activeTab.id, key) };
  }
  // A place is always one guide area: a saved place with two joined ("Emerald Grove, Ravaged Beach") becomes the first
  // area in it, in the tab and the game's saved progress, once the guide's areas are known.
  const guideAreaNames = (trackerGame.guideArea?.areas || []).map((a) => a.name).join('\u0001');
  useEffect(() => {
    if (!activeTab || !guideAreaNames) return;
    const names = guideAreaNames.split('\u0001');
    const key = (activeTab.activeSteamGame?.name || activeTab.name || '').trim().toLowerCase();
    const fix = <P extends { name: string }>(p: P | undefined): P | undefined => {
      if (!p?.name) return undefined;
      const one = singleArea(p.name, names);
      return one !== p.name ? { ...p, name: one } : undefined;
    };
    const tabFixed = fix(activeTab.place);
    if (tabFixed) setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: tabFixed } : t)));
    const saved = fix(settings.gameProgress?.[key]);
    if (saved && key) setSettings((s) => ({ ...s, gameProgress: { ...(s.gameProgress || {}), [key]: saved } }));
  }, [activeTab?.id, activeTab?.place?.name, guideAreaNames, settings.gameProgress]);
  const trackerPlaceRef = useRef(trackerPlace);
  trackerPlaceRef.current = trackerPlace;
  // Moving to a guide area from the tracker (‹ › or the area list): the place and that area's story beat, both
  // confirmed, in the tab and in the game's saved progress, and the whole tracker moves on.
  const moveToArea = (name: string) => {
    if (!activeTab) return;
    const area = (trackerGameRef.current.guideArea?.areas || []).find((a) => a.name === name);
    const story = area?.story?.trim() || '';
    const place = placeAfterMove(activeTab.place, name, story, true);
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place, lastActive: Date.now() } : t)));
    rememberGameProgress(activeTab, place);
    noteAreaChange(activeTab, activeTab.place?.name, name);
  };
  // "Locate me" (the tracker's crosshair, the PlaceBar): a screenshot of the game and the guide's areas go to
  // /api/locate-me (its own daily limit, never the player's questions). The place is confirmed only when its name was
  // read on screen (and the server checked it names that area); a guess is set unconfirmed, so the confirm button shows.
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState('');
  const locatingRef = useRef(false);
  /** The tracker as it was when "Locate me" started, and the place it found (null until then): see trackerPayload. */
  const locateHold = useRef<{ data: TrackerData; target: string | null } | null>(null);
  const [, setHoldTick] = useState(0);
  const releaseLocateHold = () => {
    if (!locateHold.current) return;
    locateHold.current = null;
    setHoldTick((n) => n + 1);
  };
  const locateNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLocateNote = (text: string) => {
    setLocateNote(text);
    if (locateNoteTimer.current) clearTimeout(locateNoteTimer.current);
    if (text) locateNoteTimer.current = setTimeout(() => setLocateNote(''), 8000);
  };
  /** The markers' screenshot size (1280x720): anything bigger is scaled down before it's sent (fewer tokens). */
  const shrinkForLocate = (dataUrl: string): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / img.naturalWidth, 720 / img.naturalHeight);
        if (scale >= 1) return resolve(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  const runLocate = async () => {
    const api = (window as any).electronAPI;
    const tab = activeTab;
    const guideAreas = trackerGameRef.current.guideArea?.areas || [];
    if (locatingRef.current || !tab) return;
    if (!api?.captureFresh || !guideAreas.length) {
      showLocateNote(tr('place.locateNoGuide'));
      return;
    }
    locatingRef.current = true;
    // The tracker holds what it shows now (only its place line says "Locating…") until the result is in and the new
    // area's guide page has loaded: then it updates once, never through a half-loaded place in between.
    locateHold.current = trackerPayloadRef.current ? { data: trackerPayloadRef.current.data, target: null } : null;
    setLocating(true);
    showLocateNote('');
    try {
      // A fresh capture of the game (an open panel slides away for it), never the panel or the snapshot from opening it.
      const captured: string | null = await api.captureFresh();
      if (!captured) throw new Error('no screenshot');
      const image = await shrinkForLocate(captured);
      const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken() : null;
      const res = await fetch(`${getApiBaseUrl()}/api/locate-me`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          imageBase64: image,
          game: tab.activeSteamGame?.name || activeGame?.name || tab.name,
          guideKey: trackerGameRef.current.guideKey || '',
          areas: guideAreas.map((a) => ({ name: a.name, story: a.story })),
          place: trackerPlaceRef.current?.name || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showLocateNote(data?.locateLimitReached ? tr('place.locateLimit', { n: data?.limit ?? '' }) : tr('place.locateFail'));
        return;
      }
      if (!data?.area || data.area === 'unknown') {
        showLocateNote(tr('place.locateUnknown'));
        return;
      }
      const sure = data.evidence === 'read';
      const story = typeof data.story === 'string' ? data.story.trim() : '';
      const place = placeAfterMove(tab.place, String(data.area), story, sure);
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, place, lastActive: Date.now() } : t)));
      rememberGameProgress(tab, place);
      noteAreaChange(tab, tab.place?.name, place.name);
      if (locateHold.current) {
        locateHold.current.target = place.name;
        // In case the area's page never loads (offline): let go after a few seconds anyway.
        setTimeout(() => releaseLocateHold(), 5000);
      }
    } catch {
      showLocateNote(tr('place.locateFail'));
    } finally {
      // No new place (a failure, or nothing recognised): nothing to wait for.
      if (locateHold.current && !locateHold.current.target) locateHold.current = null;
      locatingRef.current = false;
      setLocating(false);
    }
  };
  /**
   * "Spot it (landmarks, NPCs, chests)" (roadmap item 7): a guide entry looked for on a fresh screenshot (spot.ts, the
   * cheapest model; no question used, its own daily limit). Found: a marker in the guide's style over the game, ticked
   * with the entry. The result goes in the conversation as a short note, so a wrong marker can get a 👎 "Marker"
   * (counted on its own: the weekly hit rate in the Discord summary).
   */
  const spottingRef = useRef(false);
  const runSpot = async (req: SpotRequest) => {
    const api = (window as any).electronAPI;
    const tab = activeTab;
    const [kind, slug, ...rest] = String(req.id || '').split(':');
    if (spottingRef.current || !tab || kind !== 'g' || !slug || !api?.captureFresh) return;
    const entryId = rest.join(':').split('+')[0];
    const key = trackerGuideKeyRef.current || '';
    spottingRef.current = true;
    showLocateNote(tr('spot.looking', { item: req.label }));
    try {
      const captured: string | null = await api.captureFresh();
      if (!captured) throw new Error('no screenshot');
      const image = await shrinkForLocate(captured);
      const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken() : null;
      const res = await fetch(`${getApiBaseUrl()}/api/spot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ imageBase64: image, game: tab.activeSteamGame?.name || activeGame?.name || tab.name, entry: req.label, where: req.where || '', guideKey: key, slug, id: entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showLocateNote(data?.spotLimitReached ? tr('spot.limit') : tr('spot.fail'));
        return;
      }
      const msgId = `spot_${Date.now()}`;
      const points: ScreenPoint[] | undefined = data.visible
        ? [{ x: data.x, y: data.y, label: req.label.slice(0, 40), category: 'lore', note: tr('marker.guideFirst'), ...(key ? { guideId: entryId, guideKey: key, guideSlug: slug } : {}) }]
        : undefined;
      const note: ChatMessage = {
        id: msgId, role: 'assistant', kind: 'spot', modelUsed: 'Spot it', timestamp: Date.now(),
        // What it found, and how many checks are left today (its own daily allowance, not questions).
        text: `${data.visible ? tr('spot.found', { item: req.label }) : req.where ? tr('spot.notInView', { item: req.label, where: req.where }) : tr('spot.notInViewNoWhere', { item: req.label })}${Number.isFinite(Number(data.spotsLeft)) ? `

${tr('spot.left', { n: Number(data.spotsLeft) })}` : ''}`,
        ...(points ? { points, donePoints: [] } : {}),
      };
      setTabs((prev) => prev.map((x) => (x.id === tab.id ? { ...x, messages: [...x.messages, note], lastActive: Date.now() } : x)));
      showLocateNote(data.visible ? '' : tr('spot.notInViewShort', { item: req.label }));
      if (points && settings.showPointersOnScreen !== false) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        api.showScreenPointers?.(points, accent, { refImage: image, sessionId: msgId, hidden: [] });
      }
    } catch {
      showLocateNote(tr('spot.fail'));
    } finally {
      spottingRef.current = false;
    }
  };
  const runSpotRef = useRef(runSpot);
  runSpotRef.current = runSpot;
  useEffect(() => {
    const on = (e: Event) => void runSpotRef.current((e as CustomEvent).detail as SpotRequest);
    window.addEventListener(SPOT_EVENT, on);
    return () => window.removeEventListener(SPOT_EVENT, on);
  }, []);
  const trackerMsg = trackedMessage(activeTab, trackerPickId);
  // Guide-backed objectives: the guide's steps for the player's current quest, offered on the quest log and loaded in
  // place of the answer's objectives (utils/guideSteps). A newer answer takes the log back.
  const loadedSteps = activeTab?.guideSteps && (!activeTab.guideSteps.answerId || !trackerMsg || trackerMsg.id === activeTab.guideSteps.answerId) ? activeTab.guideSteps : null;
  const [offerDismissed, setOfferDismissed] = useState<string>('');
  // Steps loaded with an older answer: a newer answer took the log back, so they're put away.
  const staleSteps = !!activeTab?.guideSteps && !loadedSteps;
  useEffect(() => {
    if (!staleSteps || !activeTab) return;
    const id = activeTab.id;
    setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, guideSteps: undefined } : x)));
  }, [staleSteps, activeTab?.id]);
  const guideSteps = useGuideSteps({
    guideKey: trackerGame.guideKey, lang: useLocale(), tab: activeTab, msg: trackerMsg,
    areaSlug: trackerGame.guideArea?.slug, areaPage: (trackerGame.guideArea?.page as any) || null, loaded: loadedSteps, labels: trackerWords,
  });
  const stepsOffer = guideSteps.offer && `${guideSteps.offer.kind}:${guideSteps.offer.slug}` !== offerDismissed ? guideSteps.offer : null;
  const stepsOfferRef = useRef(stepsOffer);
  stepsOfferRef.current = stepsOffer;
  // The guide's approved pictures (the site's pictures.json): quest log thumbnails where "Quest log / step" is on.
  const guidePics = useGuidePictures(trackerGame.guideKey);
  const builtTrackerPayload = withPictures(activeTab
    ? buildTrackerPayload({ ...activeTab, place: trackerPlace }, trackerMsg, trackerGame.guideArea, trackerGame.achievementGuide, trackerWords, {
        accent: trackerAccent,
        gameKey: trackerKeyOfGame,
        pinned: !!trackerPickId && trackerMsg?.id === trackerPickId,
        achievements: activeGame?.achievements,
        locating,
        notice: locateNote,
        guideSteps: guideSteps.section,
        offer: stepsOffer ? { name: stepsOffer.name, count: stepsOffer.count } : null,
      })
    : null, guidePics);
  // While "Locate me" runs, the tracker keeps showing what it showed (its place line says "Locating…"). With a result,
  // it waits for the new place's guide area and page before showing anything new.
  const hold = locateHold.current;
  const holdDone =
    !!hold?.target &&
    !locating &&
    trackerPlace?.name === hold.target &&
    (!trackerGame.guideKey || (!!trackerGame.guideArea && !!trackerGame.guideArea.page));
  if (hold && holdDone) locateHold.current = null;
  const heldPayload =
    hold && !holdDone && builtTrackerPayload
      ? { ...builtTrackerPayload, data: { ...hold.data, locating: true, labels: builtTrackerPayload.data.labels } }
      : builtTrackerPayload;

  // ---- The quest log (owner, Oct 30 2026; utils/questLogView.ts): Now / Next / Watch out, driven by questions ----
  // The current objective (an answer set as Now), pins and hidden warnings live with the playthrough (tab.questLog).
  const logView: LogView | null = activeTab
    ? buildLogView({ ...activeTab, place: trackerPlace }, heldPayload?.data || null, { gameKey: trackerKeyOfGame, accent: trackerAccent, loaded: guideSteps.section, labels: trackerWords, walk: trackerGame.guideArea && Array.isArray((trackerGame.guideArea.page as any)?.walkthrough)
        ? { slug: trackerGame.guideArea.slug, steps: (trackerGame.guideArea.page as any).walkthrough, done: trackerGame.guideArea.done }
        : null })
    : null;
  const logViewRef = useRef(logView);
  logViewRef.current = logView;
  // The step the tick key acts on (next / prev move it): Now unless another step was picked.
  const [logSelPick, setLogSel] = useState<string | null>(null);
  const logSteps = logView ? [logView.now, ...logView.next].filter((x): x is NonNullable<typeof x> => !!x && x.tick) : [];
  const logSel = logSteps.some((x) => x.id === logSelPick) ? logSelPick : logSteps[0]?.id || null;
  const logSelRef = useRef(logSel);
  logSelRef.current = logSel;
  // The last tick, shown for a few seconds with Undo (from the log, the tick key, or a question that said it was done).
  const [logCleared, setLogCleared] = useState<{ ids: string[]; text: string; from?: 'question' } | null>(null);
  const logClearedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCleared = (c: { ids: string[]; text: string; from?: 'question' } | null) => {
    if (logClearedTimer.current) clearTimeout(logClearedTimer.current);
    setLogCleared(c);
    if (c) logClearedTimer.current = setTimeout(() => setLogCleared(null), 6000);
  };
  const patchLog = (fn: (s: NonNullable<GameTab['questLog']>) => Partial<NonNullable<GameTab['questLog']>>) => {
    const t = activeTab;
    if (!t) return;
    setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, questLog: nextLogState(x.questLog, fn(x.questLog || {})), lastActive: Date.now() } : x)));
  };
  // The tracker gets the log too (the popped-out window draws it; the bookmark and the spine show its number).
  const trackerPayload = heldPayload || logView
    ? {
        gameKey: heldPayload?.gameKey || trackerKeyOfGame,
        data: {
          ...(heldPayload?.data || { id: '', accent: trackerAccent, quest: '', sections: [], labels: trackerWords }),
          log: logView
            ? { now: logView.now, next: logView.next, watch: logView.watch, done: logView.done, pins: logView.pins.length, more: logView.more.length > 0, invite: logView.invite, sel: logSel || '', bookmark: logView.bookmark }
            : null,
        } as TrackerData,
      }
    : null;
  const trackerPayloadRef = useRef(trackerPayload);
  trackerPayloadRef.current = trackerPayload;
  // What the guide marks missable where the player is and they haven't ticked yet (the quest log's "Missable here"):
  // shown under the latest answer about this place too.
  const missSection = builtTrackerPayload?.data.sections.find((x) => x.id === 'missable');
  const missablesHere = trackerGame.guideArea && missSection
    ? { area: trackerGame.guideArea.name, items: missSection.items.filter((it) => !it.done).map((it) => ({ id: it.id, label: it.label, why: it.detail?.missable, where: it.where })) }
    : null;
  // "Near you" on the compact view (roadmap item 7): the next thing the guide lists here that isn't ticked, missables
  // first, in the guide's order. The guides have no map positions, so it's "next in this area", not a distance.
  const nearYou = (() => {
    const secs = builtTrackerPayload?.data.sections || [];
    for (const id of ['missable', 'collect'] as const) {
      const it = secs.find((x) => x.id === id)?.items.find((i) => !i.done && i.id.startsWith('g:'));
      if (it) return { id: it.id, label: it.label, where: it.where, missable: id === 'missable' };
    }
    return null;
  })();
  const trackerGuideKeyRef = useRef(trackerGame.guideKey);
  trackerGuideKeyRef.current = trackerGame.guideKey;
  // The owner's picture capture (Ctrl+Shift+P, admins only): what the picture most likely shows, best guess first. What
  // was asked about in the last quarter hour (the answer's guide entries), the next step of the guide steps on the quest
  // log, then the area the player is in. The capture window shows these by their guide names and saves to the queue.
  const ownerCaptureContext = useRef<() => Promise<any>>(async () => null);
  ownerCaptureContext.current = async () => {
    const key = trackerGame.guideKey || '';
    const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken() : null;
    const suggestions: { kind?: string; slug: string; id?: string; why: string }[] = [];
    const last = [...(activeTab?.messages || [])].reverse().find((m) => m.role === 'assistant');
    if (last && Date.now() - (last.timestamp || 0) < 15 * 60_000) {
      for (const r of last.guideRefs || []) if (r.key === key) suggestions.push({ slug: r.slug, id: r.entry, why: 'You asked about this' });
    }
    const next = builtTrackerPayload?.data.sections.find((x) => x.id === 'guide')?.items.find((it) => !it.done);
    const [kind, slug, ...rest] = String(next?.id || '').split(':');
    if (kind === 'w' && slug) suggestions.push({ kind: 'step', slug, id: rest.join(':'), why: 'Next on your quest log' });
    else if (kind === 'q' && slug) suggestions.push({ kind: 'entity', slug, why: 'The quest on your quest log' });
    if (trackerGame.guideArea?.slug) suggestions.push({ kind: 'area', slug: trackerGame.guideArea.slug, why: "You're here" });
    return { apiBase: getApiBaseUrl(), token, game: key, gameName: activeTab?.activeSteamGame?.name || activeTab?.name || '', suggestions };
  };
  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.onOwnerCaptureContextRequest?.(() => ownerCaptureContext.current());
    api?.onOwnerCaptureSaved?.(() => showLocateNote('Saved to the review queue (/admin/images).'));
  }, []);
  // Playthrough memory: an item ticked in the guide of the area the player is in (in the Guide, on the quest log, or with
  // its marker) goes on "Found" in Your playthrough.
  const guideTickPrev = useRef<{ id: string; set: Set<string> } | null>(null);
  const areaPageLoaded = !!trackerGame.guideArea?.page;
  useEffect(() => {
    const area = trackerGame.guideArea;
    const key = trackerGame.guideKey;
    if (!area || !key || !area.page) return;
    const id = `${key}:${area.slug}`;
    guideTickPrev.current = { id, set: readDone(key, area.slug) };
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      // Another playthrough's ticks (games-not-tabs): nothing was ticked, only what's shown changed.
      if (d.key === '*') { guideTickPrev.current = { id, set: readDone(key, area.slug) }; return; }
      if (d.key !== key || d.slug !== area.slug) return;
      const now = readDone(key, area.slug);
      const prev = guideTickPrev.current?.id === id ? guideTickPrev.current.set : new Set<string>();
      guideTickPrev.current = { id, set: now };
      const items = [...now]
        .filter((x) => !prev.has(x))
        .flatMap((x) => x.split('+'))
        .map((x) => (area.page?.items || []).find((it: any) => it.id === x))
        .filter(Boolean)
        .map((it: any) => ({ kind: 'found' as PlayKind, text: String(it.name || it.text || ''), source: 'guide' as const }));
      rememberPlayRef.current(items);
    };
    window.addEventListener(GUIDE_DONE_EVENT, on);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, on);
  }, [trackerGame.guideKey, trackerGame.guideArea?.slug, areaPageLoaded]);
  // A guide entry's marker ticked (on screen, in the answer's list or on the quest log): the entry is ticked in the
  // guide too, so it leaves the quest log, the missables under answers and the next answers' guide markers.
  const recentMessages = activeTab?.messages;
  useEffect(() => {
    for (const m of (recentMessages || []).slice(-6)) {
      (m.points || []).forEach((p, i) => {
        if (!p.guideId || !p.guideKey || !p.guideSlug || !(m.donePoints || []).includes(i)) return;
        if (!readDone(p.guideKey, p.guideSlug).has(p.guideId)) setEntryDone(p.guideKey, p.guideSlug, p.guideId, true);
      });
    }
  }, [recentMessages]);
  const latestTrackedId = trackedMessage(activeTab)?.id;
  // A newer finished answer takes over from the one picked with "Track on screen".
  useEffect(() => {
    if (trackerPickRef.current) pickTracked(null);
  }, [latestTrackedId]);
  // The quest log is independent of the panel: hiding or showing the panel never shows or hides it. Only its own
  // controls (send away, the ribbon) and the header's "Quest log" toggle do; its state comes back as tracker events.
  const [questLogVisible, setQuestLogVisible] = useState(false);
  // The quest log is attached to the panel (0.6.0): it moves and hides with it, and the controller's RB reaches it.
  const [questLogAttached, setQuestLogAttached] = useState(false);
  // Tucked in as the bookmark on the panel's edge: the panel keeps a keyboard / controller stop for it.
  const [questLogTucked, setQuestLogTucked] = useState(false);
  const toggleQuestLog = () => {
    const p = trackerPayloadRef.current;
    (window as any).electronAPI?.toggleQuestLog?.(p?.data, p?.gameKey);
  };
  // The controller's View button (ControllerLayer): the same toggle as Ctrl+Shift+L.
  const toggleQuestLogRef = useRef(toggleQuestLog);
  toggleQuestLogRef.current = toggleQuestLog;
  useEffect(() => {
    const on = () => toggleQuestLogRef.current();
    window.addEventListener('qc-toggle-log', on);
    return () => window.removeEventListener('qc-toggle-log', on);
  }, []);
  // Kept current: a new place, ticks anywhere (the guide page, the checklist, the tracker), a new answer.
  const trackerJson = trackerPayload ? JSON.stringify(trackerPayload.data) : '';
  useEffect(() => {
    // As soon as an answer finishes (even with the panel open), so the tracker never shows an older answer.
    if (trackerPayload) (window as any).electronAPI?.updateObjectivesTracker?.(trackerPayload.data, trackerPayload.gameKey);
  }, [trackerJson]);
  // A different game tab (or the game closing, handled in main.cjs) puts the tracker away.
  const firstTabRef = useRef(true);
  useEffect(() => {
    if (firstTabRef.current) {
      firstTabRef.current = false;
      return;
    }
    pickTracked(null);
    const api = (window as any).electronAPI;
    api?.hideObjectivesTracker?.();
    // ...then the new tab's quest log, if there's one and it's shown for that game (this runs after the update effect
    // above in the same render, so without it the new tab's log would stay closed until its data next changed).
    const p = trackerPayloadRef.current;
    if (p) api?.updateObjectivesTracker?.(p.data, p.gameKey);
  }, [activeTabId]);
  // The "free your mouse" tips (settings.mouseTips): the desktop app shows the quest log's and the spine's hint from
  // this state, and reports back when the log appeared, the hint was dismissed, or the shortcut opened the panel.
  const [mouseToast, setMouseToast] = useState<string | null>(null);
  // Premium arrived while the app is open (back from checkout in the browser): a short note, and no more asking.
  const wasPremiumRef = useRef<boolean | null>(null);
  useEffect(() => {
    const now = userData?.isPremium === true;
    if (wasPremiumRef.current === false && now) {
      stopWatchingPlan();
      setIsPaywallOpen(false);
      setMouseToast(tr('prem.nowOn'));
      if (mouseToastTimer.current) clearTimeout(mouseToastTimer.current);
      mouseToastTimer.current = setTimeout(() => setMouseToast(null), 6000);
    }
    if (userData && !userData.isGuest) wasPremiumRef.current = now;
  }, [userData?.isPremium]);
  // The plan the Premium screen starts on: monthly, or yearly when a link asks for it (?plan=year).
  const [paywallInterval, setPaywallInterval] = useState<'month' | 'year'>('month');
  // Premium asked for from outside (the website's "Get Premium", the Deck's QR code: ?premium=1), or by a guest who
  // then signed in: the plan / Premium screen, after sign-in for a guest.
  useEffect(() => {
    if (isInitializing || !user) return;
    let want = false;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('premium') === '1') {
        want = true;
        if (q.get('plan') === 'year') setPaywallInterval('year');
        q.delete('premium');
        q.delete('plan');
        const rest = q.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
      }
      if (!user.isGuest && sessionStorage.getItem('qc-after-signin') === 'premium') {
        want = true;
        sessionStorage.removeItem('qc-after-signin');
      }
    } catch {}
    if (!want) return;
    if (user.isGuest) {
      try { sessionStorage.setItem('qc-after-signin', 'premium'); } catch {}
      openSignIn();
    } else setIsPaywallOpen(true);
  }, [isInitializing, user?.uid, user?.isGuest]);
  // "Sign in for more" from the website's ask box (?ask=…, siteAsk.ts): sign-in first for a guest, then the question
  // waits in the box (not sent), where the normal free / Premium limits apply.
  useEffect(() => {
    if (isInitializing || !user) return;
    let text = '';
    try {
      const q = new URLSearchParams(window.location.search);
      const asked = q.get('ask');
      if (asked) {
        text = asked.slice(0, 500);
        sessionStorage.setItem('qc-ask-pending', text);
        q.delete('ask');
        const rest = q.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
      } else text = sessionStorage.getItem('qc-ask-pending') || '';
    } catch {}
    if (!text) return;
    if (user.isGuest) { openSignIn(); return; }
    try { sessionStorage.removeItem('qc-ask-pending'); } catch {}
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent('qc-prefill-question', { detail: { text } })), 800);
    return () => clearTimeout(t);
  }, [isInitializing, user?.uid, user?.isGuest]);
  // Back from the web checkout or the portal: the plan again, past the server's cache.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('upgrade') === 'success' || q.get('portal') === 'done') {
        watchPlan();
        q.delete('portal');
        const rest = q.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
      }
    } catch {}
  }, []);
  const mouseToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    (window as any).electronAPI?.setMouseTips?.({ logSeen: settings.mouseTips?.logSeen || 0, dismissed: !!settings.mouseTips?.dismissed || !showFirstRunHints() });
  }, [settings.mouseTips?.logSeen, settings.mouseTips?.dismissed]);
  const handleMouseTip = (e: any) => {
    const tips = settings.mouseTips || {};
    if (e.what === 'seen') {
      setSettings((s) => ({ ...s, mouseTips: { ...s.mouseTips, logSeen: (s.mouseTips?.logSeen || 0) + 1 } }));
    } else if (e.what === 'dismiss') {
      setSettings((s) => ({ ...s, mouseTips: { ...s.mouseTips, dismissed: true } }));
    } else if (e.what === 'shortcut-open' && (tips.toastSeen || 0) < MOUSE_TOAST_TIMES && typeof e.keys === 'string' && e.keys) {
      // "Mouse unlocked · Ctrl+\ to go back to your game", for about 3 seconds, the first 10 times.
      setSettings((s) => ({ ...s, mouseTips: { ...s.mouseTips, toastSeen: (s.mouseTips?.toastSeen || 0) + 1 } }));
      setMouseToast(tr('tip.mouseToast', { keys: e.keys }));
      if (mouseToastTimer.current) clearTimeout(mouseToastTimer.current);
      mouseToastTimer.current = setTimeout(() => setMouseToast(null), 3200);
    }
  };

  // Ticks, the place confirmed and "I'm here now" on the tracker, handled like the checklist, guide page and PlaceBar.
  const trackerEventRef = useRef<(e: any) => void>(() => {});
  trackerEventRef.current = (e: any) => {
    if (!e || typeof e.type !== 'string') return;
    const api = (window as any).electronAPI;
    if (e.type === 'mouse-tip') {
      handleMouseTip(e);
      return;
    }
    if (e.type === 'log-key') {
      logKeyRef.current(String(e.action || ''), !!e.onScreen);
      return;
    }
    if (e.type === 'log-action') {
      const a = String(e.action || '');
      if (a === 'hide' && typeof e.id === 'string' && e.id) hideWatchRef.current(e.id);
      else if (a === 'whats-next') window.dispatchEvent(new CustomEvent('qc-ask', { detail: { text: tr('tracker.logWhatsNext') } }));
      else if (a === 'ask') setTimeout(() => document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus(), 250);
      return;
    }
    if (e.type === 'visibility') {
      setQuestLogVisible(!!e.visible);
      setQuestLogAttached(!!e.attached);
      setQuestLogTucked(!!e.tucked);
      return;
    }
    if (e.type === 'tick' && typeof e.item === 'string') {
      const id: string = e.item;
      if (id.startsWith('s:')) {
        // A step from an answer: s:<message id>:<index>, ticked per answer.
        const cut = id.lastIndexOf(':');
        const msgId = id.slice(2, cut);
        const index = Number(id.slice(cut + 1));
        const msg = tabs.flatMap((t) => t.messages).find((m) => m.id === msgId);
        if (!msg?.steps?.length || !Number.isInteger(index) || index < 0 || index >= msg.steps.length) return;
        const done = msg.doneSteps ?? [];
        updateMessageById(msgId, (m) => ({ ...m, doneSteps: e.done ? [...new Set([...done, index])].sort((x, y) => x - y) : done.filter((d) => d !== index) }));
        // A ticked step goes on the "already done" list.
        const tabOf = tabs.find((t) => t.messages.some((m) => m.id === msgId));
        if (e.done && tabOf) rememberDone(tabOf, [{ text: msg.steps[index].text, kind: 'step' }]);
      } else if (id.startsWith('a:')) {
        // An answer's marker: a:<message id>:<index>, the same as its checklist under the answer.
        const cut = id.lastIndexOf(':');
        const msgId = id.slice(2, cut);
        const index = Number(id.slice(cut + 1));
        const msg = tabs.flatMap((t) => t.messages).find((m) => m.id === msgId);
        if (!msg?.points?.length || !Number.isInteger(index) || index < 0 || index >= msg.points.length) return;
        const done = msg.donePoints ?? [];
        const next = e.done ? [...new Set([...done, index])].sort((x, y) => x - y) : done.filter((d) => d !== index);
        updateMessageById(msgId, (m) => ({ ...m, donePoints: next }));
        if (next.length >= msg.points.length) api?.hideScreenPointers?.();
        else if (markersActiveFor(msgId)) api?.setPointersHidden?.(msgId, next);
      } else if (id.startsWith('q:') || id.startsWith('w:')) {
        // Loaded guide steps: q:<quest slug>:<step id> (the quest page's ticks), w:<area slug>:<step id> (the
        // walkthrough's, on its area). Kept with the guide's other ticks, so they sync with the account.
        const rest = id.slice(2);
        const cut = rest.indexOf(':');
        const key = activeTab?.guideSteps?.key || trackerGuideKeyRef.current;
        if (cut > 0 && key) {
          const slug = rest.slice(0, cut), stepId = rest.slice(cut + 1);
          if (id.startsWith('q:')) setEntryDone(key, `quest:${slug}`, stepId, !!e.done);
          else setEntryDone(key, slug, `walk:${stepId}`, !!e.done);
        }
      } else if (id.startsWith('g:')) {
        // A guide entry: g:<area slug>:<entry id>, the same ticks as the guide page.
        const rest = id.slice(2);
        const cut = rest.indexOf(':');
        const key = trackerGuideKeyRef.current;
        // A merged entry (one chest the guide lists as several entries) ticks all of its parts: ids joined by "+".
        if (cut > 0 && key) for (const entryId of rest.slice(cut + 1).split('+')) setEntryDone(key, rest.slice(0, cut), entryId, !!e.done);
      }
    } else if (e.type === 'confirm-place' && typeof e.name === 'string' && e.name.trim()) {
      if (typeof e.id === 'string' && e.id) updateMessageById(e.id, (m) => ({ ...m, placeChosen: e.name }));
      handleSetPlace(e.name);
    } else if (e.type === 'goto-area' && typeof e.name === 'string' && e.name.trim()) {
      // The ‹ › arrows or the area list on the tracker: that area becomes where the player is.
      moveToArea(e.name.trim());
    } else if (e.type === 'load-steps') {
      // "Load the guide's steps" on the quest log: they become the objectives of this tab (no AI question).
      const o = stepsOfferRef.current;
      const t = activeTab;
      if (o && t) {
        const answerId = trackedMessage(t)?.id;
        const steps = { kind: o.kind, key: o.key, slug: o.slug, name: o.name, ...(o.kind === 'walk' && o.from ? { from: o.from } : {}), ...(answerId ? { answerId } : {}) };
        setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, guideSteps: steps, lastActive: Date.now() } : x)));
      }
    } else if (e.type === 'unload-steps') {
      const t = activeTab;
      if (t) {
        if (t.guideSteps) setOfferDismissed(`${t.guideSteps.kind}:${t.guideSteps.slug}`);
        setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, guideSteps: undefined, lastActive: Date.now() } : x)));
      }
    } else if (e.type === 'dismiss-offer') {
      const o = stepsOfferRef.current;
      if (o) setOfferDismissed(`${o.kind}:${o.slug}`);
    } else if (e.type === 'locate') {
      runLocate();
    } else if (e.type === 'next-turn') {
      runNextTurn();
    } else if (e.type === 'open-entry' && typeof e.item === 'string') {
      // "Open in guide" on an expanded tracker entry (the panel is opening at the tracker): the Guide at that entry's
      // area, the entry shown and highlighted. g:<area>:<entry>, h:<area>:<achievement>, n:<area>:<point>; an answer's
      // marker (a:…) opens the area the player is in.
      const [kind, ...rest] = e.item.split(':');
      const slug = kind === 'a' ? trackerGameRef.current.guideArea?.slug : rest[0];
      const tail = rest.slice(1).join(':');
      const entry = kind === 'g' ? tail.split('+')[0] : kind === 'h' ? `ach:${tail}` : undefined;
      // A loaded quest step opens its quest page; a walkthrough step its area.
      if (slug) window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug, entry, ...(kind === 'q' ? { entity: true } : {}) } }));
    } else if (e.type === 'spot' && typeof e.item === 'string') {
      // "Spot it" on a quest-log entry: looked for on a fresh screenshot, marked over the game.
      void runSpotRef.current({ id: e.item, label: String(e.label || ''), where: String(e.where || '') });
    } else if (e.type === 'ask-about' && typeof e.label === 'string' && e.label.trim()) {
      // "Ask about this": the panel opens with a question about the entry in the box, not sent.
      const area = trackerPlaceRef.current?.name?.trim() || '';
      const text = area ? tr('tracker.askQuestion', { item: e.label.trim(), area }) : tr('tracker.askQuestionNoArea', { item: e.label.trim() });
      window.dispatchEvent(new CustomEvent('qc-prefill-question', { detail: { text } }));
    }
  };
  useEffect(() => {
    (window as any).electronAPI?.onTrackerEvent?.((e: any) => trackerEventRef.current(e));
  }, []);
  // The quest log's actions (the docked log, the popped-out window, the tick keys, the answers' Set as Now and Pin).
  const tickLog = (id: string, done: boolean) => {
    trackerEventRef.current({ type: 'tick', item: id, done });
    const st = logSteps.find((x) => x.id === id);
    if (done && st) showCleared({ ids: [id], text: st.text });
  };
  const undoLog = () => {
    const c = logCleared;
    if (!c) return;
    for (const id of c.ids) trackerEventRef.current({ type: 'tick', item: id, done: false });
    showCleared(null);
  };
  const setLogNow = (msgId: string) => {
    patchLog(() => ({ now: msgId }));
    setLogSel(null);
    // The log comes out (docked: the column) so the player sees it took.
    setTimeout(() => {
      const p = trackerPayloadRef.current;
      (window as any).electronAPI?.showQuestLog?.(p?.data, p?.gameKey);
    }, 0);
  };
  const togglePin = (msgId: string) => patchLog((st) => ({ pins: (st.pins || []).includes(msgId) ? (st.pins || []).filter((x) => x !== msgId) : [msgId, ...(st.pins || [])].slice(0, 20) }));
  const hideWatch = (id: string) => patchLog((st) => ({ hidden: [...new Set([...(st.hidden || []), id])] }));
  const hideWatchRef = useRef(hideWatch);
  hideWatchRef.current = hideWatch;
  /**
   * The tick and next keys (global shortcuts, and the popped-out window's controller): tick the picked step (Now unless
   * another was picked), or move the pick. With the log out of sight, a heads-up shows the new Now over the game.
   */
  const handleLogKey = (action: string, onScreen: boolean) => {
    const v = logViewRef.current;
    if (!v) return;
    const steps = [v.now, ...v.next].filter((x): x is NonNullable<typeof x> => !!x && x.tick);
    const sel = logSelRef.current;
    const api = (window as any).electronAPI;
    if (action === 'tick') {
      const st = steps.find((x) => x.id === sel) || steps[0];
      if (!st) return;
      tickLog(st.id, true);
      setLogSel(null);
      if (!onScreen) {
        const rest = steps.filter((x) => x.id !== st.id);
        api?.trackerHeads?.(rest[0]?.text || (v.now?.goal ? `✓ ${tr('tracker.logDone', { goal: v.now.goal })}` : ''));
      }
    } else if (action === 'next' || action === 'prev') {
      if (!steps.length) return;
      const i = Math.max(0, steps.findIndex((x) => x.id === sel));
      const to = steps[(i + (action === 'next' ? 1 : steps.length - 1)) % steps.length];
      setLogSel(to.id);
      if (!onScreen) api?.trackerHeads?.(to.text);
    }
  };
  const logKeyRef = useRef(handleLogKey);
  logKeyRef.current = handleLogKey;
  // Ctrl+Z while the log's Undo shows (anywhere in the panel but a text box): the last tick is undone.
  const undoLogRef = useRef(undoLog);
  undoLogRef.current = undoLog;
  const hasCleared = !!logCleared;
  useEffect(() => {
    if (!hasCleared) return;
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      undoLogRef.current();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [hasCleared]);

  /** "Track on screen" under an answer: that answer goes on the quest log (shown if it was away) and the panel hides. */
  const handleTrackOnScreen = (msgId: string) => {
    pickTracked(msgId);
    // An answer with steps becomes the current objective (the quest log's Now).
    if (activeTab?.messages.some((m) => m.id === msgId && m.steps?.some((st) => st.kind !== 'warning'))) patchLog(() => ({ now: msgId }));
    // Once the tracker data has been rebuilt for the picked answer (the next render).
    setTimeout(() => {
      const p = trackerPayloadRef.current;
      (window as any).electronAPI?.showQuestLog?.(p?.data, p?.gameKey);
      (window as any).electronAPI?.toggleSlide?.();
    }, 0);
  };

  /**
   * Precision pass: crop a zoomed-in square around each marked spot and ask the fast model to pinpoint the exact
   * object, using the AI's own description ("lower-right barrel of the three"). Markers then slide onto it.
   */
  /**
   * Zoom in on spots of a screenshot and ask the fast model to pinpoint each described object in its close-up.
   * Returns the objects it found (0-1 in the full screenshot); objects it couldn't find are left out.
   */
  /** Close-up check of each marker. Returns null when the check couldn't run (so nothing is removed on errors). */
  const pinpoint = async (image: string, items: { x: number; y: number; label: string; where: string; category?: string }[], game: string, token: string | null): Promise<{ index: number; x: number; y: number }[] | null> => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = image;
    });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const side = Math.round(Math.min(W * 0.3, H * 0.7));
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    if (!ctx || side < 40) return null;
    const crops = items.map((p, index) => {
      const x0 = Math.max(0, Math.min(W - side, Math.round(p.x * W - side / 2)));
      const y0 = Math.max(0, Math.min(H - side, Math.round(p.y * H - side / 2)));
      ctx.imageSmoothingEnabled = false; // keep pixel art crisp when zooming in
      ctx.drawImage(img, x0, y0, side, side, 0, 0, 768, 768);
      return { index, x0, y0, image: canvas.toDataURL('image/jpeg', 0.85), label: p.label, where: p.where, category: p.category };
    });
    const res = await fetch(`${getApiBaseUrl()}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ crops: crops.map((c) => ({ image: c.image, label: c.label, where: c.where, category: c.category })), game }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (Array.isArray(data.found) ? data.found : [])
      .map((f: { index: number; x: number; y: number }) => {
        const c = crops[f.index];
        return c ? { index: c.index, x: (c.x0 + f.x * side) / W, y: (c.y0 + f.y * side) / H } : null;
      })
      .filter(Boolean) as { index: number; x: number; y: number }[];
  };

  // Where the player is in each game, kept in settings so it outlives any one compendium.
  const gameProgressKey = (t: GameTab) => (t.memoryKey || t.activeSteamGame?.name || t.name || '').trim().toLowerCase();
  const rememberGameProgress = (t: GameTab, place: NonNullable<GameTab['place']>) => {
    const key = gameProgressKey(t);
    if (!key) return;
    setSettings((s) => ({ ...s, gameProgress: { ...(s.gameProgress || {}), [key]: place } }));
  };
  /** Progress memory: add finished things to this game's "already done" list (utils/progressMemory). */
  const rememberDone = (t: GameTab, items: { text: string; kind: DoneKind }[]) => {
    const key = gameProgressKey(t);
    if (!key || !items.length || settings.playthroughMemory === false) return;
    setSettings((s) => ({ ...s, gameDone: { ...(s.gameDone || {}), [key]: addDone(s.gameDone?.[key], items) } }));
  };
  // ---- Playthrough memory (roadmap item 8, utils/playthrough.ts) ----
  // The active game's record: this computer's copy merged with the account's (signed in), saved to both on change.
  const memoryOn = settings.playthroughMemory !== false;
  const playGame = activeTab ? (activeTab.memoryKey || activeTab.activeSteamGame?.name || activeTab.name || '').trim() : '';
  const playOwner = user && !(user as any).isGuest ? String((user as any).uid) : 'guest';
  const playUid = user && !(user as any).isGuest ? String((user as any).uid) : '';
  const [play, setPlay] = useState<Playthrough>(emptyPlaythrough());
  const playRef = useRef(play);
  playRef.current = play;
  const playFor = useRef('');
  useEffect(() => {
    if (!playGame) return;
    const id = `${playOwner}:${playGame}`;
    playFor.current = id;
    const local = readLocal(playOwner, playGame);
    setPlay(local);
    if (!playUid) return;
    void readCloud(playUid, playGame).then((cloud) => {
      if (playFor.current !== id || !cloud) return;
      const merged = mergePlaythrough(readLocal(playOwner, playGame), cloud);
      setPlay(merged);
      writeLocal(playOwner, playGame, merged);
    });
  }, [playGame, playOwner, playUid]);
  const playSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePlay = (fn: (p: Playthrough) => Playthrough) => {
    if (!playGame) return;
    const next = fn(playRef.current);
    if (next === playRef.current) return;
    playRef.current = next;
    setPlay(next);
    writeLocal(playOwner, playGame, next);
    if (!playUid) return;
    const uid = playUid, game = playGame;
    if (playSaveTimer.current) clearTimeout(playSaveTimer.current);
    playSaveTimer.current = setTimeout(() => void writeCloud(uid, game, next), 800);
  };
  /** Choices and key items an answer noted, or a guide entry ticked: added when the memory is on. */
  const rememberPlay = (items: { kind: PlayKind; text: string; source: 'answer' | 'guide' }[]) => {
    if (!memoryOn || !items.length) return;
    updatePlay((p) => addEntries(p, items));
  };
  const rememberPlayRef = useRef(rememberPlay);
  rememberPlayRef.current = rememberPlay;
  const [playOpen, setPlayOpen] = useState(false);
  useEffect(() => {
    const open = () => setPlayOpen(true);
    window.addEventListener(OPEN_PLAYTHROUGH_EVENT, open);
    return () => window.removeEventListener(OPEN_PLAYTHROUGH_EVENT, open);
  }, []);
  /** "Already done" edits from the panel (settings.gameDone). */
  const editDone = (index: number, text: string | null) => {
    const key = activeTab ? gameProgressKey(activeTab) : '';
    if (!key) return;
    setSettings((s) => {
      const list = [...(s.gameDone?.[key] || [])];
      if (index < 0 || index >= list.length) return s;
      if (text === null || text.trim().length < 2) list.splice(index, 1);
      else list[index] = { ...list[index], text: text.replace(/\s+/g, ' ').trim().slice(0, 120) };
      return { ...s, gameDone: { ...(s.gameDone || {}), [key]: list } };
    });
  };

  /** Moving on to a later guide area: the area left behind goes on the "already done" list. */
  const noteAreaChange = (t: GameTab, from: string | undefined, to: string | undefined) => {
    const names = (trackerGameRef.current.guideArea?.areas || []).map((a) => a.name);
    const past = areaMovedPast(names, from ? singleArea(from, names) : from, to);
    if (past) rememberDone(t, [{ text: past, kind: 'area' }]);
  };

  const refineMarkers = async (msgId: string, image: string, points: ScreenPoint[], game: string, token: string | null) => {
    const log = (m: string) => (window as any).electronAPI?.markerLog?.(m);
    try {
      const found = await pinpoint(image, points.map((p) => ({ x: p.x, y: p.y, label: p.label, where: p.where || '', category: p.category })), game, token);
      if (!found) {
        log('precision pass skipped (check unavailable)');
        return;
      }
      // Markers the strict close-up check couldn't find aren't really on screen (the AI expected something from its
      // memory of the place, like an NPC from another visit or stairs that aren't there): remove them. Only markers the
      // check actually looked at (the first five) can be removed.
      const unseen = points.map((p, i) => i).filter((i) => i < 5 && !found.some((f) => f.index === i));
      if (unseen.length) {
        const kept = points
          .map((p, i) => {
            const mv = found.find((f) => f.index === i);
            return mv ? { ...p, x: mv.x, y: mv.y } : p;
          })
          .filter((_, i) => !unseen.includes(i));
        log(`precision pass: removed ${unseen.length} marker(s) the close-up check couldn't see`);
        // Described in words instead of a marker: what it is and where the answer said it is.
        const removedLabels = unseen.map((i) => (points[i].where ? `${points[i].label} (${points[i].where})` : points[i].label));
        updateMessageById(msgId, (m) => ({
          ...m,
          points: kept.length ? kept : undefined,
          donePoints: [],
          removedMarkers: [...(m.removedMarkers || []), ...removedLabels],
        }));
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        const combat = !!tabs.flatMap((t) => t.messages).find((m) => m.id === msgId)?.combat;
        if (kept.length) (window as any).electronAPI?.showScreenPointers?.(kept, accent, { refImage: image, sessionId: msgId, hidden: [], combat });
        else (window as any).electronAPI?.hideScreenPointers?.();
        return;
      }
      const moves = found.filter((m) => Math.hypot(m.x - points[m.index].x, m.y - points[m.index].y) > 0.004);
      log(`precision pass: ${moves.length} of ${points.length} marker(s) adjusted`);
      if (!moves.length) return;
      updateMessageById(msgId, (m) => ({
        ...m,
        points: (m.points ?? []).map((p, i) => {
          const mv = moves.find((x) => x.index === i);
          return mv ? { ...p, x: mv.x, y: mv.y } : p;
        }),
      }));
      (window as any).electronAPI?.movePointers?.(msgId, moves);
    } catch (e: any) {
      log(`precision pass skipped: ${e?.message ?? e}`);
    }
  };

  // On-screen markers: know which answer's markers are showing, and run area checks for nearby items.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const locateUserRef = useRef<any>(null);
  locateUserRef.current = user;
  const locateGameRef = useRef<SteamGameData | null>(null);
  locateGameRef.current = globalActiveGame;
  // Area-check misses per answer, per nearby item: stop looking for an item after MAX_AREA_MISSES looks without it.
  const MAX_AREA_MISSES = 3;
  const areaMissesRef = useRef(new Map<string, Map<number, number>>());
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onLocateRequest) return;
    api.onPointersState?.(({ id, active }: { id: string; active: boolean }) => setPointersActive(id, active));
    api.onLocateRequest(async ({ id, image, occupied }: { id: string; image: string; occupied?: { x: number; y: number }[] }) => {
      const tab = tabsRef.current.find((t) => t.messages.some((m) => m.id === id));
      const msg = tab?.messages.find((m) => m.id === id);
      let misses = areaMissesRef.current.get(id);
      if (!misses) areaMissesRef.current.set(id, (misses = new Map()));
      // Only items the AI placed on this map: "elsewhere" items are on another screen, and changing screens ends the
      // markers anyway. Items missed MAX_AREA_MISSES times are dropped (hidden items look like every other barrel,
      // so repeated looks rarely find them and each one is a paid AI call).
      const pending = (msg?.nearby ?? [])
        .map((n, i) => ({ ...n, i }))
        .filter((n) => !n.found && n.onMap && (misses.get(n.i) ?? 0) < MAX_AREA_MISSES);
      const log = (m: string) => api.markerLog?.(m);
      if (!tab || !msg || !pending.length) {
        api.locateDone?.(id, 0);
        return;
      }
      /** Count a miss for every looked-for item that wasn't found; report how many are still worth looking for. */
      const finish = (foundIdx: Set<number>) => {
        let remaining = 0;
        for (const n of pending) {
          if (foundIdx.has(n.i)) continue;
          const count = (misses.get(n.i) ?? 0) + 1;
          misses.set(n.i, count);
          if (count < MAX_AREA_MISSES) remaining++;
          else log(`stopped looking for ${n.label} after ${count} checks`);
        }
        api.locateDone?.(id, remaining);
      };
      try {
        const u = locateUserRef.current;
        const token = u && typeof u.getIdToken === 'function' ? await u.getIdToken() : null;
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/locate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            imageBase64: image,
            targets: pending.map((n) => ({ label: n.label, hint: n.hint })),
            game: tab.activeSteamGame?.name || locateGameRef.current?.name || '',
          }),
        });
        if (!res.ok) {
          // Not a miss: the check didn't happen (rate limit, Premium-only, server error).
          log(`area check failed: HTTP ${res.status}`);
          api.locateDone?.(id, pending.length);
          return;
        }
        const data = await res.json();
        const found: { index: number; x: number; y: number }[] = Array.isArray(data.found) ? data.found : [];
        log(`area check: looked for ${pending.map((n) => n.label).join(', ')}; found ${found.length}`);
        if (!found.length) {
          finish(new Set());
          return;
        }
        const startIndex = msg.points?.length ?? 0;
        const already = new Set((msg.points ?? []).map((p) => p.label.trim().toLowerCase()));
        // Gate 1: not an item we already have, and not sitting on top of a marker that's showing.
        const clear = found.filter((f) => {
          if (already.has(pending[f.index].label.trim().toLowerCase())) return false;
          const onTop = (occupied ?? []).some((o) => Math.hypot(o.x - f.x, (o.y - f.y) * 0.5625) < 0.045);
          if (onTop) log(`ignored ${pending[f.index].label}: on top of a marker that's already showing`);
          return !onTop;
        });
        // Gate 2: a close-up of the spot must independently find the described object there.
        const confirmed = clear.length
          ? (await pinpoint(image, clear.map((f) => ({ x: f.x, y: f.y, label: pending[f.index].label, where: pending[f.index].hint || '' })), tab.activeSteamGame?.name || locateGameRef.current?.name || '', token)) ?? []
          : [];
        const fresh = confirmed
          .filter((c) => Math.hypot(c.x - clear[c.index].x, (c.y - clear[c.index].y) * 0.5625) < 0.08)
          .map((c) => ({ ...clear[c.index], x: c.x, y: c.y }));
        if (clear.length > fresh.length) log(`close-up check rejected ${clear.length - fresh.length} find(s)`);
        const newPoints = fresh.map((f) => ({ x: f.x, y: f.y, label: pending[f.index].label, fromArea: true }));
        const foundIdx = new Set(fresh.map((f) => pending[f.index].i));
        if (!newPoints.length) {
          finish(foundIdx);
          return;
        }
        setTabs((prev) =>
          prev.map((t) =>
            t.id !== tab.id
              ? t
              : {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id !== id
                      ? m
                      : {
                          ...m,
                          points: [...(m.points ?? []), ...newPoints],
                          nearby: (m.nearby ?? []).map((n, i) => (foundIdx.has(i) ? { ...n, found: true } : n)),
                        },
                  ),
                },
          ),
        );
        rememberAreaFind(id, { points: newPoints, refImage: image, startIndex });
        playBlipSound(settingsRef.current.soundEnabled);
        api.addPointers?.(id, newPoints, image, startIndex);
        finish(foundIdx);
      } catch {
        api.locateDone?.(id, pending.length);
      }
    });
  }, []);

  // Controller: LB / RB switch between compendiums.
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const delta = (e as CustomEvent).detail?.delta ?? 0;
      if (!tabs.length || !delta) return;
      const i = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
      const next = tabs[(i + delta + tabs.length) % tabs.length];
      if (next && next.id !== activeTabId) setActiveTabId(next.id);
    };
    window.addEventListener('qc-switch-tab', onSwitch);
    return () => window.removeEventListener('qc-switch-tab', onSwitch);
  }, [tabs, activeTabId]);

  useEffect(() => {
    if ((window as any).electronAPI?.onTriggerVoiceInputStart) {
      // Hold to talk with the keyboard (the voice shortcut held down): immersive, like the controller's.
      (window as any).electronAPI.onTriggerVoiceInputStart(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('qc-talk', { detail: { state: 'start' } }));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInputStop) {
      (window as any).electronAPI.onTriggerVoiceInputStop(() => {
        window.dispatchEvent(new CustomEvent('qc-talk', { detail: { state: 'end' } }));
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInput) {
      (window as any).electronAPI.onTriggerVoiceInput(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-record'));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerAutoScreenshot) {
      (window as any).electronAPI.onTriggerAutoScreenshot(() => {
        setIsBrowserMode(false);
        // On another game's compendium: open the running game's first, and ask once it's on screen.
        const switched = toRunningForShot.current();
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-auto-screenshot-submit'));
        }, switched ? 450 : 100);
      });
    }
  }, []);

  // The hidden panel's spine follows the theme and the language (electron/spine.cjs).
  useEffect(() => {
    const t = THEME_STYLES[settings.theme] || THEME_STYLES.purple;
    (window as any).electronAPI?.setLook?.({ accent: t.color, label: tr('tracker.spine'), tuckLabel: tr('header.tuckHandle') });
  }, [settings.theme, settings.language]);

  // Apply Theme CSS Variables
  useEffect(() => {
    const t = THEME_STYLES[settings.theme] || THEME_STYLES.purple;
    const root = document.documentElement.style;
    root.setProperty('--accent-color', t.color);
    root.setProperty('--accent-dim', t.dim);
    root.setProperty('--accent-border', t.border);
    root.setProperty('--accent-glow', t.glow);
    root.setProperty('--bg-opacity', (settings.windowOpacity / 100).toFixed(2));
    root.setProperty('--tab-font-size', `${settings.tabFontSize}px`);
    root.setProperty('--chat-font-size', `${settings.chatFontSize}px`);
    
    // Apply Font Family
    const fonts: Record<string, string> = {
      'segoe': "'Segoe UI', system-ui, sans-serif",
      'pixel': "'VT323', monospace",
      'lore': "'Literata', serif",
      'code': "'JetBrains Mono', monospace"
    };
    root.setProperty('--chat-font-family', fonts[settings.chatFont] || fonts.segoe);
    applyUiStyle(settings.uiStyle, t.color);
    applyLocale(settings.language);
  }, [settings.theme, settings.windowOpacity, settings.tabFontSize, settings.chatFontSize, settings.chatFont, settings.uiStyle, settings.language]);

  // Handle Steam Auth Return
  useEffect(() => {
    // Check URL parameters for fallback/direct-link auth
    const params = new URLSearchParams(window.location.search);
    const authSteamId = params.get('steamId');
    if (authSteamId) {
      setSettings(prev => ({ ...prev, steamId: authSteamId }));
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if ((window as any).electronAPI && (window as any).electronAPI.onDesktopSteamSuccess) {
      (window as any).electronAPI.onDesktopSteamSuccess((steamId: string) => {
        if (steamId) {
          setSettings(prev => ({ ...prev, steamId }));
        }
      });
    }

    // Listen for popup auth messages and storage events
    const handleMessage = (event: MessageEvent) => {
      // Allow localhost, .run.app, itch, and custom domain origins
      const isAllowedOrigin = 
        event.origin.includes('localhost') || 
        event.origin.endsWith('.run.app') || 
        event.origin.includes('itch') ||
        event.origin.includes('questcompendium.com');

      if (!isAllowedOrigin) {
        return;
      }
      if (event.data?.type === 'STEAM_AUTH_SUCCESS' && event.data.steamId) {
        setSettings(prev => ({ ...prev, steamId: event.data.steamId }));
      } else if (event.data?.type === 'STEAM_AUTH_ERROR') {
        console.error('Steam login failed in popup');
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'steam_auth_id' && event.newValue) {
        setSettings(prev => ({ ...prev, steamId: event.newValue }));
        localStorage.removeItem('steam_auth_id'); // cleanup
      }
      if (event.key === 'quest_compendium_settings' && event.newValue) {
        setSettings(prev => ({ ...prev, ...JSON.parse(event.newValue!) }));
      }
    };
    
    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Persist State
  useEffect(() => {
    try {
      localStorage.setItem('quest_compendium_settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Guide ticks follow the account: this device's ticks go into settings.guideDone (synced with the account), and
  // ticks synced from the player's other devices are added here (utils/guideProgress.ts).
  useEffect(() => {
    const save = () =>
      setSettings((s) => {
        const all = exportAllDone();
        const same = JSON.stringify(Object.entries(all).sort()) === JSON.stringify(Object.entries(s.guideDone || {}).sort());
        return same || (!s.guideDone && !Object.keys(all).length) ? s : { ...s, guideDone: all };
      });
    window.addEventListener(GUIDE_DONE_EVENT, save);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, save);
  }, []);
  useEffect(() => {
    if (settings.guideDone) importAllDone(settings.guideDone);
    else {
      const all = exportAllDone();
      if (Object.keys(all).length) setSettings((s) => (s.guideDone ? s : { ...s, guideDone: all }));
    }
  }, [settings.guideDone]);

  useEffect(() => {
    // Avoid overwriting persisted storage with empty tabs while initializing
    if (isInitializing) return;

    try {
      if (user?.isGuest) {
        localStorage.setItem('quest_guest_tabs', JSON.stringify(legacyTabs));
      } else if (user && !user.isGuest) {
        localStorage.setItem(`quest_compendium_tabs_${user.uid}`, JSON.stringify(legacyTabs));
        localStorage.setItem('quest_compendium_tabs', JSON.stringify(legacyTabs));
      } else {
        const isGuestSaved = typeof window !== 'undefined' && Boolean(localStorage.getItem('quest_guest_session'));
        if (isGuestSaved) {
          localStorage.setItem('quest_guest_tabs', JSON.stringify(legacyTabs));
        } else {
          localStorage.setItem('quest_compendium_tabs', JSON.stringify(legacyTabs));
        }
      }
    } catch {}
  }, [legacyTabs, user, isInitializing]);

  // Fetch Steam Profile
  useEffect(() => {
    if (!settings.steamId) {
      if (settings.steamName || settings.steamAvatar) {
        setSettings(prev => {
          const next = { ...prev };
          delete next.steamName;
          delete next.steamAvatar;
          return next;
        });
      }
      return;
    }
    
    async function fetchProfile() {
      try {
        if ((window as any).electronAPI?.fetchSteamProfileLocally) {
          const profile = await (window as any).electronAPI.fetchSteamProfileLocally(settings.steamId);
          if (profile) {
            setSettings(prev => ({ 
              ...prev, 
              steamName: profile.steamName, 
              steamAvatar: profile.avatarMedium || profile.avatarIcon || profile.avatarFull 
            }));
          }
          return;
        }

        const res = await fetch(`${getApiBaseUrl()}/api/steam/profile?steamId=${encodeURIComponent(settings.steamId)}`);
        if (res.ok) {
          const data = await res.json();
          setSettings(prev => ({ 
            ...prev, 
            steamName: data.steamName, 
            steamAvatar: data.avatarMedium || data.avatarIcon || data.avatarFull 
          }));
        }
      } catch (err) {
        console.error('Failed to fetch Steam profile', err);
      }
    }
    fetchProfile();
  }, [settings.steamId]);

    // Fetch Steam achievements and patch notes
  useEffect(() => {
    if (!activeGame || !activeTab) return;
    let isMounted = true;
    
    // Extracted separate function just for polling achievements without fetching news again
    const pollAchievements = async () => {
      try {
        let newAchievements: any = null;
        
        if ((window as any).electronAPI && (window as any).electronAPI.fetchAchievementsLocally) {
          if (settings.steamId) {
            const localAch = await (window as any).electronAPI.fetchAchievementsLocally(activeGame.appId, settings.steamId);
            if (localAch) newAchievements = localAch;
          }
        } else {
          if (settings.steamId) {
            const res = await fetch(`${getApiBaseUrl()}/api/steam/achievements/${activeGame.appId}?steamId=${encodeURIComponent(settings.steamId)}`);
            if (res.ok) {
              const data = await res.json();
              newAchievements = data.achievements || [];
            }
          }
        }

        if (isMounted && newAchievements !== null) {
          // Merge to fix Steam CDN cache desyncs: never revert an unlocked achievement to locked
          const mergeAchievements = (oldAchs: any[], newAchs: any[]) => {
            if (!oldAchs || oldAchs.length === 0) return newAchs;
            return newAchs.map(newAch => {
              const oldAch = oldAchs.find(a => a.name === newAch.name || a.apiname === newAch.apiname);
              if (oldAch && oldAch.unlocked && !newAch.unlocked) {
                return oldAch; 
              }
              return newAch;
            });
          };

          if (activeGame.isAutoDetected) {
            setGlobalActiveGame(prev => {
              if (prev && prev.appId === activeGame.appId) {
                return { ...prev, achievements: mergeAchievements(prev.achievements || [], newAchievements) } as SteamGameData;
              }
              return prev;
            });
          } else {
            setTabs(prev => prev.map(t => {
              if (t.id === activeTab.id) {
                const currentAchs = t.activeSteamGame?.achievements || [];
                return {
                  ...t,
                  activeSteamGame: {
                    ...(t.activeSteamGame?.appId === activeGame.appId ? t.activeSteamGame : {
                      name: activeGame.name,
                      appId: activeGame.appId
                    }),
                    ...(activeGame.headerImage ? { headerImage: activeGame.headerImage } : {}),
                    achievements: mergeAchievements(currentAchs, newAchievements),
                    patchNotes: t.activeSteamGame?.patchNotes || activeGame.patchNotes
                  }
                };
              }
              return t;
            }));
          }
        }
      } catch (err) {
        console.error('Failed to poll Steam achievements:', err);
      }
    };

    const fetchData = async () => {
      try {
        let achievements = activeGame.achievements || [];
        let patchNotes = activeGame.patchNotes || [];

        if ((window as any).electronAPI && (window as any).electronAPI.fetchAchievementsLocally) {
          // Desktop App Local Fetch
          if (settings.steamId) {
            const localAch = await (window as any).electronAPI.fetchAchievementsLocally(activeGame.appId, settings.steamId);
            if (localAch) achievements = localAch;
          }
          const localNews = await (window as any).electronAPI.fetchNewsLocally(activeGame.appId);
          if (localNews && localNews.length > 0) patchNotes = localNews.map((n: any) => n.contents);
        } else {
          // Web Preview Fetch
          const fetchPromises = [];
          let achIndex = -1;
          let newsIndex = -1;
          
          if (settings.steamId) {
            achIndex = fetchPromises.length;
            fetchPromises.push(fetch(`${getApiBaseUrl()}/api/steam/achievements/${activeGame.appId}?steamId=${encodeURIComponent(settings.steamId)}`));
          }
          
          newsIndex = fetchPromises.length;
          fetchPromises.push(fetch(`${getApiBaseUrl()}/api/steam/news/${activeGame.appId}`));
          
          const results = await Promise.all(fetchPromises);
          
          if (achIndex !== -1 && results[achIndex].ok) {
            const data = await results[achIndex].json();
            achievements = data.achievements || [];
          }
          
          if (newsIndex !== -1 && results[newsIndex].ok) {
            const newsData = await results[newsIndex].json();
            patchNotes = newsData.news?.map((n: any) => n.contents) || [];
          }
        }

        if (isMounted) {
          
          if (activeGame.isAutoDetected) {
            setGlobalActiveGame(prev => prev && prev.appId === activeGame.appId ? { ...prev, achievements, patchNotes } as SteamGameData : prev);
          } else {
            setTabs(prev => prev.map(t => {
              if (t.id === activeTab.id) {
                return {
                  ...t,
                  activeSteamGame: {
                    ...(t.activeSteamGame?.appId === activeGame.appId ? t.activeSteamGame : {
                      name: activeGame.name,
                      appId: activeGame.appId
                    }),
                    ...(activeGame.headerImage ? { headerImage: activeGame.headerImage } : {}),
                    achievements,
                    patchNotes
                  }
                };
              }
              return t;
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch Steam data:', err);
      }
    };

    fetchData();
    
    // Dynamically poll for achievements in the background every 15 seconds
    const intervalId = setInterval(() => {
      pollAchievements();
    }, 15000);

    return () => { 
      isMounted = false; 
      clearInterval(intervalId);
    };
  }, [activeGame?.appId, settings.steamId, activeTab?.id]);

  // Handle Sending Message to Server Gemini API
  /** Hide the markers on screen if they're a fight's (they never outlast one turn's worth of play). */
  const hideCombatMarkers = () => {
    const id = activeMarkersId();
    if (id && tabs.some((t) => t.messages.some((m) => m.id === id && m.combat))) (window as any).electronAPI?.hideScreenPointers?.();
  };
  /**
   * "Next turn" (the quest log's Battle plan, or under a combat answer): a fresh screenshot and a short question for
   * whoever is acting now. A normal question; its answer replaces the markers and the battle plan.
   */
  const nextTurnBusy = useRef(false);
  const runNextTurn = async () => {
    const api = (window as any).electronAPI;
    if (nextTurnBusy.current || isLoadingAi || !api?.captureFresh) return;
    nextTurnBusy.current = true;
    try {
      // Always a fresh capture (the open panel slides away for it), never the snapshot from when the panel opened.
      const image: string | null = await api.captureFresh();
      if (image) await handleSendMessage(tr('chat.nextTurnQ'), image);
    } finally {
      nextTurnBusy.current = false;
    }
  };

  const handleSendMessage = async (text: string, imageBase64?: string, audioBase64?: string, preferredModel?: 'pro' | 'flash', quick?: string) => {
    if (!activeTab) return;

    if (!user) {
      syncDiagnostics.addEvent?.('CHAT_NO_USER', 'Attempted to send chat message with no authenticated or guest user', true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quest_diagnostics_event', {
          detail: { type: 'CHAT_NO_USER', details: 'Attempted to send chat message with no authenticated or guest user', isError: true }
        }));
      }
      setAuthModalMessage("You're signed out. Please sign in or continue as guest to ask questions.");
      setIsAuthModalOpen(true);
      return;
    }

    const now = Date.now();
    const userMessage: ChatMessage = {
      id: `msg-${now}`,
      role: 'user',
      text,
      imageUrl: imageBase64,
      audioBase64,
      timestamp: now
    };

    // Optimistically update UI with updated lastActive timestamp
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { 
      ...t, 
      messages: [...t.messages, userMessage],
      lastActive: now 
    } : t));
    setIsLoadingAi(true);
    // A fight's markers last one turn: the next question hides them (its answer brings new ones).
    hideCombatMarkers();

    let token: string | null = null;
    try {
      token = await user.getIdToken();
    } catch (e) {
      token = null;
    }

    if (!token || !token.trim()) {
      try {
        token = typeof user.getIdToken === 'function' ? await user.getIdToken(true) : null;
      } catch (e) {
        token = null;
      }
    }

    if (!token || !token.trim()) {
      setIsLoadingAi(false);
      syncDiagnostics.addEvent?.('CHAT_TOKEN_ERROR', 'Failed to retrieve valid ID token after force refresh retry', true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quest_diagnostics_event', {
          detail: { type: 'CHAT_TOKEN_ERROR', details: 'Failed to retrieve valid ID token after force refresh retry', isError: true }
        }));
      }

      setAuthModalMessage('Your session expired. Please sign in again.');
      setIsAuthModalOpen(true);

      const nowExpired = Date.now();
      const sessionExpiredMessage: ChatMessage = {
        id: `msg-${nowExpired + 1}`,
        role: 'assistant',
        text: 'Your session expired. Please sign in again.',
        timestamp: nowExpired,
        modelUsed: 'Session Expired'
      };

      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, messages: [...t.messages, sessionExpiredMessage], lastActive: nowExpired } : t
      ));
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("Request timed out after 75 seconds.")), 75000);
    // Both models' questions used up today: the limit message, with when they come back (and Premium for free players).
    let limitText = '';
    let guestLimit = false; // a guest at their limit: the sign-in card, not the Premium screen
    let premiumNudge = false; // a free player at their limit: the Premium card in the conversation (never a pop-up)
    const backendUrl = getApiBaseUrl();
    const chatEndpoint = backendUrl ? `${backendUrl}/api/chat` : '/api/chat';

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 
          'Content-Type': 'application/json',
          // Which app is asking (for the daily activity tally); the desktop app's browser identity looks like Chrome.
          'X-QC-App': (window as any).electronAPI ? 'desktop' : 'web',
          'X-QC-Device': deviceId(),
          // Where the player first came from (?from= on the link into the app), for the daily summary's sources.
          ...(appSource() ? { 'X-QC-From': appSource() } : {}),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          question: text,
          history: activeTab.messages,
          imageBase64,
          audioBase64,
          aiMode: settings.aiMode,
          // The model picked next to the send button (Pro or Fast); the server answers with the other one when it's used up.
          answerModel: preferredModel === 'flash' ? 'fast' : 'pro',
          // For the daily reset at the player's midnight.
          timeZone: deviceTimeZone(),
          // A quick question's id (src/utils/quickQuestions.ts): the server adds what it asks for.
          ...(quick ? { quick } : {}),
          isGameRunningLocally: runningOpen,
          // The guide the app found for this game (the server checks it), and the compendium's name, so answers use the
          // same guide as the quest log whatever Steam calls the game.
          guideKey: trackerGameRef.current.guideKey || undefined,
          tabName: activeTab?.name,
          activeGame: activeGame ? {
            name: activeGame.name,
            appId: activeGame.appId,
            genre: activeGame.genre,
            developer: activeGame.developer
          } : null,
          achievements: activeGame?.achievements || [],
          news: activeGame?.patchNotes || [],
          generateBanner: false, // AI banner art is retired
          language: aiLanguageName(settings.language),
          // On-screen markers (Settings): off, the answer doesn't spend tokens on markers nobody would see.
          markers: settings.showPointersOnScreen !== false,
          // Where the player is in this game (confirmed by them, or the AI's last guess). A new compendium for the same
          // game starts from what the player's other compendiums for it already know.
          place: activeTab.place || settings.gameProgress?.[gameProgressKey(activeTab)] || null,
          // Progress memory: what the player has already done in this game, so answers never send them back.
          done: memoryOn ? doneForRequest(settings.gameDone?.[gameProgressKey(activeTab)]) : [],
          // Playthrough memory: choices made, key items and (if the player wants) their Notes. Off: nothing is sent.
          ...(memoryOn ? { playthrough: playthroughForRequest(play, activeTab.notes) || { choices: [], found: [], notes: '' } } : {}),
          // The quest log's current objective (its unticked steps): the answer ticks the ones the question says are done.
          ...(objectiveForRequest(activeTab) ? { objective: objectiveForRequest(activeTab) } : {}),
          // The guide area's ticked entries: the answer only marks guide entries the player hasn't ticked.
          ...(trackerGameRef.current.guideArea ? { guideDone: { slug: trackerGameRef.current.guideArea.slug, ids: [...trackerGameRef.current.guideArea.done].slice(0, 300) } } : {}),
        }),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 401) {
          syncDiagnostics.addEvent?.('CHAT_401', 'Server returned HTTP 401 Unauthorized for chat request', true);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('quest_diagnostics_event', {
              detail: { type: 'CHAT_401', details: 'Server returned HTTP 401 Unauthorized for chat request', isError: true }
            }));
          }

          setAuthModalMessage('Your session expired. Please sign in again.');
          setIsAuthModalOpen(true);

          const nowExpired = Date.now();
          const sessionExpiredMessage: ChatMessage = {
            id: `msg-${nowExpired + 1}`,
            role: 'assistant',
            text: 'Your session expired. Please sign in again.',
            timestamp: nowExpired,
            modelUsed: 'Session Expired'
          };

          setTabs(prev => prev.map(t => 
            t.id === activeTab.id ? { ...t, messages: [...t.messages, sessionExpiredMessage], lastActive: nowExpired } : t
          ));
          return;
        }

        let errorText = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errorText = errData.error || errData.text || errorText;
          if ((res.status === 403 || res.status === 429) && errData.modelUsed === 'Limit Reached') {
            const lim = errData.limit || {};
            if (errData.userData) window.dispatchEvent(new CustomEvent('quest_quota_updated', { detail: errData.userData }));
            const { h, m } = untilReset(Number(lim.resetAt) || Date.now());
            const when = tr('limit.in', { h, m });
            guestLimit = lim.isGuest === true;
            limitText = guestLimit
              ? tr('limit.guest', { pro: lim.signedInPro ?? 2, fast: lim.signedInFlash ?? 5 })
              : lim.isPremium
              ? tr('limit.premium', { when })
              : lim.dailyPro != null
                ? tr('limit.free', { pro: lim.dailyPro, fast: lim.dailyFlash, ppro: lim.premiumPro, pfast: lim.premiumFlash, when })
                : errorText;
            premiumNudge = !lim.isPremium && !guestLimit;
            // When the next questions arrive: "+2 Pro · +5 Fast in 3h 20m".
            const next = topUpLine(balancesOf(errData.userData), tr);
            if (next && limitText) limitText = `${limitText}\n\n${next}`;
          }
        } catch (e) {
          if (res.status === 404) {
             errorText = `HTTP 404 (${backendUrl})`;
          } else if (res.status === 403) {
             errorText = `HTTP 403 (${backendUrl})`;
          } else {
             errorText = `HTTP ${res.status} (Non-JSON response)`;
          }
        }
        
        throw new Error(errorText);
      }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned non-JSON response');
      }

      const data = await res.json();

      if (data.userData && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quest_quota_updated', { detail: data.userData }));
      }
      // The picked model was used up, so the other one answered: the toggle follows and says so.
      if (data.switched && data.answeredWith) {
        window.dispatchEvent(new CustomEvent('qc-answer-model-switched', { detail: { to: data.answeredWith } }));
      }

      let finalAiText = data.text;
      if (!finalAiText || finalAiText.trim().length === 0) {
        finalAiText = '⚠️ No response generated from the Compendium. Please try rephrasing your inquiry.';
      }

      const nowAi = Date.now();
      const aiMessage: ChatMessage = {
        id: `msg-${nowAi + 1}`,
        role: 'assistant',
        text: finalAiText,
        modelUsed: data.modelUsed || 'Gemini 3.8 Flash',
        bannerImageUrl: data.bannerImageUrl,
        // A guest's last question today: the sign-in card shows under this answer.
        ...(data.signInNudge === true ? { signInNudge: true } : {}),
        ...(Array.isArray(data.points) && data.points.length ? { points: data.points } : {}),
        ...(typeof data.title === 'string' && data.title.trim() ? { title: data.title.trim().slice(0, 60) } : {}),
        // A fight on screen: the steps are the battle plan.
        ...(data.combat === true ? { combat: true } : {}),
        // No fight on the screenshot: a fight is over (its markers go, the quest log shows normal steps).
        ...(data.noFight === true ? { noFight: true } : {}),
        ...(typeof data.fight === 'string' && data.fight.trim() ? { fight: data.fight.trim().slice(0, 120) } : {}),
        // The quest log's steps: the 1-4 things to keep in front of the player (the tracker's "From your last answer").
        ...(Array.isArray(data.steps) && data.steps.length
          ? {
              steps: data.steps
                .filter((x: any) => x && typeof x.text === 'string' && x.text.trim())
                .slice(0, 4)
                .map((x: any) => ({
                  kind: ['step', 'choice', 'warning'].includes(x.kind) ? x.kind : 'step', text: String(x.text).slice(0, 200),
                  ...(typeof x.label === 'string' && x.label.trim() ? { label: String(x.label).slice(0, 60) } : {}),
                  ...(typeof x.where === 'string' && x.where.trim() ? { where: String(x.where).slice(0, 120) } : {}),
                  ...(typeof x.detail === 'string' && x.detail.trim() ? { detail: String(x.detail).slice(0, 500) } : {}),
                })),
            }
          : {}),
        ...(typeof data.factsSaved === 'number' && data.factsSaved > 0 ? { factsSaved: data.factsSaved } : {}),
        ...(typeof data.qtype === 'string' ? { qtype: data.qtype } : {}),
        ...(Array.isArray(data.guideRefs) && data.guideRefs.length
          ? { guideRefs: data.guideRefs.filter((r: any) => r && typeof r.slug === 'string' && typeof r.name === 'string').slice(0, 4).map((r: any) => ({ key: String(r.key || ''), slug: r.slug, area: String(r.area || ''), ...(typeof r.entry === 'string' ? { entry: r.entry } : {}), name: r.name, ...(typeof r.kind === 'string' ? { kind: r.kind } : {}) })) }
          : {}),
        ...(Array.isArray(data.correctionIds) && data.correctionIds.length ? { correctionIds: data.correctionIds.filter((x: unknown) => typeof x === 'string').slice(0, 5) } : {}),
        ...(data.place && typeof data.place.name === 'string'
          ? {
              place: {
                name: String(data.place.name),
                sure: data.place.sure === true,
                options: Array.isArray(data.place.options) ? data.place.options.map(String).slice(0, 3) : [],
                ...(typeof data.place.story === 'string' && data.place.story
                  ? {
                      story: String(data.place.story),
                      storySure: data.place.storySure === true,
                      storyOptions: Array.isArray(data.place.storyOptions) ? data.place.storyOptions.map(String).slice(0, 3) : [],
                    }
                  : {}),
              },
            }
          : {}),
        ...(() => {
          // Nearby items, minus anything the answer already points at (no duplicate markers).
          const pointed = new Set((Array.isArray(data.points) ? data.points : []).map((p: any) => String(p.label).trim().toLowerCase()));
          const nearby = (Array.isArray(data.nearby) ? data.nearby : [])
            .filter((n: any) => !pointed.has(String(n.label).trim().toLowerCase()))
            .map((n: any) => ({ label: String(n.label), hint: String(n.hint || ''), onMap: n.onMap === true, found: false }));
          return nearby.length ? { nearby } : {};
        })(),
        timestamp: nowAi
      };

      // Desktop: show the AI's pointers right on top of the game.
      if (aiMessage.points && settings.showPointersOnScreen !== false) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        // The screenshot this answer is about is the reference the markers track against.
        (window as any).electronAPI?.showScreenPointers?.(withGuideNote(aiMessage.points), accent, {
          refImage: imageBase64,
          sessionId: aiMessage.id,
          hidden: [],
          watchNearby: !!aiMessage.nearby?.length,
          combat: !!aiMessage.combat,
        });
      } else if (aiMessage.noFight) {
        // The fight is over and this answer marks nothing: the old fight's markers go.
        hideCombatMarkers();
      }
      // Precision pass: zoom in on each marked spot so markers land on the exact object (free, rate-limited).
      if (aiMessage.points?.length && imageBase64 && settings.showPointersOnScreen !== false) {
        refineMarkers(aiMessage.id, imageBase64, aiMessage.points, activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name || '', token);
      }

      const readArea: string = data.placeRead && typeof data.placeRead.area === 'string' ? data.placeRead.area.trim().slice(0, 80) : '';
      const readStory: string = readArea && typeof data.placeRead.story === 'string' ? data.placeRead.story.trim().slice(0, 100) : '';
      const placeBefore = activeTab.place || settings.gameProgress?.[gameProgressKey(activeTab)];
      if (readArea) {
        const moved = placeAfterMove(placeBefore, readArea, readStory, true);
        rememberGameProgress(activeTab, moved);
        noteAreaChange(activeTab, placeBefore?.name, readArea);
      }
      // Progress memory: a fight that just ended (a combat answer, then a screenshot with no fight), and anything the
      // answer says is finished.
      const fightOver = endedFight(activeTab.messages, aiMessage);
      rememberDone(activeTab, [
        ...(fightOver ? [{ text: fightOver, kind: 'fight' as DoneKind }] : []),
        ...(Array.isArray(data.done) ? data.done.filter((x: unknown) => typeof x === 'string').slice(0, 3).map((text: string) => ({ text, kind: 'quest' as DoneKind })) : []),
      ]);
      // Playthrough memory: a choice the player made or a key item they have, as the answer noted it.
      rememberPlay((Array.isArray(data.remember) ? data.remember : [])
        .filter((x: any) => x && (x.kind === 'choice' || x.kind === 'found') && typeof x.text === 'string')
        .slice(0, 3)
        .map((x: any) => ({ kind: x.kind as PlayKind, text: x.text, source: 'answer' as const })));

      setTabs(prev => {
        const nextTabs = prev.map(t => {
          if (t.id !== activeTab.id) return t;
          // Remember where the player is: a sure answer (a sign on screen, or the player said so) counts as confirmed;
          // an unsure guess never replaces a place the player confirmed.
          // Only the player confirms a place or story point (a tap or saying it). The AI's guesses, sure or not, are kept
          // as unconfirmed and never overwrite what the player confirmed.
          let place = t.place || settings.gameProgress?.[gameProgressKey(t)];
          const g = aiMessage.place;
          // Same place with more or less detail ("South Figaro" vs "South Figaro, Relic Shop") counts as the same.
          if (g && !place?.confirmed) place = { ...place, name: g.name, confirmed: false };
          // The player moved on (the answer is about a different place than the confirmed one): switch to the new place,
          // unconfirmed, so "Known here" follows them and new facts aren't filed under the old place. The story point
          // usually carries over.
          else if (g && place?.confirmed && !samePlace(g.name, place.name)) place = { ...place, name: g.name, confirmed: false };
          if (g?.story && place && !place.storyConfirmed) place = { ...place, story: g.story, storyConfirmed: false };
          // On-screen place wins: a place name read on screen that names a guide area is where the player is, confirmed
          // (as Locate me does), whatever was stored.
          if (readArea) place = placeAfterMove(place, readArea, readStory, true);
          // Ticks from the conversation: steps of the current objective the question said are done (Undo on the log).
          const objId = t.questLog?.now;
          const ticked: number[] = objId && Array.isArray(data.objectiveDone) ? data.objectiveDone.filter((n: unknown) => Number.isInteger(n)) : [];
          const msgs = ticked.length
            ? t.messages.map((m) => (m.id === objId ? { ...m, doneSteps: [...new Set([...(m.doneSteps || []), ...ticked])].sort((a, b) => a - b) } : m))
            : t.messages;
          return { ...t, messages: [...msgs, aiMessage], lastActive: nowAi, ...(place ? { place } : {}) };
        });
        return nextTabs;
      });
      // The question said steps of the objective are done: they're ticked, and the log says so with Undo.
      {
        const objId = activeTab.questLog?.now;
        const obj = objId ? activeTab.messages.find((m) => m.id === objId) : undefined;
        const ticked: number[] = obj && Array.isArray(data.objectiveDone) ? data.objectiveDone.filter((n: unknown) => Number.isInteger(n) && !!obj.steps?.[n as number]) : [];
        if (obj && ticked.length) showCleared({ ids: ticked.map((i) => `s:${obj.id}:${i}`), text: ticked.map((i) => obj.steps![i].label || obj.steps![i].text).join(', '), from: 'question' });
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      let errorMsg = err?.message || 'Network error';

      if (errorMsg === 'Your session expired. Please sign in again.' || errorMsg.includes('401') || errorMsg.includes('Unauthorized') || err?.status === 401) {
        syncDiagnostics.addEvent?.('CHAT_401', 'Handled 401 Unauthorized in chat error handler', true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('quest_diagnostics_event', {
            detail: { type: 'CHAT_401', details: 'Handled 401 Unauthorized in chat error handler', isError: true }
          }));
        }
        setAuthModalMessage('Your session expired. Please sign in again.');
        setIsAuthModalOpen(true);
        const nowExpired = Date.now();
        const sessionExpiredMessage: ChatMessage = {
          id: `msg-${nowExpired + 1}`,
          role: 'assistant',
          text: 'Your session expired. Please sign in again.',
          timestamp: nowExpired,
          modelUsed: 'Session Expired'
        };
        setTabs(prev => prev.map(t => 
          t.id === activeTab.id ? { ...t, messages: [...t.messages, sessionExpiredMessage], lastActive: nowExpired } : t
        ));
        return;
      }

      const offline = errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('fetch failed');
      if (offline) errorMsg = `${errorMsg} (${backendUrl || DEFAULT_CLOUD_URL})`;
      let isLimitReached = !!limitText || errorMsg.includes('Daily limit reached') || errorMsg.includes('Upgrade to Premium');

      const nowCatch = Date.now();
      const errorMessage: ChatMessage = {
        id: `msg-${nowCatch + 1}`,
        role: 'assistant',
        text: isLimitReached 
          ? limitText || `**${tr('err.limitTitle')}**\n\n${errorMsg}`
          : `${tr(offline ? 'err.offline' : 'err.noAnswer')}\n\n*${tr('err.details', { d: errorMsg })}*`,
        timestamp: nowCatch,
        modelUsed: isLimitReached ? 'Limit Reached' : 'Offline Fallback',
        ...(isLimitReached && guestLimit ? { signInNudge: true } : {}),
        ...(isLimitReached && premiumNudge ? { premiumNudge: true } : {}),
      };

      setTabs(prev => {
        const nextTabs = prev.map(t => 
          t.id === activeTab.id ? { ...t, messages: [...t.messages, errorMessage], lastActive: nowCatch } : t
        );
        return nextTabs;
      });
    } finally {
      setIsLoadingAi(false);
    }
  };

  // Tab Handlers
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    if (isBrowserMode) setIsBrowserMode(false);
  };


  const handleStartCreateTab = () => {
    setRenameModalMode('create');
    setRenameModalInitialValue('New Compendium');
    setIsRenameModalOpen(true);
  };

  const handleStartRenameTab = (tabId: string, currentName: string) => {
    setRenameModalMode('rename');
    setRenameModalTabId(tabId);
    setRenameModalInitialValue(currentName);
    setIsRenameModalOpen(true);
  };

  const handleRenameModalSave = (newName: string) => {
    if (newName.trim()) {
      if (renameModalMode === 'create') {
        handleCreateTab(newName.trim());
      } else if (renameModalMode === 'rename' && renameModalTabId) {
        handleRenameTab(renameModalTabId, newName.trim());
      }
    }
    setIsRenameModalOpen(false);
  };

  const handleCreateTab = (name: string, steamGame?: SteamGameData) => {
    const newId = `tab-${Date.now()}`;
    const newTab: GameTab = {
      id: newId,
      name,
      activeSteamGame: steamGame || null,
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          text: translate('chat.newSession'),
          timestamp: Date.now(),
          modelUsed: 'Gemini 3.8 Flash'
        }
      ],
      notes: '',
      createdAt: Date.now(),
      lastActive: Date.now()
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleRenameTab = (tabId: string, newName: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, name: newName } : t));
  };

  const handleDeleteTab = (tabId: string) => {
    const remaining = tabs.filter(t => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining.length > 0 ? remaining[0].id : '');
    }
    // A game space (flag on): deleted and tombstoned by the spaces store; the compendium tabs aren't touched.
    if (spacesOn && spacesRef.current) return;

    // Record a timestamped deletion. Sync shares it with every device so the tab is not restored (see tabMerge.ts).
    recordTombstone(tabId);

    // Immediately persist remaining tabs locally
    try {
      if (user?.isGuest) {
        localStorage.setItem('quest_guest_tabs', JSON.stringify(remaining));
      } else if (user && !user.isGuest) {
        localStorage.setItem(`quest_compendium_tabs_${user.uid}`, JSON.stringify(remaining));
        localStorage.setItem('quest_compendium_tabs', JSON.stringify(remaining));
      } else {
        localStorage.setItem('quest_compendium_tabs', JSON.stringify(remaining));
      }
    } catch {}

    // Trigger immediate flush of tab deletion to cloud
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('quest_flush_sync'));
    }
  };

  // Playthrough Notes Handlers
  const handleUpdateNotes = (notes: string) => {
    if (!activeTab) return;
    const now = Date.now();
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, notes, lastActive: now } : t));
  };

  const handleAppendToNotes = (text: string) => {
    if (!activeTab) return;
    const cleanText = text.replace(/<[^>]*>?/gm, '').slice(0, 300);
    const addition = `<p><strong>Insight:</strong> ${cleanText}</p>`;
    const updated = (activeTab.notes || '') + addition;
    handleUpdateNotes(updated);
    setIsNotesOpen(true);
  };

  const handleUpdateQuests = (quests: any[]) => {
    if (!activeTab) return;
    const now = Date.now();
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, personalQuests: quests, lastActive: now } : t));
  };

  // Game Switcher Selection
  const handleSelectGame = (game: SteamGameData) => {
    const gameWithFlag = { ...game, isAutoDetected: false };
    const now = Date.now();
    if (activeTab) {
      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, name: gameWithFlag.name, activeSteamGame: gameWithFlag, lastActive: now } : t
      ));
    } else {
      handleCreateTab(gameWithFlag.name, gameWithFlag);
    }
  };

  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI;
  // A local dev server shows the update bar and "What's new" with sample notes at ?previewUpdate (for screenshots).
  const previewUpdate = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]previewUpdate/.test(location.search);
  // Tuck the panel away without the shortcut: exactly what the shortcut does (focus back to the game, quest log as is).
  const tuckAway = () => (window as any).electronAPI?.hidePanel?.();
  const tuckSide: 'left' | 'right' = String(settings.dockPosition).endsWith('left') ? 'left' : 'right';

  // The compact view: a small resting state (where you are, the current objective, the question box) over the game.
  const runningKey = globalActiveGame ? String(globalActiveGame.appId || globalActiveGame.name || '') : '';
  useEffect(() => setViewNow(null), [runningKey]);
  // A game starting (or already running when the app opens) brings its compendium up, once: after that the player's
  // own choice of compendium stands until the game closes.
  const autoOpenedFor = useRef('');
  useEffect(() => {
    if (!runningKey) { autoOpenedFor.current = ''; return; }
    if (isInitializing || !tabs.length || autoOpenedFor.current === runningKey) return;
    autoOpenedFor.current = runningKey;
    if (runningTab && runningTab.id !== activeTab?.id) setActiveTabId(runningTab.id);
  }, [runningKey, isInitializing, tabs.length, runningTab?.id]);
  const view = viewNow ?? (runningKey ? viewByGame[runningKey] ?? 'compact' : 'full');
  const compact = isDesktop && !!activeTab && !isBrowserMode && view === 'compact';
  // The compact card, or in the bottom corners the ribbon (two rows: it covers the least of the game there).
  const compactLayout: 'card' | 'ribbon' = String(settings.dockPosition || '').startsWith('bottom') ? 'ribbon' : 'card';
  // The player chose a view (Ctrl+Shift+F, the ⋯ menu, the compact card): remembered for the running game.
  const chooseView = (v: 'compact' | 'full') => {
    setViewNow(v);
    if (!runningKey) return;
    setViewByGame((prev) => {
      const next = { ...prev, [runningKey]: v };
      try {
        localStorage.setItem('qc_view_by_game', JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  // The compact card's quest log fold: the docked log's open state (the same toggle), with its window room.
  const compactFold = compact && questLogAttached && questLogVisible && !!logView?.now;
  // Its room: Next's heading and steps (two lines each), and Watch out.
  const compactFoldHeight = Math.min(220, 18 + (logView?.next.length ? 18 + logView.next.length * 40 : 0) + (logView?.watch ? 58 : 0));
  useEffect(() => {
    (window as any).electronAPI?.setCompact?.(compact, compactLayout, compactFold ? compactFoldHeight : 0);
    // The side panels close (the compact view has its own size).
    if (compact) {
      setIsAchDrawerOpen(false);
    }
  }, [compact, compactLayout, compactFold, compactFoldHeight]);
  // A question asked from anywhere (the screenshot shortcut too) opens the full view, where its answer appears.
  useEffect(() => {
    if (isLoadingAi && compact) setViewNow('full');
  }, [isLoadingAi, compact]);
  // Ctrl+Shift+F: compact view / full view.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== 'KeyF' || e.repeat) return;
      e.preventDefault();
      chooseView(compact ? 'full' : 'compact');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, compact, runningKey]);

  // Docking Layout Container classes
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.isTrusted || e.defaultPrevented || e.isComposing) return;
      const overlay = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0, [role="dialog"], [aria-modal="true"]'))
        .some((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
      if (overlay) return;
      tuckAway();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop]);

  // The tuck-away tab, built into the frame: a slim strip down the docked edge (the screen edge), its own column so
  // nothing of the content is under it, with the pull-tab in the middle. Desktop, docked only.
  const tuckStrip = (edge: 'left' | 'right') =>
    isDesktop && settings.dockPosition !== 'undocked' && tuckSide === edge ? (
      <div className={`qc-tuck-strip flex-shrink-0 w-3.5 h-full flex items-center justify-center bg-black/30 ${edge === 'left' ? 'border-r' : 'border-l'} border-white/[0.06]`}>
        <button
          type="button"
          onClick={tuckAway}
          title={tr('header.tuckHandle')}
          aria-label={tr('header.tuckHandle')}
          className="w-full h-16 flex items-center justify-center cursor-pointer text-[var(--accent-color)] bg-[var(--accent-dim)] border-y border-[var(--accent-border)] hover:bg-[var(--accent-color)] hover:text-black transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <svg viewBox="0 0 6 10" width="6" height="10" shape-rendering="crispEdges" aria-hidden="true" className={edge === 'left' ? 'scale-x-[-1]' : ''}>
            <path fill="currentColor" d="M0 0h2v2h2v2h2v2H4v2H2v2H0V8h2V6h2V4H2V2H0z" />
          </svg>
        </button>
      </div>
    ) : null;

  // The docked quest log (owner, Oct 30 2026): a column inside the panel, on its inner side, out while the log is
  // (Ctrl+Shift+L, the controller's View, the bookmark); the compact view shows it on the card instead.
  const logSide: 'left' | 'right' = settings.dockPosition !== 'undocked' && tuckSide === 'left' ? 'right' : 'left';
  const dockedLogOpen = isDesktop && !compact && questLogAttached && questLogVisible && !!logView;
  const logKeys = formatShortcut(settings.questLogShortcut || 'CmdOrCtrl+Shift+L');
  const logColumn = (side: 'left' | 'right') =>
    dockedLogOpen && logView && logSide === side ? (
      <div className={`w-[300px] flex-shrink-0 h-full min-h-0 ${side === 'left' ? 'border-r' : 'border-l'} border-white/[0.1]`} style={{ WebkitAppRegion: 'no-drag' } as any}>
        <QuestLog
          view={logView}
          sel={logSel}
          cleared={logCleared ? { id: logCleared.ids[0], text: logCleared.text, from: logCleared.from } : null}
          keysLabel={logKeys}
          onTick={tickLog}
          onUndo={undoLog}
          onSelect={setLogSel}
          onHideWatch={hideWatch}
          onClose={() => { toggleQuestLog(); setTimeout(() => document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus(), 50); }}
          onPopOut={() => (window as any).electronAPI?.trackerAttach?.(false)}
          onAsk={(text) => {
            if (text) window.dispatchEvent(new CustomEvent('qc-ask', { detail: { text } }));
            else document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus();
          }}
          onOpenPin={(id) => window.dispatchEvent(new CustomEvent('qc-scroll-to-msg', { detail: { id } }))}
          onUnpin={togglePin}
          onClearNow={() => patchLog(() => ({ now: undefined }))}
          onLoadSteps={() => trackerEventRef.current({ type: 'load-steps' })}
          onDismissOffer={() => trackerEventRef.current({ type: 'dismiss-offer' })}
          onGotoArea={moveToArea}
          onLocate={runLocate}
          onConfirmPlace={() => { const n = logView.place?.name; if (n) trackerEventRef.current({ type: 'confirm-place', name: n }); }}
          onOpenEntry={(id) => trackerEventRef.current({ type: 'open-entry', item: id })}
        />
      </div>
    ) : null;

  // The window's width: the panel, plus the achievements drawer and the docked quest log when they're open.
  useEffect(() => {
    if ((window as any).electronAPI?.resizeWindow) {
      let totalWidth = 550;
      if (isAchDrawerOpen) totalWidth += achDrawerWidth;
      if (dockedLogOpen) totalWidth += 300;
      (window as any).electronAPI.resizeWindow(totalWidth);
    }
  }, [isAchDrawerOpen, achDrawerWidth, dockedLogOpen]);
  // The log opened with the panel focused (Ctrl+Shift+L, View, the bookmark): the keyboard goes to Now.
  const wasLogOpen = useRef(false);
  useEffect(() => {
    if (dockedLogOpen && !wasLogOpen.current && document.hasFocus()) {
      setTimeout(() => document.querySelector<HTMLElement>('[data-qc-log] [data-qc-log-now]:not([disabled])')?.focus({ preventScroll: true }), 80);
    }
    wasLogOpen.current = dockedLogOpen;
  }, [dockedLogOpen]);

  const getDockClasses = (dock: DockPosition) => {
    if (!isDesktop) {
      return 'w-full h-full rounded-none border-none shadow-none';
    }
    switch (dock) {
      case 'undocked':
        // When floating freely in desktop mode, make it look like a nice app window with borders and rounded corners.
        return 'w-[98%] h-[98%] rounded-xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)] mx-auto my-auto';
      default:
        // Snug fit for all docked corners (no rounded corners, no space)
        return 'w-full h-full rounded-none border-none shadow-[0_0_40px_rgba(0,0,0,0.8)]';
    }
  };

  return (
    <Suspense fallback={<div className="w-screen h-screen bg-[#0c0d14]" />}>
    <div className={`w-screen h-screen flex overflow-clip ${isDesktop ? 'bg-transparent' : 'bg-[#0c0d14]'}`}>
      {/* Background CRT scan line ambient glow */}
      <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-transparent pointer-events-none" />

      {/* The hidden docked panel shows as a book spine on the screen edge (electron/spine.cjs), not as part of this window. */}

      {/* Main App Window Frame */}
      <div 
        className={`flex flex-row min-h-0 min-w-0 overflow-clip backdrop-blur-2xl relative transition-all ${getDockClasses(settings.dockPosition)}`}
        style={{
          backgroundColor: `rgba(14, 14, 18, ${settings.windowOpacity / 100})`,
          boxShadow: '0 0 35px var(--accent-glow)'
        }}
      >
        {tuckStrip('left')}
        {logColumn('left')}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
        {/* "Mouse unlocked": the panel opened with the show/hide shortcut (the first 10 times) */}
        {mouseToast && (
          <div role="status" aria-live="polite" className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-[80] max-w-[90%] animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="qc-px-frame px-3.5 py-2 rounded-lg bg-[#16101f]/95 border border-[var(--accent-border)] shadow-[0_0_18px_var(--accent-glow)] text-[12.5px] font-semibold text-white text-center">
              {mouseToast}
            </div>
          </div>
        )}

        {/* Header Bar (not in the compact view) */}
        {!compact && <HeaderBar
          userData={userData}
          tabs={tabs}
          activeTabId={activeTabId}
          activeGame={activeGame}
          isGameRunningLocally={globalActiveGame !== null}
          detection={detection}
          chosenGame={activeTab?.guideKey ? { game: collection?.games.find((g) => g.key === activeTab.guideKey)?.game || activeTab.guideKey, onChange: () => chooseCollectionGame(activeTab.id, undefined) } : undefined}
          onSelectTab={handleSelectTab}
          onStartCreateTab={spacesOn && spaces ? () => setIsGameSearchOpen(true) : handleStartCreateTab}
          onStartRenameTab={spacesOn && spaces ? undefined : handleStartRenameTab}
          onDeleteTab={handleDeleteTab}
          onOpenGuides={() => setIsBrowserMode(true)}
          onOpenNotes={() => setIsNotesOpen(true)}
          onOpenQuests={() => setIsQuestsOpen(true)}
          onToggleAchDrawer={() => setIsAchDrawerOpen(!isAchDrawerOpen)}
          onOpenFeedback={() => setIsFeedbackOpen(true)}
          onOpenPaywall={() => setIsPaywallOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onSignIn={user?.isGuest ? openSignIn : undefined}
          soundEnabled={settings.soundEnabled}
          isDocked={settings.dockPosition !== 'undocked'}
          onToggleDock={() => {
            const newPos = settings.dockPosition === 'undocked' ? 'top-right' : 'undocked';
            setSettings(s => ({ ...s, dockPosition: newPos }));
            if ((window as any).electronAPI?.setDockPosition) {
              (window as any).electronAPI.setDockPosition(newPos);
            }
          }}
          onToggleQuestLog={isDesktop ? toggleQuestLog : undefined}
          questLogKeys={formatShortcut(settings.questLogShortcut || 'CmdOrCtrl+Shift+L')}
          onTuckAway={isDesktop ? tuckAway : undefined}
          tuckSide={tuckSide}
          questLogVisible={questLogVisible}
          questLogReady={!!trackerPayload}
          theme={settings.theme}
          onSync={syncDiagnostics?.triggerSyncNow}
          onCompact={isDesktop && activeTab ? () => chooseView('compact') : undefined}
          playthroughs={playthroughMenu}
          runningTabId={spacesOn && spaces ? runningTab?.id : undefined}
        />}
        {/* The tucked-in quest log's bookmark is its own window just outside the panel's edge, which keyboard focus
            can't reach: this invisible stop sits under it on the panel's inner edge. Focused (Tab, or the controller's
            d-pad toward the edge), it rings the bookmark; Enter, Space or A slides the log out. */}
        {isDesktop && questLogTucked && !isBrowserMode && (
          <button
            type="button"
            onClick={toggleQuestLog}
            onFocus={() => (window as any).electronAPI?.trackerKey?.('bookmark-focus')}
            onBlur={() => (window as any).electronAPI?.trackerKey?.('bookmark-blur')}
            aria-label={`${tr('tracker.slideOut')} (${formatShortcut(settings.questLogShortcut || 'CmdOrCtrl+Shift+L')})`}
            className={`absolute top-2 ${tuckSide === 'right' ? 'left-0' : 'right-0'} z-[90] w-1 h-3.5 opacity-0 outline-none`}
            style={{ WebkitAppRegion: 'no-drag' } as any}
          />
        )}
        {/* With one space per game (flag on): the game's full name on its own line (or "Which game is this?"), the
            detection line only when it has something to do, and the one-time migration notice. */}
        {!compact && (spacesOn && spaces ? (
          <>
            {activeTab && (
              <GameLine
                name={activeTab.name}
                running={!!detection.running && detection.open}
                playthrough={activeTab.playthrough}
                prompt={activeTab.unknownGame ? (
                  <WhichGamePrompt
                    key={activeTab.id}
                    spaces={spaces}
                    spaceId={activeTab.id}
                    catalog={spacesCatalog}
                    soundEnabled={settings.soundEnabled}
                    onAssign={(spaceId, game) => {
                      setSpaces((cur) => (cur ? assignGame(cur, spaceId, game) : cur));
                      setActiveTabId(game.id);
                    }}
                    onKeepOther={(spaceId) => setSpaces((cur) => (cur ? { ...cur, games: cur.games.map((g) => (g.id === spaceId ? { ...g, kind: 'other' } : g)) } : cur))}
                  />
                ) : undefined}
              />
            )}
            {((detection.running && (!detection.open || detection.choose)) || (!detection.running && detection.confirm)) && <DetectionLine d={detection} soundEnabled={settings.soundEnabled} />}
            <MigrationNotice
              spaces={spaces}
              soundEnabled={settings.soundEnabled}
              onDismiss={() => setSpaces((cur) => (cur ? { ...cur, notice: undefined } : cur))}
              onKeepSeparate={(gameId) => setSpaces((cur) => (cur ? splitMerged(cur, gameId) : cur))}
            />
          </>
        ) : <DetectionLine d={detection} soundEnabled={settings.soundEnabled} />)}
        {/* Updates (desktop), under the header: "Version X is ready" and, after one installs, a one-time "What's new". A dev server shows
            both with sample notes at ?previewUpdate (for screenshots). */}
        {(isDesktop || previewUpdate) && (
          <AppUpdates
            compact={compact}
            preview={previewUpdate
              ? { ready: '0.5.7', ...(/whatsnew/.test(location.search) ? { whatsNew: { v: '0.5.6', text: 'a cleaner quest log with short objectives and a highlight on the next one; tick and move between objectives without your mouse; load a guide’s steps for your current quest' } } : {}) }
              : undefined}
          />
        )}

        {/* Main Body: Central Chat/Browser + Right Achievements Drawer */}
        {/* overflow-clip, not overflow-hidden: a clipped box isn't scrollable, so focusing a field can't shift the
            layout (the closed side panels are wider and taller than the window). Unlike overflow-hidden it doesn't
            stop a flex item growing to its content, hence min-h-0 / min-w-0 here and on the panel and main (without
            them a long conversation pushed the question box below the window). */}
        <div className="flex-1 min-h-0 min-w-0 flex overflow-clip relative">
          {/* Central Workspace: Chat OR Browser */}
          <main className="qc-scanlines flex-1 min-h-0 min-w-0 flex flex-col overflow-clip relative">
            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
                place={activeTab?.place?.name}
              />
            ) : tabs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#07070b] crt-grid p-4 sm:p-6 overflow-y-auto">
                 <div className="w-full max-w-lg flex flex-col items-center gap-5 text-center animate-in fade-in zoom-in-95 duration-200">
                   {/* Language: changes the interface and the language the AI answers in */}
                   <label className="self-end flex items-center gap-2 text-[11px] text-zinc-400">
                     <Globe className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                     <span className="sr-only">{tr('welcome.language')}</span>
                     <select
                       value={settings.language ?? 'en'}
                       onChange={(e) => { const language = e.target.value as AppSettings['language']; setSettings((s) => ({ ...s, language })); }}
                       className="bg-[#13141d] border border-white/15 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none focus:border-[var(--accent-border)] cursor-pointer"
                     >
                       {LOCALES.map((l) => (
                         <option key={l.id} value={l.id}>{l.label}</option>
                       ))}
                     </select>
                   </label>
                   {/* Welcome art */}
                   <img
                     src={pixelSceneUrl}
                     alt={tr('welcome.sceneAlt')}
                     className="qc-lofi-only w-full max-w-[384px] h-auto border-2 border-[var(--accent-border)] shadow-[6px_6px_0_rgba(0,0,0,0.6)]"
                     style={{ imageRendering: 'pixelated', aspectRatio: '8 / 5' }}
                   />
                   <div className="qc-classic-only relative p-3 rounded-2xl bg-[var(--accent-dim)] border border-[var(--accent-border)] shadow-[0_0_20px_var(--accent-glow)]">
                     <BookOpen className="w-8 h-8 text-[var(--accent-color)]" />
                   </div>

                   <div className="space-y-2">
                     <h2 className="text-2xl font-fantasy font-bold text-white tracking-wide">{tr('welcome.title')}</h2>
                     <p className="text-xs sm:text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
                       {tr('welcome.body')}
                     </p>
                   </div>

                   {/* Phones: no game screen to capture here, so ask about any game, or browse the guides. */}
                   {isPhone() && (
                     <div className="w-full grid grid-cols-1 gap-2">
                       <button
                         onClick={() => setIsGameSearchOpen(true)}
                         className="qc-px-bevel w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--accent-color)] hover:brightness-110 text-[#16101f] font-bold text-sm transition cursor-pointer"
                       >
                         <Search className="w-4 h-4" />
                         {tr('welcome.askAnyGame')}
                       </button>
                       <a
                         href={`https://questcompendium.com/${(settings.language ?? 'en') === 'en' ? '' : `${settings.language}/`}guides/`}
                         className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/15 hover:border-[var(--accent-border)] text-zinc-200 font-semibold text-sm transition"
                       >
                         <BookOpen className="w-4 h-4 text-[var(--accent-color)]" />
                         {tr('welcome.browseGuides')}
                       </a>
                     </div>
                   )}

                   {/* The game running on Steam right now, one click to start */}
                   {globalActiveGame && (
                     <div className="qc-px-frame w-full flex items-center gap-3 p-3 rounded-2xl bg-[#11121a] border border-[var(--accent-border)] text-left">
                       <RunningGameArt appId={globalActiveGame.appId} name={globalActiveGame.name} />
                       <div className="flex-1 min-w-0">
                         <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-emerald-400">
                           <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                           {tr('welcome.running')}
                         </div>
                         <div className="font-fantasy font-bold text-base text-white truncate">{globalActiveGame.name}</div>
                       </div>
                       <button
                         onClick={() => handleCreateTab(globalActiveGame.name, { ...globalActiveGame, isAutoDetected: false })}
                         className="qc-px-bevel flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--accent-color)] hover:brightness-110 text-[#16101f] font-bold text-xs transition cursor-pointer"
                       >
                         <Plus className="w-3.5 h-3.5" />
                         {tr('welcome.start')}
                       </button>
                     </div>
                   )}

                   {/* Pick any game */}
                   <div className="w-full space-y-2.5">
                     <div className="flex items-center gap-3 text-[10px] font-mono uppercase text-zinc-500">
                       <span className="flex-1 h-px bg-white/[0.08]" />
                       {globalActiveGame ? tr('welcome.orPick') : tr('welcome.pick')}
                       <span className="flex-1 h-px bg-white/[0.08]" />
                     </div>
                     <button
                       onClick={() => setIsGameSearchOpen(true)}
                       className="w-full h-11 flex items-center gap-2.5 px-3.5 rounded-xl bg-[#13141d] border border-white/15 hover:border-[var(--accent-border)] text-left text-sm text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                     >
                       <Search className="w-4 h-4 text-zinc-500" />
                       {tr('welcome.search')}
                     </button>
                     <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                       {POPULAR_STEAM_GAMES.slice(0, 4).map((game) => (
                         <button
                           key={game.appId}
                           onClick={() => handleCreateTab(game.name, game)}
                           className="px-2 py-2.5 rounded-xl bg-white/[0.03] hover:bg-[var(--accent-dim)] border border-white/[0.08] hover:border-[var(--accent-border)] text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer truncate"
                         >
                           {game.name}
                         </button>
                       ))}
                     </div>
                     <button
                       onClick={() => handleStartCreateTab()}
                       className="text-[11px] text-zinc-500 hover:text-[var(--accent-color)] underline-offset-2 hover:underline cursor-pointer"
                     >
                       {tr('welcome.blank')}
                     </button>
                   </div>

                   {/* The three things worth knowing up front */}
                   <div className={`w-full grid grid-cols-1 sm:grid-cols-3 gap-2 text-left ${isPhone() ? 'hidden' : ''}`}>
                     {[
                       isDesktop
                         ? { icon: Camera, title: tr('welcome.tipShot'), text: tr('welcome.tipShotText', { keys: prettyShortcut(settings.autoScreenshotShortcut) }) }
                         : { icon: Camera, title: tr('welcome.tipPaste'), text: tr('welcome.tipPasteText') },
                       { icon: Mic, title: tr('welcome.tipVoice'), text: isDesktop ? tr('welcome.tipVoiceDesktop', { keys: prettyShortcut(settings.voiceInputShortcut) }) : tr('welcome.tipVoiceWeb') },
                       isDesktop
                         ? { icon: Moon, title: tr('welcome.tipHide'), text: tr('welcome.tipHideText', { keys: prettyShortcut(settings.hideAppShortcut) }) }
                         : { icon: FileText, title: tr('welcome.tipNotes'), text: tr('welcome.tipNotesText') },
                     ].map((tip) => {
                       const Icon = tip.icon;
                       return (
                         <div key={tip.title} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07]">
                           <div className="flex items-center gap-2 text-xs font-semibold text-white">
                             <Icon className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                             {tip.title}
                           </div>
                           <div className="mt-1 text-[11px] text-zinc-400 leading-snug">{tip.text}</div>
                         </div>
                       );
                     })}
                   </div>
                 </div>
              </div>
            ) : (
              <ChatArea
                activeTab={activeTab}
                quota={userData}
                isGuest={!!user?.isGuest}
                onSignIn={openSignIn}
                markersOn={settings.showPointersOnScreen !== false}
                steamName={settings.steamName}
                steamAvatar={settings.steamAvatar}
                onSendMessage={handleSendMessage}
                isLoading={isLoadingAi}
                aiMode={settings.aiMode}
                activeGame={activeGame}
                screenshotKeys={prettyShortcut(settings.autoScreenshotShortcut)}
                hideKeys={formatShortcut(settings.hideAppShortcut)}
                tickKeys={formatShortcut(settings.trackerTickShortcut || 'CmdOrCtrl+Shift+Enter')}
                missablesHere={missablesHere}
                // "Next here" is the attached quest log's list too: the compact view leaves it out while that shows.
                nearYou={compact && questLogVisible && questLogAttached ? null : nearYou}
                logAttached={questLogAttached && (questLogVisible || questLogTucked)}
                questLog={activeTab?.questLog}
                compactLog={compact && logView?.now ? { view: logView, open: compactFold, onTick: (id) => tickLog(id, true), onToggle: toggleQuestLog, keysLabel: formatShortcut(settings.questLogShortcut || 'CmdOrCtrl+Shift+L') } : null}
                onSetNow={isDesktop ? setLogNow : undefined}
                onPinAnswer={isDesktop ? togglePin : undefined}
                onDismissOffer={(id) => patchLog((st) => ({ hidden: [...new Set([...(st.hidden || []), `offer:${id}`])] }))}
                nextKeys={formatShortcut(settings.trackerNextShortcut || 'CmdOrCtrl+Shift+Down')}
                immersiveReadAloud={settings.immersiveReadAloud !== false}
                soundEnabled={settings.soundEnabled}
                onAppendToNotes={handleAppendToNotes}
                markerLifetime={settings.markerLifetime ?? 120}
                hintMode={settings.hintMode === true}
                onOpenPremium={() => setIsPaywallOpen(true)}
                onChangeMarkerLifetime={(seconds) => setSettings((s) => ({ ...s, markerLifetime: seconds }))}
                onSetPlace={handleSetPlace}
                onLocate={isDesktop && trackerGame.guideArea?.areas?.length ? runLocate : undefined}
                locating={locating}
                locateNote={locateNote}
                onTrackOnScreen={isDesktop ? handleTrackOnScreen : undefined}
                onNextTurn={isDesktop ? runNextTurn : undefined}
                onSetStory={(story) => {
                  const next = { name: activeTab.place?.name || '', confirmed: !!activeTab.place?.confirmed, ...(activeTab.place || {}), story, storyConfirmed: true };
                  setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: next, lastActive: Date.now() } : t)));
                  rememberGameProgress(activeTab, next);
                }}
                onUpdateMessage={(msgId, patch) =>
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.messages.some((m) => m.id === msgId)
                        ? { ...t, messages: t.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)), lastActive: Date.now() }
                        : t,
                    ),
                  )
                }
                onOpenScreenModal={(url) => setExaminedImageUrl(url)}
                ttsVoice={settings.ttsVoice}
                customApiKey={settings.customApiKey}
                openAiApiKey={settings.openAiApiKey}
                compact={compact}
                compactLayout={compactLayout}
                detection={detection}
                detectionLine={<DetectionLine d={detection} soundEnabled={settings.soundEnabled} />}
                onExpand={() => chooseView('full')}
                onShowQuestLog={isDesktop ? () => { if (!questLogVisible) toggleQuestLog(); } : undefined}
                onCloseApp={isDesktop ? () => void closeAppAfterSync(syncDiagnostics?.triggerSyncNow) : undefined}
              />
            )}

            {/* Your playthrough (roadmap item 8) */}
            {activeTab && (
              <PlaythroughPanel
                objective={(() => {
                  const m = activeTab.questLog?.now ? activeTab.messages.find((x) => x.id === activeTab.questLog!.now) : undefined;
                  const steps = (m?.steps || []).map((st, i) => ({ st, i })).filter((x) => x.st.kind !== 'warning');
                  return m && steps.length ? { goal: answerTitle(m), done: steps.filter((x) => (m.doneSteps || []).includes(x.i)).length, total: steps.length } : null;
                })()}
                onClearObjective={() => patchLog(() => ({ now: undefined }))}
                open={playOpen}
                onClose={() => setPlayOpen(false)}
                game={playGame}
                memoryOn={memoryOn}
                place={activeTab.place?.name || ''}
                story={activeTab.place?.story || ''}
                onPlace={(name, story) => {
                  const next = { ...(activeTab.place || {}), name, confirmed: !!name, ...(story ? { story, storyConfirmed: true } : { story: undefined, storyConfirmed: false }) };
                  setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: next, lastActive: Date.now() } : t)));
                  if (name) rememberGameProgress(activeTab, next);
                }}
                play={play}
                done={settings.gameDone?.[gameProgressKey(activeTab)] || []}
                onAdd={(kind, text) => updatePlay((p) => addEntries(p, [{ kind, text, source: 'you' }]))}
                onEdit={(id, text) => updatePlay((p) => editEntry(p, id, text))}
                onRemove={(id) => updatePlay((p) => removeEntry(p, id))}
                onEditDone={(i, text) => editDone(i, text)}
                onRemoveDone={(i) => editDone(i, null)}
                notesInAnswers={play.notesInAnswers !== false}
                onNotesInAnswers={(on) => updatePlay((p) => ({ ...p, notesInAnswers: on, updatedAt: Date.now() }))}
                onOpenNotes={() => { setPlayOpen(false); setIsNotesOpen(true); }}
                onClear={() => {
                  updatePlay((p) => clearPlaythrough(p));
                  const key = gameProgressKey(activeTab);
                  setSettings((s) => ({ ...s, gameDone: { ...(s.gameDone || {}), [key]: [] } }));
                }}
                onOpenSettings={() => { setPlayOpen(false); setIsSettingsOpen(true); }}
              />
            )}

            {/* Playthrough Notepad Overlay */}
            <PlaythroughNotepad
              isOpen={isNotesOpen}
              onClose={() => setIsNotesOpen(false)}
              activeTab={activeTab}
              onUpdateNotes={handleUpdateNotes}
              soundEnabled={settings.soundEnabled}
            />

            {/* Personal Quests Overlay */}
            <PersonalQuestsModal
              isOpen={isQuestsOpen}
              onClose={() => setIsQuestsOpen(false)}
              activeTab={activeTab}
              onUpdateQuests={handleUpdateQuests}
              soundEnabled={settings.soundEnabled}
            />
          </main>

          {/* Achievements Drag Handle */}
          {isAchDrawerOpen && (
            <div 
              className="w-1.5 cursor-col-resize hover:bg-amber-500/50 active:bg-amber-500 transition-colors z-30 flex-shrink-0"
              onMouseDown={(e) => {
                setIsDraggingAch(true);
                dragStartRef.current = { startX: e.clientX, startWidth: achDrawerWidth };
              }}
            />
          )}

          {/* Right Achievements Drawer (not in the compact view) */}
          {!compact && <AchievementsDrawer
            width={achDrawerWidth}
            isDragging={isDraggingAch}
            isOpen={isAchDrawerOpen}
            onClose={() => setIsAchDrawerOpen(false)}
            gameData={activeGame}
            soundEnabled={settings.soundEnabled}
          />}
        </div>
        </div>
        {logColumn('right')}
        {tuckStrip('right')}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(updated) => setSettings(s => ({ ...s, ...updated }))}
        soundEnabled={settings.soundEnabled}
        syncDiagnostics={syncDiagnostics}
        plan={user ? { isGuest: !!user.isGuest, isPremium: userData?.isPremium === true, source: userData?.premiumSource, periodEnd: Number(userData?.premiumPeriodEnd) || undefined, cancelAtPeriodEnd: userData?.premiumCancelAtPeriodEnd === true, interval: userData?.premiumInterval } : undefined}
        onOpenPlan={() => { setIsSettingsOpen(false); setIsPaywallOpen(true); }}
      />

      {/* Rename/Create Modal */}
      <RenameModal
        isOpen={isRenameModalOpen}
        initialValue={renameModalInitialValue}
        title={renameModalMode === 'create' ? 'Create New Compendium' : 'Rename Compendium'}
        onSave={handleRenameModalSave}
        onCancel={() => setIsRenameModalOpen(false)}
      />

      {/* Auth & Paywall Overlays */}
      {!isInitializing && (!user || isAuthModalOpen) && (
        <AuthModal 
          onSignInSuccess={() => {
            setIsAuthModalOpen(false);
            setAuthModalMessage(null);
          }}
          initialMessage={authModalMessage}
          onClose={() => {
            setIsAuthModalOpen(false);
            setAuthModalMessage(null);
          }}
        />
      )}
      {!isInitializing && user && isOutdated && (
        <UpdateRequiredModal />
      )}
      {/* Upgrade / Paywall Modal */}
      {!isInitializing && user && !isOutdated && isPaywallOpen && (
        <PaywallModal
          onClose={() => setIsPaywallOpen(false)}
          isGuest={!!user.isGuest}
          onSignIn={() => { setIsPaywallOpen(false); openSignIn(); }}
          isPremium={userData?.isPremium === true}
          beta={userData?.beta === true}
          premiumSource={userData?.premiumSource}
          periodEnd={Number(userData?.premiumPeriodEnd) || undefined}
          cancelAtPeriodEnd={userData?.premiumCancelAtPeriodEnd === true}
          interval={userData?.premiumInterval}
          initialInterval={paywallInterval}
        />
      )}

      {/* Controller support: focus navigation, quick questions, on-screen keyboard, button hints */}
      <ControllerLayer enabled={settings.controllerEnabled !== false} talkButton={settings.controllerTalk || 'y'} hintMode={settings.hintMode === true} logAttached={questLogAttached && (questLogVisible || questLogTucked) && !isBrowserMode} />

      {/* Quick Game Search & Switcher Modal */}
      <QuickGameSearchModal
        isOpen={isGameSearchOpen}
        onClose={() => setIsGameSearchOpen(false)}
        onSelectGame={handleSelectGame}
        soundEnabled={settings.soundEnabled}
      />

      <BetaFeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} user={user} />

      {/* Fullscreen Screenshot Examination Modal */}
      <GameScreenModal
        imageUrl={examinedImageUrl}
        onClose={() => setExaminedImageUrl(null)}
        soundEnabled={settings.soundEnabled}
      />
    </div>
    </Suspense>
  );
}