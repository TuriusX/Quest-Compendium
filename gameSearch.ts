/**
 * The apps' game search (GET /api/steam/search, kept under its old name so installed desktop apps get it too): every
 * game on every platform from IGDB, plus the Steam store's hits, with the games that have a guide marked (owner, Nov 25
 * 2026: "I do want people to be able to search for more than just the less than 100 games in the guides website"; the
 * Steam store alone never found console games).
 *
 * Same shape as before ({ games: [{ appId, name, headerImage, price }] }) plus genre (platforms · year) and guide.
 * A game IGDB links to Steam keeps its Steam app id (art, achievements, guide matching); a game only IGDB knows gets
 * an id far outside Steam's range (IGDB_ID_BASE + its IGDB id), like the app's own custom games. IGDB down or not set
 * up: the Steam store's results alone, as before.
 *
 * Credentials: the Client ID from env IGDB_CLIENT_ID or config/igdb.clientId; the Client Secret only from Secret
 * Manager (igdb-client-secret, env IGDB_CLIENT_SECRET), never logged. The same ones the pipeline's igdb.ts uses.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { baseGameKey } from './guidesApi';

export const IGDB_ID_BASE = 900_000_000;
const PLATFORM_ORDER = ['PC', 'PS5', 'Series X|S', 'Switch 2', 'Switch', 'PS4', 'XONE', 'Mac', 'iOS', 'Android', 'PS3', 'X360', 'Wii U', '3DS', 'Wii', 'PS2', 'XBOX', 'NGC', 'DS', 'PSP', 'Vita', 'GBA', 'N64', 'PS1', 'SNES', 'GBC', 'GB', 'NES', 'Linux', 'Stadia'];

/**
 * The published guides, for the "guide" marks: the website's guides/index.json (the published list, small and fast)
 * with each guide's Steam app id from Firestore (one read), for ten minutes. Not guidesApi's guide list, which reads
 * every guide's pages and took longer than a search should wait on a fresh server (Nov 25 2026: no marks at all).
 */
