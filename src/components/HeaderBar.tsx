import React from 'react';
import { 
  Trophy, 
  FileText, 
  Globe, 
  Settings as SettingsIcon, 
  Type, 
  Minimize2, 
  Maximize2, 
  Gamepad2, 
  Sparkles,
  Search,
  ChevronDown,
  Activity,
  Cpu,
  LogOut
} from 'lucide-react';
import { GameTab, SteamGameData, ColorTheme } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { logOut } from '../lib/firebase';

interface HeaderBarProps {
  activeTab: GameTab | null;
  activeGame: SteamGameData | null;
  isGameRunningLocally: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isAchDrawerOpen: boolean;
  onToggleAchDrawer: () => void;
  isNotesOpen: boolean;
  onToggleNotes: () => void;
  isBrowserMode: boolean;
  onToggleBrowserMode: () => void;
  onOpenSettings: () => void;
  onOpenGameSearch: () => void;
  fontMenuOpen: boolean;
  onToggleFontMenu: () => void;
  soundEnabled: boolean;
  isDocked: boolean;
  onToggleDock: () => void;
  theme: ColorTheme;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  activeGame,
  isGameRunningLocally,
  isSidebarOpen,
  onToggleSidebar,
  isAchDrawerOpen,
  onToggleAchDrawer,
  isNotesOpen,
  onToggleNotes,
  isBrowserMode,
  onToggleBrowserMode,
  onOpenSettings,
  onOpenGameSearch,
  fontMenuOpen,
  onToggleFontMenu,
  soundEnabled,
  isDocked,
  onToggleDock,
}) => {
  const achievements = activeGame?.achievements || [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;

  return (
    <header className="h-14 bg-[#0a0b10]/95 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 sm:px-4 select-none z-30 flex-shrink-0 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
      {/* Left side: Brand Logo + Game Library Toggle */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        <button
          onClick={() => {
            playPageTurnSound(soundEnabled);
            onToggleSidebar();
          }}
          title={isSidebarOpen ? "Collapse Games Library" : "Expand Games Library"}
          className="group flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer"
        >
          {/* Ornate pixel/vector magical tome icon */}
          <div className="relative flex-shrink-0">
            <svg 
              width="28" 
              height="28" 
              viewBox="0 0 32 32" 
              fill="none" 
              className="drop-shadow-[0_0_10px_var(--accent-glow)] group-hover:scale-105 transition-transform"
            >
              <rect x="5" y="28" width="24" height="2" fill="#050508" opacity="0.7"/>
              <rect x="24" y="6" width="4" height="20" fill="#d9cdb4" />
              <rect x="25" y="6" width="1" height="20" fill="#b3a58b" />
              <rect x="27" y="6" width="1" height="20" fill="#b3a58b" />
              <rect x="28" y="5" width="1" height="22" fill="#0d0817" />
              <rect x="8" y="4" width="16" height="24" fill="#140d24" />
              <rect x="4" y="4" width="4" height="24" fill="#0d0817" />
              <rect x="6" y="4" width="1" height="24" fill="#241a38" />
              <rect x="8" y="4" width="4" height="2" fill="#e5b838" />
              <rect x="8" y="6" width="2" height="2" fill="#e5b838" />
              <rect x="20" y="4" width="4" height="2" fill="#e5b838" />
              <rect x="22" y="6" width="2" height="2" fill="#e5b838" />
              <rect x="8" y="26" width="4" height="2" fill="#e5b838" />
              <rect x="8" y="24" width="2" height="2" fill="#e5b838" />
              <rect x="20" y="26" width="4" height="2" fill="#e5b838" />
              <rect x="22" y="24" width="2" height="2" fill="#e5b838" />
              <rect x="3" y="7" width="5" height="2" fill="#a07d1c" />
              <rect x="3" y="23" width="5" height="2" fill="#a07d1c" />
              <rect x="15" y="12" width="2" height="8" fill="var(--accent-color)" />
              <rect x="13" y="14" width="6" height="4" fill="var(--accent-color)" />
              <rect x="14" y="13" width="4" height="6" fill="var(--accent-color)" />
              <rect x="14" y="14" width="4" height="4" fill="var(--accent-glow)" />
              <rect x="15" y="15" width="2" height="2" fill="#ffffff" />
            </svg>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-ping opacity-75" />
          </div>
          
          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1.5">
              <span className="font-fantasy font-bold text-sm tracking-wider text-white group-hover:text-[var(--accent-color)] transition-colors">
                QUEST COMPENDIUM
              </span>
              <span className="hidden xl:inline-block px-1.5 py-0.2 rounded text-[10px] font-pixel bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)]">
                AI HUD
              </span>
            </div>
            <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono uppercase overflow-hidden whitespace-nowrap text-ellipsis max-w-[180px]">
              <span className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${isGameRunningLocally ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="truncate">{isGameRunningLocally ? `ACTIVE: ${activeGame?.name}` : 'NO ACTIVE STEAM GAME'}</span>
            </span>
          </div>
        </button>
      </div>

      {/* Right Controls Toolbar */}
      <div className="flex items-center gap-1 sm:gap-1.5">
        {/* Achievements / Medals Drawer Toggle */}
        <button
          onClick={() => {
            playPageTurnSound(soundEnabled);
            onToggleAchDrawer();
          }}
          title="Game Achievements"
          className={`px-2.5 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium ${
            isAchDrawerOpen 
              ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)] shadow-[0_0_12px_var(--accent-glow)]' 
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] border border-transparent'
          }`}
        >
          <Trophy className="w-4 h-4 text-amber-400" />
          {totalCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-zinc-300 font-mono font-bold">
              {unlockedCount}/{totalCount}
            </span>
          )}
        </button>

        {/* Vertical Divider */}
        <div className="h-4 w-[1px] bg-white/10 mx-0.5 hidden sm:block" />

        {/* Font Quick Switcher */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onToggleFontMenu();
          }}
          title="Font & Typography Settings"
          className={`p-2 rounded-xl transition-all cursor-pointer ${
            fontMenuOpen 
              ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)]' 
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
          }`}
        >
          <Type className="w-4 h-4" />
        </button>

        {/* Dock / Free-floating Window Mode */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onToggleDock();
          }}
          title={isDocked ? "Undock / Fullscreen View" : "Dock HUD Frame"}
          className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer"
        >
          {isDocked ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Settings Dialog */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenSettings();
          }}
          title="Compendium Settings (AI Persona, Gemini Voice, Theme)"
          className="p-2 rounded-xl text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/[0.06] transition-all cursor-pointer"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
