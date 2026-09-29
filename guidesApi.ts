/**
 * Public guides API: the published guide pages as JSON, for apps that show guides natively (the Steam Deck plugin draws
 * them in its own interface, no browser needed). Read-only, no sign-in, published pages only, cached for 10 minutes.
 *
 *   GET /api/guides                    games with published guides: [{ key, game, areas }]
 *   GET /api/guides/find?game=NAME     the guide for a game, matched by name (e.g. the running Steam game)
 *   GET /api/guides/:key               one game's areas in story order: { key, game, areas: [{ slug, name, story }] }
 *   GET /api/guides/:key/:slug         one area page: overview, items, secrets, enemies, shops, tips
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
      .map((o) => ({ slug: o.slug, name: String(published.get(o.slug)?.name || o.name), story: String(published.get(o.slug)?.story || o.story || '') }));
    return areas.length ? { key, game: String(info.game || key), areas } : null;
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
      send(res, g || { key: null });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/guides/:key', async (req, res) => {
    try {
      const g = await gameAreas(gameKey(String(req.params.key)));
      if (!g) return res.status(404).json({ error: 'No guide for this game yet.' });
      send(res, g);
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
        };
      });
      if (!page) return res.status(404).json({ error: 'This page isn\'t available.' });
      send(res, page);
    } catch (e) {
      fail(res, e);
    }
  });
}
