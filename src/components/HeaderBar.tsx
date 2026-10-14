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
  RefreshCw,
  LogIn
} from './icons';
import { PWAInstallButton } from './PWAInstallButton';
import { GameTab, SteamGameData, ColorTheme } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { logOut } from '../lib/firebase';
import { useT } from '../i18n';
import { QuestLogo } from './QuestLogo';
import { displayGameName } from '../utils/gameName';

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
  /** Guests: a small Sign in button. */
  onSignIn?: () => void;
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
  /** Switch to the compact view (the small resting state over the game). */
  onCompact?: () => void;
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
  onSignIn,
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
  onCompact,
}) => {
  const t = useT();
  const [isClosing, setIsClosing] = useState(false);
  // The "More" menu: the header's less-used controls (achievements, settings, compact view, dock).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    // Opened: focus the first item (keyboard and controller land in the menu).
    setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }), 0);
  }, [menuOpen]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); menuBtnRef.current?.focus(); }
  };
  const pick = (fn: () => void) => () => { setMenuOpen(false); fn(); };

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
            <span className="truncate">{isGameRunningLocally ? displayGameName(activeGame?.name) : t('header.noGame')}</span>
          </span>
        </div>
      </div>
      {/* Right Controls Toolbar */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 ml-2">
        {/* Questions left: shown on the Pro / Fast switch next to the send button (ChatArea, ModelToggle). */}
        {onSignIn && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => {
              playBlipSound(soundEnabled);
              onSignIn();
            }}
            title={t('signin.headerTitle')}
            className="px-2.5 py-1.5 rounded-xl border border-[var(--accent-border)] text-[var(--accent-color)] hover:text-white hover:bg-[var(--accent-dim)] transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
          >
            <LogIn className="w-3.5 h-3.5" />
            {t('signin.header')}
          </button>
        )}

        {/* The desktop app's two most used controls: tuck the panel away, and the quest log. */}
        {typeof window !== 'undefined' && !!(window as any).electronAPI && (
          <>
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

          </>
        )}

        {/* "More": achievements, settings, compact view, dock / undock */}
        <div className="relative" style={{ WebkitAppRegion: "no-drag" } as any}>
          <button
            ref={menuBtnRef}
            type="button"
            onClick={() => {
              playBlipSound(soundEnabled);
              setMenuOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('header.menu')}
            aria-label={t('header.menu')}
            className={`p-2 rounded-xl transition-all cursor-pointer ${menuOpen ? 'text-white bg-white/[0.08]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'}`}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /><circle cx="13" cy="8" r="1.6" fill="currentColor" /></svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div ref={menuRef} role="menu" aria-label={t('header.menu')} onKeyDown={onMenuKey} className="absolute right-0 top-11 z-50 w-56 py-1.5 rounded-xl bg-[#161620] border border-white/15 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                {activeGame && (
                  <button type="button" role="menuitem" onClick={pick(() => { playPageTurnSound(soundEnabled); onToggleAchDrawer(); })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <span className="flex-1">{t('common.achievements')}</span>
                    {totalCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-zinc-300 font-mono font-bold">{unlockedCount}/{totalCount}</span>}
                  </button>
                )}
                {onCompact && (
                  <button type="button" role="menuitem" onClick={pick(onCompact)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="text-zinc-400"><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M2 10h12v4H2zM4 6h8M6 3h4" /></svg>
                    <span className="flex-1">{t('compact.collapse')}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">Ctrl+Shift+F</span>
                  </button>
                )}
                <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); window.dispatchEvent(new CustomEvent('qc-open-tour')); })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
                  <span className="w-4 h-4 flex items-center justify-center text-[13px]" aria-hidden="true">?</span>
                  <span className="flex-1">{t('tour.title')}</span>
                </button>
                {onOpenSettings && (
                  <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onOpenSettings(); })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
                    <SettingsIcon className="w-4 h-4 text-zinc-400" />
                    <span className="flex-1">{t('common.settings')}</span>
                  </button>
                )}
                {typeof window !== 'undefined' && !!(window as any).electronAPI && (
                  <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onToggleDock(); })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
                    {isDocked ? <Square className="w-4 h-4 text-zinc-400" /> : <ArrowRightToLine className="w-4 h-4 text-zinc-400" />}
                    <span className="flex-1">{isDocked ? t('header.undock') : t('header.dock')}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as any}>
          <PWAInstallButton />
        </div>

        {/* Desktop Window Controls (Close & Dock) - only rendered in Electron desktop mode */}
        {typeof window !== 'undefined' && !!(window as any).electronAPI && (
          <>
            {/* Vertical Divider */}
            <div className="h-4 w-[1px] bg-white/10 mx-0.5 hidden sm:block" />

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

          </>
        )}
      </div>
    </header>
  );
};
