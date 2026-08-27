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
};

const THEME_STYLES: Record<ColorTheme, { color: string; dim: string; border: string; glow: string }> = {
  purple: { color: '#a87ffb', dim: 'rgba(168, 127, 251, 0.15)', border: 'rgba(168, 127, 251, 0.3)', glow: 'rgba(168, 127, 251, 0.4)' },
  crimson: { color: '#ff4d4d', dim: 'rgba(255, 77, 77, 0.15)', border: 'rgba(255, 77, 77, 0.3)', glow: 'rgba(255, 77, 77, 0.4)' },
  cyan: { color: '#00f0ff', dim: 'rgba(0, 240, 255, 0.15)', border: 'rgba(0, 240, 255, 0.3)', glow: 'rgba(0, 240, 255, 0.4)' },
  amber: { color: '#ffb84d', dim: 'rgba(255, 184, 77, 0.15)', border: 'rgba(255, 184, 77, 0.3)', glow: 'rgba(255, 184, 77, 0.4)' },
  emerald: { color: '#00e676', dim: 'rgba(0, 230, 118, 0.15)', border: 'rgba(0, 230, 118, 0.3)', glow: 'rgba(0, 230, 118, 0.4)' },
};

export default function App() {
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
    const initialGame = POPULAR_STEAM_GAMES[0];
    return [
      {
        id: 'tab-elden-ring',
        name: 'Elden Ring',
        activeSteamGame: initialGame,
        messages: [
          {
            id: 'msg-welcome',
            role: 'assistant',
            text: `### ⚔️ Welcome, Tarnished, to the Quest Compendium!

I stand ready to guide your journey through the **Lands Between**. 

**Here is what I can do for you:**
* **Screen & Vision Analysis**: Snap or paste your game screen (<kbd>Ctrl+V</kbd>) anytime for immediate puzzle solutions, inventory optimization, or boss attack breakdowns.
* **Trophy & Medals Tracker**: Check the **Medals (🏆)** drawer on the right to track rare achievements and 100% Platinum progress.
* **Playthrough Scratchpad**: Jot down NPC quest steps, dungeon codes, and map notes in the **Notes (📝)** overlay.
* **Guides & FAQs**: Open the built-in **Guides (🌐)** browser to view interactive maps and GameFAQs.

*What challenge or question lies before you?*`,
            timestamp: Date.now(),
            modelUsed: 'Gemini 3.7 Flash'
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

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  const activeGame = activeTab?.activeSteamGame || null;

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
  }, [settings.theme, settings.windowOpacity, settings.tabFontSize]);

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
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();

      const aiMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        text: data.text || 'No response generated from the Compendium.',
        modelUsed: data.modelUsed || 'Gemini 3.7 Flash',
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
          modelUsed: 'Gemini 3.7 Flash'
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
    if (activeTab) {
      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, name: game.name, activeSteamGame: game } : t
      ));
    } else {
      handleCreateTab(game.name, game);
    }
  };

  // Docking Layout Container classes
  const getDockClasses = (dock: DockPosition) => {
    switch (dock) {
      case 'top-right':
        return 'max-w-6xl w-full h-[95vh] rounded-2xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)]';
      case 'bottom-right':
        return 'max-w-6xl w-full h-[95vh] rounded-2xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)]';
      case 'top-left':
      case 'bottom-left':
        return 'max-w-6xl w-full h-[95vh] rounded-2xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)]';
      case 'undocked':
      default:
        return 'w-full h-full rounded-none border-none';
    }
  };

  return (
    <div className="w-screen h-screen bg-[#070709] flex items-center justify-center p-0 sm:p-2 overflow-hidden select-none font-sans">
      {/* Background CRT scan line ambient glow */}
      <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-black pointer-events-none" />

      {/* Main App Window Frame */}
      <div 
        className={`flex flex-col overflow-hidden bg-[#0e0e12]/95 backdrop-blur-2xl relative transition-all ${getDockClasses(settings.dockPosition)}`}
        style={{
          boxShadow: '0 0 35px var(--accent-glow)'
        }}
      >
        {/* Header Bar */}
        <HeaderBar
          activeTab={activeTab}
          activeGame={activeGame}
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
          onToggleDock={() => setSettings(s => ({ ...s, dockPosition: s.dockPosition === 'undocked' ? 'top-right' : 'undocked' }))}
          theme={settings.theme}
        />

        {/* Font Quick Switcher Menu Popup */}
        {fontMenuOpen && (
          <div className="absolute top-14 right-12 z-50 bg-[#161620] border border-white/15 rounded-xl shadow-2xl p-3 w-48 space-y-2 select-none animate-in fade-in zoom-in-95">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block border-b border-white/10 pb-1">
              Typography Style
            </span>
            <div className="space-y-1 text-xs">
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, chatFont: 'segoe' }));
                  document.documentElement.style.setProperty('--chat-font-family', "'Segoe UI', system-ui, sans-serif");
                }}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors ${settings.chatFont === 'segoe' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Standard (Segoe UI)
              </button>
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, chatFont: 'pixel' }));
                  document.documentElement.style.setProperty('--chat-font-family', "'VT323', monospace");
                }}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-pixel text-base ${settings.chatFont === 'pixel' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Retro Pixel (VT323)
              </button>
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, chatFont: 'lore' }));
                  document.documentElement.style.setProperty('--chat-font-family', "'Literata', serif");
                }}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-lore ${settings.chatFont === 'lore' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Tome Lore (Literata)
              </button>
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, chatFont: 'code' }));
                  document.documentElement.style.setProperty('--chat-font-family', "'JetBrains Mono', monospace");
                }}
                className={`w-full text-left p-1.5 rounded hover:bg-white/10 transition-colors font-code ${settings.chatFont === 'code' ? 'text-[var(--accent-color)] font-bold' : 'text-zinc-300'}`}
              >
                Cyber Code (JetBrains)
              </button>
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
