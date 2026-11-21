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
  DockPosition,
  PlaceDoing
} from './types';
import { POPULAR_STEAM_GAMES } from './data/mockGames';
import { HeaderBar } from './components/HeaderBar';
import { ChatArea } from './components/ChatArea';
import { AchievementsDrawer } from './components/AchievementsDrawer';
const PlaythroughNotepad = React.lazy(() => import('./components/PlaythroughNotepad').then(module => ({ default: module.PlaythroughNotepad })));
const PersonalQuestsModal = React.lazy(() => import('./components/PersonalQuestsModal').then(module => ({ default: module.PersonalQuestsModal })));
const EmailSignInPage = React.lazy(() => import('./components/EmailSignInPage').then(module => ({ default: module.EmailSignInPage })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then(module => ({ default: module.SettingsModal })));
const QuickGameSearchModal = React.lazy(() => import('./components/QuickGameSearchModal').then(module => ({ default: module.QuickGameSearchModal })));
const GameScreenModal = React.lazy(() => import('./components/GameScreenModal').then(module => ({ default: module.GameScreenModal })));
const AuthModal = React.lazy(() => import('./components/AuthModal').then(module => ({ default: module.AuthModal })));
import { LogFacts } from './components/LogFacts';
const PaywallModal = React.lazy(() => import('./components/PaywallModal').then(module => ({ default: module.PaywallModal })));
import { TrialEndsNote } from './components/TrialEndsNote';
const RenameModal = React.lazy(() => import('./components/RenameModal').then(module => ({ default: module.RenameModal })));
const UpdateRequiredModal = React.lazy(() => import('./components/UpdateRequiredModal').then(module => ({ default: module.UpdateRequiredModal })));
const BetaFeedbackModal = React.lazy(() => import('./components/BetaFeedbackModal').then(module => ({ default: module.BetaFeedbackModal })));
import { db } from './lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { getApiBaseUrl, DEFAULT_CLOUD_URL } from './utils/api';
import { markAsked } from './utils/newVersionReload';
import { settleCheck, type CheckFound } from './utils/markerCheck';
declare const __APP_BUILD__: { version: string } | undefined;
const APP_VERSION = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__.version : 'dev';
import { playBlipSound } from './utils/audio';
import { samePlace, placeAfterMove, singleArea, dropDoingIfMoved } from './utils/placeName';
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
  addEntries, editEntry, removeEntry, forgetAnswers, clearPlaythrough, mergePlaythrough, playthroughForRequest, readLocal, writeLocal,
  emptyPlaythrough, OPEN_PLAYTHROUGH_EVENT, type Playthrough, type PlayKind, type PlayEntry,
} from './utils/playthrough';
import { qaPair, logWithout } from './utils/answerFind';
import { recordDeletedMessages } from './hooks/tabMerge';
import { AnswerSearch } from './components/AnswerSearch';
import { buildRecap, recapCard, RECAP_GAP_MS } from './utils/recap';
import { readCloud, writeCloud } from './utils/playthroughCloud';
import { PlaythroughPanel } from './components/PlaythroughPanel';
import { appSource, isPhone } from './utils/source';
import { useGameArt } from './utils/gameArt';
import { sharpIgdb, steamHeader, useArt } from './utils/artCache';
import { deviceId } from './utils/deviceId';
import { followRunning, runningId, tabForGame, type FollowState, type ResolvedGame } from './utils/runningGame';
import { guideApi } from './utils/guideApi';
import { displayGameName } from './utils/gameName';
import { DetectionLine, type Detection } from './components/DetectionLine';
import { asideGameIn } from './utils/asideGame';
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
import { PopWindow } from './components/PopWindow';
import { useWorthHere } from './hooks/useWorthHere';
import { QuestLog } from './components/QuestLog';
import { buildLogView, objectiveForRequest, nextLogState, answerTitle, placeIsCurrent, doSteps, isNowQuestion, isCuriosityQuestion, heldIds, HELD_DAYS, type LogView, type Foe } from './utils/questLogView';
import type { EarlierSession } from './utils/earlierSessions';
import { isCompanion } from './utils/companion';
import { padComboLabel, padPreset } from './utils/padGlyphs';
import { missablesThin } from './utils/missablesCheck';

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
      if (parsed.aiMode !== 'roleplay') parsed = { ...parsed, aiMode: 'standard' }; // Min/Max was removed (Nov 6 2026)
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
      {/* Controller mode step 6: the controller works here too (the desktop app sends it input while this has focus). */}
      <ControllerLayer enabled={settings.controllerEnabled !== false} padStyle={settings.controllerStyle || 'auto'} talkButton="off" intro={false} />
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
      if (parsed.aiMode !== 'roleplay') parsed = { ...parsed, aiMode: 'standard' }; // Min/Max was removed (Nov 6 2026)
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
  const [examinedImageUrl, setExaminedImageUrl] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [steamGame, setGlobalActiveGame] = useState<SteamGameData | null>(null);
  // Detection beyond Steam (utils/learnedGames.ts; with the current tabs too since Oct 30 2026): a launcher's game, an
  // emulator's or a program the player named is the running game while Steam runs nothing. Unknown ones are asked
  // about once (the detection line) and remembered; until then the game last picked stays open.
  const [programGame, setProgramGame] = useState<ProgramGame | null>(null);
  /** The running game (runningId) offered "Open a tab for X?", and the one just switched to ("Switched to X", X its tab's name). */
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [switchedFor, setSwitchedFor] = useState<{ id: string; name: string } | null>(null);
  /** The tab just opened for a game (createdFor), so Undo can close it and go back to where the player was. */
  const [createdFor, setCreatedFor] = useState<{ id: string; tabId: string; prevTabId: string | null; name: string } | null>(null);
  const programVerdict = useMemo(() => resolveProgram(programGame, settings.learnedPrograms), [programGame, settings.learnedPrograms]);
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
  
  // The running game through the shared resolver (/api/guides/find, the answers' and game spaces' matching): its guide
  // and that guide's name, so an edition or a collection finds the right compendium. Only the game's name (and Steam
  // app) is sent; at most 4 seconds are waited for it, then the names alone decide.
  const runId = runningId(globalActiveGame);
  const [resolvedRun, setResolvedRun] = useState<(ResolvedGame & { id: string }) | null>(null);
  useEffect(() => {
    if (!runId || !globalActiveGame) { setResolvedRun(null); return; }
    let alive = true;
    const appId = Number(globalActiveGame.appId) || 0;
    const q = new URLSearchParams({ game: globalActiveGame.name || '', ...(appId > 0 ? { appId: String(appId) } : {}) });
    const timer = setTimeout(() => alive && setResolvedRun((cur) => (cur?.id === runId ? cur : { id: runId })), 4000);
    guideApi(`/api/guides/find?${q}`)
      .then((g: any) => alive && setResolvedRun({ id: runId, key: g?.key || null, game: g?.game || null }))
      .catch(() => alive && setResolvedRun((cur) => (cur?.id === runId ? cur : { id: runId })))
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); };
  }, [runId]);
  const resolvedNow = resolvedRun && resolvedRun.id === runId ? resolvedRun : null;

  // The running game's compendium, and whether it's the open one. Questions are about the open compendium's game;
  // the running game's live data (achievements, news, "running now") joins in only on its own compendium.
  const runningTab = tabForGame(tabs, globalActiveGame, resolvedNow);
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
  const openRunningTab = () => {
    if (!globalActiveGame) return;
    setOfferFor(null);
    if (runningTab) { handleSelectTab(runningTab.id); return; }
    // A new compendium under the guide's own name and guide (the resolver's), so it opens on the right one.
    const name = displayGameName(resolvedNow?.game || globalActiveGame.name);
    handleCreateTab(name, { ...globalActiveGame, name: Number(globalActiveGame.appId) > 0 ? globalActiveGame.name : name, isAutoDetected: false }, resolvedNow?.key || undefined);
  };
  const detection: Detection = {
    running: globalActiveGame?.name || '',
    open: runningOpen,
    available: typeof window !== 'undefined' && !!(window as any).electronAPI,
    onSwitch: openRunningTab,
    ...(offerFor && offerFor === runId && !runningOpen ? { offer: { onOpen: openRunningTab, onDismiss: () => setOfferFor(null) } } : {}),
    ...(switchedFor && switchedFor.id === runId ? { switched: switchedFor.name } : {}),
    ...(createdFor && createdFor.id === runId ? { created: { name: createdFor.name, onUndo: () => undoCreated() } } : {}),
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
    if (!api?.setDetectBeyondSteam) return;
    api.setDetectBeyondSteam(true);
    api.onProgramDetected?.((g: ProgramGame | null) => setProgramGame(g));
    api.getProgramGame?.().then((g: ProgramGame | null) => setProgramGame(g)).catch(() => {});
  }, []);

  // "Where was I?" (session companion step 1, owner Nov 18 2026; utils/recap.ts): a game that starts after a day or more
  // away gets a recap on the pop-up card, a few seconds in (the game's own loading first). Read before the switch
  // below marks the tab active again. Once per game start; Settings can turn it off. The quick menu's "Where was I?"
  // shows it any time (qc-recap).
  const recapNowRef = useRef<{ tab: GameTab | null | undefined; play: Playthrough }>({ tab: null, play: emptyPlaythrough() });
  recapNowRef.current.tab = activeTab; // its playthrough is set below, where it's declared
  const showRecap = (tab: GameTab | null | undefined, why: 'start' | 'asked') => {
    const api = (window as any).electronAPI;
    if (!api?.showRecap) return;
    const r = buildRecap(tab, recapNowRef.current.play, Date.now(), tr, [tr('chat.defaultShotQ'), tr('chat.defaultQ'), tr('chat.voiceMessage')]);
    if (!r) {
      if (why === 'asked') api.showRecap({ id: `recap-${Date.now()}`, question: tr('recap.question'), title: displayGameName(tab?.name || ''), text: tr('recap.nothing'), steps: [] });
      return;
    }
    api.showRecap(recapCard(r, tr, `recap-${Date.now()}`));
  };
  const recapStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || recapStartRef.current === runId || settings.recapCard === false) return;
    if (isInitializing || !tabs.length || !runningTab) return;
    recapStartRef.current = runId;
    const tabId = runningTab.id;
    const away = Date.now() - (runningTab.lastActive || Date.now());
    if (away < RECAP_GAP_MS || !runningTab.messages?.length) return;
    // The tab as it was (its lastActive is what "last played" counts from), with the playthrough loaded by then.
    const snapshot = runningTab;
    const timer = setTimeout(() => {
      const now = recapNowRef.current.tab;
      showRecap(now && now.id === tabId ? { ...now, lastActive: snapshot.lastActive } : snapshot, 'start');
    }, 6000);
    return () => clearTimeout(timer);
  }, [runId, runningTab?.id, isInitializing, tabs.length > 0]);
  useEffect(() => {
    const on = () => showRecap(recapNowRef.current.tab, 'asked');
    window.addEventListener('qc-recap', on);
    return () => window.removeEventListener('qc-recap', on);
  }, []);
  // Following the game that starts (utils/runningGame.ts followRunning): its compendium opens by itself ("Switched to
  // X" for a few seconds, beside the book too when the panel is hidden), or "Open a tab for X?" when it has none. Once
  // the resolver has answered (or given up) and the tabs are loaded, and only when a game starts (or is running when
  // the app opens): a compendium picked by hand stays.
  // Seamless (owner, Nov 19 2026): a game with no compendium gets one ("Opened a tab for X · Undo"), and a compendium
  // picked by hand while the game runs stays only while the panel is in front: back in the game (the panel hidden or
  // the game focused: away), the game's own is open again.
  const followRef = useRef<FollowState>({ id: null, goneAt: 0 });
  const [away, setAway] = useState(() => typeof document !== 'undefined' && (document.hidden || !document.hasFocus()));
  useEffect(() => {
    const on = () => setAway(document.hidden || !document.hasFocus());
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    window.addEventListener('blur', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); window.removeEventListener('blur', on); };
  }, []);
  useEffect(() => {
    if (isInitializing || !tabs.length || (runId && !resolvedNow)) return;
    const r = followRunning(followRef.current, runId, Date.now(), {
      matchTabId: runningTab?.id || null, activeTabId: activeTab?.id || null, auto: settings.autoSwitchGames !== false,
      away, declined: !!runId && (settings.noAutoTab || []).includes(runId),
    });
    followRef.current = r.state;
    const action = r.action;
    if (action.kind === 'switch') {
      const name = tabs.find((t) => t.id === action.tabId)?.name || globalActiveGame?.name || '';
      handleSelectTab(action.tabId);
      if (!action.quiet) {
        setSwitchedFor({ id: runId!, name });
        (window as any).electronAPI?.trackerHeads?.(`✓ ${tr('detect.switched', { game: displayGameName(name) })}`);
      }
    } else if (action.kind === 'create' && globalActiveGame) {
      const prevTabId = activeTab?.id || null;
      const name = displayGameName(resolvedNow?.game || globalActiveGame.name);
      const tabId = handleCreateTab(name, { ...globalActiveGame, name: Number(globalActiveGame.appId) > 0 ? globalActiveGame.name : name, isAutoDetected: false }, resolvedNow?.key || undefined);
      setCreatedFor({ id: runId!, tabId, prevTabId, name });
      (window as any).electronAPI?.trackerHeads?.(`✓ ${tr('detect.created', { game: name })}`);
    } else if (action.kind === 'offer') {
      setOfferFor(runId);
    }
  }, [runId, resolvedNow, isInitializing, tabs.length > 0, away, runningTab?.id]);
  useEffect(() => {
    if (!createdFor) return;
    const t = setTimeout(() => setCreatedFor(null), 8000);
    return () => clearTimeout(t);
  }, [createdFor]);
  const undoCreated = () => {
    const c = createdFor;
    if (!c) return;
    setCreatedFor(null);
    const tab = tabs.find((t) => t.id === c.tabId);
    // Only a tab still as it was made (nothing asked in it yet) is closed; the game is remembered so it isn't made again.
    if (tab && !tab.messages.some((m) => m.role === 'user')) handleDeleteTab(c.tabId);
    if (c.prevTabId && tabs.some((t) => t.id === c.prevTabId)) setActiveTabId(c.prevTabId);
    setSettings((s) => ({ ...s, noAutoTab: [...new Set([...(s.noAutoTab || []), c.id])].slice(-50) }));
  };
  useEffect(() => {
    if (!switchedFor) return;
    const t = setTimeout(() => setSwitchedFor(null), 4000);
    return () => clearTimeout(t);
  }, [switchedFor]);


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
        // (The "highlight the next objective" key went with the tick boxes, Nov 20 2026.)
        trackerNextShortcut: '',
        questLogShortcut: settings.questLogShortcut || 'CmdOrCtrl+Shift+L',
        locateShortcut: settings.locateShortcut || 'CmdOrCtrl+Shift+K',
        quickMenuShortcut: settings.quickMenuShortcut || 'Alt+Q',
        findMarkersShortcut: settings.findMarkersShortcut || 'CmdOrCtrl+Shift+M',
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
    settings.locateShortcut,
    settings.quickMenuShortcut,
    settings.findMarkersShortcut,
    userData?.isAdmin,
  ]);

  // Pop-up answers over the game: their size and corner (Settings).
  useEffect(() => {
    (window as any).electronAPI?.setCardPrefs?.({ size: settings.popupSize || 'm', corner: settings.popupCorner || 'tr', speak: settings.popupReadAloud !== false, orb: settings.popupOrb !== false, orbStyle: settings.popupOrbStyle === 'icon' ? 'icon' : 'orb' });
  }, [settings.popupSize, settings.popupCorner, settings.popupReadAloud, settings.popupOrb, settings.popupOrbStyle]);
  // The pop-up's speaker button: its choice is the Settings switch's too.
  useEffect(() => {
    (window as any).electronAPI?.onCardSpeakPref?.((on: boolean) => setSettings((s) => ({ ...s, popupReadAloud: on })));
  }, []);

  // Controller: tell the desktop app which chord shows / hides the overlay.
  useEffect(() => {
    (window as any).electronAPI?.setControllerConfig?.({
      enabled: settings.controllerEnabled !== false,
      toggle: padPreset(settings.controllerToggle),
      custom: settings.controllerCustom,
      talk: settings.controllerTalk || 'off',
      trackerTick: settings.controllerTick || 'off',
      // The controller's "highlight the next objective" chord went with the tick boxes (Nov 20 2026): its tick chord is now Next step.
      trackerNext: 'off',
      trackerLocate: settings.controllerLocate || 'off',
    });
  }, [settings.controllerEnabled, settings.controllerToggle, settings.controllerCustom, settings.controllerTalk, settings.controllerTick, settings.controllerNext, settings.controllerLocate]);

  // Snapshot on open (desktop): capture the game before the overlay takes focus.
  const noFollowText = tr('markers.noFollow');
  useEffect(() => {
    (window as any).electronAPI?.setOverlayOptions?.({ snapshotOnOpen: settings.snapshotOnOpen !== false, stickyPointers: settings.stickyPointers !== false, markersInRecordings: settings.markersInRecordings !== false, markerLifetimeMs: Math.max(0, settings.markerLifetime ?? 120) * 1000, noFollowText });
  }, [settings.snapshotOnOpen, settings.stickyPointers, settings.markersInRecordings, settings.markerLifetime, noFollowText]);

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
    // "Yes" to an unsure check's suggestion: what it saw the player doing comes with it.
    const seen = whereFor?.tabId === activeTab.id && whereFor.doing && samePlace(whereFor.suggestion, name) ? whereFor.doing : null;
    const next = { ...dropDoingIfMoved(activeTab.place, name), name, confirmed: true, checkedAt: Date.now(), ...(seen ? { doing: seen } : {}) };
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: next, lastActive: Date.now() } : t)));
    rememberGameProgress(activeTab, next);
    noteAreaChange(activeTab, activeTab.place?.name, name);
    setWhereFor(null);
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
  // Where the player is: this playthrough's own place. Never the place saved for the game from another tab (owner, Oct
  // 31 2026: a new tab for a save in Act 3 showed the start of the guide's Emerald Grove from an older playthrough).
  const trackerPlace = activeTab ? activeTab.place : undefined;
  // The place is checked again when a game starts, a tab is opened or switched to while its game runs, and when the
  // player comes back to the game after a while (locateDue: when, per tab). Until it's known since then
  // (utils/questLogView placeIsCurrent), the quest log shows nothing from the guide, only "Where are you?".
  const [locateDue, setLocateDue] = useState<Record<string, number>>({});
  const markLocateDue = (tabId: string | null | undefined) => {
    if (tabId) setLocateDue((d) => ({ ...d, [tabId]: Date.now() }));
  };
  const dueAt = activeTab ? locateDue[activeTab.id] || 0 : 0;
  const placeCurrent = placeIsCurrent(activeTab?.place, dueAt);
  const logPlace = placeCurrent ? trackerPlace : undefined;
  // What an unsure Locate me thought ("Looks like Rivington?"), for the active tab.
  // doing: what the unsure check saw the player doing, kept when the player says "Yes" to the suggestion.
  const [whereFor, setWhereFor] = useState<{ tabId: string; suggestion: string; doing?: PlaceDoing } | null>(null);
  const trackerGame = useTrackerGuide(activeTab ? activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name : undefined, logPlace?.name, logPlace?.story, useLocale(), Number(activeTab?.activeSteamGame?.appId || activeGame?.appId) || 0, activeTab?.name, activeTab?.guideKey);
  const trackerGameRef = useRef(trackerGame);
  trackerGameRef.current = trackerGame;
  // "Worth getting here" for the player's area, any game, guide or not (owner, Nov 15 2026; hooks/useWorthHere): the
  // fact database's list for a sure place, filled on demand with a ticket from Help me here or an answer.
  const worthLocale = useLocale();
  const { here: worthHere, redeem: redeemWorth } = useWorthHere(
    activeTab ? activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name : undefined,
    logPlace && (logPlace.sure || logPlace.confirmed) ? logPlace.name : undefined,
    {
      appId: Number(activeTab?.activeSteamGame?.appId || activeGame?.appId) || undefined,
      guideKey: activeTab?.guideKey || trackerGame.guideKey || null,
      english: !worthLocale || worthLocale === 'en',
      token: async () => (user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken().catch(() => null) : (user as any)?.isGuest ? String((user as any).uid) : null),
    },
  );
  const redeemWorthRef = useRef(redeemWorth);
  redeemWorthRef.current = redeemWorth;
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
    // "Yes" to an unsure check's suggestion: what it saw the player doing comes with it.
    const seen = whereFor?.tabId === activeTab.id && whereFor.doing && samePlace(whereFor.suggestion, name) ? whereFor.doing : null;
    const place = { ...placeAfterMove(activeTab.place, name, story, true), checkedAt: Date.now(), ...(seen ? { doing: seen } : {}) };
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place, lastActive: Date.now() } : t)));
    rememberGameProgress(activeTab, place);
    noteAreaChange(activeTab, activeTab.place?.name, name);
    setWhereFor(null);
  };
  // "Locate me" (the quest log's button, Ctrl+Shift+K, the controller, the tracker's crosshair, the PlaceBar): a
  // screenshot of the game and the guide's areas go to /api/locate-me (the Fast model; its own daily limit, never the
  // player's questions). Only a confident answer sets the place ("You're in Rivington · Change"); an unsure one is a
  // suggestion the player confirms ("Looks like Rivington?"), and nothing found asks "Where are you?". Automatic
  // checks (auto) take the screenshot quietly: never sliding an open panel away (its snapshot from opening is used,
  // else the check waits until the game is back in view), never a window that isn't the game.
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
  /** The last note Locate me showed (Help me here repeats a failure in the conversation, where it's always seen). */
  const lastLocateNote = useRef('');
  const showLocateNote = (text: string) => {
    if (text) lastLocateNote.current = text;
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
  const pendingAutoLocate = useRef<string | null>(null);
  /** The place an unsure Locate me suggested (Help me here says so). */
  const lastUnsure = useRef('');
  const runLocate = async (autoArg?: unknown): Promise<string | null> => {
    // A click passes its event: only an explicit true is an automatic check.
    const auto = autoArg === true;
    const api = (window as any).electronAPI;
    const tab = activeTab;
    const guideAreas = trackerGameRef.current.areas || [];
    if (locatingRef.current || !tab) return null;
    // Any game (owner, Nov 15 2026): with a guide its areas are a list to pick from; without one the check names the area.
    if (!api?.captureFresh) return null;
    // The quiet capture for an automatic check: null means not now (the game isn't in view, or the panel is open
    // without a snapshot of the game): it runs when the game is back in view.
    let quiet: string | null = null;
    if (auto) {
      const r = api.locateCapture ? await api.locateCapture().catch(() => null) : null;
      if (!r?.image) {
        pendingAutoLocate.current = tab.id;
        return null;
      }
      quiet = r.image;
    }
    pendingAutoLocate.current = null;
    locatingRef.current = true;
    // The tracker holds what it shows now (only its place line says "Locating…") until the result is in and the new
    // area's guide page has loaded: then it updates once, never through a half-loaded place in between.
    locateHold.current = trackerPayloadRef.current ? { data: trackerPayloadRef.current.data, target: null } : null;
    setLocating(true);
    showLocateNote('');
    try {
      // A fresh capture of the game (an open panel slides away for it), never the panel or the snapshot from opening it.
      const captured: string | null = quiet || (await api.captureFresh());
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
          ...(auto ? { auto: true } : {}),
          doing: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // An automatic check that couldn't run says nothing: the log is already asking "Where are you?".
        if (!auto) showLocateNote(data?.locateLimitReached ? tr('place.locateLimit', { n: data?.limit ?? '' }) : tr('place.locateFail'));
        return null;
      }
      if (!data?.area || data.area === 'unknown') {
        if (!auto) showLocateNote(tr('place.locateUnknown'));
        return null;
      }
      // Older servers don't say "confident": a read was.
      const confident = data.confident === true || (data.confident === undefined && data.evidence === 'read');
      if (!confident) {
        setWhereFor({ tabId: tab.id, suggestion: String(data.area), ...(data.doing && typeof data.doing === 'object' ? { doing: data.doing } : {}) });
        lastUnsure.current = String(data.area);
        return null;
      }
      const story = typeof data.story === 'string' ? data.story.trim() : '';
      // What the player is doing, as the screen showed it (or nothing: an older "doing" in the same area is dropped).
      const { doing: _oldDoing, ...moved } = placeAfterMove(tab.place, String(data.area), story, data.evidence === 'read');
      const doing = data.doing && typeof data.doing === 'object' ? data.doing : null;
      const place = { ...moved, sure: true, checkedAt: Date.now(), ...(doing ? { doing } : {}) };
      setWhereFor(null);
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, place, lastActive: Date.now() } : t)));
      rememberGameProgress(tab, place);
      noteAreaChange(tab, tab.place?.name, place.name);
      // The area has no "Worth getting here" yet: its ticket (filled once the quest log is on the area).
      if (data.worth && typeof data.worth === 'object') redeemWorthRef.current(data.worth);
      if (locateHold.current) {
        locateHold.current.target = place.name;
        // In case the area's page never loads (offline): let go after a few seconds anyway.
        setTimeout(() => releaseLocateHold(), 5000);
      }
      return place.name;
    } catch {
      showLocateNote(tr('place.locateFail'));
      return null;
    } finally {
      // No new place (a failure, or nothing recognised): nothing to wait for.
      if (locateHold.current && !locateHold.current.target) locateHold.current = null;
      locatingRef.current = false;
      setLocating(false);
    }
  };
  /**
   * Help me here (owner, Nov 15 2026; roadmap item 30): one press (Ctrl+Shift+H, L3+R3, or the quest log's button) runs
   * Locate me, lets the quest log set Now from what the screen shows, fetches the visual for that objective (a video
   * or picture under a short note), then says what it did. Locate me's own daily allowance covers it; the visual is
   * cached per objective, so pressing again costs nothing new.
   */
  const helpingRef = useRef(false);
  const runHelpHere = async () => {
    const tab = activeTab;
    if (helpingRef.current || !tab) return;
    helpingRef.current = true;
    lastUnsure.current = '';
    lastLocateNote.current = '';
    // The outcome as a short note in the conversation, so a press never looks like it did nothing.
    const say = (text: string, extra: Partial<ChatMessage> = {}) => {
      const msg: ChatMessage = { id: `help_${Date.now()}`, role: 'assistant', kind: 'help', modelUsed: tr('help.label'), timestamp: Date.now(), text, ...extra };
      setTabs((prev) => prev.map((x) => (x.id === tab.id ? { ...x, messages: [...x.messages, msg], lastActive: Date.now() } : x)));
      return msg.id;
    };
    try {
      // Right after a start or a tab switch the game's guide may still be loading: wait a few seconds for the lookup (a
      // game without a guide goes ahead as soon as that's known).
      for (let i = 0; i < 16 && !trackerGameRef.current.looked; i++) await new Promise((r) => setTimeout(r, 250));
      const placeName = await runLocate(false);
      if (!placeName) {
        // Why it couldn't: unsure (with its guess), or what Locate me said (no guide, its daily limit, not recognised).
        const why = lastUnsure.current ? tr('help.unsure', { place: lastUnsure.current }) : lastLocateNote.current || tr('place.locateUnknown');
        showLocateNote(why);
        say(why);
        return;
      }
      // The log settles on the new place (and its Now) once that area's guide page has loaded.
      let now: LogView['now'] = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const v = logViewRef.current;
        if (v && !v.locating && v.place?.name === placeName) { now = v.now; if (now) break; }
      }
      const goal = now ? String(now.text || now.goal || '').trim() : '';
      const noteId = say(goal ? tr('help.done', { place: placeName, goal }) : tr('help.doneNoGoal', { place: placeName }), now ? { helpFor: now.id } : {});
      showLocateNote(goal ? tr('help.doneShort', { goal }) : tr('help.doneNoGoalShort', { place: placeName }));
      if (goal) {
        const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken().catch(() => null) : (user as any)?.isGuest ? String((user as any).uid) : null;
        const game = tab.activeSteamGame?.name || activeGame?.name || tab.name;
        await fetchVisual(noteId, `How do I ${goal.replace(/[.?!]+$/, '')}?`, [goal, now?.detail || now?.sub || ''].filter(Boolean).join('. '), game, token);
      }
    } finally {
      helpingRef.current = false;
    }
  };
  const runHelpRef = useRef(runHelpHere);
  runHelpRef.current = runHelpHere;

  // Every new answer (or note) goes to the desktop app, which pops it up over the game when it was asked there (the
  // controller's quick menu, or a keyboard shortcut with the panel away; electron/answerCard.cjs; owner, Nov 17-18 2026).
  // Its one picture, in Noah's order: the answer's own visual, else a close-up from the question's screenshot that the
  // marker check confirmed is there, else none. The card never mentions markers.
  const cardSeenRef = useRef<string | null>(null);
  const cardCloseUpRef = useRef(new Map<string, string>());
  const [cardCloseUpTick, setCardCloseUpTick] = useState(0);
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.answerArrived || !activeTab) return;
    const msgs = activeTab.messages;
    const last = msgs[msgs.length - 1];
    // Its pop-up summary is on the way (at most 8 s): the card keeps thinking until it's here.
    // (One left over from a closed app is ignored.)
    if (last && last.role === 'assistant' && last.summaryPending && Date.now() - (last.timestamp || 0) < 15000) return;
    const v = last && last.role === 'assistant' && !last.visualHidden ? last.visual : undefined;
    const dr = last && last.role === 'assistant' && !last.drawnHidden ? last.drawn : undefined;
    const closeUp = last ? cardCloseUpRef.current.get(last.id) : undefined;
    // A drawn answer comes first (owner, Nov 18 2026), shown across the card.
    const picture =
      dr ? {
        url: dr.url, wide: true,
        credit: dr.on === 'illustration' ? tr('drawn.illustrationNote') : dr.on === 'wiki' ? tr('drawn.onWiki', { site: dr.page?.site || 'wiki' }) : tr('drawn.onScreen'),
        ...(dr.on === 'illustration' ? { tag: tr('drawn.illustration') } : {}),
      }
        : v?.kind === 'picture' && v.source !== 'ours' ? { url: v.url, credit: v.credit || v.page?.site || '' }
        : v?.kind === 'video' ? { url: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`, credit: v.channel || 'YouTube', video: true, videoId: v.videoId, start: v.start, seconds: v.seconds, title: v.title }
        : closeUp ? { url: closeUp, credit: tr('card.yourScreen') }
        : null;
    const sig = last && last.role === 'assistant' ? `${last.id}:${(last.text || '').length}:${picture?.url.slice(-40) || ''}` : '';
    const first = cardSeenRef.current === null;
    if (sig === cardSeenRef.current) return;
    cardSeenRef.current = sig;
    if (first || !sig) return; // what was there on start isn't new
    let question = '';
    for (let i = msgs.length - 2; i >= 0; i--) if (msgs[i].role === 'user') { question = String(msgs[i].text || ''); break; }
    api.answerArrived({
      id: last.id,
      question: question.slice(0, 200),
      title: last.title || '',
      text: String(last.text || '').slice(0, 6000),
      steps: (last.steps || []).map((s) => ({ kind: s.kind, label: s.label || s.text, where: s.where || '' })),
      // What to do now (Nov 19 2026), until a bigger hint level is opened.
      summary: last.summary || '',
      model: /pro/i.test(last.modelUsed || '') ? 'Pro' : last.modelUsed ? 'Fast' : '',
      place: activeTab.place?.name || '',
      combat: !!last.combat,
      picture,
      // Immersive mode (owner, Nov 20 2026, idea #8): the pop-up's storybook look.
      immersive: settings.aiMode === 'roleplay',
    });
  }, [activeTab?.messages, cardCloseUpTick]);
  useEffect(() => {
    const on = () => void runHelpRef.current();
    window.addEventListener('qc-help-here', on);
    return () => window.removeEventListener('qc-help-here', on);
  }, []);

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
    ? buildTrackerPayload({ ...activeTab, place: logPlace }, trackerMsg, trackerGame.guideArea, trackerGame.achievementGuide, trackerWords, {
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
    ? buildLogView({ ...activeTab, place: logPlace }, heldPayload?.data || null, { gameKey: trackerKeyOfGame, accent: trackerAccent, loaded: guideSteps.section, labels: trackerWords, walk: trackerGame.guideArea && Array.isArray((trackerGame.guideArea.page as any)?.walkthrough)
        ? { slug: trackerGame.guideArea.slug, steps: (trackerGame.guideArea.page as any).walkthrough, done: trackerGame.guideArea.done }
        : null,
        // What Locate me saw the player doing there: only that makes a guide step "Now".
        doing: logPlace?.doing || null,
        foes: trackerGame.guideArea?.page
          ? { slug: trackerGame.guideArea.slug, list: [...(((trackerGame.guideArea.page as any).fights as Foe[]) || []), ...(((trackerGame.guideArea.page as any).enemies as Foe[]) || [])] }
          : null,
        // The place isn't known: "Where are you?" (any game, Nov 15 2026), with what an unsure check or answer thought,
        // and where this playthrough was last time.
        where: !placeCurrent && trackerGame.looked
          ? {
              locating,
              suggestion: (whereFor?.tabId === activeTab.id ? whereFor.suggestion : '') || (activeTab.place?.name && !activeTab.place.confirmed && !activeTab.place.sure ? activeTab.place.name : undefined) || undefined,
              last: activeTab.place?.name && (activeTab.place.confirmed || activeTab.place.sure) ? activeTab.place.name : undefined,
              areas: trackerGame.areas.map((a) => a.name),
            }
          : null })
    : null;
  const logViewRef = useRef(logView);
  logViewRef.current = logView;
  // The conversation's place strip and the guide follow the same rule: a place that isn't known now isn't shown as
  // where the player is (the log asks "Where are you?").
  const chatTab = useMemo(() => (activeTab && logView?.where && activeTab.place ? { ...activeTab, place: undefined } : null), [activeTab, !!logView?.where]);

  // Checking where the player is (owner, Oct 31 2026): due when a game starts, when a tab is opened or switched to
  // while its game runs, and when the player comes back to the game after a while (electron: game-in-view). The check
  // runs by itself once per due moment (runLocate(true): a quiet screenshot, the Fast model, its own daily allowance).
  useEffect(() => {
    if (runId && runningTab) markLocateDue(runningTab.id);
  }, [runId]);
  useEffect(() => {
    // A tab switched to whose place was checked in the last few minutes (a quick look at another tab) isn't checked again.
    const checked = activeTab?.place?.checkedAt || 0;
    if (activeTab && runningOpen && Date.now() - checked > 5 * 60_000) markLocateDue(activeTab.id);
  }, [activeTab?.id, runningOpen]);
  const autoTried = useRef<Record<string, number>>({});
  const runLocateRef = useRef(runLocate);
  runLocateRef.current = runLocate;
  useEffect(() => {
    if (!activeTab || !runningOpen || !dueAt || placeCurrent || !trackerGame.looked) return;
    if ((autoTried.current[activeTab.id] || 0) >= dueAt) return;
    autoTried.current[activeTab.id] = dueAt;
    // A moment for a game that just started (or a tab just switched to) to settle.
    const t = setTimeout(() => void runLocateRef.current(true), 1500);
    return () => clearTimeout(t);
  }, [activeTab?.id, runningOpen, dueAt, placeCurrent, trackerGame.looked]);
  const runningTabRef = useRef(runningTab);
  runningTabRef.current = runningTab;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useEffect(() => {
    const api = (window as any).electronAPI;
    // The game is in view again: after a while away (returned), the place is checked again; a check that waited for the
    // game (pendingAutoLocate) runs now.
    api?.onGameInView?.((e: { returned?: boolean }) => {
      const tab = activeTabRef.current;
      const running = runningTabRef.current;
      if (e?.returned && running) markLocateDue(running.id);
      else if (tab && pendingAutoLocate.current === tab.id) setTimeout(() => void runLocateRef.current(true), 800);
    });
    // Locate me from anywhere: its shortcut (Ctrl+Shift+K) and the controller's button.
    // The Locate me shortcut (Ctrl+Shift+K) is Help me here now (owner, Nov 15 2026; roadmap item 30).
    api?.onLocateKey?.(() => void runHelpRef.current());
  }, []);
  // The guide's missable list for where the player is looks thin: the area is flagged for the nightly improver to check
  // against sources (guidesApi.ts missables-thin; once a week per area from this device). Only the area is sent.
  const thinArea = placeCurrent && trackerGame.guideKey && trackerGame.guideArea?.page && missablesThin(trackerGame.guideArea.page as any)
    ? `${trackerGame.guideKey}/${trackerGame.guideArea.slug}` : '';
  useEffect(() => {
    if (!thinArea) return;
    const k = `qc-missables-thin:${thinArea}`;
    try {
      if (Date.now() - Number(localStorage.getItem(k) || 0) < 7 * 86_400_000) return;
      localStorage.setItem(k, String(Date.now()));
    } catch {}
    fetch(`${getApiBaseUrl()}/api/guides/${thinArea.split('/').map(encodeURIComponent).join('/')}/missables-thin`, { method: 'POST' }).catch(() => {});
  }, [thinArea]);
  // The step the tick key acts on (next / prev move it): Now unless another step was picked.
  const [logSelPick, setLogSel] = useState<string | null>(null);
  const logSteps = logView ? [logView.now, ...logView.next, ...(logView.here?.items || [])].filter((x): x is NonNullable<typeof x> => !!x && x.tick) : [];
  const logSel = logSteps.some((x) => x.id === logSelPick) ? logSelPick : logSteps[0]?.id || null;
  const logSelRef = useRef(logSel);
  logSelRef.current = logSel;
  // The last tick, shown for a few seconds with Undo (from the log, the tick key, or a question that said it was done).
  // from 'now': a question set its answer as Now by itself (owner, Oct 31 2026); Undo puts back what Now was (prev).
  type LogCleared = { ids: string[]; text: string; from?: 'question' | 'now' | 'moved' | 'removed'; msgId?: string; prev?: string };
  const [logCleared, setLogCleared] = useState<LogCleared | null>(null);
  const logClearedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCleared = (c: LogCleared | null) => {
    if (logClearedTimer.current) clearTimeout(logClearedTimer.current);
    setLogCleared(c);
    if (c) logClearedTimer.current = setTimeout(() => setLogCleared(null), 6000);
  };
  const patchLog = (fn: (s: NonNullable<GameTab['questLog']>) => Partial<NonNullable<GameTab['questLog']>>) => {
    const t = activeTab;
    if (!t) return;
    setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, questLog: nextLogState(x.questLog, fn(x.questLog || {})), lastActive: Date.now() } : x)));
  };
  // Guide entries an answer advised against come back once the corrections check decides (owner, Oct 31 2026):
  // "applied" (the guide entry now says it, e.g. leave it until the World of Ruin), "dismissed" (the guide was right), or
  // no check at all; and after HELD_DAYS whatever happens. Checked when the tab is opened and every 30 minutes.
  const heldTabId = activeTab?.id;
  const heldKey = (activeTab?.questLog?.held || []).map((h) => h.id).join(',');
  useEffect(() => {
    if (!heldTabId || !heldKey) return;
    let stop = false;
    const check = async () => {
      const t = tabsRef.current.find((x) => x.id === heldTabId);
      const held = t?.questLog?.held || [];
      if (!held.length) return;
      const groups = held.map((h) => h.group).filter((g): g is string => !!g);
      let status: Record<string, string> = {};
      if (groups.length) {
        try {
          const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken() : null;
          const res = await fetch(`${getApiBaseUrl()}/api/corrections/status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ groups }),
          });
          if (res.ok) status = (await res.json())?.status || {};
          else return;
        } catch {
          return;
        }
      }
      if (stop) return;
      const now = Date.now();
      const keep = held.filter((h) => now - h.at < HELD_DAYS * 86_400_000 && !!h.group && !['applied', 'dismissed', 'none'].includes(status[h.group] || 'pending'));
      if (keep.length !== held.length) setTabs((prev) => prev.map((x) => (x.id === heldTabId ? { ...x, questLog: nextLogState(x.questLog, { held: keep }) } : x)));
    };
    void check();
    const timer = setInterval(check, 30 * 60_000);
    return () => { stop = true; clearInterval(timer); };
  }, [heldTabId, heldKey]);
  // The tracker gets the log too (the popped-out window draws it; the bookmark and the spine show its number).
  const trackerPayload = heldPayload || logView
    ? {
        gameKey: heldPayload?.gameKey || trackerKeyOfGame,
        data: {
          ...(heldPayload?.data || { id: '', accent: trackerAccent, quest: '', sections: [], labels: trackerWords }),
          // The place isn't known: no place line and no guide lists, only the log's "Where are you?".
          ...(logView?.where ? { place: undefined, areas: undefined, sections: [] } : {}),
          log: logView
            ? { now: logView.now, next: logView.next, watch: logView.watch, done: logView.done, pins: logView.pins.length, more: logView.more.length > 0, invite: logView.invite, sel: logSel || '', bookmark: logView.bookmark, ...(logView.where ? { where: logView.where } : {}), ...(logView.here ? { here: logView.here } : {}) }
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
    ? { area: trackerGame.guideArea.name, items: missSection.items.filter((it) => !it.done && ![...(activeTab?.questLog?.hidden || []), ...heldIds(activeTab?.questLog)].includes(it.id)).map((it) => ({ id: it.id, label: it.label, why: it.detail?.missable, where: it.where })) }
    : null;
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
  // (No tick boxes, owner Nov 20 2026, idea #6: a guide item removed from the quest log is kept where ticks were, but
  // removing isn't "found", so it no longer goes on Your playthrough's Found; and a marker hidden with its eye only hides
  // the marker, it doesn't take the guide entry off the log.)
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

  // The controller's open combo moves from holding View + Menu (it also opens Windows' multitasking view and Game Bar)
  // to holding L3 + R3, once (owner, Nov 17 2026). A short note says so, and the first-time controller guide shows
  // again with the new combo. Anyone can pick View + Menu again in Settings; this never runs twice.
  useEffect(() => {
    if (settings.padComboMoved) return;
    const was = settings.controllerToggle;
    const moving = !was || was === 'hold-view-menu' || was === 'back+start';
    setSettings((s) => ({ ...s, padComboMoved: true, ...(moving ? { controllerToggle: 'hold-ls-rs' as const } : {}) }));
    if (!moving) return;
    // Nothing saved means the old default: a note only for players who have used a controller here already.
    let usedPad = !!was;
    try {
      usedPad = usedPad || !!localStorage.getItem('qc-pad-intro-seen');
      localStorage.removeItem('qc-pad-intro-seen');
    } catch {
      /* the guide just won't show again */
    }
    if (!usedPad) return;
    setMouseToast(tr('pad.comboMoved'));
    if (mouseToastTimer.current) clearTimeout(mouseToastTimer.current);
    mouseToastTimer.current = setTimeout(() => setMouseToast(null), 9000);
  }, [settings.padComboMoved, settings.controllerToggle]);
  // The plan the Premium screen starts on: monthly, or yearly when a link asks for it (?plan=year).
  const [paywallInterval, setPaywallInterval] = useState<'month' | 'year'>('month');
  // Subscribe for everyone not on Premium (owner, Nov 15 2026), at the right end of the game-detected row under the top
  // bar (the top bar has no room for it next to the game's name). Guests get the same Premium card, which asks them to sign in.
  const subscribeBtn = user && userData && !userData.isPremium ? (
    <button
      type="button"
      data-qc-subscribe
      onClick={() => { playBlipSound(settings.soundEnabled); setIsPaywallOpen(true); }}
      title={tr('prem.headerTitle')}
      className="h-5 px-2 rounded-md bg-[var(--accent-color)] text-black hover:brightness-110 cursor-pointer flex items-center gap-1 text-[11px] font-bold whitespace-nowrap shadow-[0_0_10px_var(--accent-dim)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      <Sparkles className="w-3 h-3" />
      {tr('prem.header')}
    </button>
  ) : null;
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
      // The popped-out log's Now X, its Undo, and a step brought back from "Earlier" (idea #3).
      else if (a === 'move-on' && typeof e.id === 'string' && e.id) moveOnRef.current({ id: e.id, text: String(e.text || ''), ...(typeof e.msgId === 'string' && e.msgId ? { msgId: e.msgId } : {}) });
      else if ((a === 'unpass' || a === 'bring-back') && typeof e.id === 'string' && e.id) bringBackRef.current(e.id);
      else if (a === 'whats-next') window.dispatchEvent(new CustomEvent('qc-ask', { detail: { text: tr('tracker.logWhatsNext') } }));
      else if (a === 'ask') setTimeout(() => document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus(), 250);
      return;
    }
    if (e.type === 'log-snap') {
      // The popped-out log dropped back against the panel's side: docked again.
      (window as any).electronAPI?.trackerAttach?.(true);
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
      void runHelpRef.current();
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
  // The quest log's actions (the docked log, the popped-out window, the next-step keys, the answers' Set as Now and Save).
  /**
   * Remove on the quest log (owner, Nov 20 2026, idea #6: no tick boxes). A step of the objective (Now or Next) moves on,
   * to Earlier, as the Now box's X; a guide item is taken off the log for this playthrough, kept where its tick was (so it
   * syncs, and things ticked before stay off). Undo for a few seconds.
   */
  const removeLog = (s: { id: string; text: string; msgId?: string }) => {
    const v = logViewRef.current;
    if (v && [v.now, ...v.next].some((x) => x?.id === s.id)) return moveOn(s);
    trackerEventRef.current({ type: 'tick', item: s.id, done: true });
    // It's listed under Earlier too (no place: it doesn't come back by itself), where a tap puts it back.
    patchLog((st) => ({ passed: [...(st.passed || []).filter((x) => x.id !== s.id), { id: s.id, text: s.text, at: Date.now() }] }));
    showCleared({ ids: [s.id], text: s.text, from: 'removed' });
  };
  const undoLog = () => {
    const c = logCleared;
    if (!c) return;
    if (c.from === 'now') {
      patchLog((st) => (st.now === c.msgId ? { now: c.prev } : {}));
      showCleared(null);
      return;
    }
    if (c.from === 'moved') {
      patchLog((st) => ({ passed: (st.passed || []).filter((x) => !c.ids.includes(x.id)) }));
      showCleared(null);
      return;
    }
    for (const id of c.ids) trackerEventRef.current({ type: 'tick', item: id, done: false });
    if (c.from === 'removed') patchLog((st) => ({ passed: (st.passed || []).filter((x) => !c.ids.includes(x.id)) }));
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
  const togglePin = (msgId: string) => patchLog((st) => ({ pins: (st.pins || []).includes(msgId) ? (st.pins || []).filter((x) => x !== msgId) : [msgId, ...(st.pins || [])].slice(0, 50) }));
  const hideWatch = (id: string) => patchLog((st) => ({ hidden: [...new Set([...(st.hidden || []), id])] }));
  // The Now box's X (owner, Nov 19 2026, idea #3): move on. The step isn't done and isn't gone: it goes to "Earlier"
  // (tap to make it Now again) and comes back by itself when the player returns to that place. Undo for a few seconds.
  const moveOn = (step: { id: string; text: string; msgId?: string }) => {
    patchLog((st) => ({ passed: [...(st.passed || []).filter((x) => x.id !== step.id), { id: step.id, text: step.text, ...(activeTab?.place?.name ? { place: activeTab.place.name } : {}), ...(step.msgId ? { msgId: step.msgId } : {}), at: Date.now() }] }));
    showCleared({ ids: [step.id], text: step.text, from: 'moved', ...(step.msgId ? { msgId: step.msgId } : {}) });
  };
  const bringBack = (id: string) => {
    patchLog((st) => {
      const x = (st.passed || []).find((p) => p.id === id);
      return { passed: (st.passed || []).filter((p) => p.id !== id), ...(x?.msgId && st.now !== x.msgId ? { now: x.msgId } : {}) };
    });
    // A guide item removed from the log (Nov 20 2026, no tick boxes): it comes back onto the log.
    if (/^g:/.test(id)) trackerEventRef.current({ type: 'tick', item: id, done: false });
    if (logCleared?.from === 'moved' && logCleared.ids.includes(id)) showCleared(null);
  };
  const moveOnRef = useRef(moveOn);
  moveOnRef.current = moveOn;
  // "Looks done" (owner, Nov 20 2026): the answer saw on the screenshot that the Now step is finished (the player didn't
  // say so): the log offers Move on / Not yet. Never done by itself; the next question clears the offer.
  const [looksDone, setLooksDone] = useState<string | null>(null);
  const answerLooksDone = (yes: boolean) => {
    const n = logView?.now;
    if (yes && n && looksDone === n.id) moveOn({ id: n.id, text: n.text, ...(n.msgId ? { msgId: n.msgId } : {}) });
    setLooksDone(null);
  };
  // Earlier's session notes (utils/earlierSessions.ts): asked for when Earlier is opened, kept on that game's log.
  const notesAsked = useRef(new Set<string>());
  const needNote = async (s: EarlierSession) => {
    const tab = activeTab;
    if (!tab) return;
    const ask = `${tab.id}:${s.key}:${s.count}`;
    if (notesAsked.current.has(ask)) return;
    notesAsked.current.add(ask);
    try {
      const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken().catch(() => null) : (user as any)?.isGuest ? String((user as any).uid) : null;
      const res = await fetch(`${getApiBaseUrl()}/api/session-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ game: displayGameName(tab.name || ''), language: aiLanguageName(settings.language), places: s.places.map((p) => ({ place: p.place, items: p.items.map((i) => ({ text: i.text })) })), questions: s.questions }),
      });
      const note = String((await res.json().catch(() => null))?.note || '').trim();
      if (!note) return;
      setTabs((prev) => prev.map((x) => (x.id === tab.id ? { ...x, questLog: nextLogState(x.questLog, { notes: { ...(x.questLog?.notes || {}), [s.key]: { t: note, n: s.count } } }) } : x)));
    } catch {
      /* no note: Earlier shows the steps alone */
    }
  };
  const bringBackRef = useRef(bringBack);
  bringBackRef.current = bringBack;
  // Back in a place the player moved on from steps in: those steps come back (they may want them now).
  const passedPlaceRef = useRef<{ tab?: string; place?: string }>({});
  useEffect(() => {
    const tabId = activeTab?.id, place = activeTab?.place?.name;
    const before = passedPlaceRef.current;
    passedPlaceRef.current = { tab: tabId, place };
    if (!tabId || !place || before.tab !== tabId || !before.place || samePlace(before.place, place)) return;
    if ((activeTab?.questLog?.passed || []).some((x) => x.place && samePlace(x.place, place))) {
      patchLog((st) => ({ passed: (st.passed || []).filter((x) => !(x.place && samePlace(x.place, place))) }));
    }
  }, [activeTab?.id, activeTab?.place?.name]);
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
      // The "next step" key (was the tick key): Now moves on; with the log out of sight, the new Now shows over the game.
      const st = v.now && v.now.tick ? v.now : steps[0];
      if (!st) return;
      moveOn({ id: st.id, text: st.text, ...(st === v.now && v.now.msgId ? { msgId: v.now.msgId } : {}) });
      setLogSel(null);
      if (!onScreen) api?.trackerHeads?.(steps.filter((x) => x.id !== st.id)[0]?.text || '');
    } else if (action === 'remove') {
      // The controller's X in the attached log: the highlighted item is removed (Undo for a few seconds).
      const all = [v.now, ...v.next, ...(v.here?.items || [])].filter((x): x is NonNullable<typeof x> => !!x && x.tick);
      const st = all.find((x) => x.id === sel) || all[0];
      if (!st) return;
      removeLog({ id: st.id, text: st.text, ...(st === v.now && v.now.msgId ? { msgId: v.now.msgId } : {}) });
      setLogSel(null);
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
  /**
   * Close-up check of each marker. Returns null when the check couldn't run (so nothing is removed on errors).
   * `checked`: how many of the items the server looked at (the first N; older servers check 5).
   */
  const pinpoint = async (image: string, items: { x: number; y: number; label: string; where: string; category?: string; guide?: boolean }[], game: string, token: string | null): Promise<{ found: CheckFound[]; checked: number } | null> => {
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
      return { index, x0, y0, image: canvas.toDataURL('image/jpeg', 0.85), label: p.label, where: p.where, category: p.category, guide: !!p.guide };
    });
    const res = await fetch(`${getApiBaseUrl()}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      // Which app and version asked, and which markers are guide entries: kept with any removals (Quality page).
      body: JSON.stringify({ crops: crops.map((c) => ({ image: c.image, label: c.label, where: c.where, category: c.category, ...(c.guide ? { guide: true } : {}) })), game, client: (window as any).electronAPI ? 'desktop' : 'web', appVersion: APP_VERSION }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const found = (Array.isArray(data.found) ? data.found : [])
      .map((f: { index: number; x: number; y: number }) => {
        const c = crops[f.index];
        return c ? { index: c.index, x: (c.x0 + f.x * side) / W, y: (c.y0 + f.y * side) / H } : null;
      })
      .filter(Boolean) as CheckFound[];
    const checked = Number.isInteger(data.checked) ? Math.min(data.checked, crops.length) : Math.min(5, crops.length);
    return { found, checked };
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
  recapNowRef.current.play = play;
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
  const rememberPlay = (items: { kind: PlayKind; text: string; source: 'answer' | 'guide'; msgId?: string }[]) => {
    if (!memoryOn || !items.length) return;
    updatePlay((p) => addEntries(p, items));
  };
  const rememberPlayRef = useRef(rememberPlay);
  rememberPlayRef.current = rememberPlay;

  // Delete a question and its answer (owner, Nov 20 2026, idea #10): gone from the conversation at once, so from what
  // later questions send (their history), the quest log (Now, Saved, Earlier), the recap and the pop-up's Last card, and
  // the playthrough notes it added. Undo for 8 seconds (or Ctrl+Z); only then is the delete made final for the other
  // copies (tombstones: tabMerge for tabs, deletedMsgs for game spaces), so Undo always works.
  type QaDeleted = { tabId: string; ids: string[]; removed: { at: number; msg: ChatMessage }[]; logBefore?: Partial<NonNullable<GameTab['questLog']>>; gone: PlayEntry[] };
  const [qaDeleted, setQaDeleted] = useState<QaDeleted | null>(null);
  const qaPending = useRef<QaDeleted | null>(null);
  const qaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishDelete = () => {
    const d = qaPending.current;
    qaPending.current = null;
    if (qaTimer.current) { clearTimeout(qaTimer.current); qaTimer.current = null; }
    setQaDeleted(null);
    if (!d) return;
    const now = Date.now();
    recordDeletedMessages(d.ids, now);
    if (spacesOn) {
      setTabs((prev) => prev.map((t) => {
        if (t.id !== d.tabId) return t;
        const all = Object.entries({ ...(t.deletedMsgs || {}), ...Object.fromEntries(d.ids.map((id) => [id, now])) }).sort((a, b) => b[1] - a[1]).slice(0, 300);
        return { ...t, deletedMsgs: Object.fromEntries(all) };
      }));
    }
    for (const id of d.ids) (window as any).electronAPI?.forgetAnswer?.(id);
  };
  const finishDeleteRef = useRef(finishDelete);
  finishDeleteRef.current = finishDelete;
  const deleteQa = (answerId: string) => {
    const tab = activeTab;
    if (!tab) return;
    if (qaPending.current) finishDelete();
    const ids = qaPair(tab.messages, answerId);
    if (!ids.length) return;
    const removed = tab.messages.map((msg, at) => ({ at, msg })).filter((x) => ids.includes(x.msg.id));
    const logPatch = logWithout(tab.questLog, ids);
    const logBefore = logPatch ? (Object.fromEntries(Object.keys(logPatch).map((k) => [k, (tab.questLog as any)?.[k]])) as QaDeleted['logBefore']) : undefined;
    setTabs((prev) => prev.map((t) => (t.id === tab.id
      ? { ...t, messages: t.messages.filter((m) => !ids.includes(m.id)), ...(logPatch ? { questLog: nextLogState(t.questLog, logPatch) } : {}) }
      : t)));
    const gone = playRef.current.entries.filter((e) => e.msgId && ids.includes(e.msgId));
    if (gone.length) updatePlay((p) => forgetAnswers(p, ids));
    const d: QaDeleted = { tabId: tab.id, ids, removed, logBefore, gone };
    qaPending.current = d;
    setQaDeleted(d);
    qaTimer.current = setTimeout(() => finishDeleteRef.current(), 8000);
  };
  const undoDelete = () => {
    const d = qaPending.current;
    if (!d) return;
    qaPending.current = null;
    if (qaTimer.current) { clearTimeout(qaTimer.current); qaTimer.current = null; }
    setQaDeleted(null);
    setTabs((prev) => prev.map((t) => {
      if (t.id !== d.tabId) return t;
      const msgs = [...t.messages];
      for (const r of d.removed) msgs.splice(Math.min(r.at, msgs.length), 0, r.msg);
      return { ...t, messages: msgs, ...(d.logBefore ? { questLog: nextLogState(t.questLog, d.logBefore) } : {}) };
    }));
    if (d.gone.length) {
      const back = new Set(d.gone.map((e) => e.id));
      updatePlay((p) => ({ ...p, entries: [...d.gone, ...p.entries].sort((a, b) => b.at - a.at), deleted: Object.fromEntries(Object.entries(p.deleted || {}).filter(([id]) => !back.has(id))), updatedAt: Date.now() }));
    }
  };
  const undoDeleteRef = useRef(undoDelete);
  undoDeleteRef.current = undoDelete;
  const qaShowing = !!qaDeleted;
  useEffect(() => {
    if (!qaShowing) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      undoDeleteRef.current();
    };
    // Closing the app inside the 8 seconds: the delete is made final now.
    const unload = () => finishDeleteRef.current();
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [qaShowing]);

  // Find an answer again (owner, Nov 20 2026, idea #1): the magnifier above the conversation, or Ctrl+F.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      setSearchOpen(true);
      setTimeout(() => document.querySelector<HTMLInputElement>('[data-qc-search] input')?.focus(), 0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const pickFound = (tabId: string, answerId: string) => {
    setSearchOpen(false);
    if (tabId !== activeTab?.id) handleSelectTab(tabId);
    setTimeout(() => window.dispatchEvent(new CustomEvent('qc-scroll-to-msg', { detail: { id: answerId } })), 30);
  };
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

  /**
   * Visual answers (owner, Nov 14 2026): after the answer has arrived, one video or picture for it, if one helps
   * (visualServer.ts). The answer itself never waits for this or changes; nothing found (or the feature off) adds nothing.
   */
  /**
   * The pop-up's summary (owner, Nov 19 2026): what to do now, made from the finished answer by its own small call
   * (server: /api/card-summary), so the answer itself is never changed by it. The card waits for it (summaryPending),
   * at most 8 s; without one it shows the answer as before.
   */
  const fetchCardSummary = async (msgId: string, question: string, answer: string, token: string | null) => {
    let summary = '';
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(`${getApiBaseUrl()}/api/card-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // Immersive mode: the summary keeps the narrator's voice (the action stays plain and exact).
        body: JSON.stringify({ question, answer: answer.slice(0, 12000), ...(settingsRef.current?.aiMode === 'roleplay' ? { immersive: true } : {}) }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.summary === 'string') summary = data.summary.trim().slice(0, 320);
      }
    } catch {
      /* no summary: the card shows the answer */
    }
    updateMessageById(msgId, (m) => {
      const { summaryPending: _p, ...rest } = m;
      return summary ? { ...rest, summary } : rest;
    });
  };

  const fetchVisual = async (msgId: string, question: string, answer: string, game: string, token: string | null, shotOnly = false) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // shotOnly: no typed question (a screenshot or voice message): the server takes the topic from the answer.
        body: JSON.stringify({ game, guideKey: trackerGameRef.current?.guideKey || undefined, question, answer, client: (window as any).electronAPI ? 'desktop' : 'web', appVersion: APP_VERSION, ...(shotOnly ? { shotOnly: true } : {}) }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.visual && (data.visual.kind === 'video' || data.visual.kind === 'picture' || data.visual.kind === 'link')) {
        updateMessageById(msgId, (m) => ({ ...m, visual: data.visual, visualRef: typeof data.ref === 'string' ? data.ref : undefined }));
      }
    } catch {
      /* no visual: the answer is complete without one */
    }
  };

  /**
   * Drawn answers (owner, Nov 18 2026; drawnAnswer.ts): the answer drawn on the question's screenshot or a wiki picture,
   * or an illustration, when seeing it helps (the server decides; most answers get none). After the answer, alongside
   * the visual; the answer never waits for it.
   */
  const fetchDrawn = async (msgId: string, question: string, answer: string, game: string, token: string | null, shotOnly: boolean, image?: string, live = false, markers: string[] = []) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/drawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ game, guideKey: trackerGameRef.current?.guideKey || undefined, question, answer, client: (window as any).electronAPI ? 'desktop' : 'web', ...(image ? { image } : {}), ...(shotOnly ? { shotOnly: true } : {}), ...(live && markers.length ? { markers } : {}) }),
      });
      if (!res.ok) return;
      const body = await res.json();
      // Step 3 (desktop): lines joining the answer's markers in order, rings for rough areas, over the game with them.
      const pins = body?.pins;
      if (live && pins && Array.isArray(pins.order) && Array.isArray(pins.areas)) (window as any).electronAPI?.setPointerPins?.({ id: msgId, pins });
      const d = body?.drawn;
      if (d && d.kind === 'drawn' && typeof d.url === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d.url) && ['screen', 'wiki', 'illustration'].includes(d.on)) {
        const page = d.page && /^https:\/\//.test(String(d.page.url || '')) ? { url: String(d.page.url), title: String(d.page.title || '').slice(0, 120), site: String(d.page.site || '').slice(0, 60) } : undefined;
        updateMessageById(msgId, (m) => ({ ...m, drawn: { kind: 'drawn', url: d.url, on: d.on, alt: String(d.alt || '').slice(0, 200), ...(page ? { page } : {}) } }));
        // Step 2 (desktop): drawn on a screen that holds still (a map, a menu): the strokes over the live game while that
        // screen stays the same. Not kept in the conversation.
        const api = (window as any).electronAPI;
        if (live && image && d.on === 'screen' && typeof d.layer === 'string' && d.layer.startsWith('data:image/png;base64,') && api?.showDrawnLayer) {
          void api.showDrawnLayer({ id: msgId, layer: d.layer, ref: image });
        }
      }
    } catch {
      /* no drawing: the answer is complete without one */
    }
  };

  /** Played, opened (counted for /stats) or "Not right" for a visual shown in the quest log. */
  const sendVisualEvent = async (type: 'played' | 'opened' | 'wrong', ref?: string) => {
    try {
      const token = user && typeof (user as any).getIdToken === 'function' ? await (user as any).getIdToken().catch(() => null) : (user as any)?.isGuest ? String((user as any).uid) : null;
      await fetch(`${getApiBaseUrl()}/api/visual/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type, ...(ref ? { ref } : {}) }),
      });
    } catch {
      /* counting only */
    }
  };

  const refineMarkers = async (msgId: string, image: string, points: ScreenPoint[], game: string, token: string | null) => {
    const api = (window as any).electronAPI;
    const log = (m: string) => api?.markerLog?.(m);
    // The markers are on screen dimmed ("checking") until this settles them, whatever happens.
    let moves: CheckFound[] = [];
    let removed: number[] = [];
    try {
      const res = await pinpoint(image, points.map((p) => ({ x: p.x, y: p.y, label: p.label, where: p.where || '', category: p.category, guide: !!p.guideId })), game, token);
      if (!res) {
        log('precision pass skipped (check unavailable)');
        return;
      }
      // Markers the strict close-up check couldn't find aren't really on screen (the AI expected something from its
      // memory of the place, like an NPC from another visit or stairs that aren't there): remove them. Only markers the
      // check actually looked at can be removed. Ticks carry over to the new numbering.
      const s = settleCheck(points, res.found, res.checked, tabsRef.current.flatMap((t) => t.messages).find((m) => m.id === msgId)?.donePoints ?? []);
      moves = s.moves;
      removed = s.removed;
      log(`precision pass: ${s.moves.length} of ${points.length} marker(s) adjusted, ${s.removed.length} removed`);
      if (!s.moves.length && !s.removed.length) return;
      updateMessageById(msgId, (m) => ({
        ...m,
        points: s.kept.length ? s.kept : undefined,
        ...(s.removed.length ? { donePoints: s.done, removedMarkers: [...(m.removedMarkers || []), ...s.removedLabels], removedPoints: [...(m.removedPoints || []), ...s.removed.map((i) => points[i])] } : {}),
      }));
    } catch (e: any) {
      log(`precision pass skipped: ${e?.message ?? e}`);
    } finally {
      api?.settlePointers?.(msgId, moves, removed);
    }
  };

  /** A close-up (384 px square) around each marked spot of the question's screenshot: what each thing looked like. */
  const closeUps = async (image: string, points: { x: number; y: number }[]): Promise<string[] | null> => {
    try {
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
      canvas.width = 384;
      canvas.height = 384;
      const ctx = canvas.getContext('2d');
      if (!ctx || side < 40) return null;
      ctx.imageSmoothingEnabled = false; // keep pixel art crisp
      return points.map((p) => {
        const x0 = Math.max(0, Math.min(W - side, Math.round(p.x * W - side / 2)));
        const y0 = Math.max(0, Math.min(H - side, Math.round(p.y * H - side / 2)));
        ctx.drawImage(img, x0, y0, side, side, 0, 0, 384, 384);
        return canvas.toDataURL('image/jpeg', 0.85);
      });
    } catch {
      return null;
    }
  };

  /**
   * Markers v2 (Nov 2026): the answer arrives ~20 s after its screenshot, and in a 3D game the camera has moved by then.
   * So take a fresh picture of the screen and find each marked thing on it (/api/refind, with a close-up of each from the
   * screenshot); the markers are tracked from that picture. Things not on screen now are listed under the answer
   * instead. Replaces the close-up check on desktop; if anything fails, the markers go up the old way (screenshot + check).
   */
  const markerRunRef = useRef('');
  // When each answer's markers first went up (their display time counts from then), and how often they've been found again.
  const markerShownAtRef = useRef(new Map<string, number>());
  const findAgainRef = useRef(new Map<string, { auto: number; manual: number; empty: number }>());
  /** Finding again: by itself at most 3 times per answer (stopping after 2 finds that saw none of them), 10 on request. */
  const AUTO_FINDS = 3;
  const MANUAL_FINDS = 10;

  /**
   * Markers v2, step 3: find an answer's markers again on the screen as it is now. `auto`: the marker page lost the view
   * (the camera turned, the player walked) and the screen has held still since; otherwise the player asked (Find again,
   * the shortcut, Show). Things listed as not on screen are looked for too, and go back in the list when found. Markers
   * not found this time stay in the list but aren't drawn. The server caps finding again per day (markerFindCap.ts).
   */
  const findMarkersAgain = async (msgId: string | undefined, auto: boolean) => {
    const api = (window as any).electronAPI;
    const log = (m: string) => api?.markerLog?.(m);
    const id = msgId || markerRunRef.current;
    if (!api?.captureScreenNow || !id) return;
    const stop = () => {
      if (auto) api.hideScreenPointers?.();
    };
    const tab = tabsRef.current.find((t) => t.messages.some((m) => m.id === id));
    const at = tab ? tab.messages.findIndex((m) => m.id === id) : -1;
    const msg = tab && at >= 0 ? tab.messages[at] : undefined;
    let shot: string | undefined;
    for (let i = at - 1; tab && i >= 0; i--) {
      if (tab.messages[i].role === 'user') {
        shot = tab.messages[i].imageUrl;
        break;
      }
    }
    const listed = msg?.points ?? [];
    const gone = msg?.removedPoints ?? [];
    if (!msg || !shot || (!listed.length && !gone.length)) return stop();
    const c = findAgainRef.current.get(id) || { auto: 0, manual: 0, empty: 0 };
    if (auto ? c.auto >= AUTO_FINDS || c.empty >= 2 : c.manual >= MANUAL_FINDS) {
      log(`not finding the markers again: ${auto ? (c.empty >= 2 ? 'two finds in a row saw none of them' : `${AUTO_FINDS} finds already`) : `${MANUAL_FINDS} finds on request already`}`);
      return stop();
    }
    // The display time counts from when they first went up; asking again starts it over.
    const lifetimeMs = Math.max(0, settingsRef.current.markerLifetime ?? 120) * 1000;
    const shownAt = markerShownAtRef.current.get(id) ?? Date.now();
    const leftMs = lifetimeMs > 0 ? lifetimeMs - (Date.now() - shownAt) : 0;
    if (auto && lifetimeMs > 0 && leftMs < 3000) return stop();
    if (auto) c.auto++;
    else c.manual++;
    findAgainRef.current.set(id, c);
    // Area finds (fromArea) were placed on other pictures: not looked for here.
    const items = [...listed, ...gone];
    const lookFor = items.map((p, i) => ({ p, i })).filter(({ p }) => !p.fromArea);
    try {
      const t0 = performance.now();
      const user = locateUserRef.current;
      const token = user && typeof user.getIdToken === 'function' ? await user.getIdToken().catch(() => null) : user?.isGuest ? String(user.uid) : null;
      const [screen, crops] = await Promise.all([api.captureScreenNow().catch(() => null), closeUps(shot, lookFor.map(({ p }) => p))]);
      if (!screen || !crops) {
        log('finding again: no fresh picture');
        return stop();
      }
      const res = await fetch(`${getApiBaseUrl()}/api/refind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          image: screen,
          items: lookFor.map(({ p }, k) => ({ crop: crops[k], label: p.label, where: p.where || '', category: p.category, ...(p.guideId ? { guide: true } : {}) })),
          game: tab?.activeSteamGame?.name || tab?.name || '',
          client: 'desktop',
          appVersion: APP_VERSION,
          again: true,
        }),
      });
      if (!res.ok) {
        log(`finding again failed: server ${res.status}${res.status === 429 ? ' (paused for now)' : ''}`);
        return stop();
      }
      const data = await res.json();
      if (markerRunRef.current && markerRunRef.current !== id && auto) return; // a newer answer's markers are up
      const fresh = new Map<number, { x: number; y: number }>();
      for (const f of Array.isArray(data.found) ? data.found : []) {
        const it = lookFor[f?.index];
        if (it && Number.isFinite(f.x) && Number.isFinite(f.y)) fresh.set(it.i, { x: f.x, y: f.y });
      }
      log(`found again: ${fresh.size} of ${lookFor.length} in ${Math.round(performance.now() - t0)} ms (${auto ? `auto ${c.auto} of ${AUTO_FINDS}` : `asked ${c.manual} of ${MANUAL_FINDS}`})`);
      if (!fresh.size) {
        c.empty++;
        findAgainRef.current.set(id, c);
        api.hideScreenPointers?.();
        return;
      }
      c.empty = 0;
      findAgainRef.current.set(id, c);
      // Things that weren't on screen before and are now: back in the answer's list, numbered after the others.
      const back = gone.map((p, j) => ({ p, j })).filter(({ j }) => fresh.has(listed.length + j));
      const points = [...listed, ...back.map(({ p }) => p)];
      if (back.length) {
        const left = gone.filter((_, j) => !fresh.has(listed.length + j));
        updateMessageById(id, (m) => ({
          ...m,
          points,
          removedPoints: left.length ? left : undefined,
          removedMarkers: left.length ? left.map((p) => (p.where ? `${p.label} (${p.where})` : p.label)) : undefined,
        }));
      }
      const order = [...listed.map((_, i) => i), ...back.map(({ j }) => listed.length + j)];
      const drawn = order.map((k, n) => ({ ...points[n], ...(fresh.get(k) || {}) }));
      const missing = order.map((k, n) => (fresh.has(k) ? -1 : n)).filter((n) => n >= 0);
      if (!auto) markerShownAtRef.current.set(id, Date.now());
      markerRunRef.current = id;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
      api.showScreenPointers?.(withGuideNote(drawn), accent, {
        refImage: screen,
        sessionId: id,
        hidden: msg.donePoints ?? [],
        missing,
        combat: !!msg.combat,
        refindable: true,
        ...(auto && leftMs > 0 ? { lifetimeMs: leftMs } : {}),
      });
    } catch (e: any) {
      log(`finding again failed: ${e?.message ?? e}`);
      stop();
    }
  };
  const findMarkersAgainRef = useRef(findMarkersAgain);
  findMarkersAgainRef.current = findMarkersAgain;
  useEffect(() => {
    (window as any).electronAPI?.onRefindRequest?.((r: { id?: string; auto?: boolean }) => void findMarkersAgainRef.current(r.id, r.auto === true));
    // The controller's quick menu: Find markers again (the latest answer's).
    const onFind = () => void findMarkersAgainRef.current(undefined, false);
    window.addEventListener('qc-find-markers', onFind);
    return () => window.removeEventListener('qc-find-markers', onFind);
  }, []);

  const placeMarkersNow = async (msgId: string, image: string, points: ScreenPoint[], accent: string, opts: { combat: boolean; watchNearby: boolean }, game: string, token: string | null) => {
    const api = (window as any).electronAPI;
    const log = (m: string) => api?.markerLog?.(m);
    markerRunRef.current = msgId;
    const fallback = (why: string) => {
      if (markerRunRef.current !== msgId) return;
      log(`placing markers on the screen now failed (${why}): using the screenshot`);
      markerShownAtRef.current.set(msgId, Date.now());
      api?.showScreenPointers?.(withGuideNote(points), accent, { refImage: image, sessionId: msgId, hidden: [], watchNearby: opts.watchNearby, combat: opts.combat, checking: true, refindable: true });
      void refineMarkers(msgId, image, points, game, token);
    };
    try {
      const t0 = performance.now();
      const [screen, crops] = await Promise.all([api.captureScreenNow().catch(() => null), closeUps(image, points)]);
      if (!screen || !crops) return fallback(!screen ? 'no fresh picture' : 'no close-ups');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(`${getApiBaseUrl()}/api/refind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            image: screen,
            items: points.map((p, i) => ({ crop: crops[i], label: p.label, where: p.where || '', category: p.category, ...(p.guideId ? { guide: true } : {}) })),
            game,
            client: 'desktop',
            appVersion: APP_VERSION,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return fallback(`server ${res.status}`);
      const data = await res.json();
      if (markerRunRef.current !== msgId) return; // a newer answer's markers have taken over
      const found = (Array.isArray(data.found) ? data.found : []).filter(
        (f: any) => Number.isInteger(f?.index) && f.index >= 0 && f.index < points.length && Number.isFinite(f.x) && Number.isFinite(f.y),
      ) as CheckFound[];
      const checked = Number.isInteger(data.checked) ? Math.min(data.checked, points.length) : points.length;
      // The answer's list keeps the screenshot's positions (they're drawn on it); only the overlay uses the fresh ones.
      const s = settleCheck(
        points,
        found.map((f) => ({ index: f.index, x: points[f.index].x, y: points[f.index].y })),
        checked,
        tabsRef.current.flatMap((t) => t.messages).find((m) => m.id === msgId)?.donePoints ?? [],
      );
      log(`placed on the screen now: ${found.length} of ${points.length} found in ${Math.round(performance.now() - t0)} ms`);
      // The pop-up card's picture when the answer has none of its own: a thing the check confirmed is on screen.
      const sure = found.find((f) => crops[f.index]);
      if (sure) {
        cardCloseUpRef.current.set(msgId, crops[sure.index]);
        if (cardCloseUpRef.current.size > 20) cardCloseUpRef.current.delete(cardCloseUpRef.current.keys().next().value as string);
        setCardCloseUpTick((n) => n + 1);
      }
      if (s.removed.length) {
        updateMessageById(msgId, (m) => ({
          ...m,
          points: s.kept.length ? s.kept : undefined,
          donePoints: s.done,
          removedMarkers: [...(m.removedMarkers || []), ...s.removedLabels],
          removedPoints: [...(m.removedPoints || []), ...s.removed.map((i) => points[i])],
        }));
      }
      const at = new Map(found.map((f) => [f.index, f]));
      const onScreen = points
        .map((p, i) => ({ p, f: at.get(i), i }))
        .filter(({ i }) => !s.removed.includes(i))
        .map(({ p, f }) => (f ? { ...p, x: f.x, y: f.y } : p));
      if (!onScreen.length) return;
      markerShownAtRef.current.set(msgId, Date.now());
      api?.showScreenPointers?.(withGuideNote(onScreen), accent, { refImage: screen, sessionId: msgId, hidden: [], watchNearby: opts.watchNearby, combat: opts.combat, refindable: true });
    } catch (e: any) {
      fallback(e?.name === 'AbortError' ? 'timed out' : String(e?.message ?? e));
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
    api.onPointersState?.(({ id, active, unplaced }: { id: string; active: boolean; unplaced?: boolean }) => {
      setPointersActive(id, active);
      // Couldn't be placed (the scene changed): the answer says so and offers them on the screenshot. Placed later
      // (Show, back in the same spot): the note goes.
      if (unplaced) updateMessageById(id, (m) => (m.markersUnplaced ? m : { ...m, markersUnplaced: true }));
      else if (active) updateMessageById(id, (m) => (m.markersUnplaced ? { ...m, markersUnplaced: false } : m));
    });
    // A marker closed with its × over the game: switched off in the answer's list too (as unticking it there does).
    api.onPointersDismissed?.(({ id, index }: { id: string; index: number }) => {
      if (!Number.isInteger(index) || index < 0) return;
      updateMessageById(id, (m) => ((m.donePoints || []).includes(index) ? m : { ...m, donePoints: [...(m.donePoints || []), index] }));
    });
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
          ? (await pinpoint(image, clear.map((f) => ({ x: f.x, y: f.y, label: pending[f.index].label, where: pending[f.index].hint || '' })), tab.activeSteamGame?.name || locateGameRef.current?.name || '', token))?.found ?? []
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
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-record'));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerAutoScreenshot) {
      (window as any).electronAPI.onTriggerAutoScreenshot(() => {
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
    // The right-click menu (spelling suggestions, Cut, Copy, Paste) in the same language.
    (window as any).electronAPI?.setEditLabels?.({ cut: translate('edit.cut'), copy: translate('edit.copy'), paste: translate('edit.paste'), selectAll: translate('edit.selectAll'), addWord: translate('edit.addWord'), noSuggestions: translate('edit.noSuggestions') });
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

  /** A question waiting for the running game's compendium to open (target) or for the game to be known (null). */
  const pendingAskRef = useRef<{ args: readonly [string, string?, string?, ('pro' | 'flash')?, string?]; target: string | null; at: number } | null>(null);
  const sendRef = useRef<(...a: any[]) => Promise<void>>(async () => {});
  // Each render's handleSendMessage (looked up when called, so it always sees the open compendium as it is then).
  sendRef.current = (...a: any[]) => (handleSendMessage as any)(...a);
  useEffect(() => {
    const p = pendingAskRef.current;
    if (!p) return;
    const ready = p.target ? activeTab?.id === p.target : !runId || !!resolvedNow;
    if (!ready) return;
    pendingAskRef.current = null;
    // Asked in the game's compendium now (a question that waited for the game's name is routed again).
    void sendRef.current(...p.args, p.target ? { routed: true } : undefined);
  }, [activeTab?.id, resolvedNow, runId]);
  const handleSendMessage = async (text: string, imageBase64?: string, audioBase64?: string, preferredModel?: 'pro' | 'flash', quick?: string, opts?: { routed?: boolean }) => {
    if (!activeTab) return;
    // The running game's compendium (owner, Nov 19 2026: questions "always go to the running game silently"): asked from
    // another compendium, the game's own opens and the question is asked there; asked in the first seconds of a game,
    // before it's known, the question waits for it (pendingAsk; at most a few seconds). A question that names the open
    // compendium's game is about it, and stays.
    const typed = !audioBase64 && !!text && ![tr('chat.defaultShotQ'), tr('chat.defaultQ'), tr('chat.referencePicture')].includes(text);
    if (!opts?.routed) {
      const args = [text, imageBase64, audioBase64, preferredModel, quick] as const;
      const queue = (target: string | null) => {
        const p = { args, target, at: Date.now() };
        pendingAskRef.current = p;
        // Never lost: if the switch or the game's name doesn't come, it's asked where the player is.
        setTimeout(() => { if (pendingAskRef.current === p) { pendingAskRef.current = null; void sendRef.current(...args, { routed: true }); } }, 5000);
      };
      if (runId && !resolvedNow) { queue(null); return; }
      const home = settings.autoSwitchGames !== false && runningTab ? runningTab : null;
      if (home && home.id !== activeTab.id && !(typed && asideGameIn(text, tabs, home.id)?.tabId === activeTab.id)) {
        queue(home.id);
        handleSelectTab(home.id);
        return;
      }
    }
    // A side question: about another game the player has a compendium for. Answered as that game's (no screenshot, place,
    // memory or quest log of this one), kept out of this game's history, and filed in that game's compendium after.
    const aside = typed ? asideGameIn(text, tabs, activeTab.id) : null;
    const asideTab = aside ? tabs.find((t) => t.id === aside.tabId) : undefined;
    markAsked(); // a new web app version no longer reloads this page
    // The last answer's drawing over the game is about the last question: it goes when a new one is asked.
    (window as any).electronAPI?.hideDrawnLayer?.();

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
      timestamp: now,
      ...(aside ? { aside: aside.name } : {}),
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
    const timeoutId = setTimeout(() => controller.abort(new Error("Request timed out after 100 seconds.")), 100000);
    // Both models' questions used up today: the limit message, with when they come back (and Premium for free players).
    let limitText = '';
    let guestLimit = false; // a guest at their limit: the sign-in card, not the Premium screen
    let premiumNudge = false; // a free player at their limit: the Premium card in the conversation (never a pop-up)
    const backendUrl = getApiBaseUrl();
    const chatEndpoint = backendUrl ? `${backendUrl}/api/chat` : '/api/chat';

    // Asked from the panel while a game is running (owner, Nov 18 2026): the panel slides away as it does after hold to
    // talk, and the answer pops up over the game (electron/answerCard.cjs); the full answer stays here for later.
    // Settings → Pop-up answers can keep the panel open instead.
    {
      const api = (window as any).electronAPI;
      if (api?.askOverGame && globalActiveGame && settings.popupHidePanel !== false) {
        const standIn = [tr('chat.defaultShotQ'), tr('chat.defaultQ'), tr('chat.referencePicture')].includes(text);
        api.askOverGame({
          question: audioBase64 ? tr('pad.cardSpoken') : standIn ? tr('pad.shotAsk') : String(text || '').slice(0, 200),
          mode: document.documentElement.classList.contains('qc-pad') ? 'pad' : 'keys',
          screen: !aside && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image') ? imageBase64 : undefined,
        });
      }
      // The pop-up card says it's on its way, and to which model.
      api?.cardStage?.({ sent: true, model: preferredModel === 'flash' ? 'Fast' : 'Pro', place: activeTab?.place?.name || '' });
    }
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
          // Only what the server reads (server.ts: the last 6 messages' role and text; whether there are any): never
          // the earlier screenshots, drawn pictures or markers, which made every question upload the whole
          // conversation (session companion step 0, Nov 18 2026).
          history: (aside ? asideTab?.messages || [] : activeTab.messages.filter((m) => !m.aside && !m.asideMoved)).filter((m) => !m.aside && !m.asideMoved).slice(-6).map((m) => ({ role: m.role, text: typeof m.text === 'string' ? m.text : '' })),
          // A side question: this game's screenshot isn't about the other game.
          imageBase64: aside ? undefined : imageBase64,
          audioBase64,
          aiMode: settings.aiMode,
          // The model picked next to the send button (Pro or Fast); the server answers with the other one when it's used up.
          answerModel: preferredModel === 'flash' ? 'fast' : 'pro',
          // For the daily reset at the player's midnight.
          timeZone: deviceTimeZone(),
          // A quick question's id (src/utils/quickQuestions.ts): the server adds what it asks for.
          ...(quick ? { quick } : {}),
          isGameRunningLocally: runningOpen && !aside,
          // The guide the app found for this game (the server checks it), and the compendium's name, so answers use the
          // same guide as the quest log whatever Steam calls the game.
          guideKey: (aside ? asideTab?.guideKey : trackerGameRef.current.guideKey) || undefined,
          tabName: aside ? aside.name : activeTab?.name,
          activeGame: aside ? (asideTab?.activeSteamGame?.name ? { name: asideTab.activeSteamGame.name, appId: asideTab.activeSteamGame.appId } : { name: aside.name }) : activeGame ? {
            name: activeGame.name,
            appId: activeGame.appId,
            genre: activeGame.genre,
            developer: activeGame.developer
          } : null,
          achievements: aside ? [] : activeGame?.achievements || [],
          news: aside ? [] : activeGame?.patchNotes || [],
          generateBanner: false, // AI banner art is retired
          language: aiLanguageName(settings.language),
          // On-screen markers (Settings): off, the answer doesn't spend tokens on markers nobody would see.
          markers: !aside && settings.showPointersOnScreen !== false,
          // Where the player is in this playthrough (confirmed by them, or the AI's last guess), unless it has to be
          // checked again (the game started, the tab was switched to): then nothing, rather than an old place.
          place: aside ? null : !dueAt || (activeTab.place?.checkedAt || 0) >= dueAt ? activeTab.place || null : null,
          // Progress memory: what the player has already done in this game, so answers never send them back.
          done: memoryOn && !aside ? doneForRequest(settings.gameDone?.[gameProgressKey(activeTab)]) : [],
          // Playthrough memory: choices made, key items and (if the player wants) their Notes. Off: nothing is sent.
          ...(memoryOn && !aside ? { playthrough: playthroughForRequest(play, activeTab.notes) || { choices: [], found: [], notes: '' } } : {}),
          // The quest log's current objective (its unticked steps): the answer ticks the ones the question says are done.
          ...(!aside && objectiveForRequest(activeTab) ? { objective: objectiveForRequest(activeTab) } : {}),
          // The guide area's ticked entries: the answer only marks guide entries the player hasn't ticked.
          ...(!aside && trackerGameRef.current.guideArea ? { guideDone: { slug: trackerGameRef.current.guideArea.slug, ids: [...trackerGameRef.current.guideArea.done].slice(0, 300) } } : {}),
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
      // A side question changes nothing about this game: no markers, place, quest log, fight or memory from its answer.
      if (aside && data && typeof data === 'object') for (const k of ['points', 'steps', 'place', 'placeRead', 'objectiveDone', 'objectiveLooksDone', 'combat', 'noFight', 'fight', 'nowGoal', 'nearby', 'guideConflicts', 'done', 'remember', 'worth']) delete (data as any)[k];
      // The answer settled the player's area, which has no "Worth getting here" yet: its ticket.
      if (data.worth && typeof data.worth === 'object') setTimeout(() => redeemWorthRef.current(data.worth), 0);

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
      // The desktop app: the answer may pop up on the card, with a summary to show and read aloud. Always asked for
      // there (owner, Nov 20 2026: the card reading its summary is ideal; it used to need a detected game, so cards asked
      // without one had none). The card reads the answer's start only if the summary fails.
      const wantCardSummary = !!(window as any).electronAPI?.answerArrived;
      const aiMessage: ChatMessage = {
        id: `msg-${nowAi + 1}`,
        role: 'assistant',
        text: finalAiText,
        modelUsed: data.modelUsed || 'Gemini 3.8 Flash',
        ...(aside ? { aside: aside.name } : {}),
        bannerImageUrl: data.bannerImageUrl,
        // A guest's last question today: the sign-in card shows under this answer.
        ...(data.signInNudge === true ? { signInNudge: true } : {}),
        ...(Array.isArray(data.points) && data.points.length ? { points: data.points } : {}),
        ...(typeof data.title === 'string' && data.title.trim() ? { title: data.title.trim().slice(0, 60) } : {}),
        ...(typeof data.nowGoal === 'boolean' ? { nowGoal: data.nowGoal } : {}),
        // A fight on screen: the steps are the battle plan.
        ...(data.combat === true ? { combat: true } : {}),
        // No fight on the screenshot: a fight is over (its markers go, the quest log shows normal steps).
        ...(data.noFight === true ? { noFight: true } : {}),
        // The pop-up's summary (Nov 19 2026) is asked for next, on its own (fetchCardSummary): the card waits for it.
        ...(wantCardSummary && data.text && String(data.text).trim().length >= 40 ? { summaryPending: true } : {}),
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
        ...(Array.isArray(data.sourceLinks) && data.sourceLinks.length
          ? { sourceLinks: data.sourceLinks.filter((l: any) => l && /^https:\/\//.test(String(l.url || '')) && l.title).slice(0, 3).map((l: any) => ({ url: String(l.url), title: String(l.title).slice(0, 80), site: String(l.site || '').slice(0, 40) })) }
          : {}),
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

      // Desktop: show the AI's pointers right on top of the game, found on the screen as it is now (markers v2).
      const markerGame = activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name || '';
      const placeNow = !!(aiMessage.points?.length && imageBase64 && settings.showPointersOnScreen !== false && (window as any).electronAPI?.captureScreenNow);
      if (placeNow) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        void placeMarkersNow(aiMessage.id, imageBase64!, aiMessage.points!, accent, { combat: !!aiMessage.combat, watchNearby: !!aiMessage.nearby?.length }, markerGame, token);
      } else if (aiMessage.points && settings.showPointersOnScreen !== false) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        // The screenshot this answer is about is the reference the markers track against.
        (window as any).electronAPI?.showScreenPointers?.(withGuideNote(aiMessage.points), accent, {
          refImage: imageBase64,
          sessionId: aiMessage.id,
          hidden: [],
          watchNearby: !!aiMessage.nearby?.length,
          combat: !!aiMessage.combat,
          // The precision pass below checks them first: dimmed until it settles them.
          checking: !!imageBase64,
        });
      } else if (aiMessage.noFight) {
        // The fight is over and this answer marks nothing: the old fight's markers go.
        hideCombatMarkers();
      }
      // Precision pass: zoom in on each marked spot so markers land on the exact object (free, rate-limited).
      // (Desktop: placeMarkersNow above does this job on the screen now.)
      if (!placeNow && aiMessage.points?.length && imageBase64 && settings.showPointersOnScreen !== false) {
        refineMarkers(aiMessage.id, imageBase64, aiMessage.points, markerGame, token);
      }
      if (aiMessage.summaryPending) void fetchCardSummary(aiMessage.id, text, aiMessage.text, token);
      // A video or picture under the answer, if one helps (after the answer, never instead of it).
      // A screenshot or voice message with no typed question gets one too (owner, Nov 14 2026): its question is the app's
      // stand-in text, so the server takes the topic from what the answer is about.
      if (text && aiMessage.text && !limitText) {
        const shotOnly = !!audioBase64 || (!!imageBase64 && (text === tr('chat.defaultShotQ') || text === tr('chat.defaultQ')));
        void fetchVisual(aiMessage.id, text, aiMessage.text, aside ? aside.name : activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name || '', token, shotOnly);
        if (!aside) void fetchDrawn(aiMessage.id, text, aiMessage.text, activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name || '', token, shotOnly, imageBase64 || undefined, settings.showPointersOnScreen !== false, (aiMessage.points || []).map((p) => p.label || ''));
      }

      const readArea: string = data.placeRead && typeof data.placeRead.area === 'string' ? data.placeRead.area.trim().slice(0, 80) : '';
      const readStory: string = readArea && typeof data.placeRead.story === 'string' ? data.placeRead.story.trim().slice(0, 100) : '';
      const placeBefore = activeTab.place;
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
        .map((x: any) => ({ kind: x.kind as PlayKind, text: x.text, source: 'answer' as const, msgId: aiMessage.id })));

      // The answer wins (owner, Oct 31 2026): a question about what the player is doing or should do where they are, and
      // an answer with things to do, makes it the quest log's Now by itself, its steps the Next, with a few seconds of
      // Undo. Any of: the answer says so (now="yes"), the question reads that way ("what should I do here?", "walk me
      // through this"), or the answer is about the place the player is in (the model's now="no" isn't trusted alone: it
      // missed "I just arrived in South Figaro… walk me through this"). Curiosity (lore, builds, what an item does) never.
      const aboutHere = !!aiMessage.place?.name && !!activeTab.place?.name && samePlace(aiMessage.place.name, activeTab.place.name);
      const autoNow = isDesktop && !aiMessage.combat && doSteps(aiMessage).length > 0 && !isCuriosityQuestion(text)
        && (aiMessage.nowGoal === true || isNowQuestion(text) || aboutHere);
      const nowBefore = activeTab.questLog?.now;
      // Guide entries the answer advises against ("Do not open the barrels"): held back from the quest log while the
      // corrections check (where the server sent them) decides, never for good on the answer's word alone.
      const gc = data.guideConflicts;
      const conflicts: { id: string; group?: string; at: number }[] = gc && typeof gc.slug === 'string' && Array.isArray(gc.ids)
        ? gc.ids.filter((x: unknown) => typeof x === 'string').slice(0, 20).map((id: string) => ({ id: `g:${gc.slug}:${id}`, ...(typeof gc.key === 'string' ? { group: `${gc.key}__${gc.slug}__${id.replace(/^w:/, '')}` } : {}), at: Date.now() }))
        : [];
      setTabs(prev => {
        const nextTabs = prev.map(t => {
          if (t.id !== activeTab.id) return t;
          // Remember where the player is: a sure answer (a sign on screen, or the player said so) counts as confirmed;
          // an unsure guess never replaces a place the player confirmed.
          // Only the player confirms a place or story point (a tap or saying it). The AI's guesses, sure or not, are kept
          // as unconfirmed and never overwrite what the player confirmed.
          let place = t.place;
          const g = aiMessage.place;
          // A sure answer (a sign on screen, or the player said where they are) makes the place known for the quest log
          // (sure, checked now); an unsure one is only a suggestion ("Looks like X?").
          const answered = (name: string) => ({ name, confirmed: false, sure: !!g?.sure, ...(g?.sure ? { checkedAt: Date.now() } : {}) });
          // Same place with more or less detail ("South Figaro" vs "South Figaro, Relic Shop") counts as the same.
          if (g && !place?.confirmed) place = { ...dropDoingIfMoved(place, g.name), ...answered(g.name) };
          // The player moved on (the answer is about a different place than the confirmed one): switch to the new place,
          // unconfirmed, so "Known here" follows them and new facts aren't filed under the old place. The story point
          // usually carries over.
          else if (g && place?.confirmed && !samePlace(g.name, place.name)) place = { ...dropDoingIfMoved(place, g.name), ...answered(g.name) };
          // The same confirmed place, said again by a sure answer: it's still where they are.
          else if (g?.sure && place?.confirmed) place = { ...place, checkedAt: Date.now() };
          if (g?.story && place && !place.storyConfirmed) place = { ...place, story: g.story, storyConfirmed: false };
          // On-screen place wins: a place name read on screen that names a guide area is where the player is, confirmed
          // (as Locate me does), whatever was stored.
          if (readArea) place = { ...placeAfterMove(place, readArea, readStory, true), checkedAt: Date.now() };
          // Ticks from the conversation: steps of the current objective the question said are done (Undo on the log).
          const objId = t.questLog?.now;
          const ticked: number[] = objId && Array.isArray(data.objectiveDone) ? data.objectiveDone.filter((n: unknown) => Number.isInteger(n)) : [];
          const msgs = ticked.length
            ? t.messages.map((m) => (m.id === objId ? { ...m, doneSteps: [...new Set([...(m.doneSteps || []), ...ticked])].sort((a, b) => a - b) } : m))
            : t.messages;
          return { ...t, messages: [...msgs, aiMessage], lastActive: nowAi, ...(place ? { place } : {}), ...(autoNow || conflicts.length ? { questLog: nextLogState(t.questLog, { ...(autoNow ? { now: aiMessage.id } : {}), ...(conflicts.length ? { held: [...(t.questLog?.held || []).filter((h) => !conflicts.some((c) => c.id === h.id)), ...conflicts] } : {}) }) } : {}) };
        });
        return nextTabs;
      });
      // A side question, answered: filed in its game's compendium (as that game's own conversation from now on), and
      // this one keeps one line, "Answered in X →", so the player can find it. The pop-up card still shows it.
      if (aside) {
        const ids = new Set([userMessage.id, aiMessage.id]);
        setTabs((prev) => {
          const from = prev.find((t) => t.id === activeTab.id);
          const moved = (from?.messages || []).filter((m) => ids.has(m.id)).map(({ aside: _a, ...m }) => m as ChatMessage);
          if (!moved.length || !prev.some((t) => t.id === aside.tabId)) return prev;
          const stub: ChatMessage = { id: `msg-${nowAi + 2}`, role: 'assistant', text: '', timestamp: nowAi, asideMoved: { name: aside.name, tabId: aside.tabId } };
          return prev.map((t) =>
            t.id === aside.tabId ? { ...t, messages: [...t.messages, ...moved], lastActive: nowAi }
            : t.id === activeTab.id ? { ...t, messages: [...t.messages.filter((m) => !ids.has(m.id)), stub] }
            : t,
          );
        });
      }
      // The question said steps of the objective are done: they're ticked, and the log says so with Undo.
      {
        const objId = activeTab.questLog?.now;
        const obj = objId ? activeTab.messages.find((m) => m.id === objId) : undefined;
        const ticked: number[] = obj && Array.isArray(data.objectiveDone) ? data.objectiveDone.filter((n: unknown) => Number.isInteger(n) && !!obj.steps?.[n as number]) : [];
        if (obj && ticked.length) showCleared({ ids: ticked.map((i) => `s:${obj.id}:${i}`), text: ticked.map((i) => obj.steps![i].label || obj.steps![i].text).join(', '), from: 'question' });
        else if (autoNow) {
          showCleared({ ids: [], text: answerTitle(aiMessage), from: 'now', msgId: aiMessage.id, prev: nowBefore });
          setLogSel(null);
        }
        // The screenshot showed a step finished that the player didn't mention: offered on the log (Move on / Not yet).
        const looks: number[] = obj && !aside && Array.isArray(data.objectiveLooksDone) ? data.objectiveLooksDone.filter((n: unknown) => Number.isInteger(n) && !!obj.steps?.[n as number] && !ticked.includes(n as number)) : [];
        setLooksDone(obj && looks.length && !autoNow ? `s:${obj.id}:${Math.min(...looks)}` : null);
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

  const handleCreateTab = (name: string, steamGame?: SteamGameData, guideKey?: string): string => {
    const newId = `tab-${Date.now()}`;
    const newTab: GameTab = {
      id: newId,
      name,
      activeSteamGame: steamGame || null,
      ...(guideKey ? { guideKey } : {}),
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
    return newId;
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
  // ?previewOffers on a dev server: the Premium card with the free trial and holiday deal, and the trial's last-day note.
  const previewOffers = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]previewOffers/.test(location.search);
  useEffect(() => { if (previewOffers) setIsPaywallOpen(true); }, []);
  // Tuck the panel away without the shortcut: exactly what the shortcut does (focus back to the game, quest log as is).
  const tuckAway = () => (window as any).electronAPI?.hidePanel?.();
  // Hide just the chat (owner, Nov 15 2026): the panel folds down to the docked quest log; the seam tab brings it back.
  // (The purple tuck strip on the panel's outer edge is gone: the header's arrow and Esc do the same.)
  const [chatHidden, setChatHidden] = useState(false);
  const tuckSide: 'left' | 'right' = String(settings.dockPosition).endsWith('left') ? 'left' : 'right';

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


  // The docked quest log (owner, Oct 30 2026): a column inside the panel, on its inner side, out while the log is
  // (Ctrl+Shift+L, the controller's View, the bookmark).
  // The companion app (SteamOS, Nov 20 2026): full screen, the conversation on the left and the quest log always
  // beside it on the right.
  const companion = isCompanion();
  const logSide: 'left' | 'right' = companion ? 'right' : settings.dockPosition !== 'undocked' && tuckSide === 'left' ? 'right' : 'left';
  const dockedLogOpen = (isDesktop && questLogAttached && questLogVisible && !!logView) || (companion && !!logView);
  // Popped out (owner, Nov 15 2026): the same log, in its own window over the game (PopWindow, electron/logWindow.cjs).
  const poppedLogOpen = isDesktop && !questLogAttached && questLogVisible && !!logView;
  // Without the docked log there's nothing to fold down to: the chat comes back.
  useEffect(() => { if (!dockedLogOpen && chatHidden) setChatHidden(false); }, [dockedLogOpen, chatHidden]);
  const logKeys = formatShortcut(settings.questLogShortcut || 'CmdOrCtrl+Shift+L');
  // The quest log itself: the same in the docked column and popped out in its own window (owner, Nov 15 2026).
  const questLogEl = (popped: boolean) => !logView ? null : (
    <QuestLog
      view={logView}
      sel={logSel}
      cleared={logCleared ? { id: logCleared.ids[0], text: logCleared.text, from: logCleared.from } : null}
      keysLabel={logKeys}
      onRemove={removeLog}
      onUndo={undoLog}
      onSelect={setLogSel}
      onHideWatch={hideWatch}
      onClose={() => { toggleQuestLog(); setTimeout(() => document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus(), 50); }}
      onPopOut={() => (window as any).electronAPI?.trackerAttach?.(false)}
      popped={popped}
      popLeft={logSide === 'left'}
      onPutBack={() => (window as any).electronAPI?.trackerAttach?.(true)}
      onAsk={(text) => {
        if (popped) (window as any).electronAPI?.showPanel?.();
        if (text) window.dispatchEvent(new CustomEvent('qc-ask', { detail: { text } }));
        else document.querySelector<HTMLElement>('[data-qc-ask-input]')?.focus();
      }}
      onOpenPin={(id) => { if (popped) (window as any).electronAPI?.showPanel?.(); window.dispatchEvent(new CustomEvent('qc-scroll-to-msg', { detail: { id } })); }}
      onUnpin={togglePin}
      onClearNow={() => { patchLog(() => ({ now: undefined })); showCleared(null); }}
      onMoveOn={moveOn}
      onBringBack={bringBack}
      looksDone={looksDone}
      onLooksDone={answerLooksDone}
      onNeedNote={(s) => void needNote(s)}
      onLoadSteps={() => trackerEventRef.current({ type: 'load-steps' })}
      onDismissOffer={() => trackerEventRef.current({ type: 'dismiss-offer' })}
      onGotoArea={moveToArea}
      // (Help me here looks at the game's screen: not in the companion app until it's linked to the PC.)
      onLocate={companion ? undefined : () => void runHelpHere()}
      onPickPlace={moveToArea}
      locateKeys={formatShortcut(settings.locateShortcut || 'CmdOrCtrl+Shift+K')}
      foldMissables={!!worthHere.worth || !!(trackerGame.guideArea?.page as any)?.worth}
      facts={(() => {
        // The area's database sections (item 30; any game, guide or not, from Nov 15 2026: hooks/useWorthHere), only
        // beside what the log already shows. Being found: one quiet line.
        const w = worthHere;
        if (w.status === 'filling') return <LogFacts facts={{ slug: w.slug || '', worth: undefined, achievements: undefined } as any} game="" gameKey="" done={w.done} onRemove={() => {}} finding />;
        if (w.status !== 'ready' || !w.key || !w.slug) return null;
        return (
          <LogFacts
            facts={{ slug: w.slug, worth: w.worth, achievements: w.achievements }}
            game={activeGame?.name || activeTab?.name || ''}
            gameKey={w.key}
            done={w.done}
            // g:<area>:<item id>: removed like any log item (kept where the guide's ticks are; Undo, or Earlier, puts it back).
            onRemove={(id, text) => removeLog({ id, text })}
            steam={activeGame?.achievements?.length ? { list: activeGame.achievements, unlocked: activeGame.unlockedAchievements, total: activeGame.totalAchievements } : null}
          />
        );
      })()}
      helpMsgFor={(stepId) => [...(activeTab?.messages || [])].reverse().find((m) => m.kind === 'help' && m.helpFor === stepId && m.visual && !m.visualHidden)?.id}
      onConfirmPlace={() => { const n = logView.place?.name; if (n) trackerEventRef.current({ type: 'confirm-place', name: n }); }}
      onOpenEntry={(id) => { if (popped) (window as any).electronAPI?.showPanel?.(); trackerEventRef.current({ type: 'open-entry', item: id }); }}
      visualFor={(id) => { const m = activeTab?.messages.find((x) => x.id === id); return m && !m.visualHidden ? m.visual : undefined; }}
      onVisualEvent={(id, type) => {
        const m = activeTab?.messages.find((x) => x.id === id);
        void sendVisualEvent(type, m?.visualRef);
        if (type === 'wrong') setTimeout(() => updateMessageById(id, (x) => ({ ...x, visualHidden: true })), 5000);
      }}
    />
  );
  const logColumn = (side: 'left' | 'right') =>
    dockedLogOpen && logView && logSide === side ? (
      <div className={`${chatHidden ? 'w-full' : 'w-[300px]'} relative flex-shrink-0 h-full min-h-0 ${side === 'left' ? 'border-r qc-log-swing-l' : 'border-l qc-log-swing-r'} border-white/[0.1]`} style={{ WebkitAppRegion: 'no-drag' } as any}>
        {/* The seam tab (owner, Nov 15 2026): on the line between the quest log and the chat. It points to the screen
            edge to fold the chat away (only the log stays out), and back to bring the chat out again. */}
        {(() => {
          const towardChat = side === 'left'; // the chat is on the log's right when the log is on the left
          const pointsRight = towardChat ? !chatHidden : chatHidden;
          const label = tr(chatHidden ? 'header.showChat' : 'header.hideChat');
          return (
            <button type="button" data-qc-chat-tab={chatHidden ? 'show' : 'hide'} onClick={() => setChatHidden((h) => !h)} title={label} aria-label={label}
              className={`absolute top-1/2 ${towardChat ? `right-0 ${chatHidden ? 'rounded-l-md border-r-0' : 'translate-x-1/2 rounded-md'}` : `left-0 ${chatHidden ? 'rounded-r-md border-l-0' : '-translate-x-1/2 rounded-md'}`} -translate-y-1/2 z-[60] w-3.5 h-14 flex items-center justify-center bg-[#16151f] border border-white/[0.14] text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white`}>
              <svg viewBox="0 0 12 12" width="9" height="9" shape-rendering="crispEdges" aria-hidden="true" style={pointsRight ? undefined : { transform: 'scaleX(-1)' }}>
                <path fill="currentColor" d="M4 2h2v2h2v2h2v2H8v2H6v2H4v-2h2V8h2V6H6V4H4z" />
              </svg>
            </button>
          );
        })()}
        {questLogEl(false)}
      </div>
    ) : null;

  // The window's width: the panel, plus the achievements drawer and the docked quest log when they're open.
  useEffect(() => {
    if ((window as any).electronAPI?.resizeWindow) {
      let totalWidth = 550;
      if (isAchDrawerOpen) totalWidth += achDrawerWidth;
      if (dockedLogOpen) totalWidth += 300;
      // The chat hidden: just the quest log.
      if (chatHidden && dockedLogOpen) totalWidth = 300;
      (window as any).electronAPI.resizeWindow(totalWidth);
    }
  }, [isAchDrawerOpen, achDrawerWidth, dockedLogOpen, chatHidden]);
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
        {logColumn('left')}
        <div className={`flex-1 min-w-0 min-h-0 flex flex-col relative ${chatHidden && dockedLogOpen ? 'hidden' : ''}`}>
        {/* "Mouse unlocked": the panel opened with the show/hide shortcut (the first 10 times) */}
        {mouseToast && (
          <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-48 left-1/2 -translate-x-1/2 z-[80] max-w-[90%] animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="qc-px-frame px-3.5 py-2 rounded-lg bg-[#16101f]/95 border border-[var(--accent-border)] shadow-[0_0_18px_var(--accent-glow)] text-[12.5px] font-semibold text-white text-center">
              {mouseToast}
            </div>
          </div>
        )}

        {/* Header Bar */}
        <HeaderBar
          userData={userData}
          tabs={tabs}
          activeTabId={activeTabId}
          activeGame={activeGame}
          isGameRunningLocally={globalActiveGame !== null}
          detection={detection}
          placeName={activeTab?.place?.name || ''}
          chosenGame={activeTab?.guideKey ? { game: collection?.games.find((g) => g.key === activeTab.guideKey)?.game || activeTab.guideKey, onChange: () => chooseCollectionGame(activeTab.id, undefined) } : undefined}
          onSelectTab={handleSelectTab}
          onStartCreateTab={spacesOn && spaces ? () => setIsGameSearchOpen(true) : handleStartCreateTab}
          onStartRenameTab={spacesOn && spaces ? undefined : handleStartRenameTab}
          onDeleteTab={handleDeleteTab}
          onOpenGuides={() => window.dispatchEvent(new CustomEvent('qc-open-guides-tab'))}
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
          questLogPeek={logView ? {
            now: logView.now?.text,
            // The open Now and Next steps; a watch-out only from an answer, not the guide (owner, Nov 6 2026: answers over the guides).
            steps: (logView.now && !logView.now.done ? 1 : 0) + logView.next.filter((st) => !st.done).length,
            watch: logView.watch && !logView.watch.fromGuide ? logView.watch.text : undefined,
          } : undefined}
          theme={settings.theme}
          onSync={syncDiagnostics?.triggerSyncNow}
          playthroughs={playthroughMenu}
          runningTabId={spacesOn && spaces ? runningTab?.id : undefined}
        />
        {/* The tucked-in quest log's bookmark is its own window just outside the panel's edge, which keyboard focus
            can't reach: this invisible stop sits under it on the panel's inner edge. Focused (Tab, or the controller's
            d-pad toward the edge), it rings the bookmark; Enter, Space or A slides the log out. */}
        {isDesktop && questLogTucked && (
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
        {/* With one space per game (flag on): the "Which game is this?" line, or the playthrough when there are several (the name is in the header), the
            detection line only when it has something to do, and the one-time migration notice. */}
        {(spacesOn && spaces ? (
          <>
            {activeTab && (activeTab.unknownGame || (activeTab.playthrough?.count || 0) > 1) && (
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
            {((detection.running && (!detection.open || detection.choose || detection.switched || detection.created)) || (!detection.running && detection.confirm)) && <DetectionLine d={detection} soundEnabled={settings.soundEnabled} extra={subscribeBtn} />}
            <MigrationNotice
              spaces={spaces}
              soundEnabled={settings.soundEnabled}
              onDismiss={() => setSpaces((cur) => (cur ? { ...cur, notice: undefined } : cur))}
              onKeepSeparate={(gameId) => setSpaces((cur) => (cur ? splitMerged(cur, gameId) : cur))}
            />
          </>
        ) : <DetectionLine d={detection} soundEnabled={settings.soundEnabled} extra={subscribeBtn} />)}
        {/* Updates (desktop), under the header: "Version X is ready" and, after one installs, a one-time "What's new". A dev server shows
            both with sample notes at ?previewUpdate (for screenshots). */}
        {(isDesktop || previewUpdate) && (
          <AppUpdates
            preview={previewUpdate
              ? { ready: '0.5.7', ...(/whatsnew/.test(location.search) ? { whatsNew: { v: '0.5.6', text: 'a cleaner quest log with short objectives and a highlight on the next one; tick and move between objectives without your mouse; load a guide’s steps for your current quest' } } : {}) }
              : undefined}
          />
        )}
        {/* A free trial's last day: it ends tomorrow, then $4.99/month (TrialEndsNote). */}
        <TrialEndsNote trialEnd={previewOffers ? Date.now() + 20 * 3_600_000 : Number(userData?.premiumTrialEnd) || undefined} onManage={() => setIsPaywallOpen(true)} />

        {/* Main Body: Central Chat/Browser + Right Achievements Drawer */}
        {/* overflow-clip, not overflow-hidden: a clipped box isn't scrollable, so focusing a field can't shift the
            layout (the closed side panels are wider and taller than the window). Unlike overflow-hidden it doesn't
            stop a flex item growing to its content, hence min-h-0 / min-w-0 here and on the panel and main (without
            them a long conversation pushed the question box below the window). */}
        <div className="flex-1 min-h-0 min-w-0 flex overflow-clip relative">
          {/* Central Workspace: Chat OR Browser */}
          <main className="qc-scanlines flex-1 min-h-0 min-w-0 flex flex-col overflow-clip relative">
            {tabs.length === 0 ? (
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
                activeTab={chatTab || activeTab}
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
                logAttached={questLogAttached && (questLogVisible || questLogTucked)}
                questLog={activeTab?.questLog}
                onSetNow={isDesktop ? setLogNow : undefined}
                nowUndo={logCleared?.from === 'now' ? { msgId: logCleared.msgId, onUndo: undoLog } : null}
                onPinAnswer={isDesktop ? togglePin : undefined}
                onOpenSearch={() => setSearchOpen((x) => !x)}
                searchPanel={searchOpen ? <AnswerSearch tabs={tabs} activeTabId={activeTab.id} onPick={pickFound} onClose={() => setSearchOpen(false)} /> : null}
                onDeleteAnswer={deleteQa}
                deletedNote={qaDeleted && qaDeleted.tabId === activeTab.id ? { text: tr('qa.deleted'), onUndo: undoDelete } : null}
                onDismissOffer={(id) => patchLog((st) => ({ hidden: [...new Set([...(st.hidden || []), `offer:${id}`])] }))}
                nextKeys={formatShortcut(settings.trackerNextShortcut || 'CmdOrCtrl+Shift+Down')}
                immersiveReadAloud={settings.immersiveReadAloud !== false}
                soundEnabled={settings.soundEnabled}
                onAppendToNotes={handleAppendToNotes}
                markerLifetime={settings.markerLifetime ?? 120}
                micDeviceId={settings.micDeviceId || ''}
                onOpenPremium={() => setIsPaywallOpen(true)}
                onChangeMarkerLifetime={(seconds) => setSettings((s) => ({ ...s, markerLifetime: seconds }))}
                onSetPlace={handleSetPlace}
                onLocate={isDesktop ? () => void runHelpHere() : undefined}
                locating={locating}
                locateNote={locateNote}
                onTrackOnScreen={isDesktop ? handleTrackOnScreen : undefined}
                onFindMarkers={isDesktop ? (id: string) => void findMarkersAgain(id, false) : undefined}
                onNextTurn={isDesktop ? runNextTurn : undefined}
                onSetStory={(story) => {
                  const next = { name: activeTab.place?.name || '', confirmed: !!activeTab.place?.confirmed, ...(activeTab.place || {}), story, storyConfirmed: true };
                  setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, place: next, lastActive: Date.now() } : t)));
                  rememberGameProgress(activeTab, next);
                }}
                onOpenTab={(tabId) => handleSelectTab(tabId)}
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
                  const next = { ...dropDoingIfMoved(activeTab.place, name), name, confirmed: !!name, checkedAt: Date.now(), ...(story ? { story, storyConfirmed: true } : { story: undefined, storyConfirmed: false }) };
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

          {/* Right Achievements Drawer */}
          <AchievementsDrawer
            width={achDrawerWidth}
            isDragging={isDraggingAch}
            isOpen={isAchDrawerOpen}
            onClose={() => setIsAchDrawerOpen(false)}
            gameData={activeGame}
            soundEnabled={settings.soundEnabled}
          />
        </div>
        </div>
        {logColumn('right')}
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
          isGuest={!!user.isGuest && !previewOffers}
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
      {poppedLogOpen && <PopWindow name="qc-log" title={tr('tracker.logTitle')}>{questLogEl(true)}</PopWindow>}
      <ControllerLayer
        enabled={settings.controllerEnabled !== false}
        padStyle={settings.controllerStyle || 'auto'}
        talkButton={settings.controllerTalk || 'off'}
        logAttached={questLogAttached && (questLogVisible || questLogTucked)}
        comboLabel={padComboLabel(settings.controllerToggle, settings.controllerCustom, tr)}
        context={(() => {
          // What the quick menu's question list fits to: the quest log's Now goal, a fight, whether anything was asked.
          const msgs = activeTab?.messages ?? [];
          const nowMsg = activeTab?.questLog?.now ? msgs.find((x) => x.id === activeTab.questLog!.now) : undefined;
          let lastAnswer: ChatMessage | undefined;
          for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') { lastAnswer = msgs[i]; break; }
          return { goal: nowMsg ? answerTitle(nowMsg) : '', combat: !!lastAnswer?.combat, asked: msgs.some((m) => m.role === 'user') };
        })()}
      />

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