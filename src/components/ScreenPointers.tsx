/**
 * On-screen markers in the chat, as a checklist: the screenshot with numbered markers, one line per item with a
 * checkbox (checked = collected, and its marker leaves the screen), Show all / Hide all, what the app is watching
 * for as you walk, and what's elsewhere nearby. Numbered checkboxes also appear inside the answer text.
 */
import React, { useState } from 'react';
import type { NearbyItem, ScreenPoint } from '../types';
import { useT } from '../i18n';
import { useMarkersActive } from './pointerStore';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Add a numbered checkbox right after the first mention of each marked item in the answer text. */
export function withMarkerBadges(text: string, points: ScreenPoint[]): string {
  let out = text;
  const used = new Set<string>();
  points.forEach((p, i) => {
    const label = p.label.trim();
    if (label.length < 3 || used.has(label.toLowerCase())) return; // one checkbox per item name
    used.add(label.toLowerCase());
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[])(${escapeRe(label)})(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(out);
    if (!m) return;
    let end = m.index + m[1].length + m[2].length;
    // Keep bold/italic intact: "**Potion** [4]" reads better than "**Potion [4]**".
    const after = out.slice(end).match(/^(\*\*|__|\*|_)/);
    if (after) end += after[1].length;
    out = `${out.slice(0, end)} [${i + 1}](#qc-marker-${i + 1})${out.slice(end)}`;
  });
  return out;
}

/** A numbered checkbox inside the answer text, synced with the checklist. */
export function MarkerBadge({ n, label, checked, onToggle }: { n: number; label: string; checked: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={t('chat.markDone', { label })}
      title={t('chat.markDone', { label })}
      onClick={onToggle}
      className={`qc-inline-badge ${checked ? 'qc-inline-badge-done' : ''}`}
    >
      {checked ? '✓' : n}
    </button>
  );
}

export function AnnotatedShot({
  msgId,
  imageUrl,
  points,
  nearby,
  done,
  isDesktop,
  onToggle,
  onShowAll,
  onHideAll,
}: {
  msgId: string;
  imageUrl?: string;
  points: ScreenPoint[];
  nearby?: NearbyItem[];
  done: number[];
  isDesktop: boolean;
  onToggle: (index: number) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const t = useT();
  const [large, setLarge] = useState(false);
  const active = useMarkersActive(msgId);
  const doneSet = new Set(done);
  const watching = (nearby ?? []).filter((n) => n.onMap && !n.found);
  const elsewhere = (nearby ?? []).filter((n) => !n.onMap);
  const describe = (list: NearbyItem[]) => list.map((n) => (n.hint ? `${n.label} (${n.hint})` : n.label)).join(' · ');

  return (
    <div className="qc-marker-card mb-3 p-3 rounded-xl bg-black/25 border border-[var(--accent-border)] space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-fantasy font-bold text-sm text-white">{t('chat.markersTitle')}</span>
          <span className="text-[10px] font-mono uppercase text-zinc-400">
            {t('chat.collected', { done: done.filter((i) => i < points.length).length, total: points.length })}
            {active && <span className="ml-2 text-emerald-400">● {t('chat.onScreen')}</span>}
          </span>
        </div>
        {isDesktop && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onShowAll}
              className="px-2.5 py-1 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[11px] font-semibold text-white hover:bg-[var(--accent-border)] transition-colors cursor-pointer"
            >
              {t('chat.showAll')}
            </button>
            <button
              type="button"
              onClick={onHideAll}
              className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] font-semibold text-zinc-300 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
            >
              {t('chat.hideAll')}
            </button>
          </div>
        )}
      </div>

      {imageUrl && (
        <button
          type="button"
          onClick={() => setLarge((v) => !v)}
          aria-label={t('chat.pointsZoom')}
          title={t('chat.pointsZoom')}
          className={`relative block w-full overflow-hidden rounded-lg border border-white/10 cursor-zoom-in ${large ? '' : 'max-h-44'}`}
        >
          <img src={imageUrl} alt={t('chat.shotAlt')} className="w-full h-auto block" />
          {points.map((p, i) =>
            p.fromArea || doneSet.has(i) ? null : (
              <span key={i} className="qc-pt absolute" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden="true">
                <span className="qc-pt-ring" />
                <span className="qc-pt-dot">{i + 1}</span>
              </span>
            ),
          )}
        </button>
      )}

      {/* The checklist: checked = collected (its marker leaves the screen) */}
      <ul className="space-y-1" aria-label={t('chat.markersTitle')}>
        {points.map((p, i) => {
          const checked = doneSet.has(i);
          return (
            <li key={i}>
              <label className={`flex items-center gap-2 cursor-pointer select-none text-[13px] ${checked ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(i)}
                  className="w-4 h-4 accent-[var(--accent-color)] cursor-pointer flex-shrink-0"
                  aria-label={t('chat.markDone', { label: p.label })}
                />
                <span className="qc-pt-num flex-shrink-0">{i + 1}</span>
                <span className="font-medium">{p.label}</span>
                {p.fromArea && <span className="no-underline text-[10px] text-emerald-400 font-mono uppercase">{t('chat.foundNearby')}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {watching.length > 0 && (
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          <span className="font-semibold text-zinc-300">{isDesktop ? t('chat.watching') : t('chat.alsoHere')}</span> {describe(watching)}
        </p>
      )}
      {elsewhere.length > 0 && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          <span className="font-semibold text-zinc-400">{t('chat.elsewhere')}</span> {describe(elsewhere)}
        </p>
      )}
    </div>
  );
}
