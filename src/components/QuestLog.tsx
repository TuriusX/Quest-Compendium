import React, { useEffect, useRef, useState } from 'react';
import { X, Bookmark, Check, AlertTriangle, ChevronRight, ChevronDown, ChevronLeft, ExternalLink, PanelRightClose, Crosshair, MapPin } from './icons';
import { useT, useLocale } from '../i18n';
import { sessionDay, noteStale, type EarlierSession } from '../utils/earlierSessions';
import { isCompanion } from '../utils/companion';
import type { LogStep, LogView } from '../utils/questLogView';
import { VisualCard, type VisualData, type VisualEvent } from './VisualCard';

/**
 * The docked quest log (owner, Oct 30 2026): a column folded out of the panel's inner side, inside the overlay window.
 * Now (one objective), Next (2-3 steps) and Watch out (one, only what's missable here), nothing else by default; the
 * pinned answers on one folded line and the guide's lists behind "Show more from the guide". The data is
 * utils/questLogView.ts's, the same view the popped-out window (electron/tracker.html) and the compact card draw.
 *
 * Keyboard (focus in the log): ↑ ↓ move between steps, Space ticks the focused step, Enter opens its details, Esc
 * closes the log; Ctrl+Z anywhere in the panel (outside the question box) undoes the last tick while Undo shows (App). The controller moves with the d-pad (A ticks, B back to Ask).
 */
export type QuestLogProps = {
  view: LogView;
  /** The step the tick key acts on (the tracker's next / prev keys move it): highlighted. */
  sel: string | null;
  /** The last tick, shown for a few seconds with Undo (from 'now': a question set its answer as Now by itself). */
  cleared: { id?: string; text: string; from?: 'question' | 'now' | 'moved' | 'removed'; msgId?: string } | null;
  keysLabel: string;
  /**
   * Remove (owner, Nov 20 2026, idea #6: no tick boxes): a step of the objective moves on (to Earlier, like the Now box's
   * X); a guide item is taken off the log for this playthrough. Undo for a few seconds either way.
   */
  onRemove: (s: { id: string; text: string; msgId?: string }) => void;
  onUndo: () => void;
  onSelect: (id: string) => void;
  onHideWatch: (id: string) => void;
  onClose: () => void;
  onPopOut: () => void;
  /** Drawn in its own window over the game (popped out): the header drags it, and its button puts it back. */
  popped?: boolean;
  /** The log pops out to the left (the panel is docked right): the pop-out arrow points that way. */
  popLeft?: boolean;
  onPutBack?: () => void;
  onAsk: (text?: string) => void;
  onOpenPin: (msgId: string) => void;
  onUnpin: (msgId: string) => void;
  onClearNow: () => void;
  /** The Now box's X (idea #3): move on to the next step; the step goes to "Earlier", not done and not gone. */
  onMoveOn?: (step: { id: string; text: string; msgId?: string }) => void;
  /** A step from "Earlier" made Now again (or the Undo of moving on). */
  onBringBack?: (id: string) => void;
  onLoadSteps?: () => void;
  onDismissOffer?: () => void;
  onGotoArea?: (name: string) => void;
  onLocate?: () => void;
  /** A Help me here note that has a visual for this step (Now set from the screen, not from a question). */
  helpMsgFor?: (stepId: string) => string | undefined;
  /** The database sections (LogFacts: Worth getting here, Achievements here), under Now, Next and the warning. */
  facts?: React.ReactNode;
  /** The area has Worth getting here: its missables are badged there, so the separate missables box doesn't show (owner, Nov 15 2026). */
  foldMissables?: boolean;
  onConfirmPlace?: () => void;
  /** The player says where they are (the guide's areas, "Yes" to a suggestion, "Still here"). */
  onPickPlace?: (name: string) => void;
  /** Locate me's shortcut, shown on its button. */
  locateKeys?: string;
  /** Open an entry's guide page ("Open in guide"). */
  onOpenEntry?: (id: string) => void;
  /**
   * Visual answers (Nov 14 2026): the video or picture its answer already found, shown when one of that answer's steps is
   * opened (no new question, nothing looked up again).
   */
  visualFor?: (msgId: string) => VisualData | undefined;
  onVisualEvent?: (msgId: string, type: VisualEvent) => void;
  /**
   * "Looks done" (owner, Nov 20 2026): the Now step the last screenshot showed finished (its id), offered with Move on /
   * Not yet; never ticked by itself.
   */
  looksDone?: string | null;
  onLooksDone?: (moveOn: boolean) => void;
  /** Earlier opened: a session without a note (or one that grew) asks for its one-sentence note (App, /api/session-note). */
  onNeedNote?: (s: EarlierSession) => void;
};

const stepIds = (v: LogView) => [v.now, ...v.next].filter((s): s is LogStep => !!s && s.tick).map((s) => s.id);

