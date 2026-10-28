import React, { useState } from 'react';
import { AlertTriangle, BookOpen, Maximize2, Play, X } from './icons';
import { useT } from '../i18n';
import { useGameArt } from '../utils/gameArt';
import { sharpIgdb, steamCover, steamHeader, useArt } from '../utils/artCache';
import { playBlipSound } from '../utils/audio';
import { QuestionsPill } from './QuestionsPill';
import type { Detection } from './DetectionLine';

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

/**
 * The cover, sharp at any screen scale (utils/artCache.ts: the largest size, scaled down, kept on this computer): IGDB's
 * when the game has a guide, else Steam's library portrait, else the picture the game came with, else Steam's header,
 * else the game's initials.
 */
function CoverArt({ appId, name, fallback, live, className }: { appId?: number; name: string; fallback?: string; live: boolean; className: string }) {
  const t = useT();
  const ig = useGameArt(appId || null, name || null);
  const src = useArt([ig.cover && sharpIgdb(ig.cover, 'cover'), steamCover(appId), fallback && sharpIgdb(fallback, 'cover'), steamHeader(appId)]);
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`relative flex-shrink-0 rounded-md border border-white/15 bg-gradient-to-br from-[var(--accent-dim)] to-black/60 ${className}`}>
      {src ? (
        <img src={src} alt="" decoding="async" draggable={false} className="w-full h-full object-cover rounded-md" />
      ) : src === null ? (
        <span className="absolute inset-0 grid place-items-center text-[11px] font-bold text-[var(--accent-color)]">{initials}</span>
      ) : null}
      {live && (
        <span
          className="absolute -right-1 -bottom-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0b0b10] shadow-[0_0_6px_rgba(52,211,153,0.9)]"
          title={t('compact.running')}
          aria-label={t('compact.running')}
          role="img"
        />
      )}
    </div>
  );
}

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
      {p.place && <span className="text-zinc-600">·</span>}
      {p.place && <span className="truncate">{p.place}</span>}
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
  const line2 = d?.choose || (d?.confirm && !d.running) ? (
    <div className="min-w-0 [&>*]:!px-0 [&>*]:!py-0 [&>*]:!border-0 [&>*]:!bg-transparent" style={noDrag}>{p.detectionLine}</div>
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

  if (ribbon) {
    return (
      <div className="flex-1 h-full flex items-center gap-2.5 px-2.5 overflow-hidden bg-gradient-to-b from-[#0d0e14] to-[#07070b]">
        <button type="button" onClick={expand} title={tip} className="cursor-pointer" style={noDrag}>
          <CoverArt appId={p.appId} name={p.gameName} fallback={p.fallbackArt} live={live} className="w-8 h-12" />
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
  return (
    <div className="flex-1 h-full flex gap-2.5 p-2.5 overflow-hidden bg-gradient-to-b from-[#0d0e14] to-[#07070b]">
      <button type="button" onClick={expand} title={tip} className="self-stretch cursor-pointer" style={noDrag}>
        <CoverArt appId={p.appId} name={p.gameName} fallback={p.fallbackArt} live={live} className="w-14 h-full" />
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
}
