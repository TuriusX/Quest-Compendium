/**
 * Game data and images from IGDB (commercial use approved for our Client ID), from IGDB's data dumps, weekly:
 *
 *   1. Each guide's IGDB game: by its Steam app id (external_games, source Steam), else by name (the exact name, then
 *      without an edition suffix like "Complete Edition"), preferring the main game and the most rated; a guide can
 *      pin one with guides/{key}.igdbId.
 *   2. Its metadata (name, first release date, platforms, genres) and images: the cover, the key art (the widest
 *      landscape artwork) and a few screenshots (widest first), saved as guides/{key}.igdb. The site and the app build
 *      IGDB image URLs from the image ids (scripts/guides/igdbArt.ts); a guide IGDB has no art for keeps its Steam art.
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

type Img = { id: string; w: number; h: number };
const best = (xs: Img[], landscape: boolean) => xs.filter((x) => !landscape || x.w >= x.h).sort((a, b) => b.w * b.h - a.w * a.h);
/** Key art for a wide banner: art shaped 1.4:1 to 3.6:1 (largest first), else the widest screenshot, else any landscape art. */
const bannerArt = (arts: Img[], shots: Img[]) => best(arts, true).find((x) => x.w / Math.max(1, x.h) >= 1.4 && x.w / Math.max(1, x.h) <= 3.6) || best(shots, true)[0] || best(arts, true).find((x) => x.w / Math.max(1, x.h) >= 1.2) || null;

async function main() {
  const cfg: any = (await db().collection('config').doc('igdb').get()).data() || {};
  const clientId = process.env.IGDB_CLIENT_ID || String(cfg.clientId || '');
  const tok = await token(clientId);
  const guides = (await db().collection('guides').get()).docs.filter((d) => !d.id.includes('--')).map((d) => ({ key: d.id, ...(d.data() as any) }));
  const byApp = new Map<string, string[]>(); // Steam app id -> guide keys
  for (const g of guides) if (g.appId) byApp.set(String(g.appId), [...(byApp.get(String(g.appId)) || []), g.key]);
  const pinned = new Map<number, string[]>();
  for (const g of guides) if (g.igdbId) pinned.set(Number(g.igdbId), [...(pinned.get(Number(g.igdbId)) || []), g.key]);
  // 1. Steam app ids.
  const game = new Map<string, number>(); // guide key -> IGDB game id
  const how = new Map<string, string>(); // guide key -> steam | pinned | name
  for await (const r of rows(clientId, tok, 'external_games')) {
    const src = Number(r.external_game_source || r.category);
    if (src !== STEAM) continue;
    for (const k of byApp.get(String(r.uid)) || []) if (!game.has(k)) { game.set(k, Number(r.game)); how.set(k, 'steam'); }
  }
  for (const [id, ks] of pinned) for (const k of ks) { game.set(k, id); how.set(k, 'pinned'); }
  // 2. Games: the matched ones' fields, and name candidates for the rest.
  const wantName = new Map<string, string[]>();
  for (const g of guides) if (norm(g.game)) for (const n of [norm(g.game), norm(g.game).replace(EDITION, '')]) if (n) wantName.set(n, [...new Set([...(wantName.get(n) || []), g.key])]);
  const games = new Map<number, any>();
  const cands = new Map<string, any[]>();
  const matched = new Set(game.values());
  for await (const r of rows(clientId, tok, 'games')) {
    const id = Number(r.id);
    const n = norm(r.name);
    // The name, or the name without its subtitle or "Version" ("Dragon Quest VIII: Journey of the Cursed King",
    // "Pokémon Emerald Version") for a guide named the short way.
    const short = [norm(String(r.name).split(':')[0]), n.replace(/ version$/, '')].find((x) => x !== n && wantName.has(x));
    const keep = matched.has(id) || wantName.has(n) || !!short;
    if (!keep) continue;
    const x = { id, name: r.name, slug: r.slug, first: Number(r.first_release_date) || 0, platforms: ids(r.platforms), genres: ids(r.genres), cover: Number(r.cover) || 0, artworks: ids(r.artworks), screenshots: ids(r.screenshots), type: Number(r.game_type ?? r.category ?? 0), rated: Number(r.total_rating_count) || 0, n };
    games.set(id, x);
    for (const k of wantName.get(n) || wantName.get(short || '') || []) cands.set(k, [...(cands.get(k) || []), { ...x, n: wantName.has(n) ? n : short }]);
  }
  for (const g of guides) {
    const exact = norm(g.game), bare = exact.replace(EDITION, '');
    if (!exact) continue;
    // A Steam match that's a bundle or collection ("Kingdom Hearts HD 1.5 + 2.5 Remix" for Kingdom Hearts Final Mix)
    // gives way to the game with the guide's exact name.
    if (how.get(g.key) === 'steam') {
      const s = games.get(game.get(g.key)!);
      const named = (cands.get(g.key) || []).find((c) => c.n === exact && c.id !== s?.id);
      if (s && s.n !== exact && s.n !== bare && named) { game.set(g.key, named.id); how.set(g.key, 'name'); }
      continue;
    }
    if (game.has(g.key)) continue;
    const xs = (cands.get(g.key) || []).sort((a, b) => Number(b.n === exact) - Number(a.n === exact) || Number(b.type === 0) - Number(a.type === 0) || b.rated - a.rated);
    if (xs[0] && (xs[0].n === exact || xs[0].n === bare)) { game.set(g.key, xs[0].id); how.set(g.key, 'name'); }
  }
  const need = new Set(game.values());
  // 3. Images and names for platforms and genres.
  const pick = async (endpoint: string) => {
    const out = new Map<number, Img[]>();
    for await (const r of rows(clientId, tok, endpoint)) {
      const gid = Number(r.game);
      if (!need.has(gid) || !r.image_id) continue;
      out.set(gid, [...(out.get(gid) || []), { id: r.image_id, w: Number(r.width) || 0, h: Number(r.height) || 0 }]);
    }
    return out;
  };
  const covers = await pick('covers');
  const arts = await pick('artworks');
  const shots = await pick('screenshots');
  const names = async (endpoint: string) => { const m = new Map<number, string>(); for await (const r of rows(clientId, tok, endpoint)) m.set(Number(r.id), r.name); return m; };
  const platforms = await names('platforms');
  const genres = await names('genres');
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
    } });
  }
  console.log(`igdb: ${guides.length} guide(s): ${guides.length - none.length} matched, ${withArt} with images; no IGDB match: ${none.join(', ') || 'none'}.`);
}
main().then(() => process.exit(0), (e) => { console.error('igdb failed:', String(e?.message || e).replace(/client_secret=[^&\s]+/g, 'client_secret=…')); process.exit(1); });
