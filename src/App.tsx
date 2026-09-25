import React, { useState, useEffect, useRef, Suspense } from 'react';
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
import { GamesSidebar } from './components/GamesSidebar';
import { ChatArea } from './components/ChatArea';
import { AchievementsDrawer } from './components/AchievementsDrawer';
const PlaythroughNotepad = React.lazy(() => import('./components/PlaythroughNotepad').then(module => ({ default: module.PlaythroughNotepad })));
const PersonalQuestsModal = React.lazy(() => import('./components/PersonalQuestsModal').then(module => ({ default: module.PersonalQuestsModal })));
const GameGuidesBrowser = React.lazy(() => import('./components/GameGuidesBrowser').then(module => ({ default: module.GameGuidesBrowser })));
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
import { useCloudSync } from './hooks/useCloudSync';
import { recordTombstone } from './hooks/tabMerge';
import pixelSceneUrl from './pixel-scene.png';
import { LOCALES, aiLanguageName, applyLocale, detectLocale, translate, useT } from './i18n';
import { ControllerLayer } from './components/ControllerLayer';
import { rememberAreaFind, setPointersActive } from './components/pointerStore';

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
  ttsVoice: 'puck',
  customApiKey: '',
  hideAppShortcut: 'CmdOrCtrl+Shift+H',
  voiceInputShortcut: 'CmdOrCtrl+Shift+V',
  autoScreenshotShortcut: 'CmdOrCtrl+Shift+S',
  enableThematicBanners: true,
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