export function QuestLog(p: QuestLogProps) {
  const t = useT();
  const v = p.view;
  const [showPins, setShowPins] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  // Earlier's sessions: the newest open, older ones folded until tapped (by key).
  const [openSession, setOpenSession] = useState<string | null>(null);
  const locale = useLocale();
  const [showMore, setShowMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [noSuggestion, setNoSuggestion] = useState('');
  const [pickFilter, setPickFilter] = useState('');
  // Right-click on an item: its small menu (Remove).
  const [menu, setMenu] = useState<{ x: number; y: number; s: { id: string; text: string; msgId?: string } } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // A new place: the guide's lists and details fold again.
  useEffect(() => { setShowMore(false); setOpenId(null); setPicking(false); }, [v.place?.name]);
  // The last step ticked from the keyboard or controller: its box is gone, so the focus goes to "What's next?".
  useEffect(() => {
    if (!v.done || (document.activeElement && document.activeElement !== document.body)) return;
    root.current?.querySelector<HTMLElement>('[data-qc-log-next-q]')?.focus({ preventScroll: true });
  }, [v.done?.goal]);

  const focusStep = (id: string) => {
    const el = root.current?.querySelector<HTMLElement>(`[data-qc-log-step="${CSS.escape(id)}"]`);
    if (el) { el.focus(); p.onSelect(id); }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = (e.target as HTMLElement).closest<HTMLElement>('[data-qc-log-step]')?.dataset.qcLogStep;
    if (e.key === 'Escape') { e.preventDefault(); p.onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const ids = stepIds(v);
      if (!ids.length) return;
      e.preventDefault();
      const i = step ? ids.indexOf(step) : -1;
      focusStep(ids[e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1)]);
      return;
    }
    if (e.key === 'Enter' && step) { e.preventDefault(); setOpenId((o) => (o === step ? null : step)); }
    // Delete removes the focused item (Undo for a few seconds).
    if ((e.key === 'Delete' || e.key === 'Backspace') && step) {
      const s = [v.now, ...v.next, ...(v.here?.items || [])].find((x) => x?.id === step);
      if (s) { e.preventDefault(); remove(s); }
    }
  };
  const remove = (s: { id: string; text: string; msgId?: string }) => { setMenu(null); p.onRemove({ id: s.id, text: s.text, ...(s.msgId ? { msgId: s.msgId } : {}) }); };
  const onMenu = (s: { id: string; text: string; msgId?: string }) => (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, s }); };

  // An item's ✕ (shown on hover or focus): Remove.
  const removeBtn = (s: LogStep) => s.tick ? (
    <button type="button" data-qc-log-remove={s.id} onClick={() => remove(s)} title={t('tracker.logRemove')} aria-label={`${t('tracker.logRemove')}: ${s.text}`}
      className="ml-auto flex-shrink-0 self-start w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-white/[0.08] opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-white">
      <X className="w-3 h-3" />
    </button>
  ) : null;
  // An item's words: open its details; focus picks it (the keys act on it).
  const stepAttrs = (s: LogStep) => (s.tick ? { 'data-qc-log-step': s.id, onFocus: () => p.onSelect(s.id) } : {});
  const details = (s: LogStep) =>
    openId === s.id && (s.detail || s.sub) ? <div className="mt-1 text-[12px] leading-snug text-zinc-400">{s.detail || s.sub}</div> : null;
  // The Now answer's video or picture, under whichever of its steps is open (they share one answer).
  const answerMsg = v.now?.source === 'question' ? v.now.msgId : v.now ? p.helpMsgFor?.(v.now.id) : undefined;
  const answerVisual = answerMsg ? p.visualFor?.(answerMsg) : undefined;
  const visualOf = (s: LogStep) =>
    openId === s.id && answerVisual && answerMsg ? (
      <div data-qc-log-visual="" className="mt-1">
        <VisualCard visual={answerVisual} compact onEvent={(type) => p.onVisualEvent?.(answerMsg, type)} />
      </div>
    ) : null;
  const label = (text: string, src?: React.ReactNode, amber = false) => (
    <div className={`flex items-baseline gap-2 mb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] font-mono ${amber ? 'text-amber-300/90' : 'text-zinc-500'}`}>
      {text}
      {src}
    </div>
  );

  const n = v.now;
  const mine = n?.source === 'question';
  const pinsN = v.pins.length;
  const place = v.where ? undefined : v.place;
  const ar = v.areas && v.areas.names.length ? v.areas : null;
  const w = v.where;
  const suggestion = w?.suggestion && w.suggestion !== noSuggestion ? w.suggestion : '';
  const pickNames = w ? w.areas : ar ? ar.names : [];
  const pick = (name: string) => { setPicking(false); p.onPickPlace?.(name); };
  // Locate me (owner, Oct 31 2026): big and obvious, on its shortcut and the controller too. It looks at the screen.
  const locateBtn = (big: boolean) => p.onLocate ? (
    <button type="button" data-qc-locate="" onClick={p.onLocate} disabled={!!(w?.locating || v.locating)}
      title={`${t('tracker.locate')}${p.locateKeys ? ` (${p.locateKeys})` : ''}${w ? `: ${t('tracker.whereSub')}` : ''}`}
      className={`flex items-center justify-center gap-2 rounded-md font-bold outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70 ${
        big ? 'w-full h-11 text-[15px] bg-[var(--accent-color)] text-black hover:brightness-110' : 'flex-shrink-0 h-7 px-2.5 text-[12px] border border-[var(--accent-border)] text-[var(--accent-color)] hover:bg-[var(--accent-color)] hover:text-black'
      }`}>
      <Crosshair className={`${big ? 'w-5 h-5' : 'w-3.5 h-3.5'} ${w?.locating || v.locating ? 'animate-spin' : ''}`} />
      {w?.locating || v.locating ? t('tracker.locatingBig') : t('tracker.locate')}
      {big && p.locateKeys && !w?.locating && <kbd className="qc-log-kbd !text-black/70 !border-black/30 !bg-black/10">{p.locateKeys}</kbd>}
    </button>
  ) : null;
  const shown = pickFilter.trim() ? pickNames.filter((n) => n.toLowerCase().includes(pickFilter.trim().toLowerCase())) : pickNames;
  const picker = picking && pickNames.length > 0 && p.onPickPlace ? (
    <div className="mt-1.5 rounded border border-white/10 bg-black/30">
    {pickNames.length > 8 && (
      <input autoFocus value={pickFilter} onChange={(e) => setPickFilter(e.target.value)} placeholder={t('tracker.wherePick')} aria-label={t('tracker.wherePick')}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); pick(shown[0]); } if (e.key === 'Escape') setPicking(false); }}
        className="w-full h-7 px-2.5 bg-transparent border-b border-white/10 text-[12.5px] text-white placeholder:text-zinc-500 outline-none focus:border-[var(--accent-border)]" />
    )}
    <ul className="max-h-[180px] overflow-y-auto py-1" style={{ scrollbarWidth: 'thin' }}>
      {shown.map((name) => (
        <li key={name} ref={name === place?.name ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
          <button type="button" onClick={() => pick(name)}
            className={`w-full text-left px-2.5 py-1 text-[12.5px] hover:bg-white/[0.06] hover:text-white outline-none focus-visible:bg-white/[0.08] ${name === place?.name ? 'text-[var(--accent-color)] font-semibold' : 'text-zinc-300'}`}>{name}</button>
        </li>
      ))}
    </ul>
    </div>
  ) : null;

  return (
    <div
      ref={root}
      data-qc-log=""
      role="complementary"
      aria-label={t('tracker.title')}
      onKeyDown={onKeyDown}
      className="h-full flex flex-col min-h-0 bg-gradient-to-b from-[#121119] to-[#0f0f15] text-zinc-100"
    >
      {/* Header: the log's name, then pop out. Closing is the logo in the panel's header (owner, Nov 6 2026), Ctrl+Shift+L or the menu. */}
      <div className="flex items-center gap-1.5 pl-3.5 pr-2 py-2.5 border-b border-white/[0.07]" style={p.popped ? ({ WebkitAppRegion: 'drag' } as any) : undefined}>
        <span className="font-mono font-extrabold text-[12px] tracking-[0.14em] uppercase">{t('tracker.logTitle')}</span>
        <span className="flex-1" />
        {/* Detach / Attach, in words (owner, Nov 15 2026: the bare icon wasn't clear). */}
        {/* (Not in the companion app: the log is always beside the conversation there.) */}
        {!isCompanion() && <button type="button" data-qc-log-popout={p.popped ? 'back' : 'out'} onClick={p.popped ? p.onPutBack : p.onPopOut}
          title={t(p.popped ? 'tracker.attach' : 'tracker.popOut')}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="h-6 pl-1.5 pr-2 rounded border border-white/10 text-[11.5px] font-semibold text-zinc-300 hover:text-white hover:border-[var(--accent-border)] hover:bg-white/[0.05] flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-white">
          {p.popped ? <PanelRightClose className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" style={p.popLeft ? { transform: 'scaleX(-1)' } : undefined} />}
          {t(p.popped ? 'tracker.putBackShort' : 'tracker.popOutShort')}
        </button>}
      </div>

      {/* Where the player is, at the top: "You're in Rivington · Change" and Locate me (owner, Oct 31 2026). */}
      {place?.name && (
        <div className="px-3.5 pt-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-4 h-4 flex-shrink-0 text-[var(--accent-color)]" />
            <div className="flex-1 min-w-0 text-[13px] leading-tight">
              <span className="text-zinc-400">{t('tracker.youreIn')} </span>
              <span className={`font-bold ${place.sure ? 'text-white' : 'text-zinc-300'}`}>{v.locating ? t('tracker.locating') : place.name}</span>
              {p.onPickPlace && pickNames.length > 0 && (
                <> <span className="text-zinc-600">·</span> <button type="button" onClick={() => setPicking((x) => !x)} aria-expanded={picking}
                  className="text-[12px] font-semibold text-[var(--accent-color)] hover:underline outline-none focus-visible:underline">{t('tracker.change')}</button></>
              )}
            </div>
            {locateBtn(false)}
          </div>
          {picker}
        </div>
      )}
      {/* The place isn't known (owner, Nov 19 2026, idea #2: the box was too big): one slim line. The guess or the last
          place with its answer buttons right there; the chip itself opens the guide's areas to pick from. Nothing from
          the guide shows below until the place is known (never the start of the guide). */}
      {w && (
        <div className="px-3.5 pt-2.5">
          <div data-qc-log-where="" className="flex items-center gap-2 min-w-0 rounded-md border border-[var(--accent-border)] bg-[var(--accent-dim)]/40 pl-2.5 pr-1 py-1">
            <MapPin className="w-4 h-4 flex-shrink-0 text-[var(--accent-color)]" />
            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap text-[13px] leading-tight">
              {w.locating ? (
                <span className="text-zinc-300">{t('tracker.locatingBig')}</span>
              ) : suggestion && p.onPickPlace ? (
                <>
                  <span className="text-zinc-200 truncate">{t('tracker.whereLooksLike', { place: suggestion })}</span>
                  <button type="button" onClick={() => pick(suggestion)} className="px-1.5 py-px rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[12px] font-bold hover:bg-emerald-500/30 outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereYes')}</button>
                  <button type="button" onClick={() => { setNoSuggestion(suggestion); setPicking(true); }} className="px-1.5 py-px rounded border border-white/15 text-zinc-300 text-[12px] font-bold hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereNo')}</button>
                </>
              ) : w.last && p.onPickPlace ? (
                <>
                  <span className="text-zinc-400 truncate">{t('tracker.whereLast', { place: w.last })}</span>
                  <button type="button" onClick={() => pick(w.last!)} className="px-1.5 py-px rounded border border-white/15 text-zinc-200 text-[12px] font-semibold hover:text-white hover:border-[var(--accent-border)] outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereStill')}</button>
                  {pickNames.length > 0 && <button type="button" onClick={() => setPicking((x) => !x)} aria-expanded={picking} className="text-[12px] font-semibold text-[var(--accent-color)] hover:underline outline-none focus-visible:underline">{t('tracker.whereOther')}</button>}
                </>
              ) : p.onPickPlace && pickNames.length > 0 ? (
                <button type="button" onClick={() => setPicking((x) => !x)} aria-expanded={picking} title={t('tracker.wherePick')}
                  className="font-bold text-white hover:text-[var(--accent-color)] outline-none focus-visible:underline">{t('tracker.whereTitle')}</button>
              ) : (
                <span className="font-bold text-white">{t('tracker.whereTitle')}</span>
              )}
            </div>
            {locateBtn(false)}
          </div>
          {picker}
        </div>
      )}
      {v.notice && <div className="px-3.5 pt-1 text-[11.5px] text-amber-300">{v.notice}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pt-3 pb-2 flex flex-col gap-4" style={{ scrollbarWidth: 'thin' }}>

        {/* Nothing asked yet and nothing else to show: an invitation (the area's steps carry the same quick questions). */}
        {v.invite && !v.done && !w && !v.here && !p.facts && (
          <div className="rounded-md border border-dashed border-[var(--accent-border)] bg-[var(--accent-dim)]/40 p-3">
            <div className="font-bold text-[14px]">{t('tracker.logInvite')}</div>
            <p className="mt-0.5 mb-2 text-[12.5px] text-zinc-400 leading-snug">{t('tracker.logInviteSub')}</p>
            <div className="flex flex-wrap gap-1.5">
              {[t('tracker.logQuick1'), t('tracker.logQuick2')].map((q) => (
                <button key={q} type="button" onClick={() => p.onAsk(q)}
                  className="px-2 py-1 rounded border border-white/15 bg-[#121119] text-[12px] font-mono text-zinc-300 hover:border-[var(--accent-border)] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{q}</button>
              ))}
            </div>
          </div>
        )}

        {/* Every step done: the goal, and what's next. */}
        {v.done && (
          <div className="rounded-md border border-emerald-400/40 bg-emerald-500/[0.07] p-3">
            <div className="font-bold text-[15px] flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-400" />{t('tracker.logDone', { goal: v.done.goal })}</div>
            <button type="button" data-qc-log-now="" data-qc-log-next-q="" onClick={() => p.onAsk(t('tracker.logWhatsNext'))}
              className="mt-2 px-2.5 py-1 rounded bg-[var(--accent-color)] text-black text-[12px] font-mono font-bold outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.logWhatsNext')}</button>
          </div>
        )}

        {/* "Load the guide's steps" for the current quest. */}
        {v.offer && p.onLoadSteps && !v.done && n?.source !== 'question' && (
          <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
            <button type="button" onClick={p.onLoadSteps} title={t('tracker.loadStepsHint')}
              className="px-2 py-0.5 rounded border border-[var(--accent-border)] text-[var(--accent-color)] font-semibold hover:bg-[var(--accent-color)] hover:text-black outline-none focus-visible:ring-2 focus-visible:ring-white">＋ {t('tracker.loadSteps')}</button>
            <span className="truncate text-zinc-300">{v.offer.name}</span>
            {p.onDismissOffer && <button type="button" onClick={p.onDismissOffer} aria-label={t('tracker.dismissOffer')} className="ml-auto text-zinc-500 hover:text-white"><X className="w-3 h-3" /></button>}
          </div>
        )}

        {n && (
          <div>
            {label(t('tracker.logNow'), (
              <span className={`ml-auto normal-case tracking-normal font-sans font-semibold text-[11px] ${mine ? 'text-[var(--accent-color)]' : 'text-zinc-400'}`}>
                {/* Only a question's Now says where it came from; the guide's blends in (owner, Nov 15 2026). A click opens that
                    answer (Nov 20 2026: no extra line for it). */}
                {mine && n.msgId ? (
                  <button type="button" data-qc-log-source="" onClick={() => p.onOpenPin(n.msgId!)} title={t('tracker.logOpenSource')}
                    className="hover:underline outline-none focus-visible:underline">{t('tracker.logFromQuestion')}</button>
                ) : mine ? t('tracker.logFromQuestion') : null}
              </span>
            ))}
            <div
              className={`relative rounded-md p-3 ${p.onMoveOn ? 'pr-8' : ''} border ${
                mine || n.source === 'loaded'
                  ? 'bg-gradient-to-b from-[rgba(168,127,251,.15)] to-[rgba(168,127,251,.07)] border-[var(--accent-border)] shadow-[inset_3px_0_0_var(--accent-color)]'
                  : 'bg-white/[0.03] border-white/[0.14] shadow-[inset_3px_0_0_#6d6880]'
              } ${p.sel === n.id ? 'ring-1 ring-white/30' : ''}`}
            >
              {p.onMoveOn && (
                <button type="button" data-qc-log-moveon="" onClick={() => remove(n)}
                  title={t('tracker.logMoveOn')} aria-label={t('tracker.logMoveOn')}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="flex gap-2.5 items-start" onContextMenu={n.tick ? onMenu(n) : undefined}>
                <button type="button" data-qc-log-now="" {...stepAttrs(n)} onClick={() => setOpenId((o) => (o === n.id ? null : n.id))} className="text-left min-w-0 outline-none focus-visible:underline">
                  <div className="font-bold text-[16.5px] leading-tight tracking-[-0.005em] text-white">{n.text}</div>
                  {n.sub && <div className="mt-1 text-[12.5px] leading-snug text-zinc-400">{n.sub}</div>}
                  {details(n)}
                </button>
              </div>
              {visualOf(n)}
              {/* Looks done: the screenshot showed this step finished. Offered, never done by itself. */}
              {p.looksDone === n.id && p.onLooksDone && (
                <div data-qc-log-looksdone="" role="status" className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="text-zinc-300">{t('tracker.logLooksDone')}</span>
                  <span className="flex items-center gap-1.5 ml-auto">
                    <button type="button" onClick={() => p.onLooksDone!(true)}
                      className="px-2 py-0.5 rounded bg-[var(--accent-color)] text-black font-bold hover:brightness-110 outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.logLooksDoneYes')}</button>
                    <button type="button" onClick={() => p.onLooksDone!(false)}
                      className="px-2 py-0.5 rounded border border-white/15 text-zinc-300 font-semibold hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.logLooksDoneNo')}</button>
                  </span>
                </div>
              )}
              {n.seen && (
                <div data-qc-log-seen="" className="mt-2 flex items-center gap-1.5 text-[11.5px] text-zinc-500 min-w-0">
                  <Crosshair className="w-3 h-3 flex-shrink-0 text-[var(--accent-color)]" />
                  <span className="truncate">{t('tracker.seenOnScreen', { what: n.seen })}</span>
                </div>
              )}
              {n.guide && (
                <details data-qc-log-guide={n.guide.id} className="mt-2 text-[11.5px] text-zinc-500 min-w-0">
                  <summary className="cursor-pointer truncate outline-none focus-visible:ring-2 focus-visible:ring-white rounded">{t('tracker.fromGuideStep', { step: n.guide.title })}</summary>
                  {n.guide.detail && <p className="mt-1 text-zinc-400 leading-snug">{n.guide.detail}</p>}
                </details>
              )}
              {/* The goal these steps are for (no "n of total": nothing is ticked any more, owner Nov 20 2026). */}
              {n.total > 0 && n.goal && n.goal !== n.text && (
                <div className="mt-2 text-[11.5px] font-semibold text-zinc-500 truncate">{n.goal}</div>
              )}
            </div>
          </div>
        )}

        {/* The last tick, for a few seconds: Undo. */}
        {p.cleared && (
          <div className="-mt-2 flex items-center gap-1.5 text-[12px] text-zinc-500" role="status">
            {p.cleared.from === 'moved' || p.cleared.from === 'removed' ? <ChevronRight className="w-3 h-3 text-[var(--accent-color)]" /> : <Check className="w-3 h-3 text-emerald-400" />}
            <span className="truncate" data-qc-log-undo={p.cleared.from || 'removed'}>{p.cleared.from === 'moved' ? t('tracker.logMovedOn', { step: p.cleared.text }) : p.cleared.from === 'now' ? t('tracker.logNowFromQuestion', { goal: p.cleared.text }) : p.cleared.from === 'question' ? t('tracker.logTickedFromQuestion', { step: p.cleared.text }) : t('tracker.logRemoved', { step: p.cleared.text })}</span>
            <button type="button" onClick={p.onUndo} className="ml-1 font-bold text-[var(--accent-color)] hover:underline outline-none focus-visible:ring-2 focus-visible:ring-white rounded">{t('tracker.logUndo')}</button>
            {p.cleared.from === 'moved' && p.cleared.msgId && n?.msgId === p.cleared.msgId && (
              <><span className="text-zinc-600">·</span><button type="button" onClick={p.onClearNow} className="flex-shrink-0 font-semibold text-zinc-400 hover:text-white hover:underline outline-none focus-visible:ring-2 focus-visible:ring-white rounded">{t('tracker.logStopFollowing')}</button></>
            )}
          </div>
        )}

        {v.next.length > 0 && (
          <div>
            {label(t('tracker.logNext'))}
            <div className="flex flex-col gap-0.5">
              {v.next.map((s) => (
                <React.Fragment key={s.id}>
                  <div onContextMenu={s.tick ? onMenu(s) : undefined} className={`group/row flex gap-2 items-start px-2 py-1.5 rounded ${p.sel === s.id ? 'bg-white/[0.04] outline outline-1 outline-white/[0.14]' : ''}`}>
                    <span className="flex-shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-zinc-500" aria-hidden="true" />
                    <button type="button" {...stepAttrs(s)} onClick={() => setOpenId((o) => (o === s.id ? null : s.id))} aria-expanded={openId === s.id} className="text-left min-w-0 outline-none focus-visible:underline">
                      <div className="text-[13.5px] leading-snug text-zinc-200">{s.text}</div>
                      {s.sub && <div className="text-[12px] text-zinc-500 mt-px">{s.sub}</div>}
                      {details(s)}
                    </button>
                    {removeBtn(s)}
                  </div>
                  {visualOf(s) && <div className="px-2 pb-1">{visualOf(s)}</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* The place is known but not what the player is doing: what's here, from the guide, and no Now. */}
        {v.here && !n && (
          <div data-qc-log-here="">
            {label(t('tracker.inPlace', { place: v.here.place }))}
            <p className="-mt-0.5 mb-2 text-[12px] text-zinc-500 leading-snug">{t('tracker.hereSub')}</p>
            {v.here.items.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {v.here.items.map((s) => (
                  <div key={s.id} onContextMenu={s.tick ? onMenu(s) : undefined} className={`group/row flex gap-2 items-start px-2 py-1 rounded ${p.sel === s.id ? 'bg-white/[0.04] outline outline-1 outline-white/[0.14]' : ''}`}>
                    <span className="flex-shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-zinc-500" aria-hidden="true" />
                    <button type="button" {...stepAttrs(s)} onClick={() => setOpenId((o) => (o === s.id ? null : s.id))} className="text-left min-w-0 outline-none focus-visible:underline">
                      <div className="text-[13.5px] leading-snug text-zinc-200">{s.text}</div>
                      {s.sub && <div className="text-[12px] text-zinc-500 mt-px">{s.sub}</div>}
                      {details(s)}
                    </button>
                    {removeBtn(s)}
                  </div>
                ))}
              </div>
            )}
            {v.here.missables.length > 0 && !p.foldMissables && (
              <div className="mt-2 rounded-md border border-amber-300/35 bg-amber-300/[0.07] px-3 py-2">
                <div className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] font-mono text-amber-300/90">{t('tracker.secMissable')}</div>
                <ul className="flex flex-col gap-1">
                  {v.here.missables.map((m) => (
                    <li key={m.id} className="flex gap-2 items-start text-[12.5px] leading-snug text-[#f3e6c8] min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-300" />
                      <span className="min-w-0"><b className="text-amber-300 font-semibold">{m.text}</b>{m.why && m.why !== m.text ? <> · {m.why}</> : null}</span>
                      <button type="button" onClick={() => p.onHideWatch(m.id)} title={t('tracker.logHideWatch')} aria-label={t('tracker.logHideWatch')}
                        className="ml-auto self-start text-amber-300/70 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white rounded"><X className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {[t('tracker.logQuick1'), t('tracker.logQuick2')].map((q) => (
                <button key={q} type="button" onClick={() => p.onAsk(q)}
                  className="px-2 py-1 rounded border border-white/15 bg-[#121119] text-[12px] font-mono text-zinc-300 hover:border-[var(--accent-border)] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{q}</button>
              ))}
            </div>
          </div>
        )}

        {v.watch && (
          <div>
            {/* Watch out: what's about to be lost, without a "(from the guide)" label (owner, Nov 15 2026). */}
            {label(t('tracker.logWatch'), undefined, true)}
            <div className="flex gap-2.5 rounded-md border border-amber-300/35 bg-amber-300/[0.09] px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" />
              <div className="text-[13px] leading-snug text-[#f3e6c8] min-w-0">
                <b className="text-amber-300 font-bold">{v.watch.text}</b>
                {v.watch.why && v.watch.why !== v.watch.text ? <> · {v.watch.why}</> : null}
              </div>
              <button type="button" onClick={() => p.onHideWatch(v.watch!.id)} title={t('tracker.logHideWatch')} aria-label={t('tracker.logHideWatch')}
                className="ml-auto self-start text-amber-300/70 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white rounded"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}

        {!w && p.facts}

        {!n && !v.done && !v.invite && !w && !v.here && !v.next.length && !v.watch && !p.facts && <div className="text-[12.5px] text-zinc-500">{t('tracker.logEmpty')}</div>}

        {/* Pins and the guide: folded until asked for. */}
        <div className="mt-auto flex flex-col">
          {/* Earlier (owner, Nov 20 2026): folded to one line; opened, play sessions newest first, each with a one-sentence
              note of what the player did and its steps by place. The newest session is open, older ones fold. A step
              tapped is Now again. */}
          {!!v.earlier?.length && p.onBringBack && (
            <>
              <button type="button" data-qc-log-earlier="" onClick={() => {
                const opening = !showEarlier;
                setShowEarlier(opening);
                const s0 = v.sessions?.[0];
                if (opening && s0 && p.onNeedNote && noteStale(s0.note ? { n: s0.noteN || 0 } : undefined, s0.count)) p.onNeedNote(s0);
              }} aria-expanded={showEarlier}
                className="flex items-center gap-2 py-2 border-t border-white/[0.07] text-[12.5px] font-semibold text-zinc-400 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
                <ChevronRight className="w-3.5 h-3.5 rotate-180 text-[var(--accent-color)]" />{t('tracker.logEarlier')}
                {v.sessions?.[0] && <span className="font-normal text-zinc-500 truncate">· {sessionDay(v.sessions[0].start, Date.now(), { today: t('tracker.sessionToday'), yesterday: t('tracker.sessionYesterday') }, locale)}</span>}
                <span className="ml-auto font-mono text-[11px] text-zinc-500">{(v.sessions || []).reduce((sum, x) => sum + x.count, 0) || v.earlier.length}</span>
                {showEarlier ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {showEarlier && (
                <div data-qc-log-sessions="" className="pb-2 flex flex-col gap-2">
                  {(v.sessions || []).map((ss, si) => {
                    const open = openSession === null ? si === 0 : openSession === ss.key;
                    const day = sessionDay(ss.start, Date.now(), { today: t('tracker.sessionToday'), yesterday: t('tracker.sessionYesterday') }, locale);
                    return (
                      <div key={ss.key} data-qc-log-session={ss.key}>
                        <button type="button" aria-expanded={open}
                          onClick={() => {
                            setOpenSession(open ? '' : ss.key);
                            if (!open && p.onNeedNote && noteStale(ss.note ? { n: ss.noteN || 0 } : undefined, ss.count)) p.onNeedNote(ss);
                          }}
                          className="w-full flex items-center gap-1.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.14em] font-mono text-zinc-500 hover:text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
                          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          {day}
                          <span className="ml-auto normal-case tracking-normal font-sans font-semibold">{t('tracker.sessionSteps', { n: String(ss.count) })}</span>
                        </button>
                        {open && (
                          <div className="mt-1 pl-4 flex flex-col gap-1.5">
                            {ss.note && <p data-qc-log-note="" className="text-[12.5px] leading-snug text-zinc-300 italic">{ss.note}</p>}
                            {ss.places.map((pl) => (
                              <div key={pl.place || '-'}>
                                <div className="flex items-center gap-1 text-[11.5px] font-semibold text-zinc-500"><MapPin className="w-3 h-3" />{pl.place || t('tracker.sessionNoPlace')}</div>
                                <ul className="flex flex-col">
                                  {pl.items.map((e) => (
                                    <li key={e.id}>
                                      <button type="button" onClick={() => p.onBringBack!(e.id)} title={t('tracker.logBringBack')}
                                        className="w-full text-left truncate text-[12.5px] text-zinc-300 hover:text-white px-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-white">↺ {e.text}</button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {pinsN > 0 && (
            <>
              <button type="button" onClick={() => setShowPins((x) => !x)} aria-expanded={showPins}
                className="flex items-center gap-2 py-2 border-t border-white/[0.07] text-[12.5px] font-semibold text-zinc-400 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
                <Bookmark className="w-3.5 h-3.5 text-[var(--accent-color)]" fill="currentColor" />{t('tracker.logPinned')}
                <span className="ml-auto font-mono text-[11px] text-zinc-500">{pinsN}</span>
                {showPins ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {showPins && (
                <ul className="pb-2 flex flex-col gap-0.5">
                  {v.pins.map((pin) => (
                    <li key={pin.id} className="group/pin flex items-center gap-1.5">
                      <button type="button" onClick={() => p.onOpenPin(pin.id)} className="flex-1 min-w-0 text-left truncate text-[12.5px] text-zinc-300 hover:text-white px-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-white">{pin.title}</button>
                      <button type="button" onClick={() => p.onUnpin(pin.id)} title={t('tracker.logUnpin')} aria-label={t('tracker.logUnpin')} className="text-zinc-600 hover:text-white"><X className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {v.more.length > 0 && (
            <>
              <button type="button" onClick={() => setShowMore((x) => !x)} aria-expanded={showMore}
                className="flex items-center gap-2 py-2 border-t border-white/[0.07] text-[12.5px] font-semibold text-zinc-400 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
                {showMore ? t('tracker.logShowLess') : t('tracker.logShowMore')}
                <span className="ml-auto">{showMore ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
              </button>
              {showMore && (
                <div className="pb-2 flex flex-col gap-3">
                  {v.more.map((sec) => (
                    <div key={sec.id}>
                      <div className={`text-[10.5px] font-mono font-extrabold uppercase tracking-[0.14em] mb-1 ${sec.tone === 'amber' ? 'text-amber-300/80' : 'text-zinc-500'}`}>{sec.title}</div>
                      <ul className="flex flex-col gap-0.5">
                        {/* Removed items (and ones ticked before ticks went) stay off the list. */}
                        {sec.items.filter((it) => !it.done).slice(0, 40).map((it) => (
                          <li key={it.id} onContextMenu={it.tick ? onMenu({ id: it.id, text: it.label }) : undefined} className="group/row flex items-start gap-2 text-[12.5px] leading-snug text-zinc-300">
                            <span className="flex-shrink-0 mt-[6px] w-1 h-1 rounded-full bg-zinc-500" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              {p.onOpenEntry && /^g:/.test(it.id) ? (
                                <button type="button" onClick={() => p.onOpenEntry!(it.id)} className="text-left hover:text-white hover:underline outline-none focus-visible:underline">{it.label}</button>
                              ) : it.label}
                              {it.where && <span className="block text-[11.5px] text-zinc-500">{it.where}</span>}
                            </span>
                            {it.tick && (
                              <button type="button" onClick={() => remove({ id: it.id, text: it.label })} title={t('tracker.logRemove')} aria-label={`${t('tracker.logRemove')}: ${it.label}`}
                                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-zinc-500 hover:text-white opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="w-3 h-3" /></button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* The keys, one line. */}
      {!isCompanion() && <div data-qc-keyhints="" className="flex flex-wrap gap-x-2.5 gap-y-1 px-3.5 py-2 border-t border-white/[0.07] bg-black/20 font-mono text-[10.5px] text-zinc-500">
        <span><kbd className="qc-log-kbd">Del</kbd> {t('tracker.logKeyRemove')}</span>
        <span><kbd className="qc-log-kbd">↑↓</kbd> {t('tracker.logKeyMove')}</span>
        <span><kbd className="qc-log-kbd">{p.keysLabel}</kbd> {t('tracker.logClose')}</span>
      </div>}

      {/* An item's right-click menu: Remove. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} aria-hidden="true" />
          <div role="menu" data-qc-log-menu="" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } }}
            style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 50) }}
            className="fixed z-50 w-44 py-1 rounded-lg bg-[#161620] border border-white/15 shadow-2xl">
            <button type="button" role="menuitem" autoFocus onClick={() => remove(menu.s)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
              <X className="w-3.5 h-3.5 text-zinc-400" />{t('tracker.logRemove')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
