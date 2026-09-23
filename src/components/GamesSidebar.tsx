import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Gamepad2, 
  Settings, 
  BookOpen, 
  FileText, 
  Target,
  X,
  Check,
  Trophy,
  Sparkles,
  Save,
  Globe,
  RefreshCw
} from './icons';
import { GameTab, SteamGameData } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';

/** Short initials for a game tile, e.g. "Baldur's Gate 3" -> "BG3". */
function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => (/^\d+$/.test(w) ? w : w[0])).join('').toUpperCase().slice(0, 3);
}

/** A stable, muted tile color per game name. */
function tileColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 38%)`;
}

interface GamesSidebarProps {
  width: number;
  isDragging: boolean;
  isOpen: boolean;
  onClose: () => void;
  tabs: GameTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onStartCreateTab: () => void;
  onStartRenameTab: (tabId: string, currentName: string) => void;
  onDeleteTab: (tabId: string) => void;
  tabFontSize: number;
  onChangeTabFontSize: (size: number) => void;
  soundEnabled: boolean;
  onOpenNotes: () => void;
  onOpenGuides: () => void;
  onOpenQuests: () => void;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  globalActiveGame?: SteamGameData | null;
  onSync?: () => Promise<boolean>;
}

export const GamesSidebar: React.FC<GamesSidebarProps> = ({
  width,
  isDragging,
  isOpen,
  tabs,
  activeTabId,
  globalActiveGame,
  onSelectTab,
  onStartCreateTab,
  onStartRenameTab,
  onDeleteTab,
  tabFontSize,
  onChangeTabFontSize,
  soundEnabled,
  onOpenNotes,
  onOpenGuides,
  onOpenQuests,
  onOpenSettings,
  onOpenFeedback,
  onSync,
}) => {
  const [showFontControl, setShowFontControl] = useState(false);
  const [tabToDelete, setTabToDelete] = useState<{id: string, name: string} | null>(null);
  const [contextMenu, setContextMenu] = useState<{tabId: string, x: number, y: number} | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const handleSyncClick = async () => {
    if (isSyncing) return;
    playBlipSound(soundEnabled);
    setIsSyncing(true);
    try {
      if (onSync) {
        const ok = await onSync();
        if (ok) {
          setSyncSuccess(true);
          setTimeout(() => setSyncSuccess(false), 2000);
        }
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quest_flush_sync'));
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 2000);
      }
    } catch (e) {
      console.warn('[GamesSidebar] Sync error:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <aside 
      className={`h-full z-20 flex-shrink-0 relative ${!isDragging ? 'transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]' : ''} ${
        !isOpen ? 'border-none' : ''
      }`}
      style={{ perspective: '2000px', width: isOpen ? `${width}px` : '0px' }}
    >
      <div 
        className="h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col overflow-hidden"
        style={{
          width: `${width}px`,
          transformOrigin: 'left center',
          transform: isOpen ? 'rotateY(0deg)' : 'rotateY(-90deg)',
          opacity: isOpen ? 1 : 0,
          transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
      {/* Sidebar Header */}
      <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between bg-black/30">
        <div className="flex flex-col min-w-0">
          <span className="font-fantasy font-bold text-sm text-white leading-tight">Your games</span>
          <span className="text-[10px] text-zinc-400 font-mono uppercase">
            {tabs.length === 0 ? 'None yet' : `${tabs.length} ${tabs.length === 1 ? 'compendium' : 'compendiums'}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* New compendium */}
          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              onStartCreateTab();
            }}
            title="New compendium"
            aria-label="New compendium"
            className="qc-px-bevel w-7 h-7 mr-1 rounded-lg bg-[var(--accent-color)] text-[#16101f] flex items-center justify-center hover:brightness-110 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {/* Cloud Sync Button */}
          <button
            onClick={handleSyncClick}
            disabled={isSyncing}
            title={isSyncing ? "Syncing tabs with cloud..." : syncSuccess ? "Synced with Cloud!" : "Sync with Cloud"}
            aria-label="Sync with cloud"
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              syncSuccess 
                ? 'text-emerald-400 bg-emerald-500/20' 
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            } disabled:opacity-50`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[var(--accent-color)]' : ''}`} />
          </button>

          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              setShowFontControl(!showFontControl);
            }}
            title="Tab Scale Slider"
            aria-label="Text size"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span className="font-bold font-serif text-[15px] leading-none px-0.5">Aa</span>
          </button>
        </div>
      </div>

      {/* Font Size Slider Popout */}
      {showFontControl && (
        <div className="px-3.5 py-2 bg-black/60 border-b border-white/[0.08] flex items-center gap-2 text-xs text-zinc-400 animate-in fade-in duration-150">
          <span className="text-[11px] font-medium">Text Scale:</span>
          <input
            type="range"
            min="13"
            max="22"
            value={tabFontSize}
            onChange={(e) => onChangeTabFontSize(Number(e.target.value))}
            className="flex-1 accent-[var(--accent-color)] cursor-pointer h-1.5 bg-white/20 rounded"
          />
          <span className="font-mono text-zinc-300 w-6 text-right font-bold">{tabFontSize}px</span>
        </div>
      )}

      {/* Games Tab List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const savedGame = tab.activeSteamGame?.isAutoDetected ? null : tab.activeSteamGame;
          const game = (isActive && globalActiveGame) ? globalActiveGame : savedGame;
          const achievements = game?.achievements || [];
          const unlockedCount = achievements.filter(a => a.unlocked).length;
          const totalCount = achievements.length;
          const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
          const isLive = !!(isActive && globalActiveGame && globalActiveGame.isAutoDetected);

          return (
            <div
              key={tab.id}
              onClick={() => {
                  playBlipSound(soundEnabled);
                  onSelectTab(tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              className={`group relative rounded-xl border transition-all p-2.5 flex flex-col gap-2 cursor-pointer select-none ${
                isActive
                  ? 'bg-gradient-to-r from-[var(--accent-dim)] to-transparent border-[var(--accent-border)] shadow-[0_4px_20px_rgba(0,0,0,0.6),0_0_15px_var(--accent-glow)]'
                  : 'bg-black/40 border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              {/* Active Glowing Left Pill */}
              {isActive && (
                <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-glow)]" />
              )}

              <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Game Banner Thumbnail */}
                      {game?.headerImage ? (
                        <img 
                          src={game.headerImage} 
                          alt={tab.name} 
                          className="w-8 h-8 rounded-lg object-cover border border-white/15 flex-shrink-0" 
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold uppercase text-white shadow-[inset_-2px_-2px_0_rgba(0,0,0,0.3),inset_2px_2px_0_rgba(255,255,255,0.18)]"
                          style={{ backgroundColor: tileColor(game?.name || tab.name) }}
                          aria-hidden="true"
                        >
                          {initials(game?.name || tab.name)}
                        </div>
                      )}

                      <div className="flex flex-col min-w-0">
                        <span 
                          style={{ fontSize: `${tabFontSize}px` }}
                          className={`font-semibold truncate leading-tight transition-colors ${
                            isActive ? 'text-white font-bold' : 'text-zinc-300 group-hover:text-white'
                          }`}
                        >
                          {tab.name}
                        </span>
                        {(isLive || game?.name) && (
                          <span className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5 leading-tight mt-0.5">
                            {isLive && <span className="w-1.5 h-1.5 flex-shrink-0 bg-emerald-400 rounded-full animate-pulse" />}
                            {isLive ? 'Playing now on Steam' : game?.name}
                          </span>
                        )}

                      </div>
                    </div>
                  </div>

                  {/* Micro Progress Bar for Achievements */}
                  {totalCount > 0 && (
                    <div className="mt-1 flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden qc-seg qc-seg-gold">
                        <div 
                          className="h-full bg-gradient-to-r from-[var(--accent-color)] to-amber-400 rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                        <Trophy className="w-2.5 h-2.5 text-amber-400" />
                        {unlockedCount}/{totalCount}
                      </span>
                    </div>
                  )}
                </>
            </div>
          );
        })}

        {tabs.length === 0 && (
          <div className="py-6 px-2 text-center text-zinc-500 text-xs flex flex-col items-center gap-1">
            <span className="font-medium text-zinc-400">No Compendiums Active</span>
            <span className="text-[11px] text-zinc-500">Create a tab below to start your journey</span>
          </div>
        )}

        {/* Add New Game button (the header's + does the same once games exist) */}
        {tabs.length === 0 && (
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onStartCreateTab();
          }}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-all flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer group"
        >
          <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
          <span>Add New Compendium</span>
        </button>
        )}
      </div>

      {/* Global Tools footer */}
      <div className="p-3 border-t border-white/[0.08] bg-black/40 flex items-center justify-start gap-2">
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenGuides();
          }}
          className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-[var(--accent-border)] text-zinc-200 transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold"
          title="Guides & web browser"
        >
          <Globe className="w-4 h-4 text-sky-400" />
          Guides
        </button>
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenNotes();
          }}
          disabled={!activeTabId}
          className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-[var(--accent-border)] text-zinc-200 transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          title={activeTabId ? 'Playthrough notes' : 'Open a compendium to use notes'}
        >
          <FileText className="w-4 h-4 text-[var(--accent-color)]" />
          Notes
        </button>
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenSettings();
          }}
          className="p-2 rounded-xl bg-zinc-500/10 hover:bg-white/[0.06] border border-white/5 hover:border-white/10 text-zinc-400 hover:text-[var(--accent-color)] transition-all cursor-pointer shadow-sm"
          title="Compendium Settings"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenFeedback();
          }}
          className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 text-amber-400 transition-all cursor-pointer shadow-sm"
          title="Submit Beta Feedback"
          aria-label="Send beta feedback"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      </div>

      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (() => {
        const targetTab = tabs.find(t => t.id === contextMenu.tabId);
        if (!targetTab) return null;
        
        return (
          <div 
            className="fixed inset-0 z-50" 
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          >
            <div 
              className="absolute bg-[#1a1b26] border border-white/10 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden py-1.5 min-w-[200px] flex flex-col z-[51]"
              style={{ top: Math.min(contextMenu.y, window.innerHeight - 200), left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 border-b border-white/[0.04] mb-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider truncate block">
                  {targetTab.name}
                </span>
              </div>
              
              <button 
                className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                onClick={() => {
                  if (activeTabId !== targetTab.id) onSelectTab(targetTab.id);
                  onOpenNotes();
                  setContextMenu(null);
                  playBlipSound(soundEnabled);
                }}
              >
                <FileText className="w-4 h-4 text-purple-400" />
                Playthrough Notes
              </button>

              <button 
                className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                onClick={() => {
                  if (activeTabId !== targetTab.id) onSelectTab(targetTab.id);
                  onOpenQuests();
                  setContextMenu(null);
                  playBlipSound(soundEnabled);
                }}
              >
                <Target className="w-4 h-4 text-amber-400" />
                Personal Quests
              </button>

              <button 
                className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                onClick={() => {
                  onStartRenameTab(targetTab.id, targetTab.name);
                  setContextMenu(null);
                }}
              >
                <Edit3 className="w-4 h-4 text-zinc-400" />
                Rename Tab
              </button>
              
              <button 
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2 transition-colors cursor-pointer"
                onClick={() => {
                  setTabToDelete({ id: targetTab.id, name: targetTab.name });
                  setContextMenu(null);
                }}
              >
                <Trash2 className="w-4 h-4" />
                Delete Tab
              </button>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {tabToDelete && (
        <div 
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[9999] flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          onClick={(e) => {
             e.stopPropagation();
             setTabToDelete(null);
          }}
        >
          <div 
            className="bg-[#1a1a1a] border-2 border-red-500 p-5 rounded-lg flex flex-col gap-4 shadow-[4px_4px_0px_rgba(239,68,68,0.4)] min-w-[300px]"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="font-fantasy text-red-500 text-xl tracking-wide">Delete Compendium?</label>
            <p className="text-zinc-300 text-sm">
              Are you sure you want to delete <strong className="text-white">"{tabToDelete.name}"</strong>?<br/>
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2.5 mt-2">
              <button 
                onClick={() => setTabToDelete(null)}
                className="bg-transparent border border-red-500 text-red-500 px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer hover:bg-red-500/10"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  onDeleteTab(tabToDelete.id);
                  setTabToDelete(null);
                }}
                className="bg-red-500 text-white border-none px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
