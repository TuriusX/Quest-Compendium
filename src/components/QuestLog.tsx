import React, { useEffect, useRef, useState } from 'react';
import { X, Pin, Check, AlertTriangle, ChevronRight, ChevronDown, ChevronLeft, ExternalLink, Crosshair, MapPin } from './icons';
import { useT } from '../i18n';
import type { LogStep, LogView } from '../utils/questLogView';

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
  cleared: { id?: string; text: string; from?: 'question' | 'now' } | null;
  keysLabel: string;
  onTick: (id: string, done: boolean) => void;
  onUndo: () => void;
  onSelect: (id: string) => void;
  onHideWatch: (id: string) => void;
  onClose: () => void;
  onPopOut: () => void;
  onAsk: (text?: string) => void;
  onOpenPin: (msgId: string) => void;
  onUnpin: (msgId: string) => void;
  onClearNow: () => void;
  onLoadSteps?: () => void;
  onDismissOffer?: () => void;
  onGotoArea?: (name: string) => void;
  onLocate?: () => void;
  onConfirmPlace?: () => void;
  /** The player says where they are (the guide's areas, "Yes" to a suggestion, "Still here"). */
  onPickPlace?: (name: string) => void;
  /** Locate me's shortcut, shown on its button. */
  locateKeys?: string;
  /** Open an entry's guide page ("Open in guide"). */
  onOpenEntry?: (id: string) => void;
};

const stepIds = (v: LogView) => [v.now, ...v.next].filter((s): s is LogStep => !!s && s.tick).map((s) => s.id);

