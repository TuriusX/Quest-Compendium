import React, { useState, useEffect } from 'react';
import { 
  GameTab, 
  SteamGameData, 
  AppSettings, 
  ChatMessage, 
  ColorTheme,
  DockPosition
} from './types';
import { POPULAR_STEAM_GAMES } from './data/mockGames';
import { HeaderBar } from './components/HeaderBar';
import { GamesSidebar } from './components/GamesSidebar';
import { ChatArea } from './components/ChatArea';
import { AchievementsDrawer } from './components/AchievementsDrawer';
import { PlaythroughNotepad } from './components/PlaythroughNotepad';
import { GameGuidesBrowser } from './components/GameGuidesBrowser';
import { SettingsModal } from './components/SettingsModal';
import { QuickGameSearchModal } from './components/QuickGameSearchModal';
import { GameScreenModal } from './components/GameScreenModal';
import { AuthModal } from './components/AuthModal';
import { PaywallModal } from './components/PaywallModal';
import { useCloudSync } from './hooks/useCloudSync';

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
  ttsVoice: 'Kore',
  customApiKey: '',
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

import { DesktopLogin } from './components/DesktopLogin';

export default function App() {
  if (window.location.pathname === '/desktop-login') {
    return <DesktopLogin />;
  }

  // --- Persistent State ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [tabs, setTabs] = useState<GameTab[]>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}

    // Default starter tab: Elden Ring
    const initialGame = null;
    return [
      {
        id: 'tab-default',
        name: 'New Session',
        activeSteamGame: initialGame,
        messages: [
          {
            id: 'msg-welcome',
            role: 'assistant',
            text: `### ⚔️ Welcome to the Quest Compendium!

I stand ready to guide your journey. 

**Here is what I can do for you:**
* **Screen & Vision Analysis**: Snap or paste your game screen (<kbd>Ctrl+V</kbd>) anytime for immediate puzzle solutions, inventory optimization, or boss attack breakdowns.
* **Achievement Tracker**: Check the **Achievements (🏆)** drawer on the right to track rare achievements and 100% completion progress.
* **Playthrough Scratchpad**: Jot down NPC quest steps, dungeon codes, and map notes in the **Notes (📝)** overlay.
* **Guides & FAQs**: Open the built-in **Guides (🌐)** browser to view interactive maps and GameFAQs.

*What challenge or question lies before you?*`,
            timestamp: Date.now(),
            modelUsed: 'Gemini 3.1 Pro Preview'
          }
        ],
        notes: `<h3>Elden Ring Quest Notes</h3>
<ul>
  <li>Ranni the Witch: Meet at Three Sisters tower after Caria Manor.</li>
  <li>Alexander Iron Fist: Stuck in cliffside near Saintsbridge.</li>
  <li>Margit Shackle: Purchase from Patches in Murkwater Cave.</li>
</ul>`,
        createdAt: Date.now(),
        lastActive: Date.now()
      }
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || 'tab-1';
  });

  // --- UI Drawer & Modal States ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAchDrawerOpen, setIsAchDrawerOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isBrowserMode, setIsBrowserMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGameSearchOpen, setIsGameSearchOpen] = useState(false);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [examinedImageUrl, setExaminedImageUrl] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [globalActiveGame, setGlobalActiveGame] = useState<{name: string, appId: number} | null>(null);

  const { user, subscriptionStatus, isInitializing } = useCloudSync(settings, tabs, setSettings, setTabs);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  
  let activeGame = activeTab?.activeSteamGame || null;
  if (globalActiveGame) {
    if (activeGame?.appId === globalActiveGame.appId) {
      activeGame = { ...activeGame, name: globalActiveGame.name, appId: globalActiveGame.appId, isAutoDetected: true };
    } else {
      activeGame = { ...globalActiveGame, isAutoDetected: true } as SteamGameData;
    }
  } else if (activeGame?.isAutoDetected) {
    activeGame = null;
  }

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
      const baseWidth = 450;
      const sidebarWidth = 288; // w-72
      const achDrawerWidth = 384; // sm:w-96

      let totalWidth = baseWidth;
      if (isSidebarOpen) totalWidth += sidebarWidth;
      if (isAchDrawerOpen) totalWidth += achDrawerWidth;

      (window as any).electronAPI.resizeWindow(totalWidth);
    }
  }, [isSidebarOpen, isAchDrawerOpen]);

  // Sync Dock Position to Electron
  useEffect(() => {
    if ((window as any).electronAPI?.setDockPosition) {
      (window as any).electronAPI.setDockPosition(settings.dockPosition);
    }
  }, [settings.dockPosition]);

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
  }, [settings.theme, settings.windowOpacity, settings.tabFontSize, settings.chatFontSize, settings.chatFont]);

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

    // Listen for popup auth messages and storage events
    const handleMessage = (event: MessageEvent) => {
      // Allow localhost and .run.app origins
      if (!event.origin.includes('localhost') && !event.origin.endsWith('.run.app')) {
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
    try {
      localStorage.setItem('quest_compendium_tabs', JSON.stringify(tabs));
    } catch {}
  }, [tabs]);

  // Fetch real Steam achievements if steamId is set
  useEffect(() => {
    if (!settings.steamId || !activeGame || !activeTab) return;

    let isMounted = true;
    const fetchAchievements = async () => {
      try {
        const res = await fetch(`/api/steam/achievements/${activeGame.appId}?steamId=${encodeURIComponent(settings.steamId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.achievements && isMounted) {
            setTabs(prev => prev.map(t => {
              if (t.id === activeTab.id) {
                // Keep existing data if it's the same game, otherwise reset it
                return {
                  ...t,
                  activeSteamGame: {
                    ...(t.activeSteamGame?.appId === activeGame.appId ? t.activeSteamGame : {
                      name: activeGame.name,
                      appId: activeGame.appId
                    }),
                    ...(activeGame.isAutoDetected !== undefined ? { isAutoDetected: activeGame.isAutoDetected } : {}),
                    achievements: data.achievements
                  }
                };
              }
              return t;
            }));
          }
        }
      } catch (err) {
        console.error('Failed to sync Steam achievements:', err);
      }
    };

    fetchAchievements();
    return () => { isMounted = false; };
  }, [activeGame?.appId, settings.steamId]); // Use these deps, do not put activeTab.id in deps to avoid infinite loop when achievements update

  // Handle Sending Message to Server Gemini API
  const handleSendMessage = async (text: string, imageBase64?: string) => {
    if (!activeTab) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text,
      imageUrl: imageBase64,
      timestamp: Date.now()
    };

    const updatedMessages = [...activeTab.messages, userMessage];

    // Optimistically update UI
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, messages: updatedMessages } : t));
    setIsLoadingAi(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          history: updatedMessages,
          imageBase64,
          aiMode: settings.aiMode,
          customApiKey: settings.customApiKey,
          activeGame: activeGame ? {
            name: activeGame.name,
            appId: activeGame.appId,
            genre: activeGame.genre,
            developer: activeGame.developer
          } : { name: activeTab.name },
          achievements: activeGame?.achievements || [],
          news: activeGame?.patchNotes || []
        }),
      });

      if (!res.ok) {
        let errorText = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errorText = errData.error || errorText;
        } catch (e) {
          errorText = `HTTP ${res.status} (Non-JSON response)`;
        }
        throw new Error(`Server error: ${errorText}`);
      }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned non-JSON response');
      }

      const data = await res.json();

      const aiMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        text: data.text || 'No response generated from the Compendium.',
        modelUsed: data.modelUsed || 'Gemini 3.1 Pro Preview',
        timestamp: Date.now()
      };

      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, messages: [...updatedMessages, aiMessage] } : t
      ));
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        text: `⚠️ **Compendium Inquiry Error:** Unable to reach Google Gemini server.\n\n*Details: ${err?.message || 'Network error'}*`,
        timestamp: Date.now(),
        modelUsed: 'Offline Fallback'
      };

      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, messages: [...updatedMessages, errorMessage] } : t
      ));
    } finally {
      setIsLoadingAi(false);
    }
  };

  // Tab Handlers
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    if (isBrowserMode) setIsBrowserMode(false);
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
          text: `Welcome to **${name}**! The Compendium is ready to analyze your screen, track achievements, and guide your quest.`,
          timestamp: Date.now(),
          modelUsed: 'Gemini 3.1 Pro Preview'
        }
      ],
      notes: `<h3>${name} Notes</h3>\n<p>Start recording playthrough tips here...</p>`,
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
    if (remaining.length === 0) {
      handleCreateTab('New Game');
      return;
    }
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[0].id);
    }
  };

  // Achievement Toggling
  const handleToggleAchievement = (apiname: string) => {
    if (!activeTab || !activeGame?.achievements) return;

    const updatedAchievements = activeGame.achievements.map(a => {
      if (a.apiname === apiname) {
        return {
          ...a,
          unlocked: !a.unlocked,
          unlockDate: !a.unlocked ? new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null
        };
      }
      return a;
    });

    const updatedGame = { ...activeGame, achievements: updatedAchievements };

    setTabs(prev => prev.map(t => 
      t.id === activeTab.id ? { ...t, activeSteamGame: updatedGame } : t
    ));
  };

  // Playthrough Notes Handlers
  const handleUpdateNotes = (notes: string) => {
    if (!activeTab) return;
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, notes } : t));
  };

  const handleAppendToNotes = (text: string) => {
    if (!activeTab) return;
    const cleanText = text.replace(/<[^>]*>?/gm, '').slice(0, 300);
    const addition = `<p><strong>Insight:</strong> ${cleanText}</p>`;
    const updated = (activeTab.notes || '') + addition;
    handleUpdateNotes(updated);
    setIsNotesOpen(true);
  };

  // Game Switcher Selection
  const handleSelectGame = (game: SteamGameData) => {
    const gameWithFlag = { ...game, isAutoDetected: false };
    if (activeTab) {
      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, name: gameWithFlag.name, activeSteamGame: gameWithFlag } : t
      ));
    } else {
      handleCreateTab(gameWithFlag.name, gameWithFlag);
    }
  };

  // Docking Layout Container classes
  const getDockClasses = (dock: DockPosition) => {
    switch (dock) {
      case 'undocked':
        // When floating freely, make it look like a nice app window with borders and rounded corners.
        // We use h-[98%] and w-[98%] so the shadow doesn't get hard-clipped by the Electron window bounds,
        // and we rely on the flex container to center it.
        return 'w-[98%] h-[98%] rounded-xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)] mx-auto my-auto';
      default:
        // Snug fit for all docked corners (no rounded corners, no space)
        return 'w-full h-full rounded-none border-none shadow-[0_0_40px_rgba(0,0,0,0.8)]';
    }
  };

  return (
    <div className="w-screen h-screen bg-transparent flex overflow-hidden select-none font-sans">
      {/* Background CRT scan line ambient glow */}
      <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-transparent pointer-events-none" />

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
          activeTab={activeTab}
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
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenGameSearch={() => setIsGameSearchOpen(true)}
          fontMenuOpen={fontMenuOpen}
          onToggleFontMenu={() => setFontMenuOpen(!fontMenuOpen)}
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
        />

        {/* Font Quick Switcher Menu Popup */}
        {fontMenuOpen && (
          <div className="absolute top-14 right-12 z-50 bg-[#161620] border border-white/15 rounded-xl shadow-2xl p-3 w-56 space-y-3 select-none animate-in fade-in zoom-in-95">
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
        )}

        {/* Main Body: Left Sidebar + Central Chat/Browser + Right Achievements Drawer */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Games Sidebar */}
          <GamesSidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCreateTab={(name) => handleCreateTab(name)}
            onRenameTab={handleRenameTab}
            onDeleteTab={handleDeleteTab}
            tabFontSize={settings.tabFontSize}
            onChangeTabFontSize={(size) => setSettings(s => ({ ...s, tabFontSize: size }))}
            soundEnabled={settings.soundEnabled}
            onOpenNotes={() => setIsNotesOpen(true)}
            onOpenGuides={() => setIsBrowserMode(true)}
          />

          {/* Central Workspace: Chat OR Browser */}
          <main className="flex-1 flex flex-col overflow-hidden relative">
            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
              />
            ) : (
              <ChatArea
                activeTab={activeTab}
                onSendMessage={handleSendMessage}
                isLoading={isLoadingAi}
                aiMode={settings.aiMode}
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
                onAppendToNotes={handleAppendToNotes}
                onOpenScreenModal={(url) => setExaminedImageUrl(url)}
                ttsVoice={settings.ttsVoice}
                customApiKey={settings.customApiKey}
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
          </main>

          {/* Right Achievements Drawer */}
          <AchievementsDrawer
            isOpen={isAchDrawerOpen}
            onClose={() => setIsAchDrawerOpen(false)}
            gameData={activeGame}
            onToggleAchievement={handleToggleAchievement}
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
      />

      {/* Auth & Paywall Overlays */}
      {!isInitializing && !user && (
        <AuthModal onSignInSuccess={() => {}} />
      )}
      {!isInitializing && user && subscriptionStatus !== 'active' && (
        <PaywallModal userId={user.uid} />
      )}

      {/* Quick Game Search & Switcher Modal */}
      <QuickGameSearchModal
        isOpen={isGameSearchOpen}
        onClose={() => setIsGameSearchOpen(false)}
        onSelectGame={handleSelectGame}
        soundEnabled={settings.soundEnabled}
      />

      {/* Fullscreen Screenshot Examination Modal */}
      <GameScreenModal
        imageUrl={examinedImageUrl}
        onClose={() => setExaminedImageUrl(null)}
        soundEnabled={settings.soundEnabled}
      />
    </div>
  );
}
