import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { displayGameName } from '../utils/gameName';
import { playBlipSound } from '../utils/audio';

/** What the app sees on Steam: the running game (and whether its compendium is the open one), or nothing. */
export interface Detection {
  /** The running game's name ('' when nothing is detected). */
  running: string;
  /** The open compendium is the running game. */
  open: boolean;
  /** Open (or start) the running game's compendium. */
  onSwitch: () => void;
  /** Detection is possible here (the desktop app); the web app shows nothing. */
  available: boolean;
  /** The running Steam app holds several games with guides and this compendium hasn't said which: "Which game?". */
  choose?: { games: { key: string; game: string }[]; onPick: (key: string) => void };
  /**
   * Learned detection (games-not-tabs, behind its flag): a program beyond Steam that isn't known yet, asked once.
   * guess = the game read from its title or installer (null: "Which game is this?"); onAnswer(null) = not a game.
   */
  confirm?: { guess: string | null; via: string; onAnswer: (name: string | null) => void };
  /** A game started and has no compendium yet: "Open a tab for X?" (one click, Enter, or the controller's A). */
  offer?: { onOpen: () => void; onDismiss: () => void };
  /** A game started and its compendium was opened for it: "Switched to <the compendium's name>", for a few seconds. */
  switched?: string;
}

/**
 * A slim line under the header (and at the top of the compact view), said without hovering:
 *   "▶ Playing Baldur's Gate 3 · Switch" (another compendium is open; Switch opens or starts the game's),
 *   "▶ Playing Baldur's Gate 3 · this compendium", or "No game detected · start one in Steam and it shows here".
 * Switch is an ordinary button, so the controller reaches it like any other.
 */
/** "Playing X? Yes · Another game… · Not a game", or "Which game is this?" with a name to type. */
function ConfirmProgram({ c, soundEnabled }: { c: NonNullable<Detection['confirm']>; soundEnabled: boolean }) {
  const t = useT();
  const [typing, setTyping] = useState(!c.guess);
  const [name, setName] = useState('');
  const answer = (v: string | null) => {
    playBlipSound(soundEnabled);
    c.onAnswer(v);
  };
  const btn = 'h-5 px-2 rounded-md font-bold text-[11px] cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  return (
    <div role="status" title={t('detect.via', { via: c.via })} className="h-7 flex-shrink-0 flex items-center gap-1.5 px-3 border-b border-white/[0.06] text-[12px] bg-emerald-500/[0.12] text-emerald-100" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <span className="text-emerald-400 text-[10px]" aria-hidden="true">▶</span>
      {typing ? (
        <form className="flex-1 min-w-0 flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) answer(name.trim()); }}>
          <span className="flex-shrink-0">{t('detect.askUnknown')}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={c.guess || t('detect.namePlaceholder')} aria-label={t('detect.askUnknown')} className="flex-1 min-w-0 h-5 px-1.5 rounded bg-black/40 border border-emerald-500/30 text-[11.5px] text-white outline-none focus:border-emerald-300" />
          <button type="submit" disabled={!name.trim()} className={`${btn} bg-emerald-400 text-[#06140d] disabled:opacity-40`}>{t('detect.save')}</button>
        </form>
      ) : (
        <>
          <span className="truncate min-w-0">{t('detect.ask', { game: displayGameName(c.guess) })}</span>
          <span className="ml-auto flex-shrink-0 flex items-center gap-1">
            <button type="button" onClick={() => answer(c.guess)} className={`${btn} bg-emerald-400 text-[#06140d]`}>{t('detect.yes')}</button>
            <button type="button" onClick={() => setTyping(true)} className={`${btn} border border-emerald-500/40 text-emerald-100`}>{t('detect.other')}</button>
          </span>
        </>
      )}
      <button type="button" onClick={() => answer(null)} className={`${btn} flex-shrink-0 text-emerald-200/70 hover:text-white`}>{t('detect.notGame')}</button>
    </div>
  );
}

