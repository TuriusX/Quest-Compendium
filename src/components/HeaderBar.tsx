import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Settings as SettingsIcon,
  ScrollText,
  ArrowRightToLine,
  Square,
  RefreshCw,
  LogIn,
  MessageSquareText
} from './icons';
import { PWAInstallButton } from './PWAInstallButton';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { closeAppAfterSync } from '../utils/closeApp';
import { GameTab, SteamGameData, ColorTheme } from '../types';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { useT } from '../i18n';
import { GameSwitcher } from './GameSwitcher';
import { GlainIcon } from './GlainIcon';
import { QuestLogo, QuestLogoOpen } from './QuestLogo';
import type { Detection } from './DetectionLine';

interface HeaderBarProps {
  userData?: any;
  tabs: GameTab[];
  activeTabId: string | null;
  activeGame: SteamGameData | null;
  isGameRunningLocally: boolean;
  /** The running game: the switcher's dot is green only when the open compendium is it. */
  detection?: Detection;
  /** Where the player is, under the game's name. */
  placeName?: string;
  /** The game picked for a collection app, with a way to change it (GameSwitcher). */
  chosenGame?: { game: string; onChange: () => void };
  onSelectTab: (tabId: string) => void;
  onStartCreateTab: () => void;
  onStartRenameTab?: (tabId: string, currentName: string) => void;
  onDeleteTab: (tabId: string) => void;
  onOpenGuides: () => void;
  onOpenNotes: () => void;
  onOpenQuests: () => void;
  onToggleAchDrawer: () => void;
  onOpenFeedback: () => void;
  onOpenPaywall?: () => void;
  onOpenSettings?: () => void;
  /** Guests: a small Sign in button. */
  onSignIn?: () => void;
  soundEnabled: boolean;
  isDocked: boolean;
  onToggleDock: () => void;
  /** The quest log over the game (desktop): show it (if away or never shown) or send it away. */
  onToggleQuestLog?: () => void;
  /** The quest log's show / put away shortcut as shown ("Ctrl+Shift+L"). */
  questLogKeys?: string;
  /** The quest log is out (not away as the ribbon). */
  questLogVisible?: boolean;
  /** Tuck the panel away (desktop): the same as the show/hide shortcut. */
  onTuckAway?: () => void;
  /** The dock's screen edge, for the tuck chevron's direction. */
  tuckSide?: 'left' | 'right';
  /** There's something to put on the quest log (a known place, or an answer with steps). */
  questLogReady?: boolean;
  /** The closed book: how many Now and Next steps are open (its badge), and the hover card's Now step and watch-out. */
  questLogPeek?: { now?: string; steps?: number; watch?: string };
  theme: ColorTheme;
  onSync?: () => Promise<boolean>;
  /**
   * Games-not-tabs (flag on): the game's playthroughs. "New playthrough" is in the ⋯ menu; switching too, when there
   * are several (the current one's name then shows by the game's).
   */
  /** The running game's space (games mode): first in the game list. */
  runningTabId?: string;
  playthroughs?: { current: string; list: { id: string; name: string }[]; onNew: () => void; onSwitch: (id: string) => void; onRename: (id: string, name: string) => void };
}

/**
 * The header (owner, Nov 5 2026): the game switcher as the title (box art, the game's full name, where the player is under
 * it), then Sign in (guests), tuck away (desktop), the ⋯ menu with the questions left, and close (desktop).
 */
