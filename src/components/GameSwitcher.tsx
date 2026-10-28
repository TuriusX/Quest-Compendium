import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Edit3, FileText, Target, Globe, Trophy } from './icons';
import { GameTab, SteamGameData } from '../types';
import { playBlipSound } from '../utils/audio';
import { useT } from '../i18n';
import { displayGameName } from '../utils/gameName';
import { GameCover } from './GameCover';
import type { Detection } from './DetectionLine';

/** "yesterday", "3 days ago": when a compendium was last used. */
function ago(ms: number, t: (k: string, v?: Record<string, string | number>) => string, now = Date.now()): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (!ms || days < 0) return '';
  if (days === 0) return t('switch.today');
  if (days === 1) return t('switch.yesterday');
  return t('switch.daysAgo', { n: days });
}

/**
 * The game switcher in the header: "● Elden Ring ▾" (green while the game is running). It opens your games (the
 * running one first with its achievements, then the others by last played), New compendium, Browse all guides, and
 * the current game's notes and quests. Each game has rename and delete buttons (also on right-click). It replaces the
 * old games sidebar.
 */
export function GameSwitcher({
  tabs,
  activeTabId,
  activeGame,
  isGameRunningLocally,
  detection,
  chosenGame,
  soundEnabled,
  onSelectTab,
  onStartCreateTab,
  onStartRenameTab,
  onDeleteTab,
  onOpenGuides,
  onOpenNotes,
  onOpenQuests,
  gamesMode = false,
  runningTabId,
}: {
  tabs: GameTab[];
  activeTabId: string | null;
  activeGame: SteamGameData | null;
  isGameRunningLocally: boolean;
  /** Set: the dot is green only when the open compendium is the running game. */
  detection?: Detection;
  /** The game picked for a collection app ("Which game?"), and changing it (the detection line asks again). */
  chosenGame?: { game: string; onChange: () => void };
  soundEnabled: boolean;
  onSelectTab: (id: string) => void;
  onStartCreateTab: () => void;
  /** Rename a compendium (not with one space per game: a game keeps its name). */
  onStartRenameTab?: (id: string, name: string) => void;
  /**
   * One space per game (flag on): the button is the game's box art (the full name is on the line under the header),
   * the list is the player's games with their box art and full names, the running one first; "Add a game" in place
   * of "New compendium".
   */
  gamesMode?: boolean;
  /** The running game's space (games mode): first in the list, with the green dot. */
  runningTabId?: string;
  onDeleteTab: (id: string) => void;
  onOpenGuides: () => void;
  onOpenNotes: () => void;
  onOpenQuests: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = tabs.find((x) => x.id === activeTabId) || null;
  useEffect(() => {
    if (!open) return;
    setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }), 0);
  }, [open]);
  // Other parts of the app (the controller, the welcome screen) open the list.
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('qc-open-games', on);
    return () => window.removeEventListener('qc-open-games', on);
  }, []);
  const close = (focusBack = true) => {
    setOpen(false);
    if (focusBack) btnRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const pick = (fn: () => void) => () => {
    playBlipSound(soundEnabled);
    close(false);
    fn();
  };

  // The running game's compendium first, then the rest by last played.
  const runningName = isGameRunningLocally && activeGame?.isAutoDetected ? activeGame.name : '';
  const isRunning = (tab: GameTab) => (gamesMode ? !!runningTabId && tab.id === runningTabId : !!runningName && tab.id === activeTabId && (!detection || detection.open));
  const sorted = [...tabs].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || (b.lastActive || 0) - (a.lastActive || 0));
  const label = active ? active.name : t('switch.choose');
  const live = !!active && isGameRunningLocally && (!detection || detection.open);
  const coverOf = (tab: GameTab, className: string, dot?: string) => (
    <GameCover appId={Number(tab.activeSteamGame?.appId) || undefined} name={tab.name} fallback={tab.activeSteamGame?.headerImage} unknown={!!tab.unknownGame} live={isRunning(tab)} className={className} dot={dot} />
  );

  const item = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer';
  return (
    <div className="relative min-w-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
      {gamesMode ? (
        <button
          ref={btnRef}
          type="button"
          onClick={() => {
            playBlipSound(soundEnabled);
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${active ? active.name : t('switch.choose')}: ${t('spaces.openGames')}`}
          title={active ? active.name : t('switch.choose')}
          className={`h-9 pl-0.5 pr-1 flex items-center gap-1 rounded-lg border cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
            open ? 'bg-white/[0.08] border-[var(--accent-border)]' : tabs.length === 0 ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] animate-pulse' : 'bg-white/[0.03] border-white/[0.12] hover:bg-white/[0.07] hover:border-white/25'
          }`}
        >
          {active ? coverOf(active, 'w-[30px] h-[30px]', 'w-2.5 h-2.5') : <span className="w-[30px] h-[30px] rounded-md grid place-items-center"><Plus className="w-4 h-4 text-[var(--accent-color)]" /></span>}
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={`flex-shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      ) : (
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          playBlipSound(soundEnabled);
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isGameRunningLocally ? t('header.playing', { game: activeGame?.name ?? '' }) : t('header.noGame')}
        className={`max-w-full h-8 pl-2.5 pr-2 flex items-center gap-2 rounded-xl border text-[13px] font-semibold cursor-pointer transition-colors ${
          tabs.length === 0
            ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white shadow-[0_0_15px_var(--accent-glow)] animate-pulse'
            : open
              ? 'bg-white/[0.08] border-[var(--accent-border)] text-white'
              : 'bg-white/[0.03] border-white/[0.1] text-zinc-100 hover:bg-white/[0.07] hover:border-white/20'
        }`}
      >
        <span className={`w-2 h-2 flex-shrink-0 rounded-full ${live ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" className={`flex-shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => close(false)} aria-hidden="true" />
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('side.title')}
            onKeyDown={onKey}
            className={`absolute left-0 top-10 z-50 ${gamesMode ? 'w-[340px]' : 'w-[300px]'} max-w-[calc(100vw-24px)] p-1.5 rounded-xl bg-[#151622] border border-[var(--accent-border)] shadow-2xl animate-in fade-in zoom-in-95 duration-100`}
          >
            {gamesMode && (
              // The library: box art and full names (two lines rather than cut), the running game first.
              <div className="max-h-[360px] overflow-y-auto">
                {sorted.map((tab, i) => {
                  const on = tab.id === activeTabId;
                  const running = isRunning(tab);
                  const firstOther = sorted.findIndex((x) => !isRunning(x));
                  const section = running && i === 0 ? t('spaces.playingNow') : i === firstOther ? (firstOther > 0 ? t('spaces.recent') : t('side.title')) : '';
                  const pts = tab.playthrough && tab.playthrough.count > 1 ? t('spaces.playthroughCount', { n: tab.playthrough.count }) : '';
                  return (
                    <React.Fragment key={tab.id}>
                      {section && <div className="px-2.5 pt-2 pb-1 text-[10.5px] tracking-[0.1em] font-bold text-zinc-500 uppercase">{section}</div>}
                      <div className={`group flex items-center rounded-lg ${on ? 'bg-[var(--accent-dim)]' : ''}`}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={pick(() => onSelectTab(tab.id))}
                          className={`${item} min-w-0 flex-1 py-1.5 hover:bg-transparent focus:bg-transparent focus-visible:ring-2 focus-visible:ring-sky-400`}
                        >
                          {coverOf(tab, 'w-[34px] h-[46px]', 'w-2.5 h-2.5')}
                          <span className="min-w-0 flex-1 flex flex-col">
                            <span className={`leading-tight line-clamp-2 break-words ${tab.unknownGame ? 'text-zinc-300 italic' : on ? 'font-bold text-white' : 'font-semibold text-zinc-100'}`}>
                              {tab.name}
                              {running && <span className="ml-1.5 align-middle text-[9.5px] font-bold text-[#06140d] bg-emerald-400 rounded px-1 py-px not-italic">{t('spaces.running')}</span>}
                            </span>
                            <span className="text-[11.5px] text-zinc-500">{[ago(tab.lastActive, t), pts].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                        <span className="hidden group-hover:flex group-focus-within:flex items-center pr-1 flex-shrink-0">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              close(false);
                              setToDelete({ id: tab.id, name: tab.name });
                            }}
                            title={t('side.menuDelete')}
                            aria-label={`${t('side.menuDelete')}: ${tab.name}`}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-300 hover:bg-red-500/15 focus:bg-red-500/15 outline-none cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {!gamesMode && tabs.length > 0 && (
              <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] tracking-[0.1em] font-bold text-zinc-500 uppercase">{t('side.title')}</div>
            )}
            {!gamesMode && <div className="max-h-[280px] overflow-y-auto">
              {sorted.map((tab) => {
                const on = tab.id === activeTabId;
                const game = on && activeGame ? activeGame : tab.activeSteamGame?.isAutoDetected ? null : tab.activeSteamGame;
                const ach = game?.achievements || [];
                const got = ach.filter((a) => a.unlocked).length;
                const running = isRunning(tab);
                const sub = running ? t('side.playingNow') : ago(tab.lastActive, t);
                return (
                  <div key={tab.id} className={`group flex items-center rounded-lg ${on ? 'bg-[var(--accent-dim)]' : ''}`}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={pick(() => onSelectTab(tab.id))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        (e.currentTarget.parentElement?.querySelector('[data-rename]') as HTMLElement | null)?.focus();
                      }}
                      className={`${item} min-w-0 flex-1 hover:bg-transparent focus:bg-transparent`}
                    >
                      <span className={`w-2 h-2 flex-shrink-0 rounded-full ${running ? 'bg-emerald-400' : 'bg-zinc-600'}`} aria-hidden="true" />
                      <span className={`truncate ${on ? 'font-bold text-white' : ''}`}>{tab.name}</span>
                      <span className="ml-auto flex-shrink-0 text-[11.5px] text-zinc-500 flex items-center gap-1 group-hover:hidden group-focus-within:hidden">
                        {sub}
                        {running && ach.length > 0 && (
                          <>
                            <span>·</span>
                            {got}/{ach.length}
                            <Trophy className="w-3 h-3 text-amber-400" />
                          </>
                        )}
                      </span>
                    </button>
                    {/* Rename and delete: on hover or focus (and right-click focuses rename) */}
                    <span className="hidden group-hover:flex group-focus-within:flex items-center pr-1 flex-shrink-0">
                      {onStartRenameTab && <button
                        type="button"
                        role="menuitem"
                        data-rename
                        onClick={pick(() => onStartRenameTab(tab.id, tab.name))}
                        title={t('side.menuRename')}
                        aria-label={`${t('side.menuRename')}: ${tab.name}`}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 focus:bg-white/10 outline-none cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close(false);
                          setToDelete({ id: tab.id, name: tab.name });
                        }}
                        title={t('side.menuDelete')}
                        aria-label={`${t('side.menuDelete')}: ${tab.name}`}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-300 hover:bg-red-500/15 focus:bg-red-500/15 outline-none cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>}
            {tabs.length === 0 && (
              <div className="px-2.5 py-2 text-[12px] text-zinc-400">
                <div className="font-semibold text-zinc-300">{t('side.emptyTitle')}</div>
                <div className="text-zinc-500">{t('side.emptySub')}</div>
              </div>
            )}
            <div className="h-px bg-white/[0.08] my-1.5 mx-1" />
            <button type="button" role="menuitem" onClick={pick(onStartCreateTab)} className={item}>
              <Plus className="w-4 h-4 text-[var(--accent-color)]" />
              <span>{gamesMode ? t('spaces.addGame') : t('side.new')}</span>
            </button>
            <button type="button" role="menuitem" onClick={pick(onOpenGuides)} className={item}>
              <Globe className="w-4 h-4 text-sky-400" />
              <span>{t('switch.guides')}</span>
            </button>
            {active && (
              <>
                <button type="button" role="menuitem" onClick={pick(onOpenNotes)} className={item}>
                  <FileText className="w-4 h-4 text-[var(--accent-color)]" />
                  <span className="truncate">{t('switch.notes', { game: displayGameName(active.name) })}</span>
                </button>
                <button type="button" role="menuitem" onClick={pick(onOpenQuests)} className={item}>
                  <Target className="w-4 h-4 text-amber-400" />
                  <span className="truncate">{t('side.menuQuests')}</span>
                </button>
                {chosenGame && (
                  <button type="button" role="menuitem" onClick={pick(chosenGame.onChange)} className={item}>
                    <Edit3 className="w-4 h-4 text-emerald-400" />
                    <span className="truncate">{t('switch.chosenGame', { game: chosenGame.game })}</span>
                    <span className="ml-auto flex-shrink-0 text-[11.5px] text-zinc-500">{t('switch.changeGame')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Delete confirmation, styled like the app's other dialogs. */}
      {toDelete && createPortal(
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          onClick={() => setToDelete(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setToDelete(null); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="qc-delete-title"
            className="w-full max-w-sm bg-[#0c0d14] border border-white/10 rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 shrink-0 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <h2 id="qc-delete-title" className="font-fantasy font-bold text-white text-base">{t('side.deleteTitle')}</h2>
                <p className="text-zinc-400 text-sm mt-1 break-words">
                  {t('side.deleteBody', { name: toDelete.name })} {t('side.deleteWarn')}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setToDelete(null)}
                className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-zinc-200 text-sm font-semibold transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  onDeleteTab(toDelete.id);
                  setToDelete(null);
                }}
                className="h-9 px-4 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 hover:border-red-500/60 text-red-300 hover:text-red-200 text-sm font-semibold transition-colors cursor-pointer"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
