import React, { useState, useEffect } from 'react';
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
  LogOut,
  ArrowRightToLine,
  Square
} from 'lucide-react';
import { GameTab, SteamGameData, ColorTheme } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { logOut } from '../lib/firebase';

interface HeaderBarProps {
  userData?: any;
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
  onOpenGameSearch: () => void;
  onOpenFeedback: () => void;
  onOpenPaywall?: () => void;
  soundEnabled: boolean;
  isDocked: boolean;
  onToggleDock: () => void;
  theme: ColorTheme;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  userData,
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
  onOpenGameSearch,
  onOpenFeedback,
  onOpenPaywall,
  soundEnabled,
  isDocked,
  onToggleDock,
}) => {
  const achievements = activeGame?.achievements || [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;

  const [timeUntilReset, setTimeUntilReset] = useState<string>('');

  useEffect(() => {
    if (!userData) return;

    const updateCountdown = () => {
      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const diff = Math.max(0, tomorrow.getTime() - now.getTime());
      
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeUntilReset(`${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [userData]);

  return (
    <header className="h-14 bg-[#0a0b10]/95 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 sm:px-4 select-none z-30 flex-shrink-0 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]" style={{ WebkitAppRegion: isDocked ? "no-drag" : "drag" } as any}>
      {/* Left side: Brand Logo + Game Library Toggle */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            playPageTurnSound(soundEnabled);
            onToggleSidebar();
          }}
          title={isSidebarOpen ? "Collapse Games Library" : "Expand Games Library"}
          className="group relative flex items-center justify-center p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer"
        >
          {/* Magical Aura */}
          <div className="absolute inset-0 rounded-xl bg-[var(--accent-glow)] blur-md opacity-40 group-hover:opacity-80 animate-pulse transition-opacity" />
          
          <div className="relative flex-shrink-0 z-10">
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
          </div>
        </button>
        
        <div className="flex flex-col text-left py-1">
          <div className="flex items-center gap-1.5">
            <span className="font-fantasy font-bold text-sm tracking-wider text-white">
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
      </div>
      {/* Right Controls Toolbar */}
      <div className="flex items-center gap-1 sm:gap-1.5">
        {/* AI Queries Badge */}
        {userData && (
          <div className="relative group" style={{ WebkitAppRegion: "no-drag" } as any}>
            {/* Desktop Badge */}
            <div 
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 mr-2 cursor-default ${userData.isPremium ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400' : 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.1)] group-hover:shadow-[0_0_15px_rgba(245,158,11,0.2)]'}`} 
            >
              <Cpu className="w-3.5 h-3.5" />
              <div className="flex items-center gap-1.5">
                <span className="font-bold">
                  {userData.proQueriesAvailable ?? Math.max(0, (userData.isPremium ? 40 : 5) - (userData.proQueriesToday || 0))} Pro
                </span>
              </div>
              {!userData.isPremium && <Sparkles className="w-3.5 h-3.5 ml-1 text-amber-400 animate-pulse" />}
            </div>

            {/* Mobile Icon */}
            <div 
              className={`flex sm:hidden items-center justify-center px-2 py-1 h-8 rounded-xl transition-all duration-300 mr-1 cursor-default text-xs font-bold gap-1 ${userData.isPremium ? 'bg-indigo-500/10 text-indigo-400' : 'bg-amber-500/10 text-amber-400'}`} 
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{userData.proQueriesAvailable ?? Math.max(0, (userData.isPremium ? 40 : 5) - (userData.proQueriesToday || 0))}</span>
            </div>
            
            {/* Elegant Hover Tooltip */}
            <div className="absolute top-full right-2 pt-2 w-64 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
              <div className="p-4 rounded-xl bg-zinc-900 border border-white/10 shadow-2xl flex flex-col gap-3">
                
                {/* Pro Queries Progress */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-300 font-medium">Gemini Pro</span>
                    <span className="text-zinc-400 font-mono text-[10px]">
                      {userData.proQueriesAvailable ?? Math.max(0, (userData.isPremium ? 40 : 5) - (userData.proQueriesToday || 0))} / {userData.isPremium ? 100 : 5}
                    </span>
                  </div>
                  <div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${userData.isPremium ? 'bg-indigo-500' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`} 
                      style={{ width: `${((userData.proQueriesAvailable ?? Math.max(0, (userData.isPremium ? 40 : 5) - (userData.proQueriesToday || 0))) / (userData.isPremium ? 100 : 5)) * 100}%` }} 
                    />
                  </div>
                </div>
                
                {/* Flash Queries Progress */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-300 font-medium">Flash Fallback</span>
                    <span className="text-zinc-400 font-mono text-[10px]">
                      {userData.isPremium ? 'Unlimited' : `${userData.flashQueriesAvailable ?? Math.max(0, 5 - (userData.flashQueriesToday || 0))} / 5`}
                    </span>
                  </div>
                  {!userData.isPremium && (
                    <div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-zinc-500 h-full rounded-full transition-all duration-500" 
                        style={{ width: `${((userData.flashQueriesAvailable ?? Math.max(0, 5 - (userData.flashQueriesToday || 0))) / 5) * 100}%` }} 
                      />
                    </div>
                  )}
                </div>
                
                {/* Reset Timer */}
                <div className="pt-2 mt-1 border-t border-white/5 flex justify-between items-center text-[11px]">
                  <span className="text-zinc-500 font-medium">Allotment Resets In:</span>
                  <span className="text-zinc-400 font-mono tracking-wider">{timeUntilReset}</span>
                </div>
                
                {!userData.isPremium && (
                  <button 
                    onClick={() => {
                      if (onOpenPaywall) onOpenPaywall();
                    }}
                    className="mt-1 pt-3 border-t border-white/5 text-xs text-amber-400 font-medium flex items-center justify-center gap-1.5 hover:text-amber-300 transition-colors w-full cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Click to upgrade to Premium
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {activeGame && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
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
        )}
        {/* Vertical Divider */}
        <div className="h-4 w-[1px] bg-white/10 mx-0.5 hidden sm:block" />

        {/* Close Button */}
        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            if ((window as any).electronAPI?.closeApp) {
              (window as any).electronAPI.closeApp();
            }
          }}
          title="Close Quest Compendium"
          className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer ml-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {/* Dock / Free-floating Window Mode */}
        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            playBlipSound(soundEnabled);
            onToggleDock();
          }}
          title={isDocked ? "Undock / Fullscreen View" : "Dock HUD Frame"}
          className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer"
        >
          {isDocked ? <Square className="w-4 h-4" /> : <ArrowRightToLine className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};