type GuideRow = { key: string; base: string; appId: number };
let guideRowsCache: { at: number; rows: Promise<GuideRow[]> } | null = null;
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xv: '15', xvi: '16' };
const nameKey = (name: string) => baseGameKey(name).split('-').map((w) => ROMAN[w] || w).join('-');
function guideRows(): Promise<GuideRow[]> {
  if (guideRowsCache && Date.now() - guideRowsCache.at < 10 * 60_000) return guideRowsCache.rows;
  const rows = (async () => {
    const [index, docs] = await Promise.all([
      fetch('https://questcompendium.com/guides/index.json', { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      getFirestore().collection('guides').select('appId').get().catch(() => null),
    ]);
    const appIds = new Map<string, number>((docs?.docs || []).map((d) => [d.id, Number(d.get('appId')) || 0]));
    return ((index?.games || []) as any[]).map((g) => ({ key: String(g.key), base: nameKey(String(g.game || g.key)), appId: appIds.get(String(g.key)) || 0 }));
  })();
  guideRowsCache = { at: Date.now(), rows };
  rows.then((r) => { if (!r.length) guideRowsCache = null; }).catch(() => { guideRowsCache = null; });
  return rows;
}

/** Loads the guide list in the background (server start), so the first searches can mark the games with a guide. */
export function warmGameSearch(): void {
  void guideRows().catch(() => null);
}
const STEAM_SOURCE = 1;

type Hit = { appId: number; name: string; headerImage?: string; price?: string; genre?: string; guide?: boolean };

let tokenCache: { token: string; until: number; clientId: string } | null = null;
async function igdbAuth(): Promise<{ token: string; clientId: string } | null> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache;
  const secret = process.env.IGDB_CLIENT_SECRET || '';
  if (!secret) return null;
  let clientId = process.env.IGDB_CLIENT_ID || '';
  if (!clientId) clientId = String(((await getFirestore().collection('config').doc('igdb').get()).data() as any)?.clientId || '');
  if (!clientId) return null;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  tokenCache = { token: String(j.access_token || ''), clientId, until: Date.now() + Math.max(60, Number(j.expires_in) - 300) * 1000 };
  return tokenCache.token ? tokenCache : null;
}

const cache = new Map<string, { at: number; games: Hit[] }>();
const CACHE_MS = 6 * 3600_000;
const remember = (q: string, games: Hit[]) => {
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  cache.set(q, { at: Date.now(), games });
};

async function igdbGames(q: string): Promise<Hit[] | null> {
  const auth = await igdbAuth().catch(() => null);
  if (!auth) return null;
  const safe = q.replace(/["\\]/g, ' ').slice(0, 80);
  const FIELDS = 'fields name,first_release_date,game_type,total_rating_count,cover.image_id,platforms.abbreviation,platforms.name,external_games.external_game_source,external_games.category,external_games.uid,version_parent;';
  const query = async (body: string): Promise<any[] | null> => {
    const r = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
      body,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (!r) return null;
    if (r.status === 401) tokenCache = null;
    if (!r.ok) return null;
    return r.json().catch(() => []);
  };
  // IGDB's text search doesn't weigh popularity ("zelda" missed Breath of the Wild, "pokemon" was fan games): the
  // matches players have rated (sorted by how many below), and the plain matches for rare games.
  const [ratedRows, anyRows] = await Promise.all([
    query(`search "${safe}"; ${FIELDS} where version_parent = null & total_rating_count > 5; limit 50;`),
    query(`search "${safe}"; ${FIELDS} where version_parent = null; limit 15;`),
  ]);
  if (!ratedRows && !anyRows) return null;
  const seen = new Set<number>();
  const rows: any[] = [...(ratedRows || []), ...(anyRows || [])].filter((g) => !seen.has(g.id) && (seen.add(g.id), true));
  // Games, expansions and new versions of games; not mods, forks, add-on packs, bundles or updates (IGDB game_type:
  // 1 DLC, 3 bundle, 5 mod, 12 fork, 13 pack, 14 update). The games most players have rated first (fan projects rarely
  // are), the rest in IGDB's own order.
  const SKIP = new Set([1, 3, 5, 12, 13, 14]);
  const kept = rows.filter((g) => !SKIP.has(Number(g.game_type)));
  const rated = (g: any) => (Number(g.total_rating_count) > 2 ? Number(g.total_rating_count) : 0);
  kept.sort((a, b) => rated(b) - rated(a));
  return kept.map((g) => {
    const steam = (g.external_games || []).find((e: any) => Number(e.external_game_source ?? e.category) === STEAM_SOURCE && /^\d+$/.test(String(e.uid || '')));
    const appId = steam ? Number(steam.uid) : IGDB_ID_BASE + Number(g.id);
    const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : 0;
    // The platforms players know first (PC, the current consoles), three at most.
    const all = (g.platforms || []).map((p: any) => String(p.abbreviation || p.name || '')).filter(Boolean);
    const rank = (p: string) => { const i = PLATFORM_ORDER.indexOf(p); return i < 0 ? 99 : i; };
    const plats = [...new Set(all as string[])].sort((a, b) => rank(a) - rank(b)).slice(0, 3).join(', ');
    return {
      appId,
      name: String(g.name || ''),
      headerImage: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : steam ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : undefined,
      genre: [plats, year || ''].filter(Boolean).join(' · ') || undefined,
    };
  }).filter((g) => g.name);
}

/** Steam store hits that aren't a game to ask about. */
const EXTRA = /soundtrack|\bOST\b|artbook|art book|costume|wallpaper|season pass|upgrade pack|\bDLC\b|bonus content/i;

async function steamGames(q: string): Promise<Hit[]> {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=US`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  if (!r || !r.ok) return [];
  const data: any = await r.json().catch(() => ({}));
  return (data.items || []).filter((item: any) => !EXTRA.test(String(item.name || ''))).map((item: any) => ({
    appId: Number(item.id),
    name: String(item.name || ''),
    headerImage: item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
    price: item.price ? (item.price.final / 100).toFixed(2) : 'Free',
    genre: 'PC (Steam)',
  }));
}

const key = (s: string) => s.toLowerCase().replace(/[™®©:'’.\-]/g, '').replace(/\s+/g, ' ').trim();

export async function searchGames(query: string): Promise<Hit[]> {
  const q = String(query || '').trim().slice(0, 80);
  if (!q) return [];
  const k = q.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.games;
  const [igdb, steam] = await Promise.all([igdbGames(q), steamGames(q)]);
  const out: Hit[] = [...(igdb || [])];
  for (const s of steam) {
    const same = out.find((g) => g.appId === s.appId || key(g.name) === key(s.name));
    if (same) { if (same.appId === s.appId && !same.price) same.price = s.price; continue; }
    out.push(s);
  }
  const games = out.slice(0, 16);
  // The guide marks: the same Steam app, or the same name without editions (roman numerals as digits).
  const rows = await guideRows().catch(() => [] as GuideRow[]);
  const marked = rows.length > 0;
  for (const g of games) {
    const steamId = g.appId < IGDB_ID_BASE ? g.appId : 0;
    const base = nameKey(g.name);
    if (rows.some((r) => (steamId && r.appId === steamId) || r.base === base)) g.guide = true;
  }
  // Games with a guide first, otherwise IGDB's order (its relevance) with the Steam store's extras after.
  games.sort((a, b) => Number(!!b.guide) - Number(!!a.guide));
  if (igdb && marked) remember(k, games); // not when IGDB failed or the marks weren't ready: the next search tries again
  return games;
}