export function QuestLog(p: QuestLogProps) {
  const t = useT();
  const v = p.view;
  const [showPins, setShowPins] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [noSuggestion, setNoSuggestion] = useState('');
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
  };

  const tickBtn = (s: LogStep, big = false) => (
    <button
      type="button"
      data-qc-log-step={s.tick ? s.id : undefined}
      data-qc-log-now={big ? '' : undefined}
      disabled={!s.tick}
      onClick={() => s.tick && p.onTick(s.id, true)}
      onFocus={() => s.tick && p.onSelect(s.id)}
      title={s.tick ? t('tracker.logTick') : undefined}
      aria-label={`${t('tracker.logTick')}: ${s.text}`}
      className={`flex-shrink-0 ${big ? 'w-[18px] h-[18px] mt-[3px] border-2' : 'w-[15px] h-[15px] mt-[2px] border'} rounded-[3px] flex items-center justify-center bg-black/30 outline-none focus-visible:ring-2 focus-visible:ring-white ${
        s.tick ? (big && v.now?.source !== 'guide' ? 'border-[var(--accent-color)] hover:bg-[var(--accent-dim)]' : 'border-zinc-400/70 hover:bg-white/10') : 'invisible'
      }`}
    />
  );
  const details = (s: LogStep) =>
    openId === s.id && (s.detail || s.sub) ? <div className="mt-1 text-[12px] leading-snug text-zinc-400">{s.detail || s.sub}</div> : null;
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
      title={`${t('tracker.locate')}${p.locateKeys ? ` (${p.locateKeys})` : ''}`}
      className={`flex items-center justify-center gap-2 rounded-md font-bold outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70 ${
        big ? 'w-full h-11 text-[15px] bg-[var(--accent-color)] text-black hover:brightness-110' : 'flex-shrink-0 h-7 px-2.5 text-[12px] border border-[var(--accent-border)] text-[var(--accent-color)] hover:bg-[var(--accent-color)] hover:text-black'
      }`}>
      <Crosshair className={`${big ? 'w-5 h-5' : 'w-3.5 h-3.5'} ${w?.locating || v.locating ? 'animate-spin' : ''}`} />
      {w?.locating || v.locating ? t('tracker.locatingBig') : t('tracker.locate')}
      {big && p.locateKeys && !w?.locating && <kbd className="qc-log-kbd !text-black/70 !border-black/30 !bg-black/10">{p.locateKeys}</kbd>}
    </button>
  ) : null;
  const picker = picking && pickNames.length > 0 && p.onPickPlace ? (
    <ul className="mt-2 max-h-[180px] overflow-y-auto rounded border border-white/10 bg-black/30 py-1" style={{ scrollbarWidth: 'thin' }}>
      {pickNames.map((name) => (
        <li key={name} ref={name === place?.name ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
          <button type="button" onClick={() => pick(name)}
            className={`w-full text-left px-2.5 py-1 text-[12.5px] hover:bg-white/[0.06] hover:text-white outline-none focus-visible:bg-white/[0.08] ${name === place?.name ? 'text-[var(--accent-color)] font-semibold' : 'text-zinc-300'}`}>{name}</button>
        </li>
      ))}
    </ul>
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
      {/* Header: the log's name and where the player is, then pop out and close. */}
      <div className="flex items-center gap-1.5 pl-3.5 pr-2 py-2.5 border-b border-white/[0.07]">
        <span className="font-mono font-extrabold text-[12px] tracking-[0.14em] uppercase">{t('tracker.logTitle')}</span>
        <span className="flex-1" />
        <button type="button" onClick={p.onPopOut} title={t('tracker.popOut')} aria-label={t('tracker.popOut')}
          className="w-6 h-6 rounded border border-white/10 text-zinc-400 hover:text-white hover:border-[var(--accent-border)] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={p.onClose} title={`${t('tracker.logClose')} (${p.keysLabel})`} aria-label={t('tracker.logClose')}
          className="w-6 h-6 rounded border border-white/10 text-zinc-400 hover:text-white hover:border-[var(--accent-border)] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="w-3.5 h-3.5" />
        </button>
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
      {v.notice && <div className="px-3.5 pt-1 text-[11.5px] text-amber-300">{v.notice}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pt-3 pb-2 flex flex-col gap-4" style={{ scrollbarWidth: 'thin' }}>
        {/* The place isn't known: nothing from the guide, only "Where are you?" (never the start of the guide). */}
        {w && (
          <div data-qc-log-where="" className="rounded-md border border-[var(--accent-border)] bg-[var(--accent-dim)]/50 p-3.5 flex flex-col gap-2.5">
            <div>
              <div className="font-bold text-[17px] text-white flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[var(--accent-color)]" />{t('tracker.whereTitle')}</div>
              <p className="mt-1 text-[12.5px] text-zinc-400 leading-snug">{t('tracker.whereSub')}</p>
            </div>
            {locateBtn(true)}
            {suggestion && p.onPickPlace && !w.locating && (
              <div className="flex items-center gap-1.5 flex-wrap text-[13px] text-zinc-200">
                <span>{t('tracker.whereLooksLike', { place: suggestion })}</span>
                <button type="button" onClick={() => pick(suggestion)} className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[12px] font-bold hover:bg-emerald-500/30 outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereYes')}</button>
                <button type="button" onClick={() => { setNoSuggestion(suggestion); setPicking(true); }} className="px-2 py-0.5 rounded border border-white/15 text-zinc-300 text-[12px] font-bold hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereNo')}</button>
              </div>
            )}
            {w.last && w.last !== suggestion && p.onPickPlace && !w.locating && (
              <div className="flex items-center gap-1.5 flex-wrap text-[12.5px] text-zinc-400">
                <span>{t('tracker.whereLast', { place: w.last })}</span>
                <button type="button" onClick={() => pick(w.last!)} className="px-2 py-0.5 rounded border border-white/15 text-zinc-200 text-[12px] font-semibold hover:text-white hover:border-[var(--accent-border)] outline-none focus-visible:ring-2 focus-visible:ring-white">{t('tracker.whereStill')}</button>
              </div>
            )}
            {p.onPickPlace && pickNames.length > 0 && (
              <button type="button" onClick={() => setPicking((x) => !x)} aria-expanded={picking}
                className="self-start text-[12.5px] font-semibold text-[var(--accent-color)] hover:underline outline-none focus-visible:underline">{t('tracker.wherePick')}</button>
            )}
            {picker}
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/[0.07]">
              {[t('tracker.logQuick1'), t('tracker.logQuick2')].map((q) => (
                <button key={q} type="button" onClick={() => p.onAsk(q)}
                  className="mt-1.5 px-2 py-1 rounded border border-white/15 bg-[#121119] text-[12px] font-mono text-zinc-300 hover:border-[var(--accent-border)] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">{q}</button>
              ))}
            </div>
          </div>
        )}

        {/* Nothing asked yet: an invitation. */}
        {v.invite && !v.done && !w && (
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
                {mine ? t('tracker.logFromQuestion') : t('tracker.logFromGuide')}
                {mine && <button type="button" onClick={p.onClearNow} title={t('tracker.logClearNow')} aria-label={t('tracker.logClearNow')} className="ml-1.5 align-[-2px] text-zinc-500 hover:text-white"><X className="inline w-3 h-3" /></button>}
              </span>
            ))}
            <div
              className={`rounded-md p-3 border ${
                mine || n.source === 'loaded'
                  ? 'bg-gradient-to-b from-[rgba(168,127,251,.15)] to-[rgba(168,127,251,.07)] border-[var(--accent-border)] shadow-[inset_3px_0_0_var(--accent-color)]'
                  : 'bg-white/[0.03] border-white/[0.14] shadow-[inset_3px_0_0_#6d6880]'
              } ${p.sel === n.id ? 'ring-1 ring-white/30' : ''}`}
            >
              <div className="flex gap-2.5 items-start">
                {tickBtn(n, true)}
                <button type="button" onClick={() => setOpenId((o) => (o === n.id ? null : n.id))} className="text-left min-w-0 outline-none focus-visible:underline">
                  <div className="font-bold text-[16.5px] leading-tight tracking-[-0.005em] text-white">{n.text}</div>
                  {n.sub && <div className="mt-1 text-[12.5px] leading-snug text-zinc-400">{n.sub}</div>}
                  {details(n)}
                </button>
              </div>
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
              {n.total > 0 && (
                <div className="flex items-center gap-2 mt-2.5 text-[11px] font-mono font-bold text-zinc-400 whitespace-nowrap">
                  <span className="flex gap-[3px]">
                    {Array.from({ length: Math.min(n.total, 12) }, (_, i) => <i key={i} className={`block w-5 h-[5px] ${i < n.doneCount ? 'bg-[var(--accent-color)]' : 'bg-white/[0.12]'}`} />)}
                  </span>
                  {t('tracker.logProgress', { n: n.doneCount, total: n.total })}
                  <span className="ml-auto font-sans font-semibold text-[11.5px] text-zinc-500 truncate">{n.goal}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* The last tick, for a few seconds: Undo. */}
        {p.cleared && (
          <div className="-mt-2 flex items-center gap-1.5 text-[12px] text-zinc-500" role="status">
            <Check className="w-3 h-3 text-emerald-400" />
            <span className="truncate" data-qc-log-undo={p.cleared.from || 'tick'}>{p.cleared.from === 'now' ? t('tracker.logNowFromQuestion', { goal: p.cleared.text }) : p.cleared.from === 'question' ? t('tracker.logTickedFromQuestion', { step: p.cleared.text }) : t('tracker.logTicked', { step: p.cleared.text })}</span>
            <button type="button" onClick={p.onUndo} className="ml-1 font-bold text-[var(--accent-color)] hover:underline outline-none focus-visible:ring-2 focus-visible:ring-white rounded">{t('tracker.logUndo')}</button>
          </div>
        )}

        {v.next.length > 0 && (
          <div>
            {label(t('tracker.logNext'))}
            <div className="flex flex-col gap-0.5">
              {v.next.map((s) => (
                <div key={s.id} className={`flex gap-2.5 items-start px-2 py-1.5 rounded ${p.sel === s.id ? 'bg-white/[0.04] outline outline-1 outline-white/[0.14]' : ''}`}>
                  {tickBtn(s)}
                  <button type="button" onClick={() => setOpenId((o) => (o === s.id ? null : s.id))} className="text-left min-w-0 outline-none focus-visible:underline">
                    <div className="text-[13.5px] leading-snug text-zinc-200">{s.text}</div>
                    {s.sub && <div className="text-[12px] text-zinc-500 mt-px">{s.sub}</div>}
                    {details(s)}
                  </button>
                </div>
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
                  <div key={s.id} className={`flex gap-2.5 items-start px-2 py-1 rounded ${p.sel === s.id ? 'bg-white/[0.04] outline outline-1 outline-white/[0.14]' : ''}`}>
                    {tickBtn(s)}
                    <button type="button" onClick={() => setOpenId((o) => (o === s.id ? null : s.id))} className="text-left min-w-0 outline-none focus-visible:underline">
                      <div className="text-[13.5px] leading-snug text-zinc-200">{s.text}</div>
                      {s.sub && <div className="text-[12px] text-zinc-500 mt-px">{s.sub}</div>}
                      {details(s)}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {v.here.missables.length > 0 && (
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
            {label(t('tracker.logWatch'), v.watch.fromGuide ? <span className="ml-auto normal-case tracking-normal font-sans font-semibold text-[11px] text-amber-300/70">{t('tracker.secMissable')}</span> : undefined, true)}
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

        {!n && !v.done && !v.invite && !w && !v.here && !v.next.length && !v.watch && <div className="text-[12.5px] text-zinc-500">{t('tracker.logEmpty')}</div>}

        {/* Pins and the guide: folded until asked for. */}
        <div className="mt-auto flex flex-col">
          {pinsN > 0 && (
            <>
              <button type="button" onClick={() => setShowPins((x) => !x)} aria-expanded={showPins}
                className="flex items-center gap-2 py-2 border-t border-white/[0.07] text-[12.5px] font-semibold text-zinc-400 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
                <Pin className="w-3.5 h-3.5 text-[var(--accent-color)]" />{t('tracker.logPinned')}
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
                        {sec.items.slice(0, 40).map((it) => (
                          <li key={it.id} className={`flex items-start gap-2 text-[12.5px] leading-snug ${it.done ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                            {it.tick ? (
                              <button type="button" onClick={() => p.onTick(it.id, !it.done)} aria-label={`${t('tracker.logTick')}: ${it.label}`}
                                className={`flex-shrink-0 mt-[2px] w-[13px] h-[13px] rounded-[2px] border flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white ${it.done ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-500 hover:bg-white/10'}`}>
                                {it.done && <Check className="w-2.5 h-2.5 text-black" />}
                              </button>
                            ) : <span className="w-[13px] flex-shrink-0" />}
                            <span className="min-w-0">
                              {p.onOpenEntry && /^g:/.test(it.id) ? (
                                <button type="button" onClick={() => p.onOpenEntry!(it.id)} className="text-left hover:text-white hover:underline outline-none focus-visible:underline">{it.label}</button>
                              ) : it.label}
                              {it.where && !it.done && <span className="block text-[11.5px] text-zinc-500">{it.where}</span>}
                            </span>
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
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 px-3.5 py-2 border-t border-white/[0.07] bg-black/20 font-mono text-[10.5px] text-zinc-500">
        <span><kbd className="qc-log-kbd">Space</kbd> {t('tracker.logKeyTick')}</span>
        <span><kbd className="qc-log-kbd">↑↓</kbd> {t('tracker.logKeyMove')}</span>
        <span><kbd className="qc-log-kbd">{p.keysLabel}</kbd> {t('tracker.logClose')}</span>
      </div>
    </div>
  );
}
