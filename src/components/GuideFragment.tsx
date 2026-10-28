import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { SPOT_EVENT } from '../utils/spotIt';
import { GUIDE_DONE_EVENT, readDone, writeDone } from '../utils/guideProgress';
import { SITE, guideTarget, absolutize, type GuideTarget } from '../utils/guideSite';

export { SITE, type GuideTarget };

/**
 * One guide everywhere: the app's Guide tab shows the website's own guide pages. Every publish writes app.html next to
 * each guide page (scripts/guides/publish.ts writeAppFragments): the page's article as the site shows it, with its
 * sections, names, icons, routes and approved pictures. Shown here in a shadow root with the site's stylesheet, so it
 * looks the same and the app's styles never mix with it; parts only the website needs carry qc-site-only and are hidden.
 *
 * The app's own behaviour on top: links to guide pages open here (onOpen), # links scroll, outside links open the
 * browser; the checkboxes are the app's ticks (synced to the account and the quest log through guideProgress); each
 * checklist row gets "Ask" and, in the desktop app, "Spot it". A page that can't be loaded shows `fallback`.
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
  label:hover .qc-acts button { opacity: 1; }
  .qc-flash { box-shadow: 0 0 0 2px #a87ffb; background: rgba(255,255,255,.06); border-radius: 8px; }
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
  /** The page's slug (ticks are kept per page); none for a game's front page. */
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

  // The page in its shadow root, with the app's ticks and buttons.
  useEffect(() => {
    const el = host.current;
    if (!el || !html) return;
    const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
    root.innerHTML = `<link rel="stylesheet" href="${SITE}/assets/site.css"><style>${STYLE}</style><div class="qc-frag">${absolutize(html)}</div>`;
    const base = urls[0];
    const pageName = root.querySelector('h1')?.textContent?.trim() || '';
    const canSpot = typeof window !== 'undefined' && !!(window as any).electronAPI?.captureFresh;
    const rows = [...root.querySelectorAll<HTMLLabelElement>('label.qc-check[data-check]')].filter((l) => !String(l.dataset.check).startsWith('ach:'));
    // Ticks: the app's (per page), shown on the site's checkboxes; the fold counts follow.
    const paint = () => {
      if (!slug) return;
      const done = readDone(gameKey, slug);
      for (const l of rows) {
        const ids = String(l.dataset.check).split('+');
        const on = ids.every((id) => done.has(id));
        const box = l.querySelector('input');
        if (box) box.checked = on;
        l.classList.toggle('is-done', on);
        const spot = l.querySelector<HTMLElement>('[data-qc-spot]');
        if (spot) spot.hidden = on;
      }
      for (const c of root.querySelectorAll<HTMLElement>('[data-count]')) {
        const ids = String(c.dataset.count).split(',').filter(Boolean);
        c.textContent = `${ids.filter((id) => done.has(id)).length}/${ids.length}`;
      }
    };
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
    paint();

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-qc-ask],[data-qc-spot]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const row = btn.closest<HTMLLabelElement>('label.qc-check');
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
    const onChange = (e: Event) => {
      const box = e.target as HTMLInputElement;
      const row = box.closest<HTMLLabelElement>('label.qc-check[data-check]');
      if (!row || !slug) return;
      const ids = String(row.dataset.check).split('+');
      const done = readDone(gameKey, slug);
      for (const id of ids) box.checked ? done.add(id) : done.delete(id);
      writeDone(gameKey, slug, done);
      paint();
    };
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    // Ticks made elsewhere (the quest log, the tracker) show here too.
    const onDone = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && ((d.key === gameKey && d.slug === slug) || d.key === '*')) paint(); // '*': the playthrough changed
    };
    window.addEventListener(GUIDE_DONE_EVENT, onDone);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      window.removeEventListener(GUIDE_DONE_EVENT, onDone);
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
