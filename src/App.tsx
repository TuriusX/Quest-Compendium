import React, { useState, useEffect, useRef } from 'react';
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
import { PersonalQuestsModal } from './components/PersonalQuestsModal';
import { GameGuidesBrowser } from './components/GameGuidesBrowser';
import { SettingsModal } from './components/SettingsModal';
import { QuickGameSearchModal } from './components/QuickGameSearchModal';
import { GameScreenModal } from './components/GameScreenModal';
import { AuthModal } from './components/AuthModal';
import { PaywallModal } from './components/PaywallModal';
import { RenameModal } from './components/RenameModal';
import { useCloudSync } from './hooks/useCloudSync';
import { useGamepadShortcuts } from './hooks/useGamepadShortcuts';

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
  ttsVoice: 'nova',
  customApiKey: '',
  hideAppShortcut: 'CmdOrCtrl+Shift+H',
  voiceInputShortcut: 'CmdOrCtrl+Shift+V',
  controllerVoiceShortcut: '4+8', // LB + Select
  controllerHideAppShortcut: '5+9', // RB + Start
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
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || '';
  });

  // --- UI Drawer & Modal States ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAchDrawerOpen, setIsAchDrawerOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isQuestsOpen, setIsQuestsOpen] = useState(false);
  const [isBrowserMode, setIsBrowserMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGameSearchOpen, setIsGameSearchOpen] = useState(false);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameModalMode, setRenameModalMode] = useState<'create' | 'rename'>('create');
  const [renameModalTabId, setRenameModalTabId] = useState<string | null>(null);
  const [renameModalInitialValue, setRenameModalInitialValue] = useState('');
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [examinedImageUrl, setExaminedImageUrl] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [globalActiveGame, setGlobalActiveGame] = useState<{name: string, appId: number} | null>(null);

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

  const { user, subscriptionStatus, isInitializing } = useCloudSync(settings, tabs, setSettings, setTabs);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  
  let activeGame = activeTab?.activeSteamGame || null;
  if (globalActiveGame) {
    const autoHeaderImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${globalActiveGame.appId}/header.jpg`;
    if (activeGame?.appId === globalActiveGame.appId) {
      activeGame = { ...activeGame, name: globalActiveGame.name, appId: globalActiveGame.appId, isAutoDetected: true, headerImage: activeGame.headerImage || autoHeaderImage };
    } else {
      activeGame = { ...globalActiveGame, isAutoDetected: true, headerImage: autoHeaderImage } as SteamGameData;
    }
  } else if (activeGame?.isAutoDetected) {
    activeGame = null;
  }


  useGamepadShortcuts(
    settings.controllerVoiceShortcut,
    settings.controllerHideAppShortcut,
    () => {
      window.dispatchEvent(new CustomEvent('trigger-voice-start'));
    },
    () => {
      window.dispatchEvent(new CustomEvent('trigger-voice-stop'));
    },
    () => {
      if ((window as any).electronAPI?.toggleSlide) {
        (window as any).electronAPI.toggleSlide();
      }
    }
  );
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
      const baseWidth = 450;
      
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

  // Sync Shortcuts to Electron and Listen for triggers
  useEffect(() => {
    if ((window as any).electronAPI?.updateShortcuts) {
      (window as any).electronAPI.updateShortcuts({
        hideAppShortcut: settings.hideAppShortcut,
        voiceInputShortcut: settings.voiceInputShortcut,
        controllerVoiceShortcut: settings.controllerVoiceShortcut,
        controllerHideAppShortcut: settings.controllerHideAppShortcut
      });
    }
  }, [
    settings.hideAppShortcut, 
    settings.voiceInputShortcut, 
    settings.controllerVoiceShortcut, 
    settings.controllerHideAppShortcut
  ]);

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

  // Fetch Steam Profile
  useEffect(() => {
    if (!settings.steamId) {
      setSettings(prev => ({ ...prev, steamName: undefined, steamAvatar: undefined }));
      return;
    }
    
    async function fetchProfile() {
      try {
        const res = await fetch(`/api/steam/profile?steamId=${encodeURIComponent(settings.steamId)}`);
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
            if (activeGame.isAutoDetected) {
              setGlobalActiveGame(prev => prev && prev.appId === activeGame.appId ? { ...prev, achievements: data.achievements } as SteamGameData : prev);
            } else {
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
                      ...(activeGame.headerImage ? { headerImage: activeGame.headerImage } : {}),
                      achievements: data.achievements
                    }
                  };
                }
                return t;
              }));
            }
          }
        }
      } catch (err) {
        console.error('Failed to sync Steam achievements:', err);
      }
    };

    fetchAchievements();
    return () => { isMounted = false; };
  }, [activeGame?.appId, settings.steamId, activeTabId]);

  // Handle Sending Message to Server Gemini API
  const handleSendMessage = async (text: string, imageBase64?: string, audioBase64?: string) => {
    if (!activeTab) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text,
      imageUrl: imageBase64,
      audioBase64,
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
          history: activeTab.messages,
          imageBase64,
          audioBase64,
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
          text: `A new session has begun! The Compendium is ready to analyze your screen, track achievements, and guide your quest.`,
          timestamp: Date.now(),
          modelUsed: 'Gemini 3.1 Pro Preview'
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

    if (activeGame.isAutoDetected) {
      setGlobalActiveGame(prev => prev && prev.appId === activeGame.appId ? updatedGame as SteamGameData : prev);
    } else {
      setTabs(prev => prev.map(t => 
        t.id === activeTab.id ? { ...t, activeSteamGame: updatedGame } : t
      ));
    }
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

  const handleUpdateQuests = (quests: any[]) => {
    if (!activeTab) return;
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, personalQuests: quests } : t));
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
    <div className="w-screen h-screen bg-transparent flex overflow-hidden">
      {/* Background CRT scan line ambient glow */}
      <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-transparent pointer-events-none" />

            {/* Edge Slide Toggle Tab */}
      {settings.dockPosition !== 'undocked' && (
        <button
          onClick={() => {
            if ((window as any).electronAPI?.toggleSlide) {
              (window as any).electronAPI.toggleSlide();
            }
          }}
          className={`absolute top-1/2 -translate-y-1/2 w-2 h-24 bg-[var(--accent-color)]/70 hover:bg-[var(--accent-color)] cursor-pointer flex items-center justify-center z-50 backdrop-blur-md shadow-lg border border-white/20 transition-all ${
            settings.dockPosition.includes('right') 
              ? 'left-0 rounded-r-lg border-l-0' 
              : 'right-0 rounded-l-lg border-r-0'
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
          <main className="flex-1 flex flex-col overflow-hidden relative">
            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
              />
            ) : tabs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#07070b] crt-grid">
                 <div className="text-zinc-500 text-center space-y-4 p-6 bg-black/40 border border-white/5 rounded-2xl shadow-xl backdrop-blur-sm max-w-md">
                   <p className="text-2xl font-fantasy text-[var(--accent-color)]">No Compendium Active</p>
                   <p className="text-sm">Click "+ Add New Compendium" in the sidebar to start a new session.</p>
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
                onOpenScreenModal={(url) => setExaminedImageUrl(url)}
                ttsVoice={settings.ttsVoice}
                customApiKey={settings.customApiKey}
                openAiApiKey={settings.openAiApiKey}
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

      {/* Rename/Create Modal */}
      <RenameModal
        isOpen={isRenameModalOpen}
        initialValue={renameModalInitialValue}
        title={renameModalMode === 'create' ? 'Create New Compendium' : 'Rename Compendium'}
        onSave={handleRenameModalSave}
        onCancel={() => setIsRenameModalOpen(false)}
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
