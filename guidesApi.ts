/**
 * Public guides API: the published guide pages as JSON, for apps that show guides natively (the Steam Deck plugin draws
 * them in its own interface, no browser needed). Read-only, no sign-in, published pages only, cached for 10 minutes.
 *
 *   GET /api/guides                    games with published guides: [{ key, game, areas }]
 *   GET /api/guides/find?game=NAME     the guide for a game, matched by name (e.g. the running Steam game)
 *   GET /api/guides/:key               one game's areas in story order: { key, game, areas: [{ slug, name, story }] }
 *   GET /api/guides/:key/:slug         one area page: overview, items, secrets, enemies, shops, tips
 *   GET /api/guides/:key/achievements  the achievement guide (or /api/achievements?game=NAME)
 *   add ?lang=pt (es, pt, de, fr, ru, ja, ko, zh) to get a translated guide where one exists (English otherwise)
 */
import type { Express } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { placeKey } from './src/utils/placeName';

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; data: any }>();
const gameKey = (game: string) =>
  game
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 2000) cache.clear();
  return data;
}

async function gameAreas(key: string) {
  return cached(`game:${key}`, async () => {
    const ref = getFirestore().collection('guides').doc(key);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const info = doc.data() || {};
    const snap = await ref.collection('areas').where('status', '==', 'published').get();
    const published = new Map(snap.docs.map((d) => [d.id, d.data()]));
    const order: { slug: string; name: string; story?: string }[] = Array.isArray(info.areas) ? info.areas : [];
    const areas = order
      .filter((o) => published.has(o.slug))
      .map((o: any) => ({
        slug: o.slug,
        name: String(published.get(o.slug)?.name || o.name),
        story: String(published.get(o.slug)?.story || o.story || ''),
        group: String(o.group || published.get(o.slug)?.group || ''),
        // Words to find the page by in the apps' search boxes: its item, secret and enemy names.
        search: (() => {
          const d: any = published.get(o.slug) || {};
          return [...(d.items || []).map((e: any) => e.name), ...(d.secrets || []).map((e: any) => e.text), ...(d.enemies || []).map((e: any) => e.name)].filter(Boolean).join(' ').slice(0, 600);
        })(),
        // How many checklist entries the page has (items, secrets and checklist sections), for progress like "3/8".
        total: (() => {
          const d: any = published.get(o.slug) || {};
          const sec = (Array.isArray(d.sections) ? d.sections : []).filter((x: any) => x?.check).reduce((n: number, x: any) => n + (x.entries || []).length, 0);
          return (d.items || []).length + (d.secrets || []).length + sec;
        })(),
      }));
    // The game's art: the saved store art (scripts/guides/steam-ids.ts), or Steam's standard header for its app id.
    const art = String(info.art || '') || (info.appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${info.appId}/header.jpg` : '');
    return areas.length ? { key, game: String(info.game || key), layout: String(info.layout || 'area'), art, areas } : null;
  });
}

// ---- translations (scripts/guides/translate-guide.ts saves them at guides/{game}/i18n/{lang}) ----
const LANGS = new Set(['es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh']);
const langOf = (q: unknown) => {
  const l = String(q ?? '').toLowerCase().split(/[-_]/)[0];
  return LANGS.has(l) ? l : '';
};
async function translation(key: string, lang: string): Promise<any | null> {
  if (!lang) return null;
  return cached(`tr:${key}:${lang}`, async () => {
    const d = await getFirestore().collection('guides').doc(key).collection('i18n').doc(lang).get();
    return d.exists ? d.data() : null;
  });
}
/** A game's area list in a language: page names, story notes and section headings translated where available. */
function localizeAreas(g: any, t: any) {
  if (!g || !t) return g;
  return {
    ...g,
    areas: g.areas.map((a: any) => {
      const x = t.areas?.[a.slug];
      return { ...a, name: x?.name || a.name, story: x?.story ?? a.story, group: (a.group && t.groups?.[a.group]) || a.group };
    }),
  };
}
/** An area page in a language (ids, flags and order stay from the original). */
function localizePage(p: any, t: any) {
  const x = t?.areas?.[p.slug];
  if (!x) return p;
  const merge = (list: any[], tl: any[] | undefined) => list.map((e) => ({ ...e, ...Object.fromEntries(Object.entries((tl || []).find((y: any) => y?.id === e.id) || {}).filter(([k, v]) => k !== 'id' && typeof v === 'string' && v.trim())) }));
  return {
    ...p,
    name: x.name || p.name,
    story: x.story ?? p.story,
    overview: x.overview || p.overview,
    items: merge(p.items, x.items),
    secrets: merge(p.secrets, x.secrets),
    enemies: merge(p.enemies, x.enemies),
    shops: merge(p.shops, x.shops),
    fights: merge(p.fights || [], x.fights),
    // The summary box and the way here: the translation's words, the original's levels and coordinates.
    ...(p.info && x.info ? { info: { ...p.info, ...x.info, levels: p.info.levels, coords: p.info.coords } } : {}),
    tips: Array.isArray(x.tips) && x.tips.length === p.tips.length ? x.tips : p.tips,
    sections: p.sections.map((sec: any, i: number) => ({
      ...sec,
      title: x.sections?.[i]?.title || sec.title,
      entries: merge(sec.entries, x.sections?.[i]?.entries),
    })),
  };
}

/** Every game with a published guide (cached): the apps' guide list, and the Discord bot's game autocomplete. */
export function guideList(): Promise<{ key: string; game: string; areas: number; art?: string }[]> {
  return cached('list', async () => {
    const docs = await getFirestore().collection('guides').get();
    const out: { key: string; game: string; areas: number; art?: string }[] = [];
    // A staged rebuild (--next) isn't a guide (scripts/guides/promote.ts). 12 guides at a time: one after another took
    // over 20 seconds with 100+ guides and a cold cache (the apps now read guides/index.json from the website first).
    const keys = docs.docs.map((d) => d.id).filter((k) => !k.endsWith('--next'));
    for (let i = 0; i < keys.length; i += 12) {
      for (const g of await Promise.all(keys.slice(i, i + 12).map((k) => gameAreas(k)))) {
        if (g) out.push({ key: g.key, game: g.game, areas: g.areas.length, art: g.art });
      }
    }
    return out.sort((a, b) => a.game.localeCompare(b.game));
  });
}

/** A guide's published areas in order, by its key (cached): the Discord bot's area autocomplete. */
export async function guideAreasByKey(key: string): Promise<{ game: string; areas: { slug: string; name: string }[] } | null> {
  const g = await gameAreas(key);
  return g ? { game: g.game, areas: g.areas.map((a: any) => ({ slug: a.slug, name: a.name })) } : null;
}

/** One published area page's raw entries, by key and slug (cached): the Discord bot's entry autocomplete. */
export async function guideAreaEntries(key: string, slug: string): Promise<{ id: string; label: string }[]> {
  return cached(`entries:${key}:${slug}`, async () => {
    const d: any = (await getFirestore().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
    if (!d || d.status !== 'published') return [];
    return [
      ...(d.items || []).map((e: any) => ({ id: String(e.id), label: String(e.name || '') })),
      ...(d.secrets || []).map((e: any) => ({ id: String(e.id), label: String(e.text || e.name || '').slice(0, 90) })),
      ...(d.sections || []).filter((x: any) => x.check).flatMap((x: any) => (x.entries || []).map((e: any) => ({ id: String(e.id), label: String(e.text || '').slice(0, 90) }))),
    ].filter((e) => e.id && e.label);
  });
}

export function registerGuidesApi(app: Express): void {
  const send = (res: any, data: any) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  };
  const fail = (res: any, e: any) => {
    console.warn('[guides-api]', e?.message);
    res.status(500).json({ error: 'Guides are unavailable right now.' });
  };

  app.get('/api/guides', async (_req, res) => {
    try {
      send(res, { games: await guideList() });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/guides/find', async (req, res) => {
    try {
      const name = String(req.query.game ?? '').trim().slice(0, 160);
      const g = name ? await gameAreas(gameKey(name)) : null;
      send(res, g ? localizeAreas(g, await translation(g.key, langOf(req.query.lang))) : { key: null });
    } catch (e) {
      fail(res, e);
    }
  });

  // A game's achievement guide (scripts/guides/achievements.ts): Steam's list plus how to get each one, whether it's
  // missable, the guide area it belongs to, and a roadmap. Found by guide key, by Steam app id (so a game Steam has
  // renamed still matches), or by name; ?lang= merges a translation (translate-guide.ts) where one exists.
  const achievementsFor = (key: string) =>
    cached(`ach:${key}`, async () => {
      const d = await getFirestore().collection('guides').doc(key).collection('achievements').doc('main').get();
      return d.exists ? d.data() : null;
    });
  const keyForAppId = (appId: number) =>
    cached(`appid:${appId}`, async () => {
      const q = await getFirestore().collection('guides').where('appId', '==', appId).limit(1).get();
      return q.empty ? null : q.docs[0].id;
    });
  /** The achievement guide in a language: official names and descriptions from Steam, tips and roadmap translated. */
  const localizeAch = (data: any, t: any) => {
    const tr = t?.achievements;
    if (!tr) return data;
    const items = tr.items || {};
    return {
      ...data,
      list: (data.list || []).map((a: any) => {
        const x = items[a.name] || {};
        return { ...a, name: x.name || a.name, desc: x.desc ?? a.desc, how: x.how || a.how, areaName: x.areaName || a.areaName, englishName: a.name };
      }),
      roadmap: tr.roadmap ? { ...data.roadmap, ...tr.roadmap } : data.roadmap,
    };
  };
  // Only for a game whose guide is visible (published pages): an unpublished guide hides its achievement guide too.
  const sendAch = async (res: any, key: string | null, lang: string, notFound404: boolean) => {
    const data = key && (await gameAreas(key)) ? await achievementsFor(key) : null;
    if (!data) return notFound404 ? res.status(404).json({ error: 'No achievement guide for this game yet.' }) : send(res, { key: null });
    send(res, { key, ...localizeAch(data, await translation(key!, lang)) });
  };
  app.get('/api/achievements', async (req, res) => {
    try {
      const appId = Number(req.query.appid) || 0;
      const name = String(req.query.game ?? '').trim().slice(0, 160);
      let key = appId ? await keyForAppId(appId) : null;
      if (!key && name && (await achievementsFor(gameKey(name)))) key = gameKey(name);
      await sendAch(res, key, langOf(req.query.lang), false);
    } catch (e) {
      fail(res, e);
    }
  });
  app.get('/api/guides/:key/achievements', async (req, res) => {
    try {
      await sendAch(res, gameKey(String(req.params.key)), langOf(req.query.lang), true);
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/guides/:key', async (req, res) => {
    try {
      const g = await gameAreas(gameKey(String(req.params.key)));
      if (!g) return res.status(404).json({ error: 'No guide for this game yet.' });
      // The guide's published entity pages (compendium.ts), for the apps' links and their compendium list.
      const entities = (await compendiumOf(g.key)).map((e) => ({ slug: e.slug, name: e.name, type: e.typeLabel, region: e.summary?.region || '', line: String(e.overview || '').split(/(?<=[.!?])\s/)[0] || '' }));
      send(res, { ...localizeAreas(g, await translation(g.key, langOf(req.query.lang))), ...(entities.length ? { entities } : {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  // One entity page (published), for the apps' guide view.
  app.get('/api/guides/:key/entity/:slug', async (req, res) => {
    try {
      const key = gameKey(String(req.params.key));
      const slug = String(req.params.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120);
      const e = (await compendiumOf(key)).find((x) => x.slug === slug);
      if (!e) return res.status(404).json({ error: 'No such page.' });
      send(res, { key, slug: e.slug, name: e.name, type: e.typeLabel, title: e.title, overview: e.overview, summary: e.summary });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/guides/:key/:slug', async (req, res) => {
    try {
      const key = gameKey(String(req.params.key));
      const slug = String(req.params.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120);
      const page = await cached(`area:${key}:${slug}`, async () => {
        const doc = await getFirestore().collection('guides').doc(key).collection('areas').doc(slug).get();
        const a: any = doc.exists ? doc.data() : null;
        if (!a || a.status !== 'published') return null;
        // Sources stay server-side; placeholder values like "Steal: nothing" or "Weakness: N/A" are dropped.
        const blank = (v: unknown) =>
          /^(none|nothing|no|n\/?a|-+|—|unknown|not applicable|nothing to steal|cannot be stolen|can't be stolen|not stealable|no weakness(es)?|none known)$/.test(
            String(v ?? '').trim().toLowerCase().replace(/[.!]+$/, ''),
          ) || !String(v ?? '').trim();
        const clean = (list: any[]) =>
          (Array.isArray(list) ? list : []).map(({ sources, ...rest }) => {
            for (const k of ['weakness', 'steal', 'notes', 'where', 'sells', 'how', 'lockout']) if (k in rest && blank(rest[k])) delete rest[k];
            return rest;
          });
        return {
          key, slug, name: a.name, story: a.story || '', overview: a.overview || '',
          items: clean(a.items), secrets: clean(a.secrets), enemies: clean(a.enemies), shops: clean(a.shops),
          tips: Array.isArray(a.tips) ? a.tips : [],
          // Sections the sources couldn't fully cover: the app marks them "may be incomplete".
          incomplete: Array.isArray(a.incomplete) ? a.incomplete : [],
          // Key fights: bosses and set-piece battles, with what it takes to win them.
          fights: (Array.isArray(a.fights) ? a.fights : []).map(({ sources, updatedFrom, ...x }: any) => x).filter((x: any) => x && x.name),
          // The summary box and the way here (region, levels, quests, services, enemy types, directions, coordinates).
          ...(a.info && typeof a.info === 'object' ? { info: (({ sources, ...x }: any) => x)(a.info) } : {}),
          // Structure-specific sections (a calendar page's deadlines, missable events, social links, activities).
          sections: Array.isArray(a.sections)
            ? a.sections.map((x: any) => ({ title: String(x.title || ''), check: !!x.check, entries: (x.entries || []).map((e: any) => ({ id: String(e.id), text: String(e.text || '') })) }))
            : [],
        };
      });
      if (!page) return res.status(404).json({ error: 'This page isn\'t available.' });
      send(res, localizePage(page, await translation(key, langOf(req.query.lang))));
    } catch (e) {
      fail(res, e);
    }
  });
}

// ---- the guide page for where the player is (used by answers and "Known here") ----

const norm = (x: string) => placeKey(x, ',()');
const loose = (x: string) =>
  norm(x)
    .replace(/[(),]/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'the')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');

/**
 * A guide's published areas in order, with the parts of each page that name sub-locations (entries' "where", shops,
 * section headings): for checking that a place name read off the screen belongs to an area (POST /api/locate-me).
 */
export async function guideAreasWithPages(game: string): Promise<{ areas: { slug: string; name: string; story: string }[]; pages: Record<string, any> } | null> {
  const key = gameKey(game);
  if (!key) return null;
  return cached(`pages:${key}`, async () => {
    const ref = getFirestore().collection('guides').doc(key);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const info = doc.data() || {};
    const snap = await ref.collection('areas').where('status', '==', 'published').get();
    const published = new Map(snap.docs.map((d) => [d.id, d.data() as any]));
    const order: { slug: string; name: string; story?: string }[] = Array.isArray(info.areas) ? info.areas : [];
    const areas = order.filter((o) => published.has(o.slug)).map((o) => ({
      slug: o.slug,
      name: String(published.get(o.slug)?.name || o.name),
      story: String(published.get(o.slug)?.story || o.story || ''),
    }));
    const list = (v: any) => (Array.isArray(v) ? v : []).map((e: any) => ({ id: String(e?.id || ''), name: e?.name, text: e?.text, where: e?.where }));
    const pages: Record<string, any> = {};
    for (const a of areas) {
      const d = published.get(a.slug) || {};
      pages[a.slug] = {
        key, slug: a.slug, name: a.name, story: a.story, overview: '', tips: [],
        items: list(d.items), secrets: list(d.secrets), enemies: list(d.enemies), shops: list(d.shops),
        sections: (Array.isArray(d.sections) ? d.sections : []).map((x: any) => ({ title: String(x?.title || ''), check: !!x?.check, entries: [] })),
      };
    }
    return areas.length ? { areas, pages } : null;
  });
}

/** A guide's published entity pages (guideCompendium/{key}/entities, status published), cached. */
async function compendiumOf(key: string): Promise<any[]> {
  return cached(`compendium:${key}`, async () => {
    const snap = await getFirestore().collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get();
    return snap.docs.map((d) => d.data());
  });
}

// ---- Which guide pages answers may use ----
/**
 * Answers (their prompts, the "From the guide" badge, the new-release rule, the Known here list) only use pages that
 * passed review: "Checked against sources" pages, or pages of a guide whose latest review score meets the minimum
 * (Firestore config/guideGrounding { minScore }, default 75, the review's pass mark), unless the page is waiting for
 * re-verification or the review named it as a problem page. Everything else is left out.
 */
export const GROUNDING_MIN_DEFAULT = 75;
let minCache: { at: number; v: number } | null = null;
export async function groundingMinScore(): Promise<number> {
  if (minCache && Date.now() - minCache.at < 60_000) return minCache.v;
  let v = GROUNDING_MIN_DEFAULT;
  try {
    const d: any = (await getFirestore().collection('config').doc('guideGrounding').get()).data() || {};
    if (Number.isFinite(Number(d.minScore))) v = Math.max(0, Math.min(100, Number(d.minScore)));
  } catch {
    /* default */
  }
  minCache = { at: Date.now(), v };
  return v;
}

/** A guide's latest review: its score and the pages it named as problems. */
export type GuideStanding = { score: number | null; flagged: string[] };
export function standingOf(info: any): GuideStanding {
  const score = Number.isFinite(Number(info?.review?.score)) ? Number(info.review.score) : null;
  const flagged = (Array.isArray(info?.review?.pages) ? info.review.pages : []).map((p: any) => norm(String(p?.name || ''))).filter(Boolean);
  return { score, flagged };
}
/** Whether answers may use this page (see above). */
export function pagePassed(page: any, standing: GuideStanding, minScore: number): boolean {
  if (!page || page.status !== 'published') return false;
  // A flagship page passed its own evidence review, page by page: it stands even when the guide's review failed.
  if (page.flagship && page.verified === true) return true;
  if (page.reverify) return false;
  // A failing guide review overrides an older "checked" flag (careful builds marked whole guides checked, e.g. Trails in
  // the Sky the 2nd Chapter, reviewed at 40).
  if (standing.score !== null && standing.score < minScore) return false;
  if (page.verified === true) return true;
  if (standing.score === null) return false;
  return !standing.flagged.includes(norm(String(page.name || '')));
}
async function guideStanding(key: string): Promise<GuideStanding> {
  return cached(`standing:${key}`, async () => standingOf((await getFirestore().collection('guides').doc(key).get()).data() || {}));
}

/** The names of a game's guide pages that answers may use (for the AI's list of guide areas). */
export async function passedAreaNames(game: string | undefined): Promise<string[]> {
  if (!game) return [];
  try {
    const key = gameKey(game);
    const [minScore, standing] = await Promise.all([groundingMinScore(), guideStanding(key)]);
    return await cached(`passedNames:${key}:${minScore}`, async () => {
      const ref = getFirestore().collection('guides').doc(key);
      const info: any = (await ref.get()).data() || {};
      const snap = await ref.collection('areas').where('status', '==', 'published').get();
      const ok = new Map(snap.docs.filter((d) => pagePassed(d.data(), standing, minScore)).map((d) => [d.id, String(d.data().name || '')]));
      const order: any[] = Array.isArray(info.areas) ? info.areas : [];
      return order.filter((o) => ok.has(o.slug)).map((o) => ok.get(o.slug) || String(o.name || '')).filter(Boolean).slice(0, 300);
    });
  } catch {
    return [];
  }
}

export type GuidePageForPlace = {
  /** The guide and the area page (player corrections are filed under these). */
  key: string;
  slug: string;
  name: string;
  verified: boolean;
  overview: string;
  items: any[]; secrets: any[]; enemies: any[]; shops: any[]; tips: string[];
  sections: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
  /** Key fights (bosses and set-piece battles). */
  fights: { id: string; name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string }[];
  /** The summary box and the way here. */
  info?: { region?: string; levels?: string; quests?: string[]; services?: string[]; enemyTypes?: string[]; directions?: string; connected?: string[]; coords?: string };
  /** A flagship page: written from sources and passed the Pro review, with a walkthrough in play order. */
  flagship?: boolean;
  walkthrough?: { id?: string; title?: string; text?: string }[];
};

/**
 * The published guide page for a place in a game, matched by name: exact first, then with extra detail on either side
 * ("South Figaro" vs "South Figaro, Relic Shop"), then loosely ("Returner Hideout" vs "Returners' Hideout").
 */
export async function guidePageFor(game: string | undefined, place: string | undefined): Promise<GuidePageForPlace | null> {
  if (!game || !place) return null;
  try {
    const key = gameKey(game);
    const g = await gameAreas(key);
    if (!g) return null;
    const p = norm(place);
    const area =
      g.areas.find((a: any) => norm(a.name) === p) ||
      g.areas.find((a: any) => p.startsWith(`${norm(a.name)},`) || norm(a.name).startsWith(`${p},`)) ||
      g.areas.find((a: any) => loose(a.name) === loose(place) || loose(place.split(',')[0]) === loose(a.name));
    if (!area) return null;
    const [minScore, standing] = await Promise.all([groundingMinScore(), guideStanding(key)]);
    return await cached(`page:${key}:${area.slug}:${minScore}`, async () => {
      const doc = await getFirestore().collection('guides').doc(key).collection('areas').doc(area.slug).get();
      const a: any = doc.exists ? doc.data() : null;
      // Only a page that passed review (see pagePassed): anything else never reaches an answer.
      if (!a || !pagePassed(a, standing, minScore)) return null;
      return {
        key,
        slug: area.slug,
        name: String(a.name || area.name),
        // "Checked against sources": its entries are grounding with the "From the guide" badge.
        verified: a.verified === true,
        overview: String(a.overview || ''),
        items: a.items || [], secrets: a.secrets || [], enemies: a.enemies || [], shops: a.shops || [],
        tips: Array.isArray(a.tips) ? a.tips : [],
        sections: Array.isArray(a.sections) ? a.sections : [],
        fights: Array.isArray(a.fights) ? a.fights.filter((x: any) => x && x.name) : [],
        ...(a.info && typeof a.info === 'object' ? { info: a.info } : {}),
        ...(a.flagship ? { flagship: true } : {}),
        ...(Array.isArray(a.walkthrough) && a.walkthrough.length ? { walkthrough: a.walkthrough.slice(0, 30) } : {}),
      };
    });
  } catch {
    return null;
  }
}

const blankish = (v: unknown) =>
  !String(v ?? '').trim() ||
  /^(none|nothing|no|n\/?a|-+|—|unknown|not applicable|nothing to steal|cannot be stolen|can't be stolen|not stealable|no weakness(es)?|none known)$/.test(String(v).trim().toLowerCase().replace(/[.!]+$/, ''));

/** The page as short notes for the AI, kept to a sensible size. */
export function guideNotesForPrompt(pg: GuidePageForPlace): string {
  const lines: string[] = [];
  if (pg.overview) lines.push(pg.overview);
  for (const x of pg.sections) for (const e of x.entries.slice(0, 8)) lines.push(`${x.title}: ${e.text}`);
  for (const e of pg.items.slice(0, 15)) lines.push(`Item: ${e.name}${!blankish(e.where) ? ` (${e.where})` : ''}${!blankish(e.how) ? `; how: ${e.how}` : ''}${e.missable ? ` [missable${!blankish(e.lockout) ? `: ${e.lockout}` : ''}]` : ''}`);
  for (const e of pg.secrets.slice(0, 8)) lines.push(`Secret: ${e.text}`);
  for (const e of pg.enemies.slice(0, 10))
    lines.push(`Enemy: ${e.name}${!blankish(e.weakness) ? `, weak to ${e.weakness}` : ''}${!blankish(e.steal) ? `, steal/drop ${e.steal}` : ''}${!blankish(e.notes) ? ` (${e.notes})` : ''}`);
  for (const e of pg.shops.slice(0, 6)) lines.push(`Shop/NPC: ${e.name}${!blankish(e.sells) ? `: ${e.sells}` : ''}`);
  for (const t of pg.tips.slice(0, 5)) lines.push(`Tip: ${t}`);
  for (const f of (pg.fights || []).slice(0, 4)) lines.push(`Key fight: ${f.name}${f.enemies ? ` (${f.enemies})` : ''}`);
  if (pg.info?.region) lines.push(`Region: ${pg.info.region}${pg.info.levels ? ` (levels ${pg.info.levels})` : ''}`);
  if (pg.info?.directions) lines.push(`Getting there: ${pg.info.directions}${pg.info.coords ? ` (map ${pg.info.coords})` : ''}`);
  if (pg.info?.connected?.length) lines.push(`Connects to: ${pg.info.connected.join(', ')}`);
  if (pg.info?.quests?.length) lines.push(`Quests here: ${pg.info.quests.join('; ')}`);
  const body = lines.map((l) => `- ${l}`).join('\n').slice(0, 2400);
  return pg.verified
    ? `[GUIDE NOTES FOR ${pg.name} (from the Quest Compendium guide, checked against sources): use these]\n${body}`
    : `[GUIDE NOTES FOR ${pg.name} (from the Quest Compendium guide, written from general knowledge and not independently checked): ` +
        'use them for general guidance about this place (what is here, what is easy to miss), but verify exact numbers ' +
        '(weaknesses, stats, prices) before stating them, and trust what is actually on screen over these notes]\n' + body;
}

/** A guide entry an answer used: what the "From the guide" badge links to (the area page, and the entry on it). */
export type GuideRef = { key: string; slug: string; area: string; entry?: string; name: string };

/**
 * Grounding in a checked or flagship page: its verified entries first, each with a short tag, and the model told to
 * prefer them over its own knowledge and to list the tags it used (<qc-guide>). The same size as the plain notes
 * (2,400 characters), so a question costs the same. Returns the prompt text and what each tag stands for.
 */
export function guideGroundingForPrompt(pg: GuidePageForPlace): { text: string; refs: Record<string, GuideRef> } {
  const refs: Record<string, GuideRef> = {};
  const lines: string[] = [];
  let n = 0;
  const tag = (name: string, entry?: string) => {
    const t = `g${++n}`;
    refs[t] = { key: pg.key, slug: pg.slug, area: pg.name, ...(entry ? { entry } : {}), name: String(name || pg.name).slice(0, 80) };
    return `[${t}]`;
  };
  for (const e of pg.items.slice(0, 15))
    lines.push(`${tag(e.name, e.id)} Item: ${e.name}${!blankish(e.where) ? `; where: ${e.where}` : ''}${!blankish(e.how) ? `; how: ${e.how}` : ''}${e.missable ? ` [missable${!blankish(e.lockout) ? `: ${e.lockout}` : ''}]` : ''}`);
  for (const f of (pg.fights || []).slice(0, 4)) lines.push(`${tag(f.name, f.id)} Key fight: ${fightLine(f)}`);
  for (const x of pg.sections) for (const e of x.entries.slice(0, 6)) lines.push(`${tag(e.text.split(/[.:;]/)[0], e.id)} ${x.title}: ${e.text}`);
  for (const e of pg.secrets.slice(0, 8)) lines.push(`${tag(String(e.text || e.name || '').split(/[.:;]/)[0], e.id)} Secret: ${e.text || e.name}`);
  for (const s of (pg.walkthrough || []).slice(0, 8)) lines.push(`${tag(s.title || pg.name, s.id)} Walkthrough: ${[s.title, s.text].filter(Boolean).join(': ').slice(0, 300)}`);
  if (pg.info?.directions) lines.push(`${tag(pg.name)} Getting there: ${pg.info.directions}${pg.info.coords ? ` (map ${pg.info.coords})` : ''}`);
  if (pg.info?.connected?.length) lines.push(`Connects to: ${pg.info.connected.join(', ')}`);
  for (const e of pg.enemies.slice(0, 8))
    lines.push(`Enemy: ${e.name}${!blankish(e.weakness) ? `, weak to ${e.weakness}` : ''}${!blankish(e.steal) ? `, steal/drop ${e.steal}` : ''}`);
  // Within the same budget as the plain notes: whole lines only, and only the tags that made it in.
  let body = '';
  for (const l of lines) {
    if (body.length + l.length + 3 > 2400) break;
    body += `- ${l}\n`;
  }
  for (const t of Object.keys(refs)) if (!body.includes(`[${t}]`)) delete refs[t];
  const text =
    `[VERIFIED GUIDE ENTRIES FOR ${pg.name} (the Quest Compendium guide, ${pg.flagship ? 'a flagship page written from sources and reviewed' : 'checked against sources'})]\n` +
    'Prefer these over your own knowledge. When one of them answers the question, base the answer on it (its location, ' +
    'its steps, its warnings) and do not contradict it unless the screenshot clearly shows otherwise. Each line starts with its tag.\n' +
    body +
    'If your answer uses any of these entries, end it with one line listing the tags you used, like <qc-guide>["g1","g3"]</qc-guide>. ' +
    'Never mention the tags or this block in the answer text.';
  return { text, refs };
}

/** The <qc-guide> line: the tagged entries the answer used (removed from the text either way). */
export function extractGuideRefs(text: string, refs: Record<string, GuideRef>): { text: string; used: GuideRef[] } {
  let tags: string[] = [];
  const cleaned = text.replace(/(?:```[a-z]*\s*)?<qc-guide>([\s\S]*?)<\/qc-guide>(?:\s*```)?/gi, (_m, inner) => {
    try {
      const v = JSON.parse(String(inner).trim());
      if (Array.isArray(v)) tags.push(...v.map(String));
    } catch {
      tags.push(...String(inner).match(/g\d+/g) || []);
    }
    return '';
  }).replace(/[ \t]*\[g\d+\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  tags = [...new Set(tags)];
  const used = tags.map((t) => refs[t]).filter(Boolean).slice(0, 4);
  return { text: cleaned || text, used };
}

/** A key fight as one line: "Gate defence: enemies Za'Krug, goblin archers; threats …; weak to …; tactics …; rewards …". */
export const fightLine = (f: { name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string }) =>
  [f.name, f.enemies && `enemies ${f.enemies}`, f.threats && `threats ${f.threats}`, f.weaknesses && `weaknesses/resistances ${f.weaknesses}`, f.tactics && `tactics ${f.tactics}`, f.rewards && `rewards ${f.rewards}`].filter(Boolean).join('; ');

const FIGHT = /\b(fight|fights|battle|boss|ambush|defeat|kill|attack|attacks|defend|defenders?|defen[cs]e|enemies|enemy|hostiles?|combat|encounter|raid|assault|siege|horde|wave)\b/i;

/**
 * This area's fights, in full, for a battle plan: every enemy entry (weakness, what to steal, notes), and the sections,
 * tips and secrets about fighting here. The model is told to use their specifics when the screenshot shows a fight.
 * '' when the page has nothing about fights.
 */
export function guideFightNotes(pg: GuidePageForPlace): string {
  const lines: string[] = [];
  for (const f of pg.fights || []) lines.push(`Key fight: ${fightLine(f)}`);
  for (const e of pg.enemies)
    lines.push(`Enemy: ${e.name}${!blankish(e.weakness) ? `; weak to ${e.weakness}` : ''}${!blankish(e.steal) ? `; steal/drop ${e.steal}` : ''}${!blankish(e.notes) ? `; ${e.notes}` : ''}`);
  // A line is about fighting if it says so, or names one of this area's enemies ("Harpy" also finds "Harpies").
  const stems = pg.enemies.map((e) => String(e.name || '').toLowerCase().replace(/(ies|y|es|s)$/, '')).filter((s) => s.length >= 4);
  const aboutFights = (t: string) => FIGHT.test(t) || stems.some((s) => t.toLowerCase().includes(s));
  for (const x of pg.sections) {
    const fightSection = aboutFights(x.title);
    for (const e of x.entries) if (fightSection || aboutFights(e.text)) lines.push(`${x.title}: ${e.text}`);
  }
  for (const t of pg.tips) if (aboutFights(t)) lines.push(`Tip: ${t}`);
  for (const s of pg.secrets) if (aboutFights(String(s.text || ''))) lines.push(`Secret: ${s.text}`);
  if (pg.overview && FIGHT.test(pg.overview)) lines.unshift(`Overview: ${pg.overview}`);
  if (!lines.length) return '';
  return `[GUIDE: FIGHTS AND ENEMIES IN ${pg.name}] If the screenshot shows a fight here, use these specifics (abilities, ` +
    `weaknesses, positions, rewards) in the battle plan and the markers:\n${lines.map((l) => `- ${l}`).join('\n').slice(0, 2400)}`;
}

/** "From the guide" lines for the Known here panel. */
export function guideLinesForPanel(pg: GuidePageForPlace): { kind: string; subject: string; fact: string }[] {
  const out: { kind: string; subject: string; fact: string }[] = [];
  for (const x of pg.sections.filter((s) => s.check)) for (const e of x.entries.slice(0, 6)) out.push({ kind: 'missable', subject: x.title, fact: e.text });
  for (const e of pg.items.slice(0, 12)) out.push({ kind: e.missable ? 'missable' : 'item', subject: String(e.name || ''), fact: blankish(e.where) ? '' : String(e.where) });
  for (const e of pg.secrets.slice(0, 6)) out.push({ kind: 'secret', subject: String(e.text || '').split(/[.:]/)[0].slice(0, 50), fact: String(e.text || '') });
  return out.filter((l) => l.subject);
}
