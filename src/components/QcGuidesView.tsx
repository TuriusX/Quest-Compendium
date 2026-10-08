import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, ArrowLeft, Gem, Skull, Sparkles, TriangleAlert, MapPin, Play, MessageCircleQuestion } from './icons';
import { guideApi } from '../utils/guideApi';
import { orderGuides, readRecentGuides, rememberGuideOpened, useGuideIndex, type GuideIndexGame, type GuideSort } from '../utils/guideIndex';
import { GUIDE_DONE_EVENT, readDone, writeDone } from '../utils/guideProgress';
import { useLocale, useT } from '../i18n';
import { tipMatches, useAchievementGuideByKey, type AchievementGuide } from '../utils/achievementGuide';
import { samePlace } from '../utils/placeName';
import { entitySegments, fuzzyScore } from '../../scripts/guides/siteText';
import type { Achievement } from '../types';

/**
 * Quest Compendium's own guides, read natively in the app: all games -> a game's areas -> an area page.
 * Built to be used while playing:
 *   - opens at the running game, at the area the player is in (or where they left off)
 *   - when the player moves somewhere else, a one-tap "You're in …" jump appears (it never yanks the page away)
 *   - each area shows its checklist progress; area pages lead with what can be missed, the rest folds away
 *   - "Ask" on any item or area hands a ready-made question to the Compendium
 * Ticks and the last page are saved on this computer. Every control is a button, so it works with a controller.
 */
type Game = GuideIndexGame;
type Area = { slug: string; name: string; story: string; group?: string; total?: number; search?: string };
type Entry = { id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean; how?: string; lockout?: string };
type Page = {
  key: string; slug: string; name: string; story: string; overview: string;
  items: Entry[]; secrets: Entry[]; enemies: Entry[]; shops: Entry[]; tips: string[];
  /** Sections the sources couldn't fully cover (items, secrets, fights, ...): marked "may be incomplete". */
  incomplete?: string[];
  sections?: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
  fights?: { id: string; name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string }[];
  info?: { region?: string; levels?: string; quests?: string[]; services?: string[]; enemyTypes?: string[]; directions?: string; connected?: string[]; coords?: string };
};
type View = { view: 'games' } | { view: 'game'; key: string; game?: string } | { view: 'area'; key: string; slug: string; game?: string } | { view: 'ach'; key: string; game?: string } | { view: 'entity'; key: string; slug: string; game?: string };
/** A guide's entity page (the compendium), as the guide's area list sends it. */
type Ent = { slug: string; name: string; type: string; region?: string; line?: string };

/**
 * Guide text with mentions of the guide's entity pages as links (a click opens the page; hovering shows its type, region
 * and first line), the same matching as the website (apostrophes optional, whole words).
 */
function Linked({ text, ents, onEntity, self }: { text?: string; ents?: Ent[]; onEntity?: (slug: string) => void; self?: string }) {
  const list = (ents || []).filter((e) => e.slug !== self);
  if (!text) return null;
  if (!list.length || !onEntity) return <>{text}</>;
  return (
    <>
      {entitySegments(text, list).map((sg, i) => {
        if (!sg.slug) return <React.Fragment key={i}>{sg.text}</React.Fragment>;
        const e = list.find((x) => x.slug === sg.slug)!;
        return (
          <button key={i} type="button" onClick={() => onEntity(sg.slug!)} title={`${e.type}${e.region ? ` · ${e.region}` : ''}${e.line ? `\n${e.line}` : ''}`}
            className="inline p-0 m-0 bg-transparent border-0 text-[var(--accent-color)] underline decoration-dotted underline-offset-2 hover:text-white cursor-pointer">
            {sg.text}
          </button>
        );
      })}
    </>
  );
}

// The guide's language follows the app's (a translated guide where one exists, English otherwise). Fetches are shared
// with the objectives tracker (utils/guideApi).
let guideLang = 'en';
const api = (path: string): Promise<any> => guideApi(path, guideLang);
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

