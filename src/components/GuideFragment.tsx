import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { SPOT_EVENT } from '../utils/spotIt';
import { SITE, guideTarget, absolutize, type GuideTarget } from '../utils/guideSite';
import { compIndex } from '../utils/compIndex';

export { SITE, type GuideTarget };

/**
 * One guide everywhere: the app's Guide tab shows the website's own guide pages. Every publish writes app.html next to
 * each guide page (scripts/guides/publish.ts writeAppFragments): the page's article as the site shows it, with its
 * sections, names, icons, routes and approved pictures. Shown here in a shadow root with the site's stylesheet, so it
 * looks the same and the app's styles never mix with it; parts only the website needs carry qc-site-only and are hidden.
 *
 * The app's own behaviour on top: links to guide pages open here (onOpen), # links scroll, outside links open the
 * browser; the pages are plain reference (no ticks, owner Nov 20 2026); each checklist row gets "Ask" and, in the
 * desktop app, "Spot it". A page that can't be loaded shows `fallback`.
 */
const cache = new Map<string, Promise<string | null>>();

/** A guide page's app.html (in this language, else English), cached for the session. */
export function fetchFragment(urls: string[]): Promise<string | null> {
  const k = urls.join('|');
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      for (const u of urls) {
        try {
          const r = await fetch(`${u}app.html`, { cache: 'no-cache' });
          if (r.ok) return await r.text();
        } catch { /* the next one */ }
      }
      return null;
    })().then((v) => { if (v === null) cache.delete(k); return v; }));
  }
  return cache.get(k)!;
}


/** Banners shown full this session (they stay full until the app restarts). */
const bannerFullNow = new Set<string>();

const STYLE = `
  :host { display: block; color: #e4e4e7; line-height: 1.5; }
  .qc-site-only { display: none !important; }
  /* The route at the top of a walkthrough: the site leaves it out on phones; the app's panel always shows it. */
  .qc-route { display: block !important; }
  article { max-width: none !important; margin: 0 !important; }
  a { cursor: pointer; }
  .qc-acts { display: inline-flex; gap: 2px; margin-left: auto; padding-left: 6px; flex-shrink: 0; align-self: flex-start; }
  .qc-acts button { width: 26px; height: 26px; border-radius: 8px; border: 0; background: transparent; color: #71717a; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; opacity: .6; }
  .qc-acts button:hover, .qc-acts button:focus-visible { opacity: 1; background: rgba(255,255,255,.06); color: #c4b0ff; outline: none; }
  .qc-check:hover .qc-acts button { opacity: 1; }
  .qc-flash { box-shadow: 0 0 0 2px #a87ffb; background: rgba(255,255,255,.06); border-radius: 8px; }
  /* A front page's section menu sticks to the top of the panel (the site's sits under its bar). */
  .qc-ix-menu { top: 0 !important; }
  .qc-ix { margin-left: 0 !important; margin-right: 0 !important; }
  /* The game's banner: full size the first time its guide opens here, a slim strip after (owner, Nov 24 2026, overlay
     audit: fewer rows before the guide). */
  .qc-seen article > div[class*="aspect-[460/215]"] { aspect-ratio: auto !important; height: 64px; }
`;
const ASK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
const SPOT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/></svg>';

