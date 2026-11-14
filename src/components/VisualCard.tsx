/**
 * Visual answers (owner's request, Nov 14 2026): the one video or picture under an answer (visualServer.ts finds it after
 * the answer arrives; the answer itself never changes).
 *
 * Video: the best match, thumbnail first (nothing loads from YouTube until the player clicks), then a youtube-nocookie
 * player starting at the matched moment. Under it, 2-3 other videos from the same search as compact rows; clicking one
 * plays it in the same player, inside the app. Picture: click to see it larger; a credit and link only for wiki
 * pictures (never under the owner's own pictures).
 * "Not right" hides it and tells the server (that video or picture isn't picked for this question again).
 */
import React, { useState } from 'react';
import { Play, ExternalLink, X, Maximize2, ThumbsDown } from 'lucide-react';
import { useT } from '../i18n';

export type VideoChoice = { videoId: string; title: string; channel: string; seconds: number; start: number; thumb?: string; note?: string };
export type VisualData =
  | (VideoChoice & { kind: 'video'; alts?: VideoChoice[] })
  | { kind: 'picture'; source: 'ours' | 'wiki'; url: string; alt: string; credit?: string; link?: string; map?: boolean };
export type VisualEvent = 'played' | 'opened' | 'wrong';

export const mmss = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
// The small rows use the search's 320-wide thumbnail; the main player YouTube's 480-wide one (sharp on wide screens).
const thumbOf = (v: VideoChoice) => v.thumb || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
const bigThumbOf = (v: VideoChoice) => `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
const KINDS = ['guide', 'walkthrough', 'quick', 'cheese', 'run'];

export function VisualCard({ visual, compact, onEvent }: { visual: VisualData; compact?: boolean; onEvent?: (e: VisualEvent) => void }) {
  const t = useT();
  const [current, setCurrent] = useState<VideoChoice | null>(visual.kind === 'video' ? visual : null);
  const [playing, setPlaying] = useState(false);
  const [big, setBig] = useState(false);
  const [wrong, setWrong] = useState(false);
  // At most 640 wide: on the wide web app a full-width video would push the answer off the screen.
  const shell = 'mt-3 w-full max-w-[640px] rounded-xl border border-white/[0.12] bg-[#14151e] overflow-hidden';
  const meta = 'text-[11px] text-zinc-400 flex items-center gap-1.5 min-w-0 flex-1';
  const linkCls = 'inline-flex items-center gap-1 text-[11px] text-[var(--accent-color)] hover:underline shrink-0';
  const wrongBtn = onEvent && (
    <button type="button" onClick={() => { setWrong(true); onEvent('wrong'); }} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 shrink-0" title={t('visual.notRightTitle')}>
      <ThumbsDown className="w-3 h-3" /> {t('visual.notRight')}
    </button>
  );
  if (wrong) return <div className={`${shell} px-3 py-2 text-[12px] text-zinc-400`}>{t('visual.thanks')}</div>;

  if (visual.kind === 'video' && current) {
    const v = current;
    const start = Math.max(0, Math.round(v.start || 0));
    const watch = `https://www.youtube.com/watch?v=${v.videoId}${start ? `&t=${start}s` : ''}`;
    const all: VideoChoice[] = [visual, ...(visual.alts || [])];
    const others = all.filter((x) => x.videoId !== v.videoId).slice(0, 3);
    const kindLabel = (x: VideoChoice) => (x.note && KINDS.includes(x.note) ? t(`visual.kind.${x.note}`) : '');
    const play = () => { setPlaying(true); onEvent?.('played'); };
    return (
      <div className={shell} data-qc-visual="video">
        <div className="relative w-full aspect-video bg-black">
          {playing ? (
            <iframe
              key={v.videoId}
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${v.videoId}?start=${start}&rel=0&modestbranding=1&autoplay=1&playsinline=1`}
              title={v.title}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <button type="button" onClick={play} className="group absolute inset-0 w-full h-full" aria-label={t('visual.play', { title: v.title })}>
              <img src={bigThumbOf(v)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-[var(--accent-color)] text-black flex items-center justify-center shadow-[0_0_24px_var(--accent-glow)] group-hover:scale-105 transition-transform">
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              </span>
              <span className="absolute right-2 bottom-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-mono text-white">{mmss(v.seconds)}</span>
              {start > 0 && <span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] text-white">{t('visual.startsAt', { time: mmss(start) })}</span>}
            </button>
          )}
        </div>
        <div className={`px-3 ${compact ? 'py-2' : 'py-2.5'} flex flex-col gap-1`}>
          <div className="text-[12.5px] text-zinc-100 font-medium leading-snug line-clamp-2">{v.title}</div>
          <div className="flex items-center justify-between gap-3">
            <span className={meta}><span className="truncate">{[kindLabel(v) || t('visual.video'), v.channel].filter(Boolean).join(' · ')}</span></span>
            <span className="flex items-center gap-3 shrink-0">{wrongBtn}<a href={watch} target="_blank" rel="noreferrer" className={linkCls}>YouTube <ExternalLink className="w-3 h-3" /></a></span>
          </div>
        </div>
        {others.length > 0 && (
          <div className="border-t border-white/[0.08] px-2 pt-1.5 pb-2">
            <div className="px-1 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-500">{t('visual.others')}</div>
            <div className="flex flex-col gap-1">
              {others.map((o) => {
                const rel = o.seconds < v.seconds * 0.8 ? t('visual.shorter') : o.seconds > v.seconds * 1.25 ? t('visual.longer') : '';
                return (
                  <button key={o.videoId} type="button" onClick={() => { setCurrent(o); setPlaying(true); onEvent?.('played'); }}
                    className="group flex items-center gap-2.5 w-full text-left rounded-lg p-1 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-color)]"
                    aria-label={t('visual.play', { title: o.title })}>
                    <span className="relative shrink-0 w-[88px] aspect-video rounded overflow-hidden bg-black">
                      <img src={thumbOf(o)} alt="" className="w-full h-full object-cover" />
                      <span className="absolute right-0.5 bottom-0.5 px-1 rounded bg-black/80 text-[9.5px] font-mono text-white">{mmss(o.seconds)}</span>
                    </span>
                    <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="text-[11.5px] text-zinc-200 leading-snug line-clamp-2 group-hover:text-white">{o.title}</span>
                      <span className="text-[10.5px] text-zinc-500 truncate">{[kindLabel(o), rel, o.channel].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (visual.kind !== 'picture') return null;
  return (
    <div className={shell} data-qc-visual="picture">
      <button type="button" onClick={() => { setBig(true); onEvent?.('opened'); }} className="group relative block w-full bg-[#0c0d13]" aria-label={t('visual.larger')}>
        <img src={visual.url} alt={visual.alt} className={`mx-auto w-full ${compact ? 'max-h-[220px]' : 'max-h-[300px]'} object-contain`} />
        <span className="absolute right-2 top-2 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"><Maximize2 className="w-3.5 h-3.5" /></span>
      </button>
      <div className="px-3 py-2 flex items-center justify-between gap-3">
        <span className={meta}><span className="truncate">{visual.map ? t('visual.map') : t('visual.picture')} · {visual.alt}</span></span>
        <span className="flex items-center gap-3 shrink-0">
          {wrongBtn}
          {visual.source === 'wiki' && visual.link && (
            <a href={visual.link} target="_blank" rel="noreferrer" className={linkCls} title={visual.credit}>{(visual.credit || t('visual.source')).split(':')[0]} <ExternalLink className="w-3 h-3" /></a>
          )}
        </span>
      </div>
      {big && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-6" onClick={() => setBig(false)}>
          <img src={visual.url} alt={visual.alt} className="max-w-full max-h-full object-contain rounded-lg" />
          <button type="button" className="absolute right-4 top-4 p-2 rounded-full bg-white/10 text-white" aria-label={t('visual.close')}><X className="w-5 h-5" /></button>
        </div>
      )}
    </div>
  );
}
