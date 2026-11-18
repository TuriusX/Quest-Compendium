/**
 * Drawn answers (owner, Nov 18 2026; drawnAnswer.ts): the answer drawn on the player's own screenshot, on a wiki picture
 * of the place (credited and linked), or an illustration made from the answer (always labelled as one, never passed off
 * as the game). Click to see it larger; "Not right" hides it.
 */
import React, { useState } from 'react';
import { ExternalLink, X, Maximize2, ThumbsDown, PenLine, Sparkles } from 'lucide-react';
import { useT } from '../i18n';
import type { WikiPage } from './VisualCard';

export type DrawnData = { kind: 'drawn'; url: string; on: 'screen' | 'wiki' | 'illustration'; alt: string; page?: WikiPage };

export function DrawnCard({ drawn, compact, onWrong }: { drawn: DrawnData; compact?: boolean; onWrong?: () => void }) {
  const t = useT();
  const [big, setBig] = useState(false);
  const [wrong, setWrong] = useState(false);
  const shell = 'mt-3 w-full max-w-[640px] rounded-xl border border-white/[0.12] bg-[#14151e] overflow-hidden';
  if (wrong) return <div className={`${shell} px-3 py-2 text-[12px] text-zinc-400`}>{t('drawn.thanks')}</div>;
  const illus = drawn.on === 'illustration';
  const label = illus ? t('drawn.illustration') : drawn.on === 'wiki' ? t('drawn.onWiki', { site: drawn.page?.site || 'wiki' }) : t('drawn.onScreen');
  return (
    <div className={shell} data-qc-drawn={drawn.on}>
      <button type="button" onClick={() => setBig(true)} className="group relative block w-full bg-[#0c0d13]" aria-label={t('visual.larger')}>
        <img src={drawn.url} alt={drawn.alt} className={`block mx-auto max-w-full ${compact ? 'max-h-[260px]' : 'max-h-[360px]'} object-contain`} />
        {illus && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/75 text-[10.5px] font-semibold uppercase tracking-wider text-white">
            <Sparkles className="w-3 h-3" /> {t('drawn.illustration')}
          </span>
        )}
        <span className="absolute right-2 top-2 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"><Maximize2 className="w-3.5 h-3.5" /></span>
      </button>
      <div className="px-3 py-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-zinc-400 flex items-center gap-1.5 min-w-0 flex-1">
          {illus ? <Sparkles className="w-3 h-3 shrink-0 text-[var(--accent-color)]" /> : <PenLine className="w-3 h-3 shrink-0 text-[var(--accent-color)]" />}
          <span className="truncate">{illus ? t('drawn.illustrationNote') : label} · {drawn.alt}</span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {onWrong && (
            <button type="button" onClick={() => { setWrong(true); onWrong(); }} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300" title={t('drawn.notRightTitle')}>
              <ThumbsDown className="w-3 h-3" /> {t('visual.notRight')}
            </button>
          )}
          {drawn.page && (
            <a href={drawn.page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-color)] hover:underline" title={drawn.page.title}>
              {drawn.page.site} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </span>
      </div>
      {big && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-6" onClick={() => setBig(false)}>
          <img src={drawn.url} alt={drawn.alt} className="max-w-full max-h-full object-contain rounded-lg" />
          <button type="button" className="absolute right-4 top-4 p-2 rounded-full bg-white/10 text-white" aria-label={t('visual.close')}><X className="w-5 h-5" /></button>
        </div>
      )}
    </div>
  );
}