/** "CmdOrCtrl+Shift+S" -> "Ctrl + Shift + S" (shown as Cmd on a Mac). */
function prettyShortcut(accel?: string): string {
  if (!accel) return '';
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
  return accel
    .split('+')
    .map((k) => (k === 'CmdOrCtrl' || k === 'CommandOrControl' ? (isMac ? 'Cmd' : 'Ctrl') : k))
    .join(' + ');
}

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
      const validVoices = ['puck', 'charon', 'fenrir', 'kore', 'aoede'];
      if (!validVoices.includes(parsed.ttsVoice)) {
        parsed = { ...parsed, ttsVoice: 'puck' };
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

  if (window.location.pathname === '/desktop-login') {
    return <Suspense fallback={<div className="w-screen h-screen bg-[#0c0d14]" />}><DesktopLogin /></Suspense>;
  }

  // --- Persistent State ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_settings');
      let parsed = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
      const validVoices = ['puck', 'charon', 'fenrir', 'kore', 'aoede'];
      if (!validVoices.includes(parsed.ttsVoice)) {
        parsed = { ...parsed, ttsVoice: 'puck' };
        localStorage.setItem('quest_compendium_settings', JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [tabs, setTabs] = useState<GameTab[]>(() => {
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

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || '';
  });

  // Ensure activeTabId always resolves to a valid tab when tabs exist, or resets when tabs is empty
  useEffect(() => {
    if (tabs.length > 0) {
      if (!tabs.some(t => t.id === activeTabId)) {
        setActiveTabId(tabs[0].id);
      }
    } else if (activeTabId !== '') {
      setActiveTabId('');
    }
  }, [tabs, activeTabId]);

  // --- UI Drawer & Modal States ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameModalMode, setRenameModalMode] = useState<'create' | 'rename'>('create');
  const [renameModalTabId, setRenameModalTabId] = useState<string | null>(null);
  const [renameModalInitialValue, setRenameModalInitialValue] = useState('');
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [examinedImageUrl, setExaminedImageUrl] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [globalActiveGame, setGlobalActiveGame] = useState<SteamGameData | null>(null);

  // --- Resizing States ---
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [achDrawerWidth, setAchDrawerWidth] = useState(384);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingAch, setIsDraggingAch] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { startX, startWidth } = dragStartRef.current;
      
      if (isDraggingSidebar) {
        const delta = e.clientX - startX;
        setSidebarWidth(Math.max(200, Math.min(800, startWidth + delta)));
      } else if (isDraggingAch) {
        const delta = startX - e.clientX;
        setAchDrawerWidth(Math.max(250, Math.min(800, startWidth + delta)));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      setIsDraggingAch(false);
      dragStartRef.current = null;
    };

    if (isDraggingSidebar || isDraggingAch) {
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
  }, [isDraggingSidebar, isDraggingAch]);

  const { user, subscriptionStatus, userData, isInitializing, isOutdated, syncDiagnostics } = useCloudSync(settings, tabs, setSettings, setTabs);

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
              setTabs(cleaned);
              setActiveTabId(cleaned[0]?.id || '');
              lastUserIdentityRef.current = currentIdentity;
              return;
            }
          }
        } catch {}
        setTabs([]);
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
              setTabs(cleaned);
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
  
  let activeGame = activeTab?.activeSteamGame || null;
  if (globalActiveGame) {
    const autoHeaderImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${globalActiveGame.appId}/header.jpg`;
    // We unconditionally prioritize the globally running game for the activeGame object so Gemini always sees the truth
    activeGame = { 
      ...globalActiveGame, 
      isAutoDetected: true, 
      headerImage: activeGame?.headerImage || autoHeaderImage,
      achievements: (globalActiveGame as any).achievements || activeGame?.achievements,
      patchNotes: (globalActiveGame as any).patchNotes || activeGame?.patchNotes
    } as SteamGameData;
  } else if (activeGame?.isAutoDetected) {
    activeGame = null;
  }


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
    if ((window as any).electronAPI?.resizeWindow) {
      const baseWidth = 550;
      
      let totalWidth = baseWidth;
      if (isSidebarOpen) totalWidth += sidebarWidth;
      if (isAchDrawerOpen) totalWidth += achDrawerWidth;

      (window as any).electronAPI.resizeWindow(totalWidth);
    }
  }, [isSidebarOpen, isAchDrawerOpen, sidebarWidth, achDrawerWidth]);

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
      });
    }
  }, [
    settings.hideAppShortcut, 
    settings.voiceInputShortcut,
    settings.autoScreenshotShortcut
  ]);

  // Controller: tell the desktop app which chord shows / hides the overlay.
  useEffect(() => {
    (window as any).electronAPI?.setControllerConfig?.({
      enabled: settings.controllerEnabled !== false,
      chord: settings.controllerToggle || 'back+start',
    });
  }, [settings.controllerEnabled, settings.controllerToggle]);

  // Snapshot on open (desktop): capture the game before the overlay takes focus.
  useEffect(() => {
    (window as any).electronAPI?.setOverlayOptions?.({ snapshotOnOpen: settings.snapshotOnOpen !== false, stickyPointers: settings.stickyPointers !== false, markersInRecordings: settings.markersInRecordings !== false, markerLifetimeMs: Math.max(0, settings.markerLifetime ?? 120) * 1000 });
  }, [settings.snapshotOnOpen, settings.stickyPointers, settings.markersInRecordings, settings.markerLifetime]);

  /** Update one message wherever it is (used by the marker features). */
  const updateMessageById = (msgId: string, fn: (m: ChatMessage) => ChatMessage) =>
    setTabs((prev) => prev.map((t) => (t.messages.some((m) => m.id === msgId) ? { ...t, messages: t.messages.map((m) => (m.id === msgId ? fn(m) : m)) } : t)));

  /**
   * Precision pass: crop a zoomed-in square around each marked spot and ask the fast model to pinpoint the exact
   * object, using the AI's own description ("lower-right barrel of the three"). Markers then slide onto it.
   */
  /**
   * Zoom in on spots of a screenshot and ask the fast model to pinpoint each described object in its close-up.
   * Returns the objects it found (0-1 in the full screenshot); objects it couldn't find are left out.
   */
  const pinpoint = async (image: string, items: { x: number; y: number; label: string; where: string }[], game: string, token: string | null) => {
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
    if (!ctx || side < 40) return [];
    const crops = items.map((p, index) => {
      const x0 = Math.max(0, Math.min(W - side, Math.round(p.x * W - side / 2)));
      const y0 = Math.max(0, Math.min(H - side, Math.round(p.y * H - side / 2)));
      ctx.imageSmoothingEnabled = false; // keep pixel art crisp when zooming in
      ctx.drawImage(img, x0, y0, side, side, 0, 0, 768, 768);
      return { index, x0, y0, image: canvas.toDataURL('image/jpeg', 0.85), label: p.label, where: p.where };
    });
    const res = await fetch(`${getApiBaseUrl()}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ crops: crops.map((c) => ({ image: c.image, label: c.label, where: c.where })), game }),
    });
    const data = res.ok ? await res.json() : { found: [] };
    return (Array.isArray(data.found) ? data.found : [])
      .map((f: { index: number; x: number; y: number }) => {
        const c = crops[f.index];
        return c ? { index: c.index, x: (c.x0 + f.x * side) / W, y: (c.y0 + f.y * side) / H } : null;
      })
      .filter(Boolean) as { index: number; x: number; y: number }[];
  };

  const refineMarkers = async (msgId: string, image: string, points: ScreenPoint[], game: string, token: string | null) => {
    const log = (m: string) => (window as any).electronAPI?.markerLog?.(m);
    try {
      const found = await pinpoint(image, points.map((p) => ({ x: p.x, y: p.y, label: p.label, where: p.where || '' })), game, token);
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
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onLocateRequest) return;
    api.onPointersState?.(({ id, active }: { id: string; active: boolean }) => setPointersActive(id, active));
    api.onLocateRequest(async ({ id, image, occupied }: { id: string; image: string; occupied?: { x: number; y: number }[] }) => {
      const tab = tabsRef.current.find((t) => t.messages.some((m) => m.id === id));
      const msg = tab?.messages.find((m) => m.id === id);
      const notFound = (msg?.nearby ?? []).map((n, i) => ({ ...n, i })).filter((n) => !n.found);
      // Items on this map first; if the AI marked none as on this map, look for all of them.
      const pending = notFound.some((n) => n.onMap) ? notFound.filter((n) => n.onMap) : notFound;
      const log = (m: string) => api.markerLog?.(m);
      if (!tab || !msg || !pending.length) {
        api.locateDone?.(id, 0);
        return;
      }
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
        const data = res.ok ? await res.json() : { found: [] };
        const found: { index: number; x: number; y: number }[] = Array.isArray(data.found) ? data.found : [];
        log(res.ok ? `area check: looked for ${pending.map((n) => n.label).join(', ')}; found ${found.length}` : `area check failed: HTTP ${res.status}`);
        if (!found.length) {
          api.locateDone?.(id, pending.length);
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
          ? await pinpoint(image, clear.map((f) => ({ x: f.x, y: f.y, label: pending[f.index].label, where: pending[f.index].hint || '' })), tab.activeSteamGame?.name || locateGameRef.current?.name || '', token)
          : [];
        const fresh = confirmed
          .filter((c) => Math.hypot(c.x - clear[c.index].x, (c.y - clear[c.index].y) * 0.5625) < 0.08)
          .map((c) => ({ ...clear[c.index], x: c.x, y: c.y }));
        if (clear.length > fresh.length) log(`close-up check rejected ${clear.length - fresh.length} find(s)`);
        const newPoints = fresh.map((f) => ({ x: f.x, y: f.y, label: pending[f.index].label, fromArea: true }));
        const foundIdx = new Set(fresh.map((f) => pending[f.index].i));
        if (!newPoints.length) {
          api.locateDone?.(id, pending.length);
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
        api.locateDone?.(id, pending.length - fresh.length);
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
      (window as any).electronAPI.onTriggerVoiceInputStart(() => {
        setIsBrowserMode(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-voice-start'));
        }, 100);
      });
    }
    if ((window as any).electronAPI?.onTriggerVoiceInputStop) {
      (window as any).electronAPI.onTriggerVoiceInputStop(() => {
        window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
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
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('trigger-auto-screenshot-submit'));
        }, 100);
      });
    }
  }, []);

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

  useEffect(() => {
    // Avoid overwriting persisted storage with empty tabs while initializing
    if (isInitializing) return;

    try {
      if (user?.isGuest) {
        localStorage.setItem('quest_guest_tabs', JSON.stringify(tabs));
      } else if (user && !user.isGuest) {
        localStorage.setItem(`quest_compendium_tabs_${user.uid}`, JSON.stringify(tabs));
        localStorage.setItem('quest_compendium_tabs', JSON.stringify(tabs));
      } else {
        const isGuestSaved = typeof window !== 'undefined' && Boolean(localStorage.getItem('quest_guest_session'));
        if (isGuestSaved) {
          localStorage.setItem('quest_guest_tabs', JSON.stringify(tabs));
        } else {
          localStorage.setItem('quest_compendium_tabs', JSON.stringify(tabs));
        }
      }
    } catch {}
  }, [tabs, user, isInitializing]);

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
  const handleSendMessage = async (text: string, imageBase64?: string, audioBase64?: string, preferredModel?: 'pro' | 'flash') => {
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
    const backendUrl = getApiBaseUrl();
    const chatEndpoint = backendUrl ? `${backendUrl}/api/chat` : '/api/chat';

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          question: text,
          history: activeTab.messages,
          imageBase64,
          audioBase64,
          aiMode: settings.aiMode,
          preferredModel,
          isGameRunningLocally: globalActiveGame !== null,
          activeGame: activeGame ? {
            name: activeGame.name,
            appId: activeGame.appId,
            genre: activeGame.genre,
            developer: activeGame.developer
          } : null,
          achievements: activeGame?.achievements || [],
          news: activeGame?.patchNotes || [],
          generateBanner: settings.enableThematicBanners !== false,
          language: aiLanguageName(settings.language)
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
        let shouldOpenPaywall = false;
        try {
          const errData = await res.json();
          errorText = errData.error || errData.text || errorText;
          if ((res.status === 403 || res.status === 429) && errData.modelUsed === 'Limit Reached') {
            shouldOpenPaywall = true;
          }
        } catch (e) {
          if (res.status === 404) {
             errorText = `Backend 404 at ${backendUrl}: The server endpoint was not found.`;
          } else if (res.status === 403) {
             errorText = `HTTP 403 Forbidden at ${backendUrl}. The server rejected the request. Please check your backend connection in Settings -> Cloud & Server.`;
          } else {
             errorText = `HTTP ${res.status} (Non-JSON response)`;
          }
        }
        
        if (shouldOpenPaywall) {
           setIsPaywallOpen(true);
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
        ...(Array.isArray(data.points) && data.points.length ? { points: data.points } : {}),
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
        (window as any).electronAPI?.showScreenPointers?.(aiMessage.points, accent, {
          refImage: imageBase64,
          sessionId: aiMessage.id,
          hidden: [],
          watchNearby: !!aiMessage.nearby?.length,
        });
      }
      // Precision pass: zoom in on each marked spot so markers land on the exact object (free, rate-limited).
      if (aiMessage.points?.length && imageBase64) {
        refineMarkers(aiMessage.id, imageBase64, aiMessage.points, activeTab.activeSteamGame?.name || globalActiveGame?.name || '', token);
      }

      setTabs(prev => {
        const nextTabs = prev.map(t => 
          t.id === activeTab.id ? { ...t, messages: [...t.messages, aiMessage], lastActive: nowAi } : t
        );
        return nextTabs;
      });
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

      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('fetch failed')) {
        errorMsg = `Connection failed to cloud server at ${backendUrl || DEFAULT_CLOUD_URL}. Please check your internet connection or verify your server in Settings -> Cloud & Server.`;
      }
      let isLimitReached = errorMsg.includes('Daily limit reached') || errorMsg.includes('Upgrade to Premium');

      const nowCatch = Date.now();
      const errorMessage: ChatMessage = {
        id: `msg-${nowCatch + 1}`,
        role: 'assistant',
        text: isLimitReached 
          ? `⚠️ **Inquiry Limit Reached:**\n\n${errorMsg}`
          : `⚠️ **Compendium Inquiry Error:** Unable to reach Google Gemini server.\n\n*Details: ${errorMsg}*`,
        timestamp: nowCatch,
        modelUsed: isLimitReached ? 'Limit Reached' : 'Offline Fallback'
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

  // Docking Layout Container classes
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
    <div className={`w-screen h-screen flex overflow-hidden ${isDesktop ? 'bg-transparent' : 'bg-[#0c0d14]'}`}>
      {/* Background CRT scan line ambient glow */}
      <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-transparent pointer-events-none" />

      {/* Edge Slide Toggle Tab (Desktop Only) */}
      {isDesktop && settings.dockPosition !== 'undocked' && (
        <button
          onClick={() => {
            if ((window as any).electronAPI?.toggleSlide) {
              (window as any).electronAPI.toggleSlide();
            }
          }}
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-32 bg-[var(--accent-color)]/70 hover:bg-[var(--accent-color)] cursor-pointer flex items-center justify-center z-50 backdrop-blur-md shadow-lg border border-white/20 transition-all ${
            settings.dockPosition.includes('right') 
              ? 'left-0 rounded-r-xl border-l-0 hover:w-5' 
              : 'right-0 rounded-l-xl border-r-0 hover:w-5'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          title="Toggle Dock Visibility"
        >
          
        </button>
      )}

      {/* Main App Window Frame */}
      <div 
        className={`flex flex-col overflow-hidden backdrop-blur-2xl relative transition-all ${getDockClasses(settings.dockPosition)}`}
        style={{
          backgroundColor: `rgba(14, 14, 18, ${settings.windowOpacity / 100})`,
          boxShadow: '0 0 35px var(--accent-glow)'
        }}
      >
        {/* Header Bar */}
        <HeaderBar
          userData={userData}
          activeTab={activeTab}
          tabsCount={tabs.length}
          activeGame={activeGame}
          isGameRunningLocally={globalActiveGame !== null}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isAchDrawerOpen={isAchDrawerOpen}
          onToggleAchDrawer={() => setIsAchDrawerOpen(!isAchDrawerOpen)}
          isNotesOpen={isNotesOpen}
          onToggleNotes={() => setIsNotesOpen(!isNotesOpen)}
          isBrowserMode={isBrowserMode}
          onToggleBrowserMode={() => setIsBrowserMode(!isBrowserMode)}
          onOpenGameSearch={() => setIsGameSearchOpen(true)}
          onOpenFeedback={() => setIsFeedbackOpen(true)}
          onOpenPaywall={() => setIsPaywallOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          soundEnabled={settings.soundEnabled}
          isDocked={settings.dockPosition !== 'undocked'}
          onToggleDock={() => {
            const newPos = settings.dockPosition === 'undocked' ? 'top-right' : 'undocked';
            setSettings(s => ({ ...s, dockPosition: newPos }));
            if ((window as any).electronAPI?.setDockPosition) {
              (window as any).electronAPI.setDockPosition(newPos);
            }
          }}
          theme={settings.theme}
          onSync={syncDiagnostics?.triggerSyncNow}
        />

        {/* Font Quick Switcher Menu Popup */}
        {fontMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setFontMenuOpen(false)} />
            <div className="absolute top-14 right-12 z-50 bg-[#161620] border border-white/15 rounded-xl shadow-2xl p-3 w-56 space-y-3 animate-in fade-in zoom-in-95">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block border-b border-white/10 pb-1">
              Typography Style
            </span>
            <div className="space-y-1 text-xs">
              <button
                onClick={() => setSettings(s => ({ ...s, chatFont: 'segoe' }))}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors ${settings.chatFont === 'segoe' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Standard (Segoe UI)
              </button>
              <button
                onClick={() => setSettings(s => ({ ...s, chatFont: 'pixel' }))}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-pixel text-base ${settings.chatFont === 'pixel' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Retro Pixel (VT323)
              </button>
              <button
                onClick={() => setSettings(s => ({ ...s, chatFont: 'lore' }))}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-lore ${settings.chatFont === 'lore' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Tome Lore (Literata)
              </button>
              <button
                onClick={() => setSettings(s => ({ ...s, chatFont: 'code' }))}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-code ${settings.chatFont === 'code' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Cyber Code (JetBrains)
              </button>
            </div>
            
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block border-b border-white/10 pb-1 mt-2 pt-2">
              Chat Size
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="12"
                max="24"
                value={settings.chatFontSize}
                onChange={(e) => setSettings(s => ({ ...s, chatFontSize: Number(e.target.value) }))}
                className="flex-1 accent-[var(--accent-color)] cursor-pointer h-1.5 bg-white/20 rounded"
              />
              <span className="font-mono text-zinc-300 w-6 text-right font-bold text-xs">{settings.chatFontSize}px</span>
            </div>
          </div>
          </>
        )}

        {/* Main Body: Left Sidebar + Central Chat/Browser + Right Achievements Drawer */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Games Sidebar */}
          <GamesSidebar
            width={sidebarWidth}
            isDragging={isDraggingSidebar}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            tabs={tabs}
            activeTabId={activeTabId}
            globalActiveGame={activeGame}
            onSelectTab={handleSelectTab}
            onStartCreateTab={handleStartCreateTab}
            onStartRenameTab={handleStartRenameTab}
            onDeleteTab={handleDeleteTab}
            tabFontSize={settings.tabFontSize}
            onChangeTabFontSize={(size) => setSettings(s => ({ ...s, tabFontSize: size }))}
            soundEnabled={settings.soundEnabled}
            onOpenNotes={() => setIsNotesOpen(true)}
            onOpenGuides={() => setIsBrowserMode(true)}
            onOpenQuests={() => setIsQuestsOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenFeedback={() => setIsFeedbackOpen(true)}
            onSync={syncDiagnostics?.triggerSyncNow}
          />

          {/* Sidebar Drag Handle */}
          {isSidebarOpen && (
            <div 
              className="w-1.5 cursor-col-resize hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)] transition-colors z-30 flex-shrink-0"
              onMouseDown={(e) => {
                setIsDraggingSidebar(true);
                dragStartRef.current = { startX: e.clientX, startWidth: sidebarWidth };
              }}
            />
          )}

          {/* Central Workspace: Chat OR Browser */}
          <main className="qc-scanlines flex-1 flex flex-col overflow-hidden relative">
            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
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

                   {/* The game running on Steam right now, one click to start */}
                   {globalActiveGame && (
                     <div className="qc-px-frame w-full flex items-center gap-3 p-3 rounded-2xl bg-[#11121a] border border-[var(--accent-border)] text-left">
                       <img
                         src={`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${globalActiveGame.appId}/header.jpg`}
                         alt=""
                         className="w-16 h-10 object-cover rounded-lg border border-white/10 flex-shrink-0"
                         onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                       />
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
                   <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2 text-left">
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
                steamName={settings.steamName}
                steamAvatar={settings.steamAvatar}
                onSendMessage={handleSendMessage}
                isLoading={isLoadingAi}
                aiMode={settings.aiMode}
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
                onAppendToNotes={handleAppendToNotes}
                markerLifetime={settings.markerLifetime ?? 120}
                onChangeMarkerLifetime={(seconds) => setSettings((s) => ({ ...s, markerLifetime: seconds }))}
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
                fontMenuOpen={fontMenuOpen}
                onToggleFontMenu={() => setFontMenuOpen(!fontMenuOpen)}
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

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(updated) => setSettings(s => ({ ...s, ...updated }))}
        soundEnabled={settings.soundEnabled}
        syncDiagnostics={syncDiagnostics}
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
          userId={user.uid} 
          onClose={() => setIsPaywallOpen(false)} 
        />
      )}

      {/* Controller support: focus navigation, quick questions, on-screen keyboard, button hints */}
      <ControllerLayer enabled={settings.controllerEnabled !== false} />

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