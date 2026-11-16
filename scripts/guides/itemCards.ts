/**
 * Item cards (owner, Nov 15 2026; roadmap item 30, step 2): for each item in an area's "Worth getting here", its wiki
 * page and a quality picture, found once ahead of time, the way visual answers find them (visualAnswer.ts wikiPage and
 * wikiPicture: the wiki page's main picture, big enough, and a vision check that it clearly shows the item itself).
 * The picture is copied to our own store (wikiPics/{hash}, served by /api/wiki-pic/:hash), so players' apps never load
 * it from the wiki. No picture good enough: the card has the wiki link alone. A card's "Not right" hides its picture.
 *
 * Saved in gameRecords/{key}/cards/{recordId} { place, page: { url, title, site } | null, pic: hash | null, what, at }.
 *
 *   npx tsx scripts/guides/itemCards.ts --only KEY [--max-dollars 1] [--nopic | --redo] [--dry-run]
 */
import crypto from 'crypto';
import sharp from 'sharp';
import { db, gemini, arg } from './common';
import { RECORDS } from './recordsImport';
import { wikiPage, wikiPicture, communityWikis, type Cost, type MoreWiki } from '../../visualAnswer';
import type { GameRecord } from './records';
import { fextralifeDomain, communityWikisFor, rememberPictureSite } from './suggestImages';

const UA = 'QuestCompendium/1.0 (+https://questcompendium.com)';

/** A picture copied to our store: re-encoded as a JPEG at most 600 wide. Returns its hash, or null. */
async function keep(url: string, page: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const w = (await sharp(buf).metadata()).width || 0;
    // A small icon (76-150px on some wikis) is enlarged smoothly to 192px so the card doesn't show it tiny or blocky.
    const jpeg = await sharp(buf).flatten({ background: '#1a1a1a' })
      .resize(w && w < 192 ? { width: 192, kernel: 'lanczos3' } : { width: 600, withoutEnlargement: true })
      .jpeg({ quality: 88 }).toBuffer();
    if (jpeg.length > 700_000) return null;
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24);
    await db().collection('wikiPics').doc(hash).set({ mime: 'image/jpeg', data: jpeg.toString('base64'), src: url, page, at: Date.now() });
    return hash;
  } catch { return null; }
}

/**
 * The game's wikis for cards (guideImageSources), or null when none is known. Any game, guide or not: given its name,
 * a game never looked at gets its Fextralife wiki found from the name (free; remembered either way).
 */
export async function wikiFor(key: string, game?: string): Promise<CardWikis | null> {
  const src: any = (await db().collection('guideImageSources').doc(key).get()).data() || {};
  const fx = src.fextralife === undefined && game ? await fextralifeDomain(key, game, src).catch(() => '') : src.fextralife?.domain || '';
  // Community wikis: the hand-filled override, else found from the name once (remembered).
  const more = communityWikis(key).length ? communityWikis(key) : await communityWikisFor(key, game || key, src, gemini()).catch(() => []);
  // Sites that gave this game good pictures from the web before (rememberPictureSite): opened first next time.
  const wiki = { fextralife: fx, fandom: src.wiki?.domain || '', more, prefer: (src.pictureSites || []) as string[] };
  return wiki.fextralife || wiki.fandom || wiki.more.length || wiki.prefer.length ? wiki : null;
}
export type CardWikis = { fextralife: string; fandom: string; more?: MoreWiki[]; prefer?: string[] };
/** Wiki hosts already known for a game: a picture from anywhere else came from the web. */
const knownHost = (w: CardWikis | null, site: string) => !!w && [w.fextralife, w.fandom, ...(w.more || []).map((m) => m.site)].some((h) => h && (site === h || /^(Fextralife|Fandom)$/.test(site)));

/**
 * One item's card: its wiki page and a checked picture (copied to our store), saved in gameRecords/{key}/cards/{id}.
 * No wiki known for the game: the web search still looks for a picture (wikiPicture's last resort, credited and linked
 * to its page), and the card keeps the page the sources cited (`cited`) when nothing better.
 */
export async function cardFor(key: string, game: string, wiki: CardWikis | null, r: GameRecord, cost: Cost, cited?: { url: string; title: string; site: string } | null): Promise<{ page: boolean; pic: boolean }> {
  const steps: string[] = [];
  const pic = await wikiPicture(gemini() as any, cost, wiki || { fextralife: '', fandom: '' }, game, `Show me ${r.name}`, r.name, steps, false, true);
  const page = pic?.page || (wiki ? await wikiPage(wiki, r.name).catch(() => null) : null) || cited || null;
  const hash = pic ? await keep(pic.url, pic.page.url) : null;
  // A good picture from the web: its site is remembered for this game (a wiki joins the game's wikis).
  if (hash && pic && !knownHost(wiki, pic.page.site)) await rememberPictureSite(key, pic.page.site).catch(() => {});
  await RECORDS().doc(key).collection('cards').doc(r.id).set({ place: r.place, page: page || null, pic: hash, what: pic?.alt || '', at: Date.now() });
  return { page: !!page, pic: !!hash };
}

async function main() {
  const key = String(arg('only') || '');
  if (!key) throw new Error('--only KEY is required');
  const max = Number(arg('max-dollars', '1')) || 1;
  const dry = process.argv.includes('--dry-run'), redo = process.argv.includes('--redo');
  const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
  const wiki = await wikiFor(key, game);
  if (!wiki) console.log(`No wiki known for ${key}: pictures from the web search only.`);
  const items = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord)
    .filter((r) => r.place && (r.type === 'item' || r.type === 'secret') && r.fields?.rank && r.status !== 'disputed');
  // --redo: every item again; --nopic: also the cards that have no picture yet; default: items with no card.
  const nopic = process.argv.includes('--nopic');
  const cards = new Map((await RECORDS().doc(key).collection('cards').get()).docs.map((d) => [d.id, d.data() as any]));
  const todo = items.filter((r) => redo || !cards.has(r.id) || (nopic && !cards.get(r.id)?.pic));
  console.log(`${game}: ${items.length} items in Worth getting here, ${todo.length} to do; wikis ${[wiki?.fextralife, wiki?.fandom, ...(wiki?.more || []).map((w) => w.site)].filter(Boolean).join(', ') || 'none (web only)'}.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);
  const cost: Cost = { d: 0 };
  let pages = 0, pics = 0, n = 0;
  for (let i = 0; i < todo.length; i += 4) {
    if (cost.d >= max - 0.02) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    await Promise.all(todo.slice(i, i + 4).map(async (r) => {
      try {
        const c = await cardFor(key, game, wiki, r, cost);
        if (c.page) pages++;
        if (c.pic) pics++;
        n++;
      } catch (e: any) { console.warn(`${r.name}: ${e?.message}`); }
    }));
  }
  console.log(`Cards: ${n} item(s), ${pages} with a wiki page, ${pics} with a picture; $${cost.d.toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/itemCards\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('itemCards failed:', e?.message || e); process.exit(1); });
