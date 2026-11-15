import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ExternalLink, ThumbsDown, X } from 'lucide-react';
import { useT } from '../i18n';
import { getApiBaseUrl } from '../utils/api';

/**
 * An item's card (owner, Nov 15 2026; roadmap item 30, step 2), beside the quest log, over the conversation: its
 * picture (a wiki picture checked to show the item, copied to our server; itemCards.ts), its rarity in loot colors,
 * what it does, where and how to get it, whether it's missable and what loses it, and a link card to its wiki page
 * (the same card as under answers). Hover shows it, click keeps it; Esc or a click elsewhere closes it.
 */
export type CardItem = {
  id: string; name: string; kind?: string; rarity?: string; why?: string; where?: string; how?: string;
  missable?: boolean; lockout?: string; lost?: string; confirmed?: boolean;
  card?: { rid: string; page?: { url: string; title: string; site: string }; pic?: string };
};

export function ItemCard({ item, anchor, doc, gameKey, color, onClose, onEnter, onLeave }: {
  item: CardItem; anchor: DOMRect; gameKey: string; color: string;
  /** The document the log is in: the panel's, or the popped-out log's window. */
  doc?: Document;
  onClose: () => void; onEnter?: () => void; onLeave?: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const d = doc || document;
  const view = d.defaultView || window;
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.right + 10, top: anchor.top - 8 });
  const [picGone, setPicGone] = useState(false);
  const [reported, setReported] = useState(false);
  // Beside the row: to its right (over the conversation) when there's room, else to its left; never off screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight, vw = view.innerWidth, vh = view.innerHeight;
      const left = anchor.right + 10 + w <= vw - 8 ? anchor.right + 10 : Math.max(8, anchor.left - 10 - w);
      const top = Math.max(8, Math.min(anchor.top - 8, vh - h - 8));
      setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    // The picture loads after the card shows: it's placed again whenever its size changes, so it never runs off screen.
    const ro = new view.ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, item.id, picGone]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    view.addEventListener('keydown', key);
    return () => view.removeEventListener('keydown', key);
  }, [onClose, view]);

  const pic = !picGone && item.card?.pic ? `${getApiBaseUrl()}${item.card.pic}` : '';
  const page = item.card?.page;
  const wrong = async () => {
    setReported(true);
    setPicGone(true);
    try {
      await fetch(`${getApiBaseUrl()}/api/guides/${encodeURIComponent(gameKey)}/card-wrong`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.card?.rid }) });
    } catch { /* the picture is already hidden here */ }
  };

  return createPortal(
    <div ref={ref} role="dialog" aria-label={item.name} data-qc-item-card={item.id} onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[90] w-[300px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#14151e] shadow-[0_12px_40px_rgba(0,0,0,0.55)] animate-in fade-in zoom-in-95 duration-100">
      {pic && (
        <div className="relative bg-[#0c0d13] border-b border-white/[0.06]">
          <img src={pic} alt={item.name} onError={() => setPicGone(true)} className="block mx-auto max-w-full max-h-[170px] object-contain" />
        </div>
      )}
      <div className="px-3.5 pt-3 pb-2.5 flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-bold leading-tight" style={{ color }}>{item.name}</div>
            {(item.rarity || item.kind) && (
              <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ color }}>
                {[item.rarity, item.kind === 'spell' ? t('card.spell') : ''].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t('visual.close')} className="text-zinc-500 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white rounded"><X className="w-3.5 h-3.5" /></button>
        </div>
        {item.why && <p className="text-[12.5px] leading-snug text-zinc-200">{item.why}</p>}
        {(item.where || item.how) && (
          <div className="text-[11.5px] leading-snug text-zinc-400 flex flex-col gap-0.5">
            {item.where && <span><span className="text-zinc-500">{t('card.where')}</span> {item.where}</span>}
            {item.how && <span><span className="text-zinc-500">{t('card.how')}</span> {item.how}</span>}
          </div>
        )}
        {(item.missable || item.lost) && (
          <div className="text-[11.5px] leading-snug text-amber-300/90">
            <span className="mr-1 rounded border border-amber-400/40 bg-amber-400/10 px-1 text-[9.5px] font-bold uppercase tracking-wide text-amber-300">{t('logfacts.missable')}</span>
            {item.lost ? t('logfacts.goneAt', { when: item.lost }) : item.lockout}
          </div>
        )}
        {(item.confirmed === false || (pic && !reported)) && (
          <div className="flex items-center gap-2 pt-0.5">
            {/* How sure we are, quietly (owner, Nov 15 2026): no badge, a footnote only on what isn't checked yet. */}
            {item.confirmed === false && <span className="text-[10.5px] italic text-zinc-500">{t('card.unchecked')}</span>}
            {pic && !reported && (
              <button type="button" onClick={wrong} title={t('card.wrongPicture')} className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
                <ThumbsDown className="w-3 h-3" /> {t('visual.notRight')}
              </button>
            )}
          </div>
        )}
        {reported && <div className="text-[11px] text-zinc-500">{t('visual.thanks')}</div>}
      </div>
      {page && (
        <a href={page.url} target="_blank" rel="noreferrer" data-qc-wiki
          onClick={(e) => { const api = (window as any).electronAPI; if (api?.openExternal) { e.preventDefault(); api.openExternal(page.url); } }}
          className="group flex items-center gap-3 px-3.5 py-2.5 border-t border-white/[0.08] hover:bg-white/[0.04]">
          <span className="shrink-0 w-7 h-7 rounded-lg bg-[var(--accent-color)]/15 text-[var(--accent-color)] flex items-center justify-center"><BookOpen className="w-3.5 h-3.5" /></span>
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="text-[12.5px] text-zinc-100 font-medium truncate group-hover:text-white">{page.title}</span>
            <span className="text-[11px] text-zinc-400 truncate">{t('visual.wikiOpen', { site: page.site })}</span>
          </span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0 text-zinc-500 group-hover:text-[var(--accent-color)]" />
        </a>
      )}
    </div>,
    d.body,
  );
}
