import React, { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronRight, ArrowLeft, Gem, Skull, Sparkles, TriangleAlert } from './icons';
import { getApiBaseUrl } from '../utils/api';
import { useT } from '../i18n';

/**
 * Quest Compendium's own guides, read natively in the app (no web page): all games -> a game's areas -> an area page
 * with checklists. Opens straight to the running game's guide, and to the area the player is in when it's known.
 * Ticks are saved on this computer. Works with mouse and controller (every row is a button).
 */
type Game = { key: string; game: string; areas: number };
type Area = { slug: string; name: string; story: string; group?: string };
type Entry = { id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean };
type Page = {
  key: string; slug: string; name: string; story: string; overview: string;
  items: Entry[]; secrets: Entry[]; enemies: Entry[]; shops: Entry[]; tips: string[];
  sections?: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
};
type View = { view: 'games' } | { view: 'game'; key: string; game?: string } | { view: 'area'; key: string; slug: string; game?: string };

const api = async (path: string) => {
  const res = await fetch(`${getApiBaseUrl()}${path}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};
const norm = (x: string) => x.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9,]+/g, ' ').trim();
const doneKey = (key: string, slug: string) => `qc-guide-done:${key}:${slug}`;
const readDone = (key: string, slug: string) => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(doneKey(key, slug)) || '[]'));
  } catch {
    return new Set<string>();
  }
};

export function QcGuidesView({ gameName, place }: { gameName?: string; place?: string }) {
  const t = useT();
  const [stack, setStack] = useState<View[]>([{ view: 'games' }]);
  const view = stack[stack.length - 1];
  const go = (v: View) => setStack((s) => [...s, v]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // Open straight to the running game's guide, and to the player's current area when it matches a page.
  useEffect(() => {
    if (!gameName) return;
    let alive = true;
    api(`/api/guides/find?game=${encodeURIComponent(gameName)}`)
      .then((g) => {
        if (!alive || !g?.key) return;
        const p = place ? norm(place) : '';
        const here = p ? (g.areas as Area[]).find((a) => norm(a.name) === p || p.startsWith(`${norm(a.name)},`)) : undefined;
        const base: View[] = [{ view: 'games' }, { view: 'game', key: g.key, game: g.game }];
        setStack(here ? [...base, { view: 'area', key: g.key, slug: here.slug, game: g.game }] : base);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameName, place]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0a0b10] custom-scrollbar">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          {stack.length > 1 && (
            <button
              type="button"
              onClick={back}
              className="h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('common.back')}
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />
            <span className="font-fantasy font-bold text-white truncate">{view.view === 'games' ? t('qcg.title') : view.game || t('qcg.title')}</span>
          </div>
        </div>
        {view.view === 'games' && <GamesList onPick={(g) => go({ view: 'game', key: g.key, game: g.game })} />}
        {view.view === 'game' && <AreaList key={view.key} gameKey={view.key} onPick={(a, game) => go({ view: 'area', key: view.key, slug: a.slug, game })} />}
        {view.view === 'area' && (
          <AreaPage
            key={`${view.key}/${view.slug}`}
            gameKey={view.key}
            slug={view.slug}
            onGo={(a) => setStack((s) => [...s.slice(0, -1), { view: 'area', key: view.key, slug: a.slug, game: view.game }])}
          />
        )}
      </div>
    </div>
  );
}

function useApi<T>(path: string) {
  const [s, setS] = useState<{ data?: T; loading: boolean; error?: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    api(path)
      .then((d) => alive && setS({ data: d, loading: false }))
      .catch(() => alive && setS({ loading: false, error: true }));
    return () => {
      alive = false;
    };
  }, [path]);
  return s;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500 py-4">{children}</p>;
}

const rowCls =
  'w-full text-left px-4 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-[var(--accent-border)] transition-colors cursor-pointer flex items-center gap-3';

function GamesList({ onPick }: { onPick: (g: Game) => void }) {
  const t = useT();
  const s = useApi<{ games: Game[] }>('/api/guides');
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data?.games?.length) return <Note>{t('qcg.none')}</Note>;
  return (
    <div className="space-y-2">
      {s.data.games.map((g) => (
        <button key={g.key} type="button" className={rowCls} onClick={() => onPick(g)}>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-zinc-100 truncate">{g.game}</span>
            <span className="block text-xs text-zinc-500">{t('qcg.areas', { n: g.areas })}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      ))}
    </div>
  );
}

function AreaList({ gameKey, onPick }: { gameKey: string; onPick: (a: Area, game: string) => void }) {
  const t = useT();
  const s = useApi<{ game: string; areas: Area[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data) return <Note>{t('qcg.none')}</Note>;
  const areas = s.data.areas;
  return (
    <div className="space-y-2">
      {areas.map((a, i) => (
        <React.Fragment key={a.slug}>
          {/* Chapter and calendar guides: a heading where the group changes (a character, "Calendar", "Reference"). */}
          {a.group && a.group !== areas[i - 1]?.group && <h3 className="pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">{a.group}</h3>}
          <button type="button" className={rowCls} onClick={() => onPick(a, s.data!.game)}>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-zinc-100">{a.name}</span>
              {a.story && <span className="block text-xs text-zinc-500">{a.story}</span>}
            </span>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function AreaPage({ gameKey, slug, onGo }: { gameKey: string; slug: string; onGo: (a: Area) => void }) {
  const t = useT();
  const s = useApi<Page>(`/api/guides/${encodeURIComponent(gameKey)}/${encodeURIComponent(slug)}`);
  const order = useApi<{ areas: Area[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  const [done, setDone] = useState<Set<string>>(() => readDone(gameKey, slug));
  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    try {
      localStorage.setItem(doneKey(gameKey, slug), JSON.stringify([...next]));
    } catch {}
  };
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  const pg = s.data;
  if (s.error || !pg) return <Note>{t('qcg.none')}</Note>;
  const areas = order.data?.areas || [];
  const at = areas.findIndex((a) => a.slug === slug);
  const prev = at > 0 ? areas[at - 1] : null;
  const next = at >= 0 && at < areas.length - 1 ? areas[at + 1] : null;

  const check = (id: string, label: React.ReactNode, key?: string) => (
    <button
      key={key || id}
      type="button"
      onClick={() => toggle(id)}
      className={`w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.05] transition-colors cursor-pointer ${done.has(id) ? 'opacity-50' : ''}`}
      aria-pressed={done.has(id)}
    >
      <span className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${done.has(id) ? 'bg-[var(--accent-color)] border-[var(--accent-color)]' : 'border-white/30'}`}>
        {done.has(id) && <Check className="w-3 h-3 text-black" />}
      </span>
      <span className={`text-sm leading-snug text-zinc-300 ${done.has(id) ? 'line-through' : ''}`}>{label}</span>
    </button>
  );
  const Section = ({ title, icon, count, total, children }: { title: string; icon?: React.ReactNode; count?: number; total?: number; children: React.ReactNode }) => (
    <section className="mt-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-white mb-2">
        {icon}
        {title}
        {total !== undefined && <span className="text-xs font-normal text-zinc-500">{count}/{total}</span>}
      </h3>
      {children}
    </section>
  );
  const nDone = (ids: string[]) => ids.filter((id) => done.has(id)).length;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white">{pg.name}</h2>
      {pg.story && <p className="text-sm text-zinc-500 mt-1">{pg.story}</p>}
      {pg.overview && <p className="mt-4 text-sm leading-relaxed text-zinc-300">{pg.overview}</p>}
      {(pg.sections || []).map((x) => (
        <Section key={x.title} title={x.title} count={x.check ? nDone(x.entries.map((e) => e.id)) : undefined} total={x.check ? x.entries.length : undefined}>
          {x.check ? x.entries.map((e) => check(e.id, e.text)) : <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-300">{x.entries.map((e) => <li key={e.id}>{e.text}</li>)}</ul>}
        </Section>
      ))}
      {pg.items.length > 0 && (
        <Section title={t('qcg.items')} icon={<Gem className="w-4 h-4 text-[var(--accent-color)]" />} count={nDone(pg.items.map((e) => e.id))} total={pg.items.length}>
          {pg.items.map((e) =>
            check(
              e.id,
              <>
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {e.missable && <span className="ml-2 text-[10px] font-bold text-amber-400">{t('qcg.missable')}</span>}
                {e.where && <span className="text-zinc-400">: {e.where}</span>}
              </>,
            ),
          )}
        </Section>
      )}
      {pg.secrets.length > 0 && (
        <Section title={t('qcg.secrets')} icon={<Sparkles className="w-4 h-4 text-[var(--accent-color)]" />} count={nDone(pg.secrets.map((e) => e.id))} total={pg.secrets.length}>
          {pg.secrets.map((e) => check(e.id, e.text))}
        </Section>
      )}
      {pg.enemies.length > 0 && (
        <Section title={t('qcg.enemies')} icon={<Skull className="w-4 h-4 text-[var(--accent-color)]" />}>
          <div className="space-y-2">
            {pg.enemies.map((e) => (
              <div key={e.id} className="px-3 py-2 rounded-lg bg-white/[0.03] text-sm text-zinc-300">
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {e.weakness && <span> · {t('qcg.weak')}: {e.weakness}</span>}
                {e.steal && <span> · {t('qcg.steal')}: {e.steal}</span>}
                {e.notes && <span className="text-zinc-400"> · {e.notes}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {pg.shops.length > 0 && (
        <Section title={t('qcg.shops')}>
          <ul className="space-y-1 text-sm text-zinc-300">
            {pg.shops.map((e) => (
              <li key={e.id}>
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {e.sells && <span className="text-zinc-400">: {e.sells}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {pg.tips.length > 0 && (
        <Section title={t('qcg.tips')} icon={<TriangleAlert className="w-4 h-4 text-[var(--accent-color)]" />}>
          <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-300">
            {pg.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </Section>
      )}
      {(prev || next) && (
        <div className="mt-8 flex justify-between gap-3">
          {prev ? (
            <button type="button" onClick={() => onGo(prev)} className="h-9 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-200 cursor-pointer">
              ← {prev.name}
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button type="button" onClick={() => onGo(next)} className="h-9 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-200 cursor-pointer">
              {next.name} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