export function QcGuidesView({
  gameName,
  place,
  onAsk,
  openRequest,
  achievements,
}: {
  gameName?: string;
  place?: string;
  onAsk?: (question: string) => void;
  /** Open this area (the achievements drawer's "In the guide"), and show one entry in it (a tracker entry's "Open in guide"). */
  openRequest?: { slug: string; entry?: string; n: number } | null;
  /** The player's Steam achievements (unlocked or not), for "Achievements here". */
  achievements?: Achievement[];
}) {
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

  const [focus, setFocus] = useState<{ slug: string; id: string; n: number } | null>(null);
  // A search result: its page (or entity page), at the exact entry (highlighted, its section opened).
  const openHit = (hit: SearchHit, game?: string) => {
    const m = hit.h.match(/\/guides\/([^/]+)\/([^/]+)\/(?:#(.+))?$/);
    if (!m) return;
    const [, k, slug, anchor] = m;
    if (hit.e) return go({ view: 'entity', key: k, slug, game });
    openArea(k, slug, game);
    setFocus(anchor ? { slug, id: anchor.replace(/^e-/, ''), n: Date.now() } : null);
  };
  useEffect(() => {
    if (!openRequest?.slug || !guide) return;
    openArea(guide.key, openRequest.slug, guide.game);
    setFocus(openRequest.entry ? { slug: openRequest.slug, id: openRequest.entry, n: openRequest.n } : null);
  }, [openRequest?.n, guide?.key]);
  // The achievement guide of whichever game's guide is open (by the guide itself, so renamed games still match).
  const viewKey = view.view === 'games' ? guide?.key : view.key;
  const achGuide = useAchievementGuideByKey(viewKey, guideLang);

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
          {view.view === 'games' && (
            <GamesList
              current={guide?.key}
              onPick={(g) => {
                rememberGuideOpened(g.key);
                go({ view: 'game', key: g.key, game: g.game });
              }}
            />
          )}
          {view.view === 'game' && (
            <AreaList
              key={view.key}
              onHit={(hit) => openHit(hit, view.game)}
              onEntity={(slug) => go({ view: 'entity', key: view.key, slug, game: view.game })}
              gameKey={view.key}
              here={hereArea?.slug}
              onPick={(a, game) => go({ view: 'area', key: view.key, slug: a.slug, game })}
              ach={achGuide && achGuide.key === view.key ? achGuide : null}
              achievements={achievements}
              onAchievements={() => go({ view: 'ach', key: view.key, game: view.game })}
            />
          )}
          {view.view === 'ach' && achGuide && achGuide.key === view.key && (
            <AchievementsPage
              ach={achGuide}
              achievements={achievements}
              onArea={(slug) => go({ view: 'area', key: view.key, slug, game: view.game })}
            />
          )}
          {view.view === 'entity' && (
            <EntityPage key={`${view.key}/e/${view.slug}`} gameKey={view.key} slug={view.slug} onEntity={(slug) => go({ view: 'entity', key: view.key, slug, game: view.game })} />
          )}
          {view.view === 'area' && (
            <AreaPage
              onHit={(hit) => openHit(hit, view.game)}
              onEntity={(slug) => go({ view: 'entity', key: view.key, slug, game: view.game })}
              key={`${view.key}/${view.slug}`}
              gameKey={view.key}
              slug={view.slug}
              onAsk={onAsk}
              achHere={achGuide && achGuide.key === view.key ? achGuide.list.filter((a) => a.area === view.slug) : []}
              achievements={achievements}
              focus={focus && focus.slug === view.slug ? focus : null}
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

const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Initials for games without art (the same placeholder as the website). */
const initialsOf = (game: string) =>
  game
    .replace(/[™®©]/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .split(/[\s:–—-]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !/^(of|the|and|a|an|to|in|on|for)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/** A game's store art at Steam's header shape (460×215), with a placeholder underneath if there's none or it fails. */
function GameArt({ game, art, className = '' }: { game: string; art?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative aspect-[460/215] overflow-hidden bg-[#0c0d14] ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[var(--accent-dim)] via-[#1a1530] to-[#0c0d14]">
        <span className="font-bold text-white/80 tracking-wide text-base">{initialsOf(game)}</span>
      </div>
      {art && !failed && <img src={art} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full mb-3 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[var(--accent-border)]"
    />
  );
}

/** A guide's search index (published with the website: guides/{key}/search.json, per language), loaded once. */
type SearchHit = { l: string; k: string; c: string; h: string; p?: number; e?: number };
const searchIndexes = new Map<string, Promise<SearchHit[]>>();
function guideSearchIndex(key: string): Promise<SearchHit[]> {
  const path = `https://questcompendium.com/${guideLang === 'en' ? '' : `${guideLang}/`}guides/${encodeURIComponent(key)}/search.json`;
  if (!searchIndexes.has(path)) {
    const p = fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j) => (Array.isArray(j) ? j : []));
    p.catch(() => searchIndexes.delete(path));
    searchIndexes.set(path, p);
  }
  return searchIndexes.get(path)!;
}

/**
 * The guide-wide search (one per view, the same as the website's): every chapter or area, step, item, secret, shop,
 * enemy, fight and entity page, matched forgivingly (apostrophes, plurals, small typos; exact names first), each result
 * "Name · Type · Chapter". Picking one opens it at the exact entry.
 */
function GuideSearch({ gameKey, value, onChange, onPick }: { gameKey: string; value: string; onChange: (v: string) => void; onPick: (hit: SearchHit) => void }) {
  const t = useT();
  const [index, setIndex] = useState<SearchHit[] | null>(null);
  const load = () => {
    if (!index) guideSearchIndex(gameKey).then(setIndex).catch(() => setIndex([]));
  };
  useEffect(() => {
    if (value) load();
  }, [value]);
  const v = value.trim();
  const hits = v && index ? index.map((x) => ({ x, s: fuzzyScore(v, x.l) })).filter((y) => y.s > 0).map((y) => ({ ...y, s: y.s + (y.x.p ? 0.5 : 0) })).sort((a, b) => b.s - a.s).slice(0, 15) : [];
  return (
    <div className="mb-3">
      <input
        type="search"
        value={value}
        onFocus={load}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('qcg.searchAll')}
        className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-[var(--accent-border)] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[var(--accent-color)]"
      />
      {v && (
        <div className="mt-2 space-y-1">
          {!index && <Note>{t('qcg.loading')}</Note>}
          {index && !hits.length && <Note>{t('qcg.noMatches')}</Note>}
          {hits.map(({ x }, i) => (
            <button key={i} type="button" className={rowCls} onClick={() => onPick(x)}>
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-semibold text-zinc-100">{x.l}</span>
                <span className="text-xs text-[var(--accent-color)]"> · {x.k}</span>
                {x.c && <span className="text-xs text-zinc-500"> · {x.c}</span>}
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500 py-4">{children}</p>;
}

const rowCls =
  'w-full text-left px-3.5 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-[var(--accent-border)] transition-colors cursor-pointer flex items-center gap-3';

function GamesList({ current, onPick }: { current?: string; onPick: (g: Game) => void }) {
  const t = useT();
  // The website's small guide index (kept on this computer, refreshed in the background), not the server's full list.
  const s = useGuideIndex();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<GuideSort>(() => (ls.get('qc-guide-sort') === 'popular' ? 'popular' : 'az'));
  const pickSort = (v: GuideSort) => {
    setSort(v);
    ls.set('qc-guide-sort', v);
  };
  if (!s.games) {
    if (s.loading) return <Note>{t('qcg.loading')}</Note>;
    return (
      <div className="py-4 space-y-3">
        <p className="text-sm text-zinc-400">{t('qcg.loadFailed')}</p>
        <button type="button" onClick={s.retry} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-sm font-semibold text-zinc-100 cursor-pointer">
          {t('qcg.retry')}
        </button>
      </div>
    );
  }
  const games = orderGuides(s.games, { current, recent: readRecentGuides(), sort, q });
  const sortBtn = (v: GuideSort, label: string) => (
    <button
      type="button"
      onClick={() => pickSort(v)}
      aria-pressed={sort === v}
      className={`h-7 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${sort === v ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} placeholder={t('qcg.searchGames')} />
      <div className="flex items-center gap-1.5 -mt-1 mb-1">
        {sortBtn('az', t('qcg.sortAZ'))}
        {sortBtn('popular', t('qcg.sortPopular'))}
      </div>
      {!games.length && <Note>{t('qcg.noMatches')}</Note>}
      {games.map((g) => (
        <button key={g.key} type="button" className={rowCls} onClick={() => onPick(g)}>
          <GameArt game={g.game} art={g.art} className="w-24 flex-shrink-0 rounded-lg" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-zinc-100 truncate">{g.game}</span>
            <span className="block text-xs text-zinc-500">
              {t('qcg.areas', { n: g.areas })}
              {g.checked && g.checked >= g.areas ? <span className="text-emerald-400/90"> · ✓ {t('qcg.checkedGuide')}</span> : null}
            </span>
          </span>
          {g.key === current && <Play className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      ))}
    </div>
  );
}

function AreaList({
  gameKey,
  onHit,
  onEntity,
  here,
  onPick,
  ach,
  achievements = [],
  onAchievements,
}: {
  gameKey: string;
  onHit: (hit: SearchHit) => void;
  onEntity?: (slug: string) => void;
  here?: string;
  onPick: (a: Area, game: string) => void;
  ach?: AchievementGuide | null;
  achievements?: Achievement[];
  onAchievements?: () => void;
}) {
  const t = useT();
  const s = useApi<{ game: string; areas: Area[]; art?: string; entities?: Ent[]; compendium?: { type: string; built: { slug: string; name: string }[]; soon: string[] }[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  const [q, setQ] = useState('');
  // A tapped "coming soon" entry shows the words for a moment (no hover on a touch screen or with a controller).
  const [soonTap, setSoonTap] = useState('');
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data) return <Note>{t('qcg.none')}</Note>;
  const needle = fold(q.trim());
  // Search by area name, story note, or anything on the page (items, secrets, enemies).
  // With a query, the guide-wide results replace the list (GuideSearch); empty, the list is back.
  const areas = needle ? [] : s.data.areas;
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
      {!needle && <GameArt game={s.data.game} art={s.data.art} className="rounded-xl border border-white/10 mb-1" />}
      <GuideSearch gameKey={gameKey} value={q} onChange={setQ} onPick={onHit} />
      {!needle && ach && onAchievements && (
        <button type="button" className={`${rowCls} !border-amber-500/30 !bg-amber-500/[0.07] hover:!bg-amber-500/[0.12]`} onClick={onAchievements}>
          <Sparkles className="w-4 h-4 text-amber-300 flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-zinc-100">{t('ach.guideTitle')}</span>
            <span className="block text-xs text-zinc-400">
              {achievements.length
                ? t('ach.progress', { done: ach.list.filter((x) => achievements.find((a) => a.unlocked && tipMatches(x, a.name))).length, total: ach.list.length })
                : t('ach.count', { n: ach.list.length })}
              {ach.list.some((x) => x.missable) ? ` · ${ach.list.filter((x) => x.missable).length} ${t('ach.missable').toLowerCase()}` : ''}
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      )}
      {!needle && (hereA || cont) && (
        <div className="space-y-2 pb-2">
          {hereA && jump(hereA, <MapPin className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />, t('qcg.whereYouAre'))}
          {cont && jump(cont, <Play className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" />, t('qcg.continue'))}
        </div>
      )}
      {/* The compendium: the guide's entity pages (places, characters, collectibles), by type. */}
      {!needle && !!s.data.compendium?.length && onEntity && (
        <div className="pb-2">
          <h3 className="pt-1 text-xs font-bold uppercase tracking-wide text-zinc-400">{t('qcg.compendium')}</h3>
          {s.data.compendium.some((c) => c.soon.length) && <p className="text-[11px] text-zinc-500">{t('qcg.comingSoonNote')}</p>}
          <div className="mt-2 space-y-2">
            {s.data.compendium.map((c) => (
              <div key={c.type}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-color)]">{c.type}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.built.map((e) => (
                    <button key={e.slug} type="button" onClick={() => onEntity(e.slug)}
                      className="px-2.5 py-1 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-dim)] text-xs font-semibold text-zinc-100 hover:brightness-125 cursor-pointer">
                      {e.name}
                    </button>
                  ))}
                  {c.soon.map((name) => (
                    <span key={name} role="note" aria-disabled="true" title={t('qcg.comingSoon')} onClick={() => { setSoonTap(name); window.setTimeout(() => setSoonTap(''), 1400); }}
                      className="px-2.5 py-1 rounded-lg border border-dashed border-white/10 text-xs text-zinc-500 cursor-help select-none">
                      {soonTap === name ? t('qcg.comingSoon') : name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
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

/** One entity page: its summary box (type, region, where, getting there, what's there, missions) and notes. */
function EntityPage({ gameKey, slug, onEntity }: { gameKey: string; slug: string; onEntity: (slug: string) => void }) {
  const t = useT();
  const s = useApi<any>(`/api/guides/${encodeURIComponent(gameKey)}/entity/${encodeURIComponent(slug)}`);
  const all = useApi<{ entities?: Ent[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  if (s.loading) return <Note>{t('qcg.loading')}</Note>;
  if (s.error || !s.data) return <Note>{t('qcg.none')}</Note>;
  const e = s.data;
  const sm = e.summary || {};
  const ents = all.data?.entities;
  const row = (label: string, body: React.ReactNode) => (body ? <div className="flex gap-3 py-1.5 border-t border-white/5 first:border-0"><dt className="w-28 flex-shrink-0 text-zinc-500">{label}</dt><dd className="min-w-0 text-zinc-200">{body}</dd></div> : null);
  const named = (xs: any[], f: string) => (xs?.length ? <ul className="space-y-1">{xs.map((x, i) => <li key={i}><strong className="text-white">{x.name}</strong>{x[f] ? <span className="text-zinc-400">: {x[f]}</span> : null}</li>)}</ul> : null);
  return (
    <div>
      <span className="inline-block px-2 py-0.5 rounded-md bg-[var(--accent-dim)] text-[11px] font-semibold text-[var(--accent-color)]">{e.type}</span>
      <h2 className="mt-1 text-xl font-bold text-white">{e.name}</h2>
      {e.overview && <p className="mt-2 text-sm leading-relaxed text-zinc-300"><Linked text={e.overview} ents={ents} onEntity={onEntity} self={slug} /></p>}
      <dl className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm">
        {row(t('qcg.infoRegion'), sm.region)}
        {row(t('qcg.entWhere'), sm.where)}
        {row(t('qcg.infoWay'), sm.gettingThere ? <Linked text={sm.gettingThere} ents={ents} onEntity={onEntity} self={slug} /> : null)}
        {row(t('qcg.shops'), named(sm.shops, 'what'))}
        {row(t('qcg.infoServices'), sm.services?.length ? sm.services.join(' · ') : null)}
        {row(t('qcg.entThere'), named(sm.places, 'what'))}
        {row(t('qcg.entCollectibles'), named(sm.collectibles, 'where'))}
        {row(t('qcg.infoQuests'), sm.quests?.length ? <ul className="space-y-1">{sm.quests.map((q: any, i: number) => <li key={i}><strong className="text-white">{q.name}</strong><span className="text-zinc-400">{q.kind ? ` · ${q.kind}` : ''}{q.chapter ? ` · ${q.chapter}` : ''}</span></li>)}</ul> : null)}
      </dl>
      {!!sm.notes?.length && <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">{sm.notes.map((n: string, i: number) => <li key={i} className="flex gap-2"><span className="text-[var(--accent-color)]">•</span><span><Linked text={n} ents={ents} onEntity={onEntity} self={slug} /></span></li>)}</ul>}
    </div>
  );
}

function AreaPage({
  gameKey,
  slug,
  onHit,
  onEntity,
  onGo,
  onAsk,
  achHere = [],
  achievements = [],
  focus,
}: {
  gameKey: string;
  slug: string;
  /** An entry to show: its section opens, it scrolls into view and is highlighted for a moment. ach:<name> = an achievement. */
  focus?: { id: string; n: number } | null;
  onHit: (hit: SearchHit) => void;
  onEntity?: (slug: string) => void;
  onGo: (a: Area) => void;
  onAsk?: (q: string) => void;
  achHere?: { name: string; desc: string; missable?: boolean; how?: string; icon?: string }[];
  achievements?: Achievement[];
}) {
  const t = useT();
  const s = useApi<Page>(`/api/guides/${encodeURIComponent(gameKey)}/${encodeURIComponent(slug)}`);
  const order = useApi<{ areas: Area[]; entities?: Ent[] }>(`/api/guides/${encodeURIComponent(gameKey)}`);
  const [done, setDone] = useState<Set<string>>(() => readDone(gameKey, slug));
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Sections opened to show a focused entry (on top of the ones the player opened or closed).
  const [forced, setForced] = useState<Set<string>>(new Set());
  // The guide-wide search at the top of the page.
  const [q, setQ] = useState('');
  useEffect(() => ls.set(`qc-guide-last:${gameKey}`, slug), [gameKey, slug]);
  // Ticks made on the objectives tracker show here too (and ours show there: writeDone tells everyone).
  useEffect(() => {
    const onDone = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.key === gameKey && d.slug === slug) setDone(readDone(gameKey, slug));
    };
    window.addEventListener(GUIDE_DONE_EVENT, onDone);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, onDone);
  }, [gameKey, slug]);
  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    writeDone(gameKey, slug, next);
  };
  const flip = (k: string) => {
    if (forced.has(k)) {
      // Opened for a focused entry: closing it is the player's call from now on.
      setForced((p) => new Set([...p].filter((x) => x !== k)));
      setOpen((p) => {
        const n = new Set(p);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      });
      return;
    }
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  // A focused entry: open its section, then scroll to it and highlight it for a moment.
  const focusPage = s.data;
  useEffect(() => {
    if (!focus || !focusPage) return;
    const id = focus.id;
    const key = id.startsWith('ach:')
      ? 'achievements'
      : focusPage.items.some((e) => e.id === id && !e.missable)
        ? 'items'
        : focusPage.secrets.some((e) => e.id === id)
          ? 'secrets'
          : (focusPage.sections || []).find((x) => x.entries.some((e) => e.id === id) && !(x.check && /miss/i.test(x.title)))?.title;
    if (key) setForced((p) => new Set([...p, ['achievements', 'items', 'secrets'].includes(key) ? key : `s:${key}`]));
    const t = setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[data-entry]')].find((x) => x.dataset.entry === id);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const flash = ['ring-2', 'ring-[var(--accent-color)]', 'rounded-lg', 'bg-white/[0.06]'];
      el.classList.add(...flash);
      setTimeout(() => el.classList.remove(...flash), 2400);
    }, 120);
    return () => clearTimeout(t);
  }, [focus?.n, !!focusPage]);
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
    <div key={id} data-entry={id} className="group flex items-start gap-1">
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
    const isOpen = forced.has(k) || open.has(k) !== startOpen;
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
          <span className="flex-1 text-sm font-bold text-white">
            {title}
            {(pg.incomplete || []).includes(k) && (
              <span title={t('qcg.incompleteHint')} className="ml-2 align-middle rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-200">{t('qcg.incomplete')}</span>
            )}
          </span>
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
        {/* The exact final step, and what locks a missable out. */}
        {e.how && <span className="block text-zinc-400 mt-0.5">{t('qcg.how')}: {e.how}</span>}
        {e.lockout && <span className="block text-amber-300/90 mt-0.5">{t('qcg.lockout')}: {e.lockout}</span>}
      </>,
      t('qcg.askItem', { item: e.name || '', area: pg.name }),
    );

  return (
    <div>
      <GuideSearch gameKey={gameKey} value={q} onChange={setQ} onPick={(hit) => { setQ(''); onHit(hit); }} />
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
      {pg.overview && <p className="mt-3 text-sm leading-relaxed text-zinc-300"><Linked text={pg.overview} ents={order.data?.entities} onEntity={onEntity} /></p>}
      {/* The summary box: what this place is and how to get there. */}
      {pg.info && (pg.info.region || pg.info.directions || pg.info.connected?.length || pg.info.quests?.length || pg.info.services?.length || pg.info.enemyTypes?.length || pg.info.levels || pg.info.coords) && (
        <dl className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
          {([
            ['qcg.infoRegion', pg.info.region],
            ['qcg.infoLevels', pg.info.levels],
            ['qcg.infoWay', pg.info.directions ? `${pg.info.directions}${pg.info.coords ? ` (${pg.info.coords})` : ''}` : pg.info.coords],
            ['qcg.infoConnected', pg.info.connected?.join(', ')],
            ['qcg.infoQuests', pg.info.quests?.join(' · ')],
            ['qcg.infoServices', pg.info.services?.join(' · ')],
            ['qcg.infoEnemies', pg.info.enemyTypes?.join(' · ')],
          ] as const).map(([k, v]) =>
            v ? (
              <div key={k} className="flex gap-2 py-0.5">
                <dt className="w-24 shrink-0 text-zinc-500">{t(k)}</dt>
                <dd className="min-w-0 text-zinc-200">{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}

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

      {achHere.length > 0 &&
        fold(
          'achievements',
          t('qcg.achHere'),
          <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />,
          <div className="space-y-1.5">
            {achHere
              .slice()
              .sort((a, b) => Number(!!b.missable) - Number(!!a.missable))
              .map((a) => {
                const mine = achievements.find((x) => tipMatches(a as any, x.name));
                return (
                  <div key={a.name} data-entry={`ach:${a.name}`} className={`px-3 py-2 rounded-lg bg-white/[0.03] text-sm ${mine?.unlocked ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{mine?.unlocked ? '✓ ' : ''}{a.name}</span>
                      {a.missable && !mine?.unlocked && <span className="text-[10px] font-bold uppercase text-amber-300">{t('ach.missable')}</span>}
                    </div>
                    {a.how && <p className="text-xs text-zinc-400 mt-0.5">{a.how}</p>}
                  </div>
                );
              })}
          </div>,
          achHere.length ? achHere.filter((a) => achievements.find((x) => tipMatches(a as any, x.name))?.unlocked).length : undefined,
          achHere.length,
          achHere.some((a) => a.missable && !achievements.find((x) => tipMatches(a as any, x.name))?.unlocked),
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
      {(pg.fights || []).length > 0 &&
        fold(
          'fights',
          t('qcg.fights'),
          <Skull className="w-4 h-4 text-[var(--accent-color)]" />,
          <div className="space-y-1.5">
            {(pg.fights || []).map((f) => (
              <div key={f.id} id={`qc-entry-${f.id}`} className="px-3 py-2 rounded-lg bg-white/[0.03] text-sm text-zinc-300">
                <div className="flex items-start gap-2">
                  <span className="flex-1 font-semibold text-zinc-100">{f.name}</span>
                  {onAsk && (
                  <button
                    onClick={() => ask(t('qcg.askFight', { fight: f.name, area: pg.name }))}
                    className="shrink-0 text-xs text-[var(--accent-color)] hover:underline"
                  >
                    {t('qcg.ask')}
                  </button>
                  )}
                </div>
                {([['fightEnemies', f.enemies], ['fightThreats', f.threats], ['fightWeak', f.weaknesses], ['fightTactics', f.tactics], ['fightRewards', f.rewards]] as const).map(
                  ([k, v]) =>
                    v && (
                      <p key={k} className="mt-1">
                        <span className="text-zinc-500">{t(`qcg.${k}`)}:</span> {v}
                      </p>
                    ),
                )}
              </div>
            ))}
          </div>,
          undefined,
          undefined,
          true,
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
          <ul className="list-disc pl-6 space-y-1 text-sm text-zinc-300">{pg.tips.map((tip, i) => <li key={i}><Linked text={tip} ents={order.data?.entities} onEntity={onEntity} /></li>)}</ul>,
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

/** A game's achievement guide: roadmap, points of no return, then every achievement with its tip (missable first). */
function AchievementsPage({ ach, achievements = [], onArea }: { ach: AchievementGuide; achievements?: Achievement[]; onArea: (slug: string) => void }) {
  const t = useT();
  const [onlyMissable, setOnlyMissable] = useState(false);
  const [q, setQ] = useState('');
  const r = ach.roadmap || {};
  const mine = (name: string, tipName: string) => achievements.find((a) => tipMatches({ name: tipName, englishName: name } as any, a.name) || tipMatches({ name, englishName: tipName } as any, a.name));
  const list = ach.list
    .slice()
    .sort((x, y) => Number(!!y.missable) - Number(!!x.missable) || (y.rarity ?? 0) - (x.rarity ?? 0))
    .filter((x) => !onlyMissable || x.missable)
    .filter((x) => !q.trim() || fold(`${x.name} ${x.hidden ? '' : x.desc} ${x.areaName || ''}`).includes(fold(q.trim())));
  const stat = (v: string | undefined, label: string) =>
    v ? (
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="text-base font-bold text-white leading-tight">{v}</div>
        <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
      </div>
    ) : null;
  const unlocked = achievements.length ? ach.list.filter((x) => mine(x.englishName || x.name, x.name)?.unlocked).length : null;
  return (
    <div>
      <h2 className="text-xl font-bold text-white leading-tight">{t('ach.guideTitle')}</h2>
      {unlocked !== null && <p className="text-xs text-zinc-500 mt-1">{t('ach.progress', { done: unlocked, total: ach.list.length })}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {stat(r.time, t('ach.rmTime'))}
        {stat(r.difficulty, t('ach.rmDifficulty'))}
        {stat(r.playthroughs, t('ach.rmPlaythroughs'))}
        {stat(String(ach.list.filter((x) => x.missable).length), t('ach.rmMissables'))}
      </div>
      {!!r.noReturn?.length && (
        <section className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-200">
            <TriangleAlert className="w-4 h-4" />
            {t('ach.rmNoReturn')}
          </h3>
          <ul className="mt-1.5 space-y-1 text-sm text-zinc-200">
            {r.noReturn.map((n, i) => (
              <li key={i}>
                <span className="font-semibold text-white">{n.point}</span>: {n.lost}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!r.steps?.length && (
        <section className="mt-4">
          <h3 className="text-sm font-bold text-white mb-1.5">{t('ach.rmSteps')}</h3>
          <ol className="space-y-1.5">
            {r.steps.map((st, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-300">
                <span className="flex-shrink-0 w-5 h-5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[10px] font-bold text-white flex items-center justify-center">{i + 1}</span>
                <span>{st}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="mt-6 flex items-center gap-2">
        <div className="flex-1">
          <SearchBox value={q} onChange={setQ} placeholder={t('ach.search')} />
        </div>
        {ach.list.some((x) => x.missable) && (
          <button
            type="button"
            onClick={() => setOnlyMissable((v) => !v)}
            aria-pressed={onlyMissable}
            className={`mb-3 h-9 px-3 rounded-xl border text-xs font-semibold cursor-pointer ${onlyMissable ? 'bg-amber-500/20 border-amber-500/40 text-amber-200' : 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'}`}
          >
            {t('ach.filter.missable')}
          </button>
        )}
      </div>
      {!list.length && <Note>{t('qcg.noMatches')}</Note>}
      <div className="space-y-1.5">
        {list.map((x) => {
          const m = mine(x.englishName || x.name, x.name);
          return (
            <div key={x.name} className={`px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 ${m?.unlocked ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-zinc-100">{m?.unlocked ? '✓ ' : ''}{x.name}</span>
                {x.missable && !m?.unlocked && <span className="text-[10px] font-bold uppercase text-amber-300">{t('ach.missable')}</span>}
                {x.rarity != null && <span className="text-[11px] text-zinc-500">{x.rarity}%</span>}
              </div>
              {x.desc && <p className="text-xs text-zinc-400 mt-0.5">{x.desc}</p>}
              {x.how && <p className="text-sm text-zinc-300 mt-1">{x.how}</p>}
              {x.area && (
                <button type="button" onClick={() => onArea(x.area!)} className="mt-1 text-xs font-semibold text-[var(--accent-color)] hover:brightness-125 cursor-pointer">
                  {t('ach.inGuide', { area: x.areaName || x.area })} →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
