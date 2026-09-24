/**
 * On-screen pointers in the chat: the screenshot from the question with numbered markers, a list with a checkbox
 * per marker (switch individual markers off and on, live on screen), a show/hide button for all of them, and the
 * other items the AI knows are in this area (desktop: markers appear as you walk near them).
 */
import React, { useState } from 'react';
import type { NearbyItem, ScreenPoint } from '../types';
import { useT } from '../i18n';
import { Eye, Target } from './icons';
import { toggleMarker, usePointerUi } from './pointerStore';

export function AnnotatedShot({
  msgId,
  imageUrl,
  points,
  nearby,
  isDesktop,
  onShow,
  onHide,
}: {
  msgId: string;
  imageUrl?: string;
  points: ScreenPoint[];
  nearby?: NearbyItem[];
  isDesktop: boolean;
  onShow: (hidden: number[]) => void;
  onHide: () => void;
}) {
  const t = useT();
  const [large, setLarge] = useState(false);
  const { active, hidden } = usePointerUi(msgId);
  const hiddenSet = new Set(hidden);
  const pending = (nearby ?? []).filter((n) => !n.found);

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
          {points.map((p, i) =>
            p.fromArea || hiddenSet.has(i) ? null : (
              <span key={i} className="qc-pt absolute" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden="true">
                <span className="qc-pt-ring" />
                <span className="qc-pt-dot">{i + 1}</span>
              </span>
            ),
          )}
        </button>
      )}

      {/* One checkbox per marker: switch it off or back on (on screen too) */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px]" aria-label={t('chat.markerList')}>
        {points.map((p, i) => {
          const on = !hiddenSet.has(i);
          return (
            <li key={i}>
              <label className={`flex items-center gap-1.5 cursor-pointer select-none ${on ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleMarker(msgId, i)}
                  className="w-3.5 h-3.5 accent-[var(--accent-color)] cursor-pointer"
                  aria-label={t('chat.markerToggle', { label: p.label })}
                />
                <span className="qc-pt-num">{i + 1}</span>
                {p.label}
                {p.fromArea && <span className="text-[10px] text-emerald-400 font-mono uppercase">{t('chat.foundNearby')}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {/* Other items in this area that weren't on screen yet */}
      {pending.length > 0 && (
        <div className="text-[11px] text-zinc-400 leading-relaxed">
          <span className="font-semibold text-zinc-300">{t('chat.nearbyTitle')}</span>{' '}
          {pending.map((n) => (n.hint ? `${n.label} (${n.hint})` : n.label)).join(' · ')}
          {isDesktop && <div className="text-zinc-500">{t('chat.nearbyLooking')}</div>}
        </div>
      )}

      {/* Show or hide all markers on screen */}
      {isDesktop && (
        <button
          type="button"
          onClick={() => (active ? onHide() : onShow(hidden))}
          aria-pressed={active}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[11px] font-semibold text-white hover:bg-[var(--accent-border)] transition-colors cursor-pointer"
        >
          {active ? <Eye className="w-3.5 h-3.5 text-[var(--accent-color)]" /> : <Target className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
          {active ? t('chat.hideMarkers') : t('chat.showOnScreen')}
        </button>
      )}
    </div>
  );
}