export const HeaderBar: React.FC<HeaderBarProps> = ({
  userData,
  tabs,
  activeTabId,
  activeGame,
  isGameRunningLocally,
  detection,
  placeName,
  chosenGame,
  onSelectTab,
  onStartCreateTab,
  onStartRenameTab,
  onDeleteTab,
  onOpenGuides,
  onOpenNotes,
  onOpenQuests,
  onToggleAchDrawer,
  onOpenFeedback,
  onOpenPaywall,
  onOpenSettings,
  onSignIn,
  soundEnabled,
  isDocked,
  onToggleDock,
  onToggleQuestLog,
  questLogKeys,
  questLogVisible = false,
  onTuckAway,
  tuckSide = 'right',
  questLogReady = true,
  questLogPeek,
  onSync,
  playthroughs,
  runningTabId,
}) => {
  const t = useT();
  const pwa = usePWAInstall();
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const [isClosing, setIsClosing] = useState(false);
  // The "More" menu: the header's less-used controls.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    // Opened: focus the first item (keyboard and controller land in the menu).
    setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }), 0);
  }, [menuOpen]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); menuBtnRef.current?.focus(); }
  };
  const pick = (fn: () => void) => () => { setMenuOpen(false); fn(); };

  const handleCloseApp = async () => {
    if (isClosing) return;
    setIsClosing(true);
    await closeAppAfterSync(onSync);
  };

  const achievements = activeGame?.achievements || [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;
  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer';

  return (
    <header className="qc-stars min-h-[60px] py-1 bg-[#0a0b10]/95 backdrop-blur-xl border-b border-white/[0.08] flex items-center gap-2 px-2.5 sm:px-3 select-none z-30 flex-shrink-0 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]" style={{ WebkitAppRegion: isDocked ? "no-drag" : "drag" } as any}>
      {/* The logo is the quest log's switch (desktop): a closed book while the log is away, open while it's out. */}
      {onToggleQuestLog && (
        <LogBook
          open={questLogVisible}
          ready={questLogReady}
          peek={questLogPeek}
          keys={questLogKeys}
          soundEnabled={soundEnabled}
          onToggle={onToggleQuestLog}
        />
      )}
      {/* Left: the game switcher (it shrinks, so the controls on the right always stay visible) */}
      <div className="min-w-0 flex-1 flex">
        <GameSwitcher
          tabs={tabs}
          activeTabId={activeTabId}
          activeGame={activeGame}
          isGameRunningLocally={isGameRunningLocally}
          detection={detection}
          placeName={placeName}
          chosenGame={chosenGame}
          soundEnabled={soundEnabled}
          onSelectTab={onSelectTab}
          onStartCreateTab={onStartCreateTab}
          onStartRenameTab={onStartRenameTab}
          gamesMode={!!playthroughs}
          runningTabId={runningTabId}
          onDeleteTab={onDeleteTab}
          onOpenGuides={onOpenGuides}
          onOpenNotes={onOpenNotes}
          onOpenQuests={onOpenQuests}
        />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Pro / Fast (ModelToggle, drawn here by the chat area, which keeps the choice) */}
        <div id="qc-model-slot" className="flex items-center empty:hidden mr-0.5" />
        {onSignIn && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => {
              playBlipSound(soundEnabled);
              onSignIn();
            }}
            title={t('signin.headerTitle')}
            className="ml-0.5 h-7 px-2 rounded-lg border border-[var(--accent-border)] text-[var(--accent-color)] hover:text-white hover:bg-[var(--accent-dim)] transition-all cursor-pointer flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            {t('signin.header')}
          </button>
        )}

        {/* Tuck the panel away (the quest log has its own bookmark on the panel's edge, and is in the ⋯ menu). */}
        {isDesktop && (
          <>
            {/* Tuck away: the panel slides to the screen edge (Esc does the same) */}
            {onTuckAway && (
              <button
                style={{ WebkitAppRegion: "no-drag" } as any}
                onClick={onTuckAway}
                title={t('header.tuckAway')}
                aria-label={t('header.tuckAway')}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10 transition-all cursor-pointer"
              >
                <svg viewBox="0 0 12 12" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true" style={tuckSide === 'left' ? { transform: 'scaleX(-1)' } : undefined}>
                  <path fill="currentColor" d="M1 2h2v2h2v2h2v2H5v2H3v2H1v-2h2V8h2V6H3V4H1zM9 1h2v10H9z" />
                </svg>
              </button>
            )}

          </>
        )}

        {/* "More": your playthrough, achievements, settings, quick tour, dock / undock, beta feedback */}
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
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${menuOpen ? 'text-white bg-white/[0.08]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'}`}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /><circle cx="13" cy="8" r="1.6" fill="currentColor" /></svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div ref={menuRef} role="menu" aria-label={t('header.menu')} onKeyDown={onMenuKey} className="absolute right-0 top-10 z-50 w-64 max-w-[calc(100vw-24px)] py-1.5 rounded-xl bg-[#161620] border border-white/15 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); window.dispatchEvent(new CustomEvent('qc-open-playthrough')); })} className={menuItem}>
                  <span className="w-4 h-4 flex items-center justify-center text-[13px]" aria-hidden="true">✦</span>
                  <span className="flex-1">{t('play.title')}</span>
                </button>
                {/* The quest log: shown or put away (tucked in as a bookmark when attached, the ribbon when popped out). */}
                {onToggleQuestLog && (
                  <button type="button" role="menuitem" disabled={!questLogReady} onClick={pick(() => { playBlipSound(soundEnabled); onToggleQuestLog(); })} title={!questLogReady ? t('header.questLogEmpty') : undefined} className={`${menuItem} disabled:opacity-40 disabled:cursor-default`}>
                    <ScrollText className="w-4 h-4 text-[var(--accent-color)]" />
                    <span className="flex-1">{questLogVisible ? t('menu.questLogHide') : t('menu.questLogShow')}</span>
                    {questLogKeys && <span className="text-[10px] text-zinc-500 font-mono">{questLogKeys}</span>}
                  </button>
                )}
                {activeGame && (
                  <button type="button" role="menuitem" onClick={pick(() => { playPageTurnSound(soundEnabled); onToggleAchDrawer(); })} className={menuItem}>
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <span className="flex-1">{t('common.achievements')}</span>
                    {totalCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-zinc-300 font-mono font-bold">{unlockedCount}/{totalCount}</span>}
                  </button>
                )}
                {playthroughs && (
                  <>
                    {playthroughs.list.length > 1 && playthroughs.list.map((p) => (
                      <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === playthroughs.current} onClick={pick(() => { playBlipSound(soundEnabled); playthroughs.onSwitch(p.id); })} className={menuItem}>
                        <span className="w-4 h-4 flex items-center justify-center text-[12px] text-[var(--accent-color)]" aria-hidden="true">{p.id === playthroughs.current ? '●' : '○'}</span>
                        <span className="flex-1 truncate">{p.name}</span>
                      </button>
                    ))}
                    <button type="button" role="menuitem" title={t('spaces.newPlaythroughHint')} onClick={pick(() => { playBlipSound(soundEnabled); playthroughs.onNew(); })} className={menuItem}>
                      <span className="w-4 h-4 flex items-center justify-center text-[14px] text-[var(--accent-color)]" aria-hidden="true">＋</span>
                      <span className="flex-1">{t('spaces.newPlaythrough')}</span>
                    </button>
                  </>
                )}
                {/* Premium (free players and guests) or Your plan (Premium players): the same screen */}
                {onOpenPaywall && (
                  <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onOpenPaywall(); })} className={menuItem}>
                    <span className="w-4 h-4 flex items-center justify-center"><GlainIcon size={14} /></span>
                    <span className="flex-1">{userData?.isPremium ? t('prem.yourPlan') : t('prem.title')}</span>
                  </button>
                )}
                {onOpenSettings && (
                  <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onOpenSettings(); })} className={menuItem}>
                    <SettingsIcon className="w-4 h-4 text-zinc-400" />
                    <span className="flex-1">{t('common.settings')}</span>
                  </button>
                )}
                <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); window.dispatchEvent(new CustomEvent('qc-open-tour')); })} className={menuItem}>
                  <span className="w-4 h-4 flex items-center justify-center text-[13px]" aria-hidden="true">?</span>
                  <span className="flex-1">{t('tour.title')}</span>
                </button>
                {isDesktop && (
                  <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onToggleDock(); })} className={menuItem}>
                    {isDocked ? <Square className="w-4 h-4 text-zinc-400" /> : <ArrowRightToLine className="w-4 h-4 text-zinc-400" />}
                    <span className="flex-1">{isDocked ? t('header.undock') : t('header.dock')}</span>
                  </button>
                )}
                <PWAInstallButton className={menuItem} state={pwa} onDone={() => setMenuOpen(false)} />
                <div className="h-px bg-white/[0.08] my-1 mx-2" />
                <button type="button" role="menuitem" onClick={pick(() => { playBlipSound(soundEnabled); onOpenFeedback(); })} className={menuItem}>
                  <MessageSquareText className="w-4 h-4 text-amber-400" />
                  <span className="flex-1">{t('side.feedback')}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Close (desktop) */}
        {isDesktop && (
          <button
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={handleCloseApp}
            disabled={isClosing}
            title={isClosing ? t('header.closing') : t('header.close')}
            aria-label={t('header.close')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer disabled:opacity-50"
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
        )}
      </div>
    </header>
  );
};

/**
 * The quest log's switch (owner, Nov 6 2026): the app's spellbook logo. Closed while the log is away, with the number of
 * open Now and Next steps; hovering it shows the Now step (and a watch-out from an answer). A click flips the cover and
 * opens the log; the open book (glowing in the theme's colour) closes it. Ctrl+Shift+L, the controller and the ⋯ menu
 * still work.
 */
const LogBook: React.FC<{ open: boolean; ready: boolean; peek?: { now?: string; steps?: number; watch?: string }; keys?: string; soundEnabled: boolean; onToggle: () => void }> = ({ open, ready, peek, keys, soundEnabled, onToggle }) => {
  const t = useT();
  const [flip, setFlip] = useState(0);
  const [hover, setHover] = useState(false);
  const busy = React.useRef(false);
  const label = open ? t('menu.questLogHide') : t('menu.questLogShow');
  const click = () => {
    if (!ready || busy.current) return;
    busy.current = true;
    playPageTurnSound(soundEnabled);
    setFlip((n) => n + 1);
    setHover(false);
    // The cover turns, then the log comes out (or goes away) under it.
    setTimeout(() => { busy.current = false; onToggle(); }, 130);
  };
  const showPeek = hover && !open && ready && !!(peek?.now || peek?.watch);
  return (
    <div className="relative flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={click}
        aria-pressed={open}
        aria-label={label}
        title={ready ? `${label}${keys ? ` (${keys})` : ''}` : t('header.questLogEmpty')}
        className={`relative w-11 h-11 rounded-lg flex items-center justify-center border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white ${open ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] shadow-[0_0_14px_var(--accent-glow)]' : 'border-transparent hover:bg-white/[0.06] hover:border-[var(--accent-border)]'} ${ready ? 'cursor-pointer' : 'opacity-50 cursor-default'}`}
      >
        <span key={flip} className={flip ? 'qc-book-flip' : undefined}>
          {open ? <QuestLogoOpen size={32} /> : <QuestLogo size={32} compact />}
        </span>
        {!open && ready && !!peek?.steps && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[var(--accent-color)] text-black text-[10px] font-black tabular-nums flex items-center justify-center shadow-[0_0_0_2px_#0a0b10]" aria-hidden="true">{peek.steps > 9 ? '9+' : peek.steps}</span>
        )}
      </button>
      {showPeek && (
        <div role="tooltip" className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 w-64 rounded-lg border border-[var(--accent-border)] bg-[#151522]/95 px-3 py-2.5 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
          {peek?.now && (
            <>
              <div className="text-[9.5px] font-extrabold tracking-[0.14em] uppercase text-zinc-400">{t('tracker.logNow')}</div>
              <div className="text-[13.5px] font-bold text-white leading-snug mb-1">{peek.now}</div>
            </>
          )}
          {peek?.watch && (
            <div className="text-[12px] text-amber-200 leading-snug"><span className="text-amber-400 font-bold">{t('tracker.logWatch')}:</span> {peek.watch}</div>
          )}
          <div className="text-[11px] text-zinc-500 mt-1.5">{label}{keys ? ` · ${keys}` : ''}</div>
        </div>
      )}
    </div>
  );
};
