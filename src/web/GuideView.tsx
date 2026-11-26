/**
 * Guide: the game's guide inside the app, opening on the page for where the player is (owner-approved redesign, Nov 25
 * 2026). The website's own pages (app.html beside each page, shown by GuideFragment like the old app's Guide tab), in
 * the app's language where the guide has one. Links between pages open here; "Ask" on a checklist row asks it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MapPin, ExternalLink } from 'lucide-react';
import { GuideFragment, SITE, type GuideTarget } from '../components/GuideFragment';
import { guideApi, type GuideAreaInfo } from '../utils/guideApi';
import { matchGuideArea } from '../utils/guideMatch';
import type { Place } from './webApi';

export function GuideView({ guideKey, lang, place, onAsk }: { guideKey: string; lang: string; place: Place | null; onAsk: (q: string) => void }) {
  const [areas, setAreas] = useState<GuideAreaInfo[] | null>(null);
  const [page, setPage] = useState<{ key: string; slug?: string; anchor?: string } | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  useEffect(() => {
    let alive = true;
    guideApi(`/api/guides/${guideKey}`, lang)
      .then((g) => { if (alive) setAreas(Array.isArray(g?.areas) ? g.areas : []); })
      .catch(() => alive && setAreas([]));
    return () => { alive = false; };
  }, [guideKey, lang]);

  const here = useMemo(() => {
    if (!areas?.length || !place?.name) return null;
    const m = matchGuideArea(areas, String(place.name), place.story ? String(place.story) : undefined);
    return m ? areas[m.index] : null;
  }, [areas, place]);

  // First open: the page for where the player is, else the guide's front page.
  useEffect(() => {
    if (page || areas === null) return;
    setPage(here ? { key: guideKey, slug: here.slug } : { key: guideKey });
  }, [areas, here, page, guideKey]);

  const urls = useMemo(() => {
    if (!page) return [];
    const path = `guides/${page.key}/${page.slug ? `${page.slug}/` : ''}`;
    return lang && lang !== 'en' ? [`${SITE}/${lang}/${path}`, `${SITE}/${path}`] : [`${SITE}/${path}`];
  }, [page, lang]);

  const open = (t: GuideTarget) => {
    setPage({ key: t.key, slug: t.slug, anchor: t.anchor });
    setFocus(t.anchor ? { id: t.anchor, n: Date.now() } : null);
    window.scrollTo({ top: 0 });
  };

  if (!page) return <div className="w-card" style={{ padding: 16, color: 'var(--w-dim)' }}>Opening the guide…</div>;

  const onHere = here && page.key === guideKey && page.slug === here.slug;
  return (
    // minmax(0, 1fr): a wide table or route in the page scrolls inside it instead of widening the column.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {page.slug && <button className="w-chip" onClick={() => open({ key: guideKey })}><ArrowLeft size={14} /> All pages</button>}
        {here && !onHere && <button className="w-chip" onClick={() => open({ key: guideKey, slug: here.slug })}><MapPin size={14} /> Where you are: {here.name}</button>}
        <a className="w-chip" style={{ marginLeft: 'auto', textDecoration: 'none' }} href={urls[urls.length - 1]} target="_blank" rel="noopener noreferrer" aria-label="Open this page on the website"><ExternalLink size={14} /></a>
      </div>
      <GuideFragment
        urls={urls}
        gameKey={page.key}
        slug={page.slug}
        onOpen={open}
        onAsk={onAsk}
        focus={focus}
        fallback={<div className="w-card" style={{ padding: 16, color: 'var(--w-dim)' }}>This page didn't load. <a href={urls[urls.length - 1]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--w-acc)' }}>Open it on the website</a>.</div>}
      />
    </div>
  );
}
