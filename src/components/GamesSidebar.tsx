import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Gamepad2, 
  Sliders, 
  BookOpen, 
  FileText, 
  X,
  Check,
  Trophy,
  Sparkles,
  Layers
} from 'lucide-react';
import { GameTab } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';

interface GamesSidebarProps {
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
}

export const GamesSidebar: React.FC<GamesSidebarProps> = ({
  isOpen,
  tabs,
  activeTabId,
  onSelectTab,
  onStartCreateTab,
  onStartRenameTab,
  onDeleteTab,
  tabFontSize,
  onChangeTabFontSize,
  soundEnabled,
  onOpenNotes,
  onOpenGuides,
}) => {
  const [showFontControl, setShowFontControl] = useState(false);

  return (
    <aside 
      className={`h-full z-20 flex-shrink-0 relative transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${
        isOpen ? 'w-72 sm:w-80' : 'w-0 border-none'
      }`}
      style={{ perspective: '2000px' }}
    >
      <div 
        className="w-72 sm:w-80 h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col overflow-hidden"
        style={{
          transformOrigin: 'left center',
          transform: isOpen ? 'rotateY(0deg)' : 'rotateY(-90deg)',
          opacity: isOpen ? 1 : 0,
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
      {/* Sidebar Header */}
      <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between bg-black/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
            <Layers className="w-4 h-4 text-[var(--accent-color)]" />
          </div>
          <div className="flex flex-col">
            <span className="font-fantasy font-bold text-xs tracking-wider text-white">
              SAVED GAMES
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {tabs.length} Active Sessions
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              setShowFontControl(!showFontControl);
            }}
            title="Tab Scale Slider"
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
          const game = tab.activeSteamGame;
          const achievements = game?.achievements || [];
          const unlockedCount = achievements.filter(a => a.unlocked).length;
          const totalCount = achievements.length;
          const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

          return (
            <div
              key={tab.id}
              onClick={() => {
                  playBlipSound(soundEnabled);
                  onSelectTab(tab.id);
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
                        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                          <Gamepad2 className="w-4 h-4 text-zinc-400 group-hover:text-[var(--accent-color)] transition-colors" />
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

                      </div>
                    </div>

                    {/* Action buttons on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); onStartRenameTab(tab.id, tab.name); }}
                        className="p-1 rounded-md hover:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                        title="Rename Game"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {true && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete game session "${tab.name}"?`)) {
                              onDeleteTab(tab.id);
                            }
                          }}
                          className="p-1 rounded-md hover:bg-red-500/20 text-zinc-400 hover:text-red-400 cursor-pointer"
                          title="Delete Game Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Micro Progress Bar for Achievements */}
                  {totalCount > 0 && (
                    <div className="mt-1 flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
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

        {/* Add New Game Form / Button */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onStartCreateTab();
          }}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-all flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer group"
        >
          <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
          <span>+ Add New Compendium</span>
        </button>
      </div>

      {/* Quick Launch footer */}
      <div className="p-3 border-t border-white/[0.08] bg-black/40 space-y-2">
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenNotes();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/10 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-medium">Playthrough Notes</span>
          </span>
          <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">📝 ACTIVE</span>
        </button>

        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenGuides();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-xs text-blue-200 transition-all cursor-pointer shadow-sm"
        >
          <span className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-medium">GameFAQs & Steam Guides</span>
          </span>
          <span className="text-[9.5px] font-bold text-blue-300 px-1.5 py-0.5 rounded bg-blue-400/20">WEB</span>
        </button>
      </div>
      </div>
    </aside>
  );
};
