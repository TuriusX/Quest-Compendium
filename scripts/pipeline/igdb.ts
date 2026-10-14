/**
 * Game data and images from IGDB (commercial use approved for our Client ID), from IGDB's data dumps, weekly:
 *
 *   1. Each guide's IGDB game: by its Steam app id (external_games, source Steam), else by name (the exact name, then
 *      without an edition suffix like "Complete Edition"), preferring the main game and the most rated; a guide can
 *      pin one with guides/{key}.igdbId.
 *   2. Its metadata (name, first release date, platforms, genres) and images: the cover, the key art (the widest
 *      landscape artwork) and a few screenshots (widest first), saved as guides/{key}.igdb. The site and the app build
 *      IGDB image URLs from the image ids (scripts/guides/igdbArt.ts); a guide IGDB has no art for keeps its Steam art.
 *   3. Its time to beat (the game_time_to_beats endpoint, for the matched games only: it isn't in the dumps), from
 *      players' submissions: main story (hastily), main + extras (normally) and completionist (completely), in whole
 *      hours, with the number of submissions (the site leaves the numbers out below config/igdb.ttbMinCount).
 *
 * Credentials: the Client ID is plain config (env IGDB_CLIENT_ID, or config/igdb.clientId); the Client Secret only
 * reaches the job from Secret Manager (env IGDB_CLIENT_SECRET, secret igdb-client-secret) and is never logged.
 * Runs as a job (weekly from run.ts):
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/igdb.ts --wait
 */
import { db } from '../guides/common';

const API = 'https://api.igdb.com/v4';
const STEAM = 1; // external game source: Steam
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();
const EDITION = /\s+(complete|game of the year|goty|definitive|enhanced|special|deluxe|ultimate|legendary|anniversary|director s cut|remastered|hd)( edition)?$/;
/** A dump date: Unix seconds, or a date string (the CSV dumps write timestamps either way). Unix seconds out, 0 if none. */
const when = (v: string) => { const n = Number(v); if (n > 0) return n; const t = Date.parse(String(v || '')); return Number.isFinite(t) && t > 0 ? Math.round(t / 1000) : 0; };
const ids = (v: string) => String(v || '').replace(/[{}"]/g, '').split(',').map((x) => Number(x)).filter((x) => x > 0);

async function token(clientId: string): Promise<string> {
  const secret = process.env.IGDB_CLIENT_SECRET || '';
  if (!clientId || !secret) throw new Error('IGDB credentials missing (IGDB_CLIENT_ID and the igdb-client-secret secret as IGDB_CLIENT_SECRET)');
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }) });
  if (!r.ok) throw new Error(`Twitch token request failed (${r.status})`);
  return String((await r.json()).access_token || '');
}

/** Streams a dump's CSV rows (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) as objects. */
async function* rows(clientId: string, tok: string, endpoint: string): AsyncGenerator<Record<string, string>> {
  const meta = await fetch(`${API}/dumps/${endpoint}`, { headers: { 'Client-ID': clientId, Authorization: `Bearer ${tok}` } });
  if (!meta.ok) throw new Error(`IGDB dump ${endpoint}: ${meta.status}`);
  const { s3_url } = await meta.json();
  const res = await fetch(String(s3_url));
  if (!res.ok || !res.body) throw new Error(`IGDB dump ${endpoint} download: ${res.status}`);
  const dec = new TextDecoder();
  let head: string[] | null = null;
  let field = '', rec: string[] = [], quoted = false, pendingQuote = false;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    const text = done ? '\n' : dec.decode(value, { stream: true });
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (pendingQuote) { pendingQuote = false; if (c === '"') { field += '"'; continue; } quoted = false; }
      if (quoted) { if (c === '"') pendingQuote = true; else field += c; continue; }
      if (c === '"') { quoted = true; continue; }
      if (c === ',') { rec.push(field); field = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') {
        rec.push(field); field = '';
        if (!head) head = rec; else if (rec.length > 1) { const o: Record<string, string> = {}; head.forEach((h, j) => (o[h] = rec[j] ?? '')); yield o; }
        rec = [];
        continue;
      }
      field += c;
    }
    if (done) break;
  }
}

