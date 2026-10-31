import React, { useState } from 'react';
import { AlertTriangle, BookOpen, Crosshair, MapPin, Maximize2, Play, X } from './icons';
import { useT } from '../i18n';
import { GameCover } from './GameCover';
import { playBlipSound } from '../utils/audio';
import { QuestionsPill } from './QuestionsPill';
import type { Detection } from './DetectionLine';
import type { LogStep, LogView } from '../utils/questLogView';

/**
 * The compact view (owner, Oct 27 2026): the game's box art, then one line for the game and where you are, one for the
 * current objective (else what the guide lists next here, else one hint), and the one-line question box.
 *   - card:   three lines beside the cover (side docks and floating)
 *   - ribbon: two rows with the question box beside them, in the bottom corners (it covers the least of the game there)
 * Detection is a green dot on the art (the running game is this one); another running game is a small "Playing X"
 * button; a collection's "Which game?" shows the detection line once in place of the objective.
 */
export type CompactLayout = 'card' | 'ribbon';

export type CompactObjective = { title?: string; step?: string } | null;
export type CompactNear = { label: string; where?: string; missable?: boolean } | null;

export function CompactCard(p: {
  layout: CompactLayout;
  gameName: string;
  appId?: number;
  fallbackArt?: string;
  place: string;
  objective: CompactObjective;
  near: CompactNear;
  detection?: Detection;
  detectionLine?: React.ReactNode;
  quota?: any;
  soundEnabled: boolean;
  askForm: React.ReactNode;
  onExpand?: () => void;
  onNear?: () => void;
  onObjective?: () => void;
  /** Close the app (desktop): syncs first, like the full view's ✕. */
  onClose?: () => void;
  /**
   * The quest log (owner, Oct 30 2026): its Now is the objective line (tick box, progress, ⚠ when there's a Watch out);
   * open (Ctrl+Shift+L, View, or the chevron) folds Next and Watch out out under the card.
   */
  log?: {
    view: LogView; open: boolean; onTick: (id: string) => void; onToggle: () => void; keysLabel: string;
    /** Locate me (owner, Oct 31 2026): on the card too, big while the place isn't known. */
    onLocate?: () => void; onPickPlace?: (name: string) => void; locateKeys?: string;
  } | null;
}) {
  const t = useT();
  const d = p.detection;
  const live = !!d?.running && d.open;
  const other = !!d?.running && !d.open ? d.running : '';
  const ribbon = p.layout === 'ribbon';
  const [closing, setClosing] = useState(false);
  const expand = () => {
    playBlipSound(p.soundEnabled);
    p.onExpand?.();
  };
  const tip = `${t('compact.expand')} (Ctrl+Shift+F)`;
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  // Line 1: the game and where you are (or another running game to open).
  const where = (
    <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-zinc-400">
      <span className="font-bold text-zinc-100 truncate flex-shrink-0 max-w-[60%]">{p.gameName}</span>
      {p.place && !p.log?.view.where && <span className="text-zinc-600">·</span>}
      {p.place && !p.log?.view.where && <span className="truncate">{p.place}</span>}
      {p.place && !p.log?.view.where && p.log?.onLocate && (
        <button type="button" onClick={() => { playBlipSound(p.soundEnabled); p.log?.onLocate?.(); }}
          title={`${t('tracker.locate')}${p.log.locateKeys ? ` (${p.log.locateKeys})` : ''}`} aria-label={t('tracker.locate')}
          className={`flex-shrink-0 text-[var(--accent-color)] opacity-70 hover:opacity-100 cursor-pointer ${p.log.view.locating ? 'animate-spin' : ''}`} style={noDrag}>
          <Crosshair className="w-3.5 h-3.5" />
        </button>
      )}
      {other && (
        <button
          type="button"
          onClick={() => { playBlipSound(p.soundEnabled); d?.onSwitch(); }}
          title={t('compact.playingOther', { game: other })}
          aria-label={t('compact.playingOther', { game: other })}
          className="flex-shrink-[3] min-w-0 max-w-[40%] flex items-center gap-1 px-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20 cursor-pointer"
          style={noDrag}
        >
          <Play className="w-2.5 h-2.5 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{other}</span>
        </button>
      )}
    </div>
  );
  const controls = (
    <span className="flex-shrink-0 flex items-center gap-1" style={noDrag}>
      <QuestionsPill userData={p.quota} small onPress={expand} />
      <button
        type="button"
        onClick={expand}
        title={tip}
        aria-label={t('compact.expand')}
        className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/[0.06] cursor-pointer"
      >
        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {p.onClose && (
        <button
          type="button"
          onClick={() => { if (closing) return; setClosing(true); playBlipSound(p.soundEnabled); p.onClose?.(); }}
          disabled={closing}
          title={closing ? t('header.closing') : t('header.close')}
          aria-label={t('header.close')}
          className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/20 cursor-pointer disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
  // Line 2: the objective and its next step, else "Next here", else one hint (a collection's "Which game?" first).
  const lg = p.log && p.log.view.now ? p.log : null;
  const now = lg?.view.now || null;
  // The place isn't known: "Where are you?" with Locate me (and "Looks like X?" when a check was unsure).
  const ask = p.log?.view.where && !now ? p.log.view.where : null;
  const whereLog = ask ? p.log! : null;
  const box = (s: LogStep, small = false) => (
    <button
      type="button"
      disabled={!s.tick}
      onClick={() => { playBlipSound(p.soundEnabled); p.log?.onTick(s.id); }}
      aria-label={`${t('tracker.logTick')}: ${s.text}`}
      className={`flex-shrink-0 ${small ? 'w-[13px] h-[13px] border' : 'w-[15px] h-[15px] border-2'} rounded-[3px] bg-black/30 ${s.tick ? 'border-[var(--accent-color)] hover:bg-[var(--accent-dim)] cursor-pointer' : 'border-zinc-500 opacity-60'}`}
      style={noDrag}
    />
  );
  // The detection line takes line 2 when it has something to say: a collection's "Which game?", a program to confirm,
  // "Open a tab for X?", or "Switched to X" for a few seconds.
  const line2 = d?.choose || (d?.confirm && !d.running) || (d?.offer && d.running && !d.open) || (d?.switched && live) ? (
    <div className="min-w-0 [&>*]:!px-0 [&>*]:!py-0 [&>*]:!border-0 [&>*]:!bg-transparent" style={noDrag}>{p.detectionLine}</div>
  ) : ask && whereLog ? (
    <div data-qc-log-where="" className="min-w-0 flex items-center gap-2 px-2 py-1 rounded border border-[var(--accent-border)] bg-[var(--accent-dim)]" style={noDrag}>
      <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-[var(--accent-color)]" />
      <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-white">
        {ask.suggestion && !ask.locating ? t('tracker.whereLooksLike', { place: ask.suggestion }) : t('tracker.whereTitle')}
      </span>
      {ask.suggestion && !ask.locating && whereLog.onPickPlace && (
        <button type="button" onClick={() => { playBlipSound(p.soundEnabled); whereLog.onPickPlace?.(ask.suggestion!); }}
          className="flex-shrink-0 px-1.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[11.5px] font-bold cursor-pointer">{t('tracker.whereYes')}</button>
      )}
      {whereLog.onLocate && (
        <button type="button" data-qc-locate="" disabled={ask.locating} onClick={() => { playBlipSound(p.soundEnabled); whereLog.onLocate?.(); }}
          title={`${t('tracker.locate')}${whereLog.locateKeys ? ` (${whereLog.locateKeys})` : ''}`}
          className="flex-shrink-0 flex items-center gap-1 h-6 px-2 rounded bg-[var(--accent-color)] text-black text-[12px] font-bold cursor-pointer disabled:opacity-70">
          <Crosshair className={`w-3.5 h-3.5 ${ask.locating ? 'animate-spin' : ''}`} />
          {ask.locating ? t('tracker.locatingBig') : t('tracker.locate')}
        </button>
      )}
    </div>
  ) : lg && now ? (
    <div className="min-w-0 flex items-center gap-2 px-2 py-1 rounded border border-[var(--accent-border)] bg-[var(--accent-dim)]" style={noDrag}>
      {box(now)}
      <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-white" title={[now.text, now.sub].filter(Boolean).join(' · ')}>{now.text}</span>
      {now.total > 0 && <span className="flex-shrink-0 font-mono text-[11px] font-bold text-zinc-400">{now.doneCount}/{now.total}</span>}
      {lg.view.watch && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-300" aria-label={t('tracker.logWatch')} />}
      <button type="button" onClick={() => { playBlipSound(p.soundEnabled); lg.onToggle(); }} aria-expanded={lg.open}
        title={`${t('tracker.logNext')} (${lg.keysLabel})`} aria-label={t('tracker.logNext')}
        className="flex-shrink-0 text-zinc-400 hover:text-white cursor-pointer">{lg.open ? '▾' : '▸'}</button>
    </div>
  ) : p.objective ? (
    <button type="button" onClick={() => { playBlipSound(p.soundEnabled); (p.onObjective || p.onExpand)?.(); }} title={[p.objective.title, p.objective.step].filter(Boolean).join(' · ')} className="min-w-0 truncate text-left text-[12.5px] text-zinc-200 hover:text-white cursor-pointer" style={noDrag}>
      {p.objective.title && <span className="font-fantasy font-bold text-white">{p.objective.title}</span>}
      {p.objective.title && p.objective.step && <span className="text-zinc-500"> · </span>}
      {p.objective.step}
    </button>
  ) : p.near ? (
    <button type="button" onClick={() => { playBlipSound(p.soundEnabled); p.onNear?.(); }} title={t('answer.missOpen')} className="min-w-0 flex items-center gap-1.5 text-left text-[12px] text-zinc-400 hover:text-zinc-200 cursor-pointer" style={noDrag}>
      {p.near.missable ? <AlertTriangle className="w-3 h-3 text-amber-300 flex-shrink-0" aria-hidden="true" /> : <BookOpen className="w-3 h-3 text-[var(--accent-color)] flex-shrink-0" aria-hidden="true" />}
      <span className="flex-shrink-0 font-semibold text-zinc-300">{t('compact.nearYou')}</span>
      <span className="truncate">{p.near.label}{p.near.where ? ` · ${p.near.where}` : ''}</span>
    </button>
  ) : (
    <span className="min-w-0 truncate text-[12px] text-zinc-500">{t('compact.hint')}</span>
  );

  // Open: Next (2-3) and Watch out under the card, nothing from the guide's lists.
  const fold = lg && lg.open ? (
    <div className="flex-1 min-h-0 overflow-y-auto border-t border-white/[0.07] bg-[#101016] px-3 py-2 flex flex-col gap-1.5" style={noDrag}>
      {lg.view.next.length > 0 && <div className="text-[10px] font-mono font-extrabold uppercase tracking-[0.14em] text-zinc-500">{t('tracker.logNext')}</div>}
      {lg.view.next.map((s) => (
        <div key={s.id} className="flex items-start gap-2 text-[12.5px] leading-snug text-zinc-200">
          <span className="mt-[2px]">{box(s, true)}</span>
          <span className="min-w-0">{s.text}{s.sub && <span className="block text-[11.5px] text-zinc-500">{s.sub}</span>}</span>
        </div>
      ))}
      {lg.view.watch && (
        <div className="flex gap-2 rounded border border-amber-300/35 bg-amber-300/[0.09] px-2 py-1.5 text-[12px] leading-snug text-[#f3e6c8]">
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0 text-amber-300" aria-hidden="true" />
          <span className="min-w-0"><b className="text-amber-300">{lg.view.watch.text}</b>{lg.view.watch.why && lg.view.watch.why !== lg.view.watch.text ? ` · ${lg.view.watch.why}` : ''}</span>
        </div>
      )}
    </div>
  ) : null;

  if (ribbon) {
    if (fold) return (
      <div className="flex-1 h-full flex flex-col overflow-hidden">
        <div className="h-16 flex-shrink-0 flex items-center gap-2.5 px-2.5 bg-gradient-to-b from-[#0d0e14] to-[#07070b]">
          <button type="button" onClick={expand} title={tip} className="cursor-pointer" style={noDrag}>
            <GameCover appId={p.appId} name={p.gameName} fallback={p.fallbackArt} live={live} className="w-8 h-12" />
          </button>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">{where}{line2}</div>
          <div className="w-[48%] min-w-0 flex flex-col gap-1"><div className="flex justify-end">{controls}</div>{p.askForm}</div>
        </div>
        {fold}
      </div>
    );
    return (
      <div className="flex-1 h-full flex items-center gap-2.5 px-2.5 overflow-hidden bg-gradient-to-b from-[#0d0e14] to-[#07070b]">
        <button type="button" onClick={expand} title={tip} className="cursor-pointer" style={noDrag}>
          <GameCover appId={p.appId} name={p.gameName} fallback={p.fallbackArt} live={live} className="w-8 h-12" />
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          {where}
          {line2}
        </div>
        <div className="w-[48%] min-w-0 flex flex-col gap-1">
          <div className="flex justify-end">{controls}</div>
          {p.askForm}
        </div>
      </div>
    );
  }
  const card = (
    <div className={`${fold ? 'h-[104px] flex-shrink-0' : 'flex-1 h-full'} flex gap-2.5 p-2.5 overflow-hidden bg-gradient-to-b from-[#0d0e14] to-[#07070b]`}>
      <button type="button" onClick={expand} title={tip} className="self-stretch cursor-pointer" style={noDrag}>
        <GameCover appId={p.appId} name={p.gameName} fallback={p.fallbackArt} live={live} className="w-14 h-full" />
      </button>
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0">{where}</div>
          {controls}
        </div>
        {line2}
        {p.askForm}
      </div>
    </div>
  );
  return fold ? <div className="flex-1 h-full flex flex-col overflow-hidden">{card}{fold}</div> : card;
}