/** "Open a tab for X?  Open tab · Not now": Open is the controller's first stop, and Enter says yes (outside a typed question). */
function OfferTab({ name, o, soundEnabled }: { name: string; o: NonNullable<Detection['offer']>; soundEnabled: boolean }) {
  const t = useT();
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('qc-pad-focus', { detail: { el: openRef.current } }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !!(el as HTMLInputElement).value.trim()));
      const onButton = !!el && el.tagName === 'BUTTON' && el !== openRef.current;
      if (typing || onButton) return;
      e.preventDefault();
      e.stopPropagation();
      playBlipSound(soundEnabled);
      o.onOpen();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [o, soundEnabled]);
  const btn = 'h-5 px-2 rounded-md font-bold text-[11px] cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  return (
    <div role="status" data-qc-offer-tab className="h-7 flex-shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.06] text-[12px] bg-emerald-500/[0.12] text-emerald-100" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <span className="text-emerald-400 text-[10px]" aria-hidden="true">▶</span>
      <span className="truncate min-w-0">{t('detect.offer', { game: name })}</span>
      <span className="ml-auto flex-shrink-0 flex items-center gap-1">
        <button ref={openRef} type="button" data-qc-offer-open onClick={() => { playBlipSound(soundEnabled); o.onOpen(); }} className={`${btn} bg-emerald-400 text-[#06140d] hover:brightness-110`}>
          {t('detect.openTab')} <span className="font-normal opacity-70">↵</span>
        </button>
        <button type="button" onClick={() => { playBlipSound(soundEnabled); o.onDismiss(); }} className={`${btn} text-emerald-200/70 hover:text-white`}>{t('detect.notNow')}</button>
      </span>
    </div>
  );
}

export function DetectionLine({ d, soundEnabled = true }: { d: Detection; soundEnabled?: boolean }) {
  const t = useT();
  if (!d.available) return null;
  if (!d.running && d.confirm) return <ConfirmProgram key={d.confirm.via + (d.confirm.guess || '')} c={d.confirm} soundEnabled={soundEnabled} />;
  const name = displayGameName(d.running);
  if (d.running && d.offer && !d.open) return <OfferTab key={name} name={name} o={d.offer} soundEnabled={soundEnabled} />;
  if (d.running && d.switched && d.open && !d.choose) {
    return (
      <div role="status" data-qc-switched className="h-7 flex-shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.06] text-[12px] bg-emerald-500/[0.12] text-emerald-100 " style={{ WebkitAppRegion: 'no-drag' } as any}>
        <span className="text-emerald-400 text-[11px]" aria-hidden="true">✓</span>
        <span className="truncate min-w-0">{t('detect.switched', { game: displayGameName(d.switched) })}</span>
      </div>
    );
  }
  const tone = !d.running ? 'bg-white/[0.02] text-zinc-500' : d.open ? 'bg-emerald-500/[0.06] text-emerald-200/90' : 'bg-emerald-500/[0.12] text-emerald-100';
  return (
    <div role="status" className={`h-7 flex-shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.06] text-[12px] ${tone}`} style={{ WebkitAppRegion: 'no-drag' } as any}>
      {d.running ? (
        <>
          <span className="text-emerald-400 text-[10px]" aria-hidden="true">▶</span>
          <span className="truncate min-w-0">{d.open && !d.choose ? t('detect.playingHere', { game: name }) : t('detect.playing', { game: name })}</span>
          {d.open && d.choose && (
            // A collection (one Steam app, several games): asked once; the compendium remembers the answer, and the game
            // switcher can change it.
            <span className="ml-auto flex-shrink-0 flex items-center gap-1.5">
              <span className="text-emerald-200/90">{t('detect.whichGame')}</span>
              {d.choose.games.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    playBlipSound(soundEnabled);
                    d.choose!.onPick(g.key);
                  }}
                  className="h-5 px-2 rounded-md bg-emerald-400 text-[#06140d] font-bold text-[11px] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white cursor-pointer whitespace-nowrap"
                >
                  {g.game}
                </button>
              ))}
            </span>
          )}
          {!d.open && (
            <button
              type="button"
              onClick={() => {
                playBlipSound(soundEnabled);
                d.onSwitch();
              }}
              title={t('detect.switchTitle', { game: name })}
              className="ml-auto flex-shrink-0 h-5 px-2.5 rounded-md bg-emerald-400 text-[#06140d] font-bold text-[11.5px] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
            >
              {t('detect.switch')}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" aria-hidden="true" />
          <span className="truncate min-w-0">{t('detect.none')}</span>
        </>
      )}
    </div>
  );
}
