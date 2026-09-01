import React, { useState } from 'react';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Bookmark, 
  Plus, 
  X, 
  Trash2,
  ExternalLink, 
  ZoomIn, 
  ZoomOut, 
  Search, 
  Sparkles,
  BookOpen,
  Globe,
  Share2
} from 'lucide-react';
import { BrowserTab, FavoriteBookmark, SteamGameData } from '../types';
import { DEFAULT_BOOKMARKS } from '../data/mockGames';
import { playBlipSound } from '../utils/audio';

interface GameGuidesBrowserProps {
  activeGame: SteamGameData | null;
  soundEnabled: boolean;
}

export const GameGuidesBrowser: React.FC<GameGuidesBrowserProps> = ({
  activeGame,
  soundEnabled,
}) => {
  const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent.toLowerCase());
  const FrameComponent = isElectron ? 'webview' : 'iframe';

  const [tabs, setTabs] = useState<BrowserTab[]>([
    { id: 'btab-1', name: 'Web Browser', url: 'https://www.google.com' },
    { id: 'btab-2', name: 'Steam Community Guides', url: activeGame ? `https://steamcommunity.com/app/${activeGame.appId}/guides/` : 'https://steamcommunity.com' },
  ]);
  const [activeTabId, setActiveTabId] = useState<string | null>('btab-1');
  const [inputUrl, setInputUrl] = useState('https://www.google.com');
  const [bookmarks, setBookmarks] = useState<FavoriteBookmark[]>(DEFAULT_BOOKMARKS);
  const [showBookmarksMenu, setShowBookmarksMenu] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);

  const activeTab = tabs.find(t => t.id === activeTabId);

  const handleNavigate = (targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = `https://${finalUrl}`;
      } else {
        // Search query
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      }
    }

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: finalUrl, name: finalUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] } : t));
    setInputUrl(finalUrl);
    
    // Force navigation on the actual element
    setTimeout(() => {
      if (!activeTabId) return;
      const frame = document.getElementById(`browser-frame-${activeTabId}`) as any;
      if (frame) {
        if (typeof frame.loadURL === 'function') {
          frame.loadURL(finalUrl);
        } else if (frame.tagName.toLowerCase() === 'iframe') {
          frame.src = finalUrl;
        }
      }
    }, 10);
  };

  const handleAddTab = () => {
    playBlipSound(soundEnabled);
    const newId = `btab-${Date.now()}`;
    const defaultUrl = activeGame 
      ? `https://steamcommunity.com/app/${activeGame.appId}/guides/` 
      : 'https://www.google.com';

    const newTab: BrowserTab = {
      id: newId,
      name: `Guide ${tabs.length + 1}`,
      url: defaultUrl,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setInputUrl(defaultUrl);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    playBlipSound(soundEnabled);

    const tabIndex = tabs.findIndex(t => t.id === id);
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      if (remaining.length > 0) {
        const nextIndex = Math.max(0, Math.min(tabIndex, remaining.length - 1));
        setActiveTabId(remaining[nextIndex].id);
        setInputUrl(remaining[nextIndex].url);
      } else {
        setActiveTabId(null);
        setInputUrl('');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0b10] overflow-hidden">
      {/* Browser Tab Strip */}
      <div className="px-3 pt-2 bg-black/70 border-b border-white/[0.08] flex items-center gap-1.5 overflow-x-auto select-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => {
                playBlipSound(soundEnabled);
                setActiveTabId(tab.id);
                setInputUrl(tab.url);
              }}
              className={`group px-3 py-1.5 rounded-t-xl border-t border-x text-xs flex items-center gap-2 cursor-pointer max-w-[200px] transition-all ${
                isActive
                  ? 'bg-[#12131c] border-white/20 text-white font-medium shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
                  : 'bg-black/40 border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
              <span className="truncate flex-1 text-[11px] font-sans">{tab.name}</span>
              {tabs.length > 0 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/20 text-zinc-400 hover:text-white transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={handleAddTab}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer ml-1"
          title="New Browser Tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Navigation Controls & URL Bar */}
      <div className="p-2.5 bg-black/40 border-b border-white/[0.08] flex items-center gap-2 relative">
        <button
          onClick={() => {
            if (!activeTab) return;
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.canGoBack && wv.canGoBack()) wv.goBack();
          }}
          className={`p-1.5 rounded-lg transition-colors ${!activeTab ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer'}`}
          title="Back"
          disabled={!activeTab}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            if (!activeTab) return;
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.canGoForward && wv.canGoForward()) wv.goForward();
          }}
          className={`p-1.5 rounded-lg transition-colors ${!activeTab ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer'}`}
          title="Forward"
          disabled={!activeTab}
        >
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            if (!activeTab) return;
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.reload) wv.reload();
          }}
          className={`p-1.5 rounded-lg transition-colors ${!activeTab ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer'}`}
          title="Reload"
          disabled={!activeTab}
        >
          <RotateCw className="w-4 h-4" />
        </button>

        {/* URL / Search Input */}
        <div className="flex-1 relative flex items-center">
          <Globe className="w-3.5 h-3.5 text-zinc-500 absolute left-3" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNavigate(inputUrl);
            }}
            placeholder={activeTab ? "Enter URL or search game guides..." : "Open a new tab to browse..."}
            disabled={!activeTab}
            className="w-full bg-[#13141d] border border-white/15 rounded-xl pl-9 pr-8 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={() => handleNavigate(inputUrl)}
            className={`absolute right-2 p-1 ${!activeTab ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white cursor-pointer'}`}
            title="Go"
            disabled={!activeTab}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-xl p-0.5 text-xs text-zinc-400">
          <button
            onClick={() => setZoomLevel(prev => Math.max(70, prev - 10))}
            className="p-1 hover:text-white hover:bg-white/10 rounded"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="font-mono text-[10px] px-1">{zoomLevel}%</span>
          <button
            onClick={() => setZoomLevel(prev => Math.min(150, prev + 10))}
            className="p-1 hover:text-white hover:bg-white/10 rounded"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        {/* Open in New Window */}
        <a
          href={activeTab?.url || '#'}
          target={activeTab ? "_blank" : undefined}
          rel={activeTab ? "noopener noreferrer" : undefined}
          className={`p-2 rounded-xl transition-colors ${!activeTab ? 'text-zinc-600 pointer-events-none' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
          title="Open in Native Browser Tab"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>



      {/* Web Frame View */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        {!activeTab && (
          <div className="flex flex-col items-center gap-4 text-zinc-600">
            <Globe className="w-12 h-12 opacity-20" />
            <p className="text-sm">No tabs open. Click the + to open a new tab.</p>
          </div>
        )}
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          return React.createElement('webview' as any, {
            key: tab.id,
            id: `browser-frame-${tab.id}`,
            src: tab.url,
            title: tab.name,
            useragent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            partition: "persist:browser_session",
            style: {
              display: isActive ? 'flex' : 'none',
              transform: `scale(${zoomLevel / 100})`,
              transformOrigin: 'top left',
              width: `${100 / (zoomLevel / 100)}%`,
              height: `${100 / (zoomLevel / 100)}%`,
            },
            className: "border-none absolute inset-0 bg-[#111218]"
          });
        })}
      </div>
    </div>
  );
};
