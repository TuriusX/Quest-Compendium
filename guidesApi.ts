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
    return areas.length ? { key, game: String(info.game || key), layout: String(info.layout || 'area'), areas } : null;
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
    tips: Array.isArray(x.tips) && x.tips.length === p.tips.length ? x.tips : p.tips,
    sections: p.sections.map((sec: any, i: number) => ({
      ...sec,
      title: x.sections?.[i]?.title || sec.title,
      entries: merge(sec.entries, x.sections?.[i]?.entries),
    })),
  };
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
      const list = await cached('list', async () => {
        const docs = await getFirestore().collection('guides').get();
        const out: { key: string; game: string; areas: number }[] = [];
        for (const d of docs.docs) {
          const g = await gameAreas(d.id);
          if (g) out.push({ key: g.key, game: g.game, areas: g.areas.length });
        }
        return out.sort((a, b) => a.game.localeCompare(b.game));
      });
      send(res, { games: list });
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
  // missable, the guide area it belongs to, and a roadmap. By guide key, or by game name for the apps.
  const achievementsFor = (key: string) =>
    cached(`ach:${key}`, async () => {
      const d = await getFirestore().collection('guides').doc(key).collection('achievements').doc('main').get();
      return d.exists ? d.data() : null;
    });
  app.get('/api/achievements', async (req, res) => {
    try {
      const name = String(req.query.game ?? '').trim().slice(0, 160);
      const data = name ? await achievementsFor(gameKey(name)) : null;
      send(res, data ? { key: gameKey(name), ...data } : { key: null });
    } catch (e) {
      fail(res, e);
    }
  });
  app.get('/api/guides/:key/achievements', async (req, res) => {
    try {
      const key = gameKey(String(req.params.key));
      const data = await achievementsFor(key);
      if (!data) return res.status(404).json({ error: 'No achievement guide for this game yet.' });
      send(res, { key, ...data });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/guides/:key', async (req, res) => {
    try {
      const g = await gameAreas(gameKey(String(req.params.key)));
      if (!g) return res.status(404).json({ error: 'No guide for this game yet.' });
      send(res, localizeAreas(g, await translation(g.key, langOf(req.query.lang))));
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
            for (const k of ['weakness', 'steal', 'notes', 'where', 'sells']) if (k in rest && blank(rest[k])) delete rest[k];
            return rest;
          });
        return {
          key, slug, name: a.name, story: a.story || '', overview: a.overview || '',
          items: clean(a.items), secrets: clean(a.secrets), enemies: clean(a.enemies), shops: clean(a.shops),
          tips: Array.isArray(a.tips) ? a.tips : [],
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

const norm = (x: string) => x.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9,()]+/g, ' ').replace(/\s+/g, ' ').trim();
const loose = (x: string) =>
  norm(x)
    .replace(/[(),]/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'the')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');

export type GuidePageForPlace = {
  name: string;
  verified: boolean;
  overview: string;
  items: any[]; secrets: any[]; enemies: any[]; shops: any[]; tips: string[];
  sections: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
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
    return await cached(`page:${key}:${area.slug}`, async () => {
      const doc = await getFirestore().collection('guides').doc(key).collection('areas').doc(area.slug).get();
      const a: any = doc.exists ? doc.data() : null;
      if (!a || a.status !== 'published') return null;
      return {
        name: String(a.name || area.name),
        verified: a.verified !== false,
        overview: String(a.overview || ''),
        items: a.items || [], secrets: a.secrets || [], enemies: a.enemies || [], shops: a.shops || [],
        tips: Array.isArray(a.tips) ? a.tips : [],
        sections: Array.isArray(a.sections) ? a.sections : [],
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
  for (const e of pg.items.slice(0, 15)) lines.push(`Item: ${e.name}${!blankish(e.where) ? ` (${e.where})` : ''}${e.missable ? ' [missable]' : ''}`);
  for (const e of pg.secrets.slice(0, 8)) lines.push(`Secret: ${e.text}`);
  for (const e of pg.enemies.slice(0, 10))
    lines.push(`Enemy: ${e.name}${!blankish(e.weakness) ? `, weak to ${e.weakness}` : ''}${!blankish(e.steal) ? `, steal/drop ${e.steal}` : ''}${!blankish(e.notes) ? ` (${e.notes})` : ''}`);
  for (const e of pg.shops.slice(0, 6)) lines.push(`Shop/NPC: ${e.name}${!blankish(e.sells) ? `: ${e.sells}` : ''}`);
  for (const t of pg.tips.slice(0, 5)) lines.push(`Tip: ${t}`);
  const body = lines.map((l) => `- ${l}`).join('\n').slice(0, 2400);
  return pg.verified
    ? `[GUIDE NOTES FOR ${pg.name} (from the Quest Compendium guide, checked against sources): use these]\n${body}`
    : `[GUIDE NOTES FOR ${pg.name} (from the Quest Compendium guide, written from general knowledge and not independently checked): ` +
        'use them for general guidance about this place (what is here, what is easy to miss), but verify exact numbers ' +
        '(weaknesses, stats, prices) before stating them, and trust what is actually on screen over these notes]\n' + body;
}

/** "From the guide" lines for the Known here panel. */
export function guideLinesForPanel(pg: GuidePageForPlace): { kind: string; subject: string; fact: string }[] {
  const out: { kind: string; subject: string; fact: string }[] = [];
  for (const x of pg.sections.filter((s) => s.check)) for (const e of x.entries.slice(0, 6)) out.push({ kind: 'missable', subject: x.title, fact: e.text });
  for (const e of pg.items.slice(0, 12)) out.push({ kind: e.missable ? 'missable' : 'item', subject: String(e.name || ''), fact: blankish(e.where) ? '' : String(e.where) });
  for (const e of pg.secrets.slice(0, 6)) out.push({ kind: 'secret', subject: String(e.text || '').split(/[.:]/)[0].slice(0, 50), fact: String(e.text || '') });
  return out.filter((l) => l.subject);
}
