/**
 * On-screen markers in the chat, as a checklist: the screenshot with numbered markers, one line per item with a
 * checkbox (checked = collected, and its marker leaves the screen), Show all / Hide all, what the app is watching
 * for as you walk, and what's elsewhere nearby. Numbered checkboxes also appear inside the answer text.
 */
import React, { useState } from 'react';
import { BookOpen, ChevronDown, FlaskConical, Gem, Hand, KeyRound, MapPin, ScrollText, Shield, Skull, Sparkles, Sword, TriangleAlert, User } from 'lucide-react';
import type { NearbyItem, ScreenPoint } from '../types';
import { useT } from '../i18n';
import { useMarkersActive } from './pointerStore';

/** A small icon per kind of thing, so the list can be scanned at a glance. */
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  weapon: Sword,
  armor: Shield,
  consumable: FlaskConical,
  key: KeyRound,
  quest: ScrollText,
  lore: BookOpen,
  secret: Sparkles,
  character: User,
  enemy: Skull,
  danger: TriangleAlert,
  action: Hand,
  place: MapPin,
};

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

/**
 * Which markers got an inline checkbox in the answer text (the rest are listed separately). Read from the badges
 * withMarkerBadges actually added, so a marker never ends up with no checkbox at all.
 */
export function markerMentions(text: string, points: ScreenPoint[]): Set<number> {
  const found = new Set<number>();
  for (const m of withMarkerBadges(text, points).matchAll(/\]\(#qc-marker-(\d+)\)/g)) found.add(Number(m[1]) - 1);
  return found;
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
  lifetime,
  onChangeLifetime,
  onHighlight,
  removed,
  compact = false,
  referenced,
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
  lifetime?: number;
  onChangeLifetime?: (seconds: number) => void;
  /** The player is pointing at one item in the list (null = none): its marker stands out on screen. */
  onHighlight?: (index: number | null) => void;
  /** Markers the close-up check removed because it couldn't see them. */
  removed?: string[];
  /** Desktop: a compact footer after the answer (markers are on screen and checkboxes are in the text). */
  compact?: boolean;
  /** With compact: markers the answer text already mentions; only the others get listed. */
  referenced?: Set<number>;
}) {
  const t = useT();
  const [large, setLarge] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const pointAt = (i: number | null) => {
    setHover(i);
    onHighlight?.(i);
  };
  const active = useMarkersActive(msgId);
  const doneSet = new Set(done);
  const watching = (nearby ?? []).filter((n) => n.onMap && !n.found);
  const elsewhere = (nearby ?? []).filter((n) => !n.onMap);
  const describe = (list: NearbyItem[]) => list.map((n) => (n.hint ? `${n.label} (${n.hint})` : n.label)).join(' · ');
  // Compact: only markers the text doesn't mention get a line here; the screenshot is behind a toggle.
  const listed = compact ? points.map((_, i) => i).filter((i) => !referenced?.has(i)) : points.map((_, i) => i);
  const [showShot, setShowShot] = useState(false);
  const shotVisible = !!imageUrl && (!compact || showShot);

  return (
    <div className={compact ? 'qc-marker-card mt-3 pt-2.5 border-t border-white/[0.08] space-y-2' : 'qc-marker-card mb-3 p-3 rounded-xl bg-black/25 border border-[var(--accent-border)] space-y-2.5'}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className={`font-fantasy font-bold ${compact ? 'text-xs text-zinc-300' : 'text-sm text-white'}`}>{t('chat.markersTitle')}</span>
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
            {onChangeLifetime && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                <span>{t('chat.keep')}</span>
                <select
                  value={String(lifetime ?? 120)}
                  onChange={(e) => onChangeLifetime(Number(e.target.value))}
                  aria-label={t('chat.keepLabel')}
                  title={t('chat.keepLabel')}
                  className="bg-black/40 border border-white/15 rounded-lg px-1.5 py-1 text-[11px] text-zinc-200 outline-none cursor-pointer"
                >
                  <option value="30">30 s</option>
                  <option value="60">1 min</option>
                  <option value="120">2 min</option>
                  <option value="300">5 min</option>
                  <option value="0">{t('chat.keepAlways')}</option>
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {compact && imageUrl && (
        <button type="button" onClick={() => setShowShot((v) => !v)} className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
          {showShot ? t('chat.shotHide') : t('chat.shotShow')}
        </button>
      )}
      {shotVisible && (
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
              <span key={i} className={`qc-pt absolute ${hover === i ? 'qc-pt-hl' : ''}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden="true">
                <span className="qc-pt-ring" />
                <span className="qc-pt-dot">{i + 1}</span>
              </span>
            ),
          )}
        </button>
      )}

      {/* The checklist: checked = collected (its marker leaves the screen). Each line shows what the item is and why it
          matters; pointing at a line makes its marker stand out, and the arrow opens a little more detail. */}
      {listed.length > 0 && <ul className="space-y-1.5" aria-label={t('chat.markersTitle')} onMouseLeave={() => pointAt(null)}>
        {listed.map((i) => {
          const p = points[i];
          const checked = doneSet.has(i);
          const Icon = (p.category && CATEGORY_ICONS[p.category]) || Gem;
          const isOpen = open.has(i);
          const toggleOpen = () =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            });
          return (
            <li
              key={i}
              onMouseEnter={() => pointAt(i)}
              onFocus={() => pointAt(i)}
              className={`rounded-lg px-1.5 py-1 -mx-1.5 transition-colors ${hover === i ? 'bg-white/[0.05]' : ''}`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(i)}
                  className="w-4 h-4 mt-0.5 accent-[var(--accent-color)] cursor-pointer flex-shrink-0"
                  aria-label={t('chat.markDone', { label: p.label })}
                />
                <span className="qc-pt-num flex-shrink-0 mt-0.5">{i + 1}</span>
                <button
                  type="button"
                  onClick={p.detail ? toggleOpen : () => onToggle(i)}
                  aria-expanded={p.detail ? isOpen : undefined}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <span className={`flex items-center gap-1.5 text-[13px] ${checked ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
                    <Icon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--accent-color)]" aria-hidden="true" />
                    <span className="font-medium">{p.label}</span>
                    {p.category && <span className="sr-only">({t(`chat.cat.${p.category}`)})</span>}
                    {p.fromArea && <span className="no-underline text-[10px] text-emerald-400 font-mono uppercase">{t('chat.foundNearby')}</span>}
                    {p.detail && (
                      <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    )}
                  </span>
                  {p.note && <span className={`block text-[12px] leading-snug mt-0.5 ${checked ? 'text-zinc-600' : 'text-zinc-400'}`}>{p.note}</span>}
                  {p.detail && isOpen && <span className="block text-[12px] leading-relaxed mt-1 text-zinc-300">{p.detail}</span>}
                </button>
              </div>
            </li>
          );
        })}
      </ul>}

      {removed && removed.length > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-zinc-500">{t('chat.removedMarkers', { list: removed.join(', ') })}</p>
      )}
      {watching.length > 0 && (
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          <span className="font-semibold text-zinc-300">{t('chat.alsoHere')}</span> {describe(watching)}
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
