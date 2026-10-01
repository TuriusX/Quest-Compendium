import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, ArrowLeft, Gem, Skull, Sparkles, TriangleAlert, MapPin, Play, MessageCircleQuestion } from './icons';
import { getApiBaseUrl } from '../utils/api';
import { useLocale, useT } from '../i18n';

/**
 * Quest Compendium's own guides, read natively in the app: all games -> a game's areas -> an area page.
 * Built to be used while playing:
 *   - opens at the running game, at the area the player is in (or where they left off)
 *   - when the player moves somewhere else, a one-tap "You're in …" jump appears (it never yanks the page away)
 *   - each area shows its checklist progress; area pages lead with what can be missed, the rest folds away
 *   - "Ask" on any item or area hands a ready-made question to the Compendium
 * Ticks and the last page are saved on this computer. Every control is a button, so it works with a controller.
 */
type Game = { key: string; game: string; areas: number };
type Area = { slug: string; name: string; story: string; group?: string; total?: number };
type Entry = { id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean };
type Page = {
  key: string; slug: string; name: string; story: string; overview: string;
  items: Entry[]; secrets: Entry[]; enemies: Entry[]; shops: Entry[]; tips: string[];
  sections?: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
};
type View = { view: 'games' } | { view: 'game'; key: string; game?: string } | { view: 'area'; key: string; slug: string; game?: string };

