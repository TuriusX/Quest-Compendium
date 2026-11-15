/**
 * Item cards (owner, Nov 15 2026; roadmap item 30, step 2): for each item in an area's "Worth getting here", its wiki
 * page and a quality picture, found once ahead of time, the way visual answers find them (visualAnswer.ts wikiPage and
 * wikiPicture: the wiki page's main picture, big enough, and a vision check that it clearly shows the item itself).
 * The picture is copied to our own store (wikiPics/{hash}, served by /api/wiki-pic/:hash), so players' apps never load
 * it from the wiki. No picture good enough: the card has the wiki link alone. A card's "Not right" hides its picture.
 *
 * Saved in gameRecords/{key}/cards/{recordId} { place, page: { url, title, site } | null, pic: hash | null, what, at }.
 *
 *   npx tsx scripts/guides/itemCards.ts --only KEY [--max-dollars 1] [--redo] [--dry-run]
 */
import crypto from 'crypto';
import sharp from 'sharp';
import { db, gemini, arg } from './common';
import { RECORDS } from './recordsImport';
import { wikiPage, wikiPicture, type Cost } from '../../visualAnswer';
import type { GameRecord } from './records';

const UA = 'QuestCompendium/1.0 (+https://questcompendium.com)';

/** A picture copied to our store: re-encoded as a JPEG at most 600 wide. Returns its hash, or null. */
async function keep(url: string, page: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) return null;
    const jpeg = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: '#1a1a1a' }).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    if (jpeg.length > 700_000) return null;
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24);
    await db().collection('wikiPics').doc(hash).set({ mime: 'image/jpeg', data: jpeg.toString('base64'), src: url, page, at: Date.now() });
    return hash;
  } catch { return null; }
}

async function main() {
  const key = String(arg('only') || '');
  if (!key) throw new Error('--only KEY is required');
  const max = Number(arg('max-dollars', '1')) || 1;
  const dry = process.argv.includes('--dry-run'), redo = process.argv.includes('--redo');
  const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
  const src: any = (await db().collection('guideImageSources').doc(key).get()).data() || {};
  const wiki = { fextralife: src.fextralife?.domain || '', fandom: src.wiki?.domain || '' };
  if (!wiki.fextralife && !wiki.fandom) throw new Error(`no wiki known for ${key} (guideImageSources)`);
  const items = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord)
    .filter((r) => r.place && (r.type === 'item' || r.type === 'secret') && r.fields?.rank && r.status !== 'disputed');
  const done = new Set((await RECORDS().doc(key).collection('cards').get()).docs.map((d) => d.id));
  const todo = items.filter((r) => redo || !done.has(r.id));
  console.log(`${game}: ${items.length} items in Worth getting here, ${todo.length} to do; wiki ${wiki.fextralife || wiki.fandom}.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);
  const cost: Cost = { d: 0 };
  let pages = 0, pics = 0, n = 0;
  for (let i = 0; i < todo.length; i += 4) {
    if (cost.d >= max - 0.02) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    await Promise.all(todo.slice(i, i + 4).map(async (r) => {
      const steps: string[] = [];
      try {
        const pic = await wikiPicture(gemini() as any, cost, wiki, game, `Show me ${r.name}`, r.name, steps, false, true);
        const page = pic?.page || (await wikiPage(wiki, r.name).catch(() => null));
        const hash = pic ? await keep(pic.url, pic.page.url) : null;
        if (page) pages++;
        if (hash) pics++;
        n++;
        await RECORDS().doc(key).collection('cards').doc(r.id).set({ place: r.place, page: page || null, pic: hash, what: pic?.alt || '', at: Date.now() });
      } catch (e: any) { console.warn(`${r.name}: ${e?.message}`); }
    }));
  }
  console.log(`Cards: ${n} item(s), ${pages} with a wiki page, ${pics} with a picture; $${cost.d.toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/itemCards\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('itemCards failed:', e?.message || e); process.exit(1); });