export function GuideFragment({
  urls,
  gameKey,
  slug,
  onOpen,
  onAsk,
  focus,
  fallback,
}: {
  /** The page's folder on the website (in the app's language first, then English), each ending in "/". */
  urls: string[];
  gameKey: string;
  /** The page's slug; none for a game's front page. */
  slug?: string;
  onOpen: (t: GuideTarget) => void;
  onAsk?: (question: string) => void;
  /** An entry to show: its fold opens, it scrolls into view and is highlighted for a moment. */
  focus?: { id: string; n: number } | null;
  fallback: React.ReactNode;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading');
  const [html, setHtml] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const cb = useRef({ onOpen, onAsk });
  cb.current = { onOpen, onAsk };

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetchFragment(urls).then((h) => {
      if (!alive) return;
      setHtml(h);
      setState(h ? 'ok' : 'none');
    });
    return () => { alive = false; };
  }, [urls.join('|')]);

  // The page in its shadow root, with the app's buttons.
  useEffect(() => {
    const el = host.current;
    if (!el || !html) return;
    const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
    // The banner full the first time (and for the rest of that session), a strip on later visits.
    const seenKey = `qc-guide-banner-seen:${gameKey || ''}`;
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey) && !bannerFullNow.has(seenKey); } catch { /* private mode: always full */ }
    root.innerHTML = `<link rel="stylesheet" href="${SITE}/assets/site.css"><style>${STYLE}</style><div class="qc-frag${seen ? ' qc-seen' : ''}">${absolutize(html)}</div>`;
    if (!seen && root.querySelector('article > div[class*="aspect-[460/215]"]')) {
      bannerFullNow.add(seenKey);
      try { localStorage.setItem(seenKey, '1'); } catch { /* fine */ }
    }
    const base = urls[0];
    const pageName = root.querySelector('h1')?.textContent?.trim() || '';
    const canSpot = typeof window !== 'undefined' && !!(window as any).electronAPI?.captureFresh;
    const rows = [...root.querySelectorAll<HTMLElement>('.qc-check[data-check]')].filter((l) => !String(l.dataset.check).startsWith('ach:'));
    // Each checklist row: Ask, and Spot it in the desktop app.
    for (const l of rows) {
      const name = (l.querySelector('strong')?.textContent || l.querySelector('span')?.textContent || '').split(/[.:;]/)[0].trim().slice(0, 80);
      if (!name) continue;
      const acts = document.createElement('span');
      acts.className = 'qc-acts';
      if (cb.current.onAsk) acts.insertAdjacentHTML('beforeend', `<button type="button" data-qc-ask title="${tRef.current('qcg.ask')}" aria-label="${tRef.current('qcg.ask')}: ${name.replace(/"/g, '&quot;')}">${ASK}</button>`);
      if (canSpot && slug) acts.insertAdjacentHTML('beforeend', `<button type="button" data-qc-spot title="${tRef.current('tracker.spotIt')}" aria-label="${tRef.current('tracker.spotIt')}: ${name.replace(/"/g, '&quot;')}">${SPOT}</button>`);
      (acts as any).qcName = name;
      if (acts.childElementCount) l.appendChild(acts);
    }
    // A game's front page: its index (the filter; the first chapter opens), as on the site.
    if (!slug) compIndex(root, null);

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-qc-ask],[data-qc-spot]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const row = btn.closest<HTMLElement>('.qc-check[data-check]');
        const name = (btn.parentElement as any)?.qcName || '';
        if (btn.hasAttribute('data-qc-ask')) cb.current.onAsk?.(tRef.current('qcg.askItem', { item: name, area: pageName }));
        else if (row && slug) {
          const where = row.querySelector('strong + span')?.textContent?.replace(/^:\s*/, '') || '';
          window.dispatchEvent(new CustomEvent(SPOT_EVENT, { detail: { id: `g:${slug}:${String(row.dataset.check)}`, label: name, where } }));
        }
        return;
      }
      const a = target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      e.preventDefault();
      if (href.startsWith('#')) {
        const dest = root.getElementById(decodeURIComponent(href.slice(1)));
        if (dest) {
          const fold = dest.closest('details');
          if (fold) (fold as HTMLDetailsElement).open = true;
          dest.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        return;
      }
      const dest = guideTarget(href, base);
      if (!dest) return;
      if ('external' in dest) {
        const api = (window as any).electronAPI;
        if (api?.openExternal) api.openExternal(dest.external);
        else window.open(dest.external, '_blank', 'noopener');
        return;
      }
      cb.current.onOpen(dest);
    };
    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('click', onClick);
    };
  }, [html, gameKey, slug]);

  // A focused entry: open its fold, scroll to it, highlight it for a moment.
  useEffect(() => {
    const root = host.current?.shadowRoot;
    if (!focus || !root || !html) return;
    const timer = setTimeout(() => {
      const el = root.getElementById(focus.id) || root.getElementById(`e-${focus.id}`) || [...root.querySelectorAll<HTMLElement>('[data-check]')].find((x) => String(x.dataset.check).split('+').includes(focus.id)) || null;
      if (!el) return;
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') || null) d.open = true;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('qc-flash');
      setTimeout(() => el.classList.remove('qc-flash'), 2400);
    }, 150);
    return () => clearTimeout(timer);
  }, [focus?.n, html]);

  if (state === 'none') return <>{fallback}</>;
  return (
    <>
      {state === 'loading' && <p className="text-sm text-zinc-500 py-6">{t('qcg.loading')}</p>}
      <div ref={host} data-qc-guide-page hidden={state !== 'ok'} />
    </>
  );
}