type Img = { id: string; w: number; h: number; type?: number };
/** IGDB artwork types, best first for a banner: key art with logo, key art without logo, artwork, concept art. Logos,
 * icons, infographics and alternative or historical covers (5-15) are never used as a banner. */
const ART_RANK: Record<number, number> = { 3: 0, 2: 1, 1: 2, 0: 2, 4: 3 };
const best = (xs: Img[], landscape: boolean) => xs.filter((x) => !landscape || x.w >= x.h).sort((a, b) => b.w * b.h - a.w * a.h);
/** Key art for a wide banner: art shaped 1.4:1 to 3.6:1 (largest first), else the widest screenshot, else any landscape art. */
const bannerArt = (arts: Img[], shots: Img[]) => {
  const ratio = (x: Img) => x.w / Math.max(1, x.h);
  const ranked = (xs: Img[]) => best(xs, true).sort((a, b) => (ART_RANK[a.type ?? 1] ?? 9) - (ART_RANK[b.type ?? 1] ?? 9));
  return ranked(arts).find((x) => ratio(x) >= 1.4 && ratio(x) <= 3.6 && x.w >= 1200) || best(shots, true)[0] || ranked(arts).find((x) => ratio(x) >= 1.2) || null;
};

async function main() {
  const cfg: any = (await db().collection('config').doc('igdb').get()).data() || {};
  const clientId = process.env.IGDB_CLIENT_ID || String(cfg.clientId || '');
  const tok = await token(clientId);
  // Read-only look at one guide's artworks with every field the dump has (--inspect <guide key>).
  const inspect = process.argv.includes('--inspect') ? process.argv[process.argv.indexOf('--inspect') + 1] : '';
  if (inspect) {
    const gid = Number(((await db().collection('guides').doc(inspect).get()).data() as any)?.igdb?.id);
    for await (const r of rows(clientId, tok, 'artworks')) if (Number(r.game) === gid) console.log(`igdb-inspect artwork: ${JSON.stringify(r)}`);
    try { for await (const r of rows(clientId, tok, 'artwork_types')) console.log(`igdb-inspect type: ${JSON.stringify(r)}`); } catch (e: any) { console.log(`igdb-inspect: no artwork_types dump (${e?.message})`); }
    return;
  }
  const guides = (await db().collection('guides').get()).docs.filter((d) => !d.id.includes('--')).map((d) => ({ key: d.id, ...(d.data() as any) }));
  const byApp = new Map<string, string[]>(); // Steam app id -> guide keys
  for (const g of guides) if (g.appId) byApp.set(String(g.appId), [...(byApp.get(String(g.appId)) || []), g.key]);
  const pinned = new Map<number, string[]>();
  for (const g of guides) if (g.igdbId) pinned.set(Number(g.igdbId), [...(pinned.get(Number(g.igdbId)) || []), g.key]);
  // 1. Steam app ids.
  const game = new Map<string, number>(); // guide key -> IGDB game id
  const how = new Map<string, string>(); // guide key -> steam | pinned | name
  const steamCands = new Map<string, number[]>(); // guide key -> IGDB games sharing its Steam app id
  for await (const r of rows(clientId, tok, 'external_games')) {
    const src = Number(r.external_game_source || r.category);
    if (src !== STEAM) continue;
    // One Steam app can be several IGDB games (the game, its deluxe edition, a bundle): all kept, the main game chosen below.
    for (const k of byApp.get(String(r.uid)) || []) steamCands.set(k, [...(steamCands.get(k) || []), Number(r.game)]);
  }
  for (const [id, ks] of pinned) for (const k of ks) { game.set(k, id); how.set(k, 'pinned'); }
  // 2. Games: the matched ones' fields, and name candidates for the rest.
  const wantName = new Map<string, string[]>();
  for (const g of guides) if (norm(g.game)) for (const n of [norm(g.game), norm(g.game).replace(EDITION, '')]) if (n) wantName.set(n, [...new Set([...(wantName.get(n) || []), g.key])]);
  const games = new Map<number, any>();
  const cands = new Map<string, any[]>();
  const matched = new Set([...game.values(), ...[...steamCands.values()].flat()]);
  for await (const r of rows(clientId, tok, 'games')) {
    const id = Number(r.id);
    const n = norm(r.name);
    // The name, or the name without its subtitle or "Version" ("Dragon Quest VIII: Journey of the Cursed King",
    // "Pokémon Emerald Version") for a guide named the short way.
    const short = [norm(String(r.name).split(':')[0]), n.replace(/ version$/, '')].find((x) => x !== n && wantName.has(x));
    const keep = matched.has(id) || wantName.has(n) || !!short;
    if (!keep) continue;
    const x = { id, name: r.name, slug: r.slug, first: when(r.first_release_date), platforms: ids(r.platforms), genres: ids(r.genres), cover: Number(r.cover) || 0, artworks: ids(r.artworks), screenshots: ids(r.screenshots), type: Number(r.game_type ?? r.category ?? 0), rated: Number(r.total_rating_count) || 0, n };
    games.set(id, x);
    for (const k of wantName.get(n) || wantName.get(short || '') || []) cands.set(k, [...(cands.get(k) || []), { ...x, n: wantName.has(n) ? n : short, viaShort: !wantName.has(n) }]);
  }
  // The Steam match: the main game among the IGDB games sharing the app id, then the closest name, then the most rated.
  for (const [k, xs] of steamCands) {
    if (game.has(k)) continue; // pinned
    const g = guides.find((x) => x.key === k)!;
    const exact = norm(g.game || ''), bare = exact.replace(EDITION, '');
    const opts = [...new Set(xs)].map((id) => games.get(id)).filter(Boolean) as any[];
    const pick = opts.sort((a, b) => Number(b.type === 0) - Number(a.type === 0) || Number(b.n === exact || b.n === bare) - Number(a.n === exact || a.n === bare) || b.rated - a.rated)[0];
    if (pick) { game.set(k, pick.id); how.set(k, 'steam'); }
  }
  for (const g of guides) {
    const exact = norm(g.game), bare = exact.replace(EDITION, '');
    if (!exact) continue;
    // A Steam match that's a bundle or collection ("Kingdom Hearts HD 1.5 + 2.5 Remix" for Kingdom Hearts Final Mix)
    // gives way to the game with the guide's exact name.
    if (how.get(g.key) === 'steam') {
      const s = games.get(game.get(g.key)!);
      const named = (cands.get(g.key) || []).filter((c) => c.n === exact && c.id !== s?.id).sort((a, b) => Number(!!a.viaShort) - Number(!!b.viaShort) || b.rated - a.rated)[0];
      if (s && s.type !== 0 && s.n !== exact && s.n !== bare && named && !named.viaShort) { game.set(g.key, named.id); how.set(g.key, 'name'); }
      continue;
    }
    if (game.has(g.key)) continue;
    const xs = (cands.get(g.key) || []).sort((a, b) => Number(b.n === exact) - Number(a.n === exact) || Number(!!a.viaShort) - Number(!!b.viaShort) || Number(b.type === 0) - Number(a.type === 0) || b.rated - a.rated);
    if (xs[0] && (xs[0].n === exact || xs[0].n === bare)) { game.set(g.key, xs[0].id); how.set(g.key, 'name'); }
  }
  const need = new Set(game.values());
  // 3. Images and names for platforms and genres.
  const pick = async (endpoint: string) => {
    const out = new Map<number, Img[]>();
    for await (const r of rows(clientId, tok, endpoint)) {
      const gid = Number(r.game);
      if (!need.has(gid) || !r.image_id) continue;
      // Transparent or animated artworks are logos and badges, not banner art; covers may be either and are kept.
      if (endpoint === 'artworks' && (r.animated === 't' || r.alpha_channel === 't')) continue;
      const type = Number(r.artwork_type) || 0;
      if (endpoint === 'artworks' && !(type in ART_RANK)) continue;
      out.set(gid, [...(out.get(gid) || []), { id: r.image_id, w: Number(r.width) || 0, h: Number(r.height) || 0, ...(endpoint === 'artworks' ? { type } : {}) }]);
    }
    return out;
  };
  const covers = await pick('covers');
  const arts = await pick('artworks');
  const shots = await pick('screenshots');
  const names = async (endpoint: string) => { const m = new Map<number, string>(); for await (const r of rows(clientId, tok, endpoint)) m.set(Number(r.id), r.name); return m; };
  const platforms = await names('platforms');
  const genres = await names('genres');
  // 3b. Time to beat, from the API (200 games a request): seconds in, whole hours out (0 = no time given).
  const ttb = new Map<number, { main: number; extras: number; complete: number; count: number }>();
  const idsNeeded = [...need];
  const hours = (v: unknown) => Math.round((Number(v) || 0) / 3600);
  for (let i = 0; i < idsNeeded.length; i += 200) {
    const chunk = idsNeeded.slice(i, i + 200);
    const r = await fetch(`${API}/game_time_to_beats`, {
      method: 'POST', headers: { 'Client-ID': clientId, Authorization: `Bearer ${tok}`, 'Content-Type': 'text/plain' },
      body: `fields game_id,hastily,normally,completely,count; where game_id = (${chunk.join(',')}); limit 500;`,
    });
    if (!r.ok) { console.log(`igdb: time to beat unavailable (${r.status}); kept as before`); break; }
    for (const x of (await r.json()) as any[]) ttb.set(Number(x.game_id), { main: hours(x.hastily), extras: hours(x.normally), complete: hours(x.completely), count: Number(x.count) || 0 });
    await new Promise((res) => setTimeout(res, 300)); // under IGDB's 4 requests a second
  }
  // 4. Save on each guide.
  let withArt = 0, none: string[] = [];
  for (const g of guides) {
    const id = game.get(g.key);
    const x = id ? games.get(id) : null;
    // update() replaces the whole igdb field, so nothing from an older match lingers.
    if (!x) { none.push(g.game || g.key); await db().collection('guides').doc(g.key).update({ igdb: { id: null, at: Date.now(), missing: true } }); continue; }
    const art = bannerArt(arts.get(x.id) || [], shots.get(x.id) || []);
    const ss = best(shots.get(x.id) || [], true).slice(0, 4);
    const cover = best(covers.get(x.id) || [], false)[0] || null;
    if (art || ss.length || cover) withArt++;
    await db().collection('guides').doc(g.key).update({ igdb: {
      id: x.id, name: x.name, slug: x.slug, url: `https://www.igdb.com/games/${x.slug}`,
      released: x.first ? new Date(x.first * 1000).toISOString().slice(0, 10) : null,
      platforms: x.platforms.map((p: number) => platforms.get(p)).filter(Boolean),
      genres: x.genres.map((p: number) => genres.get(p)).filter(Boolean),
      cover, art, screenshots: ss, matchedBy: how.get(g.key) || 'name', at: Date.now(),
      ...(ttb.has(x.id) ? { ttb: ttb.get(x.id) } : {}),
    } });
  }
  console.log(`igdb: ${guides.length} guide(s): ${guides.length - none.length} matched, ${withArt} with images, ${[...game.values()].filter((id) => ttb.has(id)).length} with time to beat; no IGDB match: ${none.join(', ') || 'none'}.`);
}
main().then(() => process.exit(0), (e) => { console.error('igdb failed:', String(e?.message || e).replace(/client_secret=[^&\s]+/g, 'client_secret=…')); process.exit(1); });
