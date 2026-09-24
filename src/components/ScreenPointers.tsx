/**
 * On-screen pointers in the chat: the screenshot from the question, with numbered markers the AI placed on it,
 * and a legend. On desktop there's also a button to show the markers over the game itself.
 */
import React, { useState } from 'react';
import type { ScreenPoint } from '../types';
import { useT } from '../i18n';
import { Target } from './icons';

export function AnnotatedShot({ imageUrl, points, onShowOnScreen }: { imageUrl?: string; points: ScreenPoint[]; onShowOnScreen?: () => void }) {
  const t = useT();
  const [large, setLarge] = useState(false);

  return (
    <div className="mb-3 space-y-2">
      {imageUrl && (
        <button
          type="button"
          onClick={() => setLarge((v) => !v)}
          aria-label={t('chat.pointsZoom')}
          title={t('chat.pointsZoom')}
          className={`relative block w-full overflow-hidden rounded-lg border border-[var(--accent-border)] cursor-zoom-in ${large ? '' : 'max-h-72'}`}
        >
          <img src={imageUrl} alt={t('chat.shotAlt')} className="w-full h-auto block" />
          {points.map((p, i) => (
            <span
              key={i}
              className="qc-pt absolute"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              aria-hidden="true"
            >
              <span className="qc-pt-ring" />
              <span className="qc-pt-dot">{i + 1}</span>
            </span>
          ))}
        </button>
      )}
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-300">
        {points.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="qc-pt-num">{i + 1}</span>
            {p.label}
          </li>
        ))}
      </ol>
      {onShowOnScreen && (
        <button
          type="button"
          onClick={onShowOnScreen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[11px] font-semibold text-white hover:bg-[var(--accent-border)] transition-colors cursor-pointer"
        >
          <Target className="w-3.5 h-3.5 text-[var(--accent-color)]" />
          {t('chat.showOnScreen')}
        </button>
      )}
    </div>
  );
}
