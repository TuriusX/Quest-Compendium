import React, { useState, useEffect } from 'react';
import { 
  Trophy, 
  FileText, 
  Globe, 
  Settings as SettingsIcon, 
  Type, 
  ScrollText, 
  Maximize2, 
  Gamepad2, 
  Search,
  ChevronDown,
  Activity,
  Cpu,
  LogOut,
  ArrowRightToLine,
  Square,
  RefreshCw
} from './icons';
import { PWAInstallButton } from './PWAInstallButton';
import { GameTab, SteamGameData, ColorTheme } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { logOut } from '../lib/firebase';
import { useT } from '../i18n';
import { QuestLogo } from './QuestLogo';

interface HeaderBarProps {
  userData?: any;
  activeTab: GameTab | null;
  tabsCount?: number;
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
  onOpenSettings?: () => void;
  soundEnabled: boolean;
  isDocked: boolean;
  onToggleDock: () => void;
  /** Desktop: hide the panel; the objectives tracker shows the latest answer's markers over the game. */
  /** The quest log over the game (desktop): show it (if away or never shown) or send it away. */
  onToggleQuestLog?: () => void;
  /** The quest log is out (not away as the ribbon). */
  questLogVisible?: boolean;
  /** Tuck the panel away (desktop): the same as the show/hide shortcut. */
  onTuckAway?: () => void;
  /** The dock's screen edge, for the tuck chevron's direction. */
  tuckSide?: 'left' | 'right';
  /** There's something to put on the quest log (a known place, or an answer with steps). */
  questLogReady?: boolean;
  theme: ColorTheme;
  onSync?: () => Promise<boolean>;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  userData,
  activeTab,
  tabsCount = 1,
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
  onOpenSettings,
  soundEnabled,
  isDocked,
  onToggleDock,
  onToggleQuestLog,
  questLogVisible = false,
  onTuckAway,
  tuckSide = 'right',
  questLogReady = true,
  theme,
  onSync,
}) => {
  const t = useT();
  const [isClosing, setIsClosing] = useState(false);

  const handleCloseApp = async () => {
    if (isClosing) return;
    setIsClosing(true);
    try {
      if (onSync) {
        await Promise.race([
          onSync(),
          new Promise(resolve => setTimeout(resolve, 1500))
        ]);
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quest_flush_sync'));
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    } catch (err) {
      console.warn('[HeaderBar] Auto-sync on close error:', err);
    } finally {
      if ((window as any).electronAPI?.closeApp) {
        (window as any).electronAPI.closeApp();
      }
    }
  };

  const achievements = activeGame?.achievements || [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;

  return (
    <header className="qc-stars h-14 bg-[#0a0b10]/95 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 sm:px-4 select-none z-30 flex-shrink-0 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]" style={{ WebkitAppRegion: isDocked ? "no-drag" : "drag" } as any}>
      {/* Left side: Brand Logo + Game Library Toggle (shrinks, so the buttons on the right always stay visible) */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        <div className="relative flex items-center">
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => {
              playPageTurnSound(soundEnabled);
              onToggleSidebar();
            }}
            title={isSidebarOpen ? t('header.collapseLibrary') : t('header.expandLibrary')}
            className={`group relative flex items-center justify-center p-2 rounded-xl border transition-all cursor-pointer ${
              tabsCount === 0 && !isSidebarOpen
                ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] ring-2 ring-[var(--accent-color)] ring-offset-2 ring-offset-[#0a0b10] shadow-[0_0_15px_var(--accent-glow)]'
                : 'hover:bg-white/[0.06] border-transparent hover:border-white/10'
            }`}
          >
            {/* Pulsing Beacon Rings when no tabs */}
            {tabsCount === 0 && !isSidebarOpen && (
              <>
                <span className="absolute -inset-1 rounded-2xl bg-[var(--accent-color)] opacity-40 animate-ping pointer-events-none" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full border-2 border-[#0a0b10] animate-bounce z-20 shadow-md" />
              </>
            )}

            {/* Magical Aura */}
            <div className={`absolute inset-0 rounded-xl bg-[var(--accent-glow)] blur-md transition-opacity ${
              tabsCount === 0 && !isSidebarOpen ? 'opacity-80 animate-pulse' : 'opacity-40 group-hover:opacity-80'
            }`} />
            
            <div className="relative flex-shrink-0 z-10">
              <QuestLogo
                size={32}
                compact
                className="drop-shadow-[0_0_10px_var(--accent-glow)] group-hover:scale-105 transition-transform"
              />
            </div>
          </button>

          {/* Floating animated callout badge */}
          {tabsCount === 0 && !isSidebarOpen && (
            <div 
              onClick={() => {
                playPageTurnSound(soundEnabled);
                onToggleSidebar();
              }}
              className="hidden sm:flex items-center gap-1.5 ml-2.5 px-2.5 py-1 rounded-full bg-[var(--accent-color)] text-white text-[11px] font-semibold shadow-lg shadow-[var(--accent-glow)] animate-pulse cursor-pointer hover:brightness-110 whitespace-nowrap"
            >
              <span>👈 Click to Open Tabs</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-col text-left py-1 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-fantasy font-bold text-sm tracking-wider text-white truncate">
              QUEST COMPENDIUM
            </span>
            <span className="hidden xl:inline-block px-1.5 py-0.2 rounded text-[10px] font-pixel bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)]">
              AI HUD
            </span>
          </div>
          <span
            className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono uppercase min-w-0"
            title={isGameRunningLocally ? t('header.playing', { game: activeGame?.name ?? '' }) : t('header.noGame')}
          >
            <span className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${isGameRunningLocally ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
            {/* The game's name matters most, so a narrow window shows just the name. */}
            <span className="truncate">{isGameRunningLocally ? (activeGame?.name ?? '') : t('header.noGame')}</span>
          </span>
        </div>
      </div>
      {/* Right Controls Toolbar */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 ml-2">
        {/* Questions left: shown on the Pro / Fast switch next to the send button (ChatArea, ModelToggle). */}

        {activeGame && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => {
              playPageTurnSound(soundEnabled);
              onToggleAchDrawer();
            }}
            title={t('common.achievements')}
            aria-label={t('common.achievements')}
            className={`px-2 sm:px-2.5 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium ${
              isAchDrawerOpen 
                ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)] shadow-[0_0_12px_var(--accent-glow)]' 
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] border border-transparent'
            }`}
          >
            <Trophy className="w-4 h-4 text-amber-400" />
            {totalCount > 0 && (
              <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-zinc-300 font-mono font-bold">
                {unlockedCount}/{totalCount}
              </span>
            )}
          </button>
        )}
        {onOpenSettings && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => {
              playBlipSound(soundEnabled);
              onOpenSettings();
            }}
            title={t('common.settings')}
            aria-label={t('common.settings')}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as any}>
          <PWAInstallButton />
        </div>

        {/* Desktop Window Controls (Close & Dock) - only rendered in Electron desktop mode */}
        {typeof window !== 'undefined' && !!(window as any).electronAPI && (
          <>
            {/* Vertical Divider */}
            <div className="h-4 w-[1px] bg-white/10 mx-0.5 hidden sm:block" />

            {/* Tuck away: the panel slides to the screen edge (Esc does the same) */}
            {onTuckAway && (
              <button
                style={{ WebkitAppRegion: "no-drag" } as any}
                onClick={onTuckAway}
                title={t('header.tuckAway')}
                aria-label={t('header.tuckAway')}
                className="p-2 rounded-xl text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10 transition-all cursor-pointer"
              >
                <svg viewBox="0 0 12 12" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true" style={tuckSide === 'left' ? { transform: 'scaleX(-1)' } : undefined}>
                  <path fill="currentColor" d="M1 2h2v2h2v2h2v2H5v2H3v2H1v-2h2V8h2V6H3V4H1zM9 1h2v10H9z" />
                </svg>
              </button>
            )}

            {onToggleQuestLog && (
              <button
                style={{ WebkitAppRegion: "no-drag" } as any}
                onClick={onToggleQuestLog}
                disabled={!questLogReady}
                aria-pressed={questLogVisible}
                title={!questLogReady ? t('header.questLogEmpty') : questLogVisible ? t('header.questLogHide') : t('header.questLogShow')}
                aria-label={t('header.questLog')}
                className={`p-2 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default ${questLogVisible ? 'text-[var(--accent-color)] bg-[var(--accent-dim)] hover:bg-white/10' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
              >
                <ScrollText className="w-4 h-4" />
              </button>
            )}

            {/* Close Button */}
            <button
              style={{ WebkitAppRegion: "no-drag" } as any}
              onClick={handleCloseApp}
              disabled={isClosing}
              title={isClosing ? t('header.closing') : t('header.close')}
              aria-label={t('header.close')}
              className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer ml-1 disabled:opacity-50"
            >
              {isClosing ? (
                <RefreshCw className="w-4 h-4 animate-spin text-zinc-300" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              )}
            </button>

            {/* Dock / Free-floating Window Mode */}
            <button
              style={{ WebkitAppRegion: "no-drag" } as any}
              onClick={() => {
                playBlipSound(soundEnabled);
                onToggleDock();
              }}
              title={isDocked ? t('header.undock') : t('header.dock')}
              aria-label={isDocked ? t('header.undock') : t('header.dock')}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              {isDocked ? <Square className="w-4 h-4" /> : <ArrowRightToLine className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>
    </header>
  );
};