const cache = new Map<string, Promise<any>>();
// The guide's language follows the app's (a translated guide where one exists, English otherwise).
let guideLang = 'en';
const withLang = (path: string) => (guideLang === 'en' || path === '/api/guides' ? path : `${path}${path.includes('?') ? '&' : '?'}lang=${guideLang}`);
const api = (rawPath: string): Promise<any> => {
  const path = withLang(rawPath);
  if (!cache.has(path)) {
    const p = fetch(`${getApiBaseUrl()}${path}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path)!;
};
const norm = (x: string) => x.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9,]+/g, ' ').trim();
const samePlace = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(`${y},`) || y.startsWith(`${x},`));
};
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const doneKey = (key: string, slug: string) => `qc-guide-done:${key}:${slug}`;
const readDone = (key: string, slug: string) => {
  try {
    return new Set<string>(JSON.parse(ls.get(doneKey(key, slug)) || '[]'));
  } catch {
    return new Set<string>();
  }
};

export function QcGuidesView({ gameName, place, onAsk }: { gameName?: string; place?: string; onAsk?: (question: string) => void }) {
  const t = useT();
  guideLang = useLocale();
  const [stack, setStack] = useState<View[]>([{ view: 'games' }]);
  const [guide, setGuide] = useState<{ key: string; game: string; areas: Area[] } | null>(null);
  const view = stack[stack.length - 1];
  const go = (v: View) => setStack((s) => [...s, v]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const openArea = (key: string, slug: string, game?: string) =>
    setStack([{ view: 'games' }, { view: 'game', key, game }, { view: 'area', key, slug, game }]);

  // The running game's guide: open it at the player's area, else where they left off, else its area list.
  useEffect(() => {
    if (!gameName) return;
    let alive = true;
    api(`/api/guides/find?game=${encodeURIComponent(gameName)}`)
      .then((g) => {
        if (!alive || !g?.key) return;
        setGuide(g);
        const here = place ? (g.areas as Area[]).find((a) => samePlace(a.name, place)) : undefined;
        const last = (g.areas as Area[]).find((a) => a.slug === ls.get(`qc-guide-last:${g.key}`));
        const target = here || last;
        if (target) openArea(g.key, target.slug, g.game);
        else setStack([{ view: 'games' }, { view: 'game', key: g.key, game: g.game }]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameName, guideLang]);

  // The player moved on: offer a jump to their new area instead of moving the page they're reading.
  const hereArea = useMemo(() => (guide && place ? guide.areas.find((a) => samePlace(a.name, place)) : undefined), [guide, place]);
  const showJump = !!hereArea && !(view.view === 'area' && view.key === guide?.key && view.slug === hereArea.slug);

  const title = view.view === 'games' ? t('qcg.title') : view.game || t('qcg.title');
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0b10]">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-white/[0.06] bg-black/20">
        {stack.length > 1 && (
          <button
            type="button"
            onClick={back}
            aria-label={t('common.back')}
            className="h-7 w-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-200 flex items-center justify-center cursor-pointer flex-shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <BookOpen className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />
        <span className="font-fantasy font-bold text-sm text-white truncate">{title}</span>
        {showJump && hereArea && guide && (
          <button
            type="button"
            onClick={() => openArea(guide.key, hereArea.slug, guide.game)}
            className="ml-auto h-7 px-2.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[11px] font-semibold text-zinc-100 hover:brightness-125 flex items-center gap-1.5 cursor-pointer flex-shrink-0 max-w-[55%]"
          >
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{t('qcg.youreIn', { place: hereArea.name })}</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar" data-qc-scroll>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          {view.view === 'games' && <GamesList current={guide?.key} onPick={(g) => go({ view: 'game', key: g.key, game: g.game })} />}
          {view.view === 'game' && (
            <AreaList key={view.key} gameKey={view.key} here={hereArea?.slug} onPick={(a, game) => go({ view: 'area', key: view.key, slug: a.slug, game })} />
          )}
          {view.view === 'area' && (
            <AreaPage
              key={`${view.key}/${view.slug}`}
              gameKey={view.key}
              slug={view.slug}
              onAsk={onAsk}
              onGo={(a) => setStack((s) => [...s.slice(0, -1), { view: 'area', key: view.key, slug: a.slug, game: view.game }])}
            />
          )}
        </div>
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
  }, [path, guideLang]);
  return s;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500 py-4">{children}</p>;
}

const rowCls =
  'w-full text-left px-3.5 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-[var(--accent-border)] transition-colors cursor-pointer flex items-center gap-3';

function GamesList({ current, onPick }: { current?: string; onPick: (g: Game) => void }) {
  const t = useT();
  const s = useApi<{ games: Game[] }>('/api/guides');
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data?.games?.length) return <Note>{t('qcg.none')}</Note>;
  const games = s.data.games.slice().sort((a, b) => (a.key === current ? -1 : b.key === current ? 1 : 0));
  return (
    <div className="space-y-2">
      {games.map((g) => (
        <button key={g.key} type="button" className={rowCls} onClick={() => onPick(g)}>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-zinc-100 truncate">{g.game}</span>
            <span className="block text-xs text-zinc-500">{t('qcg.areas', { n: g.areas })}</span>
          </span>
          {g.key === current && <Play className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      ))}
    </div>
  );
}

function AreaList({ gameKey, here, onPick }: { gameKey: string; here?: string; onPick: (a: Area, game: string) => void }) {
  const t = useT();
  const s = useApi<{ game: string; areas: Area[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data) return <Note>{t('qcg.none')}</Note>;
  const areas = s.data.areas;
  const lastSlug = ls.get(`qc-guide-last:${gameKey}`);
  const cont = areas.find((a) => a.slug === lastSlug && a.slug !== here);
  const hereA = areas.find((a) => a.slug === here);
  const progress = (a: Area) => {
    if (!a.total) return null;
    const d = readDone(gameKey, a.slug).size;
    if (d >= a.total) return <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400"><Check className="w-3.5 h-3.5" /></span>;
    return d ? <span className="text-[11px] font-semibold text-[var(--accent-color)]">{d}/{a.total}</span> : <span className="text-[11px] text-zinc-600">{a.total}</span>;
  };
  const jump = (a: Area, icon: React.ReactNode, label: string) => (
    <button type="button" className={`${rowCls} border-l-2 !border-l-[var(--accent-color)]`} onClick={() => onPick(a, s.data!.game)}>
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-zinc-100 truncate">{a.name}</span>
        <span className="block text-xs text-zinc-500">{label}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-zinc-500" />
    </button>
  );
  return (
    <div className="space-y-2">
      {(hereA || cont) && (
        <div className="space-y-2 pb-2">
          {hereA && jump(hereA, <MapPin className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />, t('qcg.whereYouAre'))}
          {cont && jump(cont, <Play className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />, t('qcg.continue'))}
        </div>
      )}
      {areas.map((a, i) => (
        <React.Fragment key={a.slug}>
          {/* Chapter and calendar guides: a heading where the group changes (a character, "Calendar", "Reference"). */}
          {a.group && a.group !== areas[i - 1]?.group && <h3 className="pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">{a.group}</h3>}
          <button type="button" className={rowCls} onClick={() => onPick(a, s.data!.game)}>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-zinc-100">{a.name}</span>
              {a.story && <span className="block text-xs text-zinc-500 truncate">{a.story}</span>}
            </span>
            {progress(a)}
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function AreaPage({ gameKey, slug, onGo, onAsk }: { gameKey: string; slug: string; onGo: (a: Area) => void; onAsk?: (q: string) => void }) {
  const t = useT();
  const s = useApi<Page>(`/api/guides/${encodeURIComponent(gameKey)}/${encodeURIComponent(slug)}`);
  const order = useApi<{ areas: Area[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  const [done, setDone] = useState<Set<string>>(() => readDone(gameKey, slug));
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => ls.set(`qc-guide-last:${gameKey}`, slug), [gameKey, slug]);
  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    ls.set(doneKey(gameKey, slug), JSON.stringify([...next]));
  };
  const flip = (k: string) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  const pg = s.data;
  if (s.error || !pg) return <Note>{t('qcg.none')}</Note>;
  const areas = order.data?.areas || [];
  const at = areas.findIndex((a) => a.slug === slug);
  const prev = at > 0 ? areas[at - 1] : null;
  const next = at >= 0 && at < areas.length - 1 ? areas[at + 1] : null;
  const n = (ids: string[]) => ids.filter((id) => done.has(id)).length;
  const ask = (q: string) => onAsk?.(q);

  const check = (id: string, label: React.ReactNode, askAbout?: string) => (
    <div key={id} className="group flex items-start gap-1">
      <button
        type="button"
        onClick={() => toggle(id)}
        aria-pressed={done.has(id)}
        className={`flex-1 min-w-0 text-left flex items-start gap-3 px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-colors cursor-pointer ${done.has(id) ? 'opacity-50' : ''}`}
      >
        <span className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${done.has(id) ? 'bg-[var(--accent-color)] border-[var(--accent-color)]' : 'border-white/30'}`}>
          {done.has(id) && <Check className="w-3 h-3 text-black" />}
        </span>
        <span className={`text-sm leading-snug text-zinc-300 ${done.has(id) ? 'line-through' : ''}`}>{label}</span>
      </button>
      {onAsk && askAbout && (
        <button
          type="button"
          onClick={() => ask(askAbout)}
          title={t('qcg.ask')}
          aria-label={`${t('qcg.ask')}: ${askAbout}`}
          className="mt-1 h-7 w-7 flex-shrink-0 rounded-lg text-zinc-500 hover:text-[var(--accent-color)] hover:bg-white/[0.06] flex items-center justify-center cursor-pointer opacity-60 group-hover:opacity-100 focus:opacity-100"
        >
          <MessageCircleQuestion className="w-4 h-4" />
        </button>
      )}
    </div>
  );
  /** A folding section: the header shows its progress; it opens when you want it. */
  const fold = (k: string, title: string, icon: React.ReactNode, body: React.ReactNode, count?: number, total?: number, startOpen = false) => {
    const isOpen = open.has(k) !== startOpen;
    return (
      <section key={k} className="mt-3">
        <button
          type="button"
          onClick={() => flip(k)}
          aria-expanded={isOpen}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-left cursor-pointer"
        >
          {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
          {icon}
          <span className="flex-1 text-sm font-bold text-white">{title}</span>
          {total !== undefined && <span className="text-xs text-zinc-500">{count}/{total}</span>}
        </button>
        {isOpen && <div className="mt-1.5 pl-1">{body}</div>}
      </section>
    );
  };

  const missItems = pg.items.filter((e) => e.missable);
  const otherItems = pg.items.filter((e) => !e.missable);
  const missSec = (pg.sections || []).filter((x) => x.check && /miss/i.test(x.title));
  const otherSec = (pg.sections || []).filter((x) => !missSec.includes(x));
  const missIds = [...missItems.map((e) => e.id), ...missSec.flatMap((x) => x.entries.map((e) => e.id))];
  const itemRow = (e: Entry) =>
    check(
      e.id,
      <>
        <span className="font-semibold text-zinc-100">{e.name}</span>
        {e.where && <span className="text-zinc-400">: {e.where}</span>}
      </>,
      t('qcg.askItem', { item: e.name || '', area: pg.name }),
    );

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white leading-tight">{pg.name}</h2>
          {pg.story && <p className="text-xs text-zinc-500 mt-1">{pg.story}</p>}
        </div>
        {onAsk && (
          <button
            type="button"
            onClick={() => ask(t('qcg.askArea', { area: pg.name }))}
            className="h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-[var(--accent-border)] text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <MessageCircleQuestion className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            {t('qcg.ask')}
          </button>
        )}
      </div>
      {pg.overview && <p className="mt-3 text-sm leading-relaxed text-zinc-300">{pg.overview}</p>}

      {missIds.length > 0 && (
        <section className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-2">
          <h3 className="flex items-center gap-2 px-1.5 pb-1 text-sm font-bold text-amber-200">
            <TriangleAlert className="w-4 h-4" />
            {t('qcg.dontMiss')}
            <span className="text-xs font-normal text-amber-200/70">
              {n(missIds)}/{missIds.length}
            </span>
          </h3>
          {missItems.map(itemRow)}
          {missSec.flatMap((x) => x.entries.map((e) => check(e.id, e.text)))}
        </section>
      )}

      {otherSec.map((x) =>
        fold(
          `s:${x.title}`,
          x.title,
          <ListIcon />,
          x.check ? x.entries.map((e) => check(e.id, e.text)) : <ul className="list-disc pl-6 space-y-1 text-sm text-zinc-300">{x.entries.map((e) => <li key={e.id}>{e.text}</li>)}</ul>,
          x.check ? n(x.entries.map((e) => e.id)) : undefined,
          x.check ? x.entries.length : undefined,
          true,
        ),
      )}
      {otherItems.length > 0 &&
        fold('items', t('qcg.items'), <Gem className="w-4 h-4 text-[var(--accent-color)]" />, otherItems.map(itemRow), n(otherItems.map((e) => e.id)), otherItems.length, !missIds.length)}
      {pg.secrets.length > 0 &&
        fold(
          'secrets',
          t('qcg.secrets'),
          <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />,
          pg.secrets.map((e) => check(e.id, e.text, t('qcg.askSecret', { secret: e.text || '', area: pg.name }))),
          n(pg.secrets.map((e) => e.id)),
          pg.secrets.length,
        )}
      {pg.enemies.length > 0 &&
        fold(
          'enemies',
          t('qcg.enemies'),
          <Skull className="w-4 h-4 text-[var(--accent-color)]" />,
          <div className="space-y-1.5">
            {pg.enemies.map((e) => (
              <div key={e.id} className="px-3 py-2 rounded-lg bg-white/[0.03] text-sm text-zinc-300">
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {e.weakness && <span> · {t('qcg.weak')}: {e.weakness}</span>}
                {e.steal && <span> · {t('qcg.steal')}: {e.steal}</span>}
                {e.notes && <span className="text-zinc-400"> · {e.notes}</span>}
              </div>
            ))}
          </div>,
        )}
      {pg.shops.length > 0 &&
        fold(
          'shops',
          t('qcg.shops'),
          <BookOpen className="w-4 h-4 text-[var(--accent-color)]" />,
          <ul className="space-y-1 text-sm text-zinc-300 px-2">
            {pg.shops.map((e) => (
              <li key={e.id}>
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {e.sells && <span className="text-zinc-400">: {e.sells}</span>}
              </li>
            ))}
          </ul>,
        )}
      {pg.tips.length > 0 &&
        fold(
          'tips',
          t('qcg.tips'),
          <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />,
          <ul className="list-disc pl-6 space-y-1 text-sm text-zinc-300">{pg.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>,
        )}

      {(prev || next) && (
        <div className="mt-6 flex justify-between gap-3">
          {prev ? (
            <button type="button" onClick={() => onGo(prev)} className="h-9 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-200 cursor-pointer truncate max-w-[48%]">
              ← {prev.name}
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button type="button" onClick={() => onGo(next)} className="h-9 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-200 cursor-pointer truncate max-w-[48%]">
              {next.name} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ListIcon = () => <Check className="w-4 h-4 text-[var(--accent-color)]" />;
