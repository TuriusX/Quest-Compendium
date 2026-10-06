/**
 * Achievement guide for a game: the official Steam list, plus how to get each achievement, whether it can be missed,
 * where in the game it happens (linked to the guide's areas), and a roadmap to 100%.
 *
 *   npx tsx scripts/guides/achievements.ts --game "The Witcher 3: Wild Hunt - Complete Edition"
 *   options: --appid 292030   if Steam's search can't find the game by name
 *            --quick          from the AI's own knowledge, no searches (fine for well-known older games)
 *            --max-searches 120
 *
 * The list itself (names, descriptions, icons, how many players have each) comes from Steam, so it's exact. The
 * "how to" part is researched with Google Search (each batch must actually search), or written from the AI's
 * knowledge with --quick. Saved at guides/{game}/achievements/main; the website, the apps and the Known here panel
 * read it from there. Re-running replaces it.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, gameKey, arg, searchesIn, editionOf, editionNote } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';
import { acquireGuideLock, isRefusal, lockedLine, releaseGuideLocks } from './guideLock';

const game = arg('game');
const quick = arg('quick') === 'true';
const maxSearches = Math.max(10, Number(arg('max-searches', '120')));
if (!game) {
  console.log('Usage: npx tsx scripts/guides/achievements.ts --game "Game" [--appid N] [--quick] [--max-searches 120]');
  process.exit(1);
}

type Ach = { name: string; desc: string; rarity: number | null; icon: string; hidden: boolean; missable?: boolean; how?: string; area?: string; areaName?: string; labels?: string[] };
/** Labels an achievement can carry (the page shows and filters on them; missable is its own field). */
const LABELS = ['collectible', 'cumulative', 'difficulty', 'online', 'buggy'];

// Steam sometimes sends Windows-1252 control bytes as characters: 0x85 is "…" ("That Is the Evilest Thing…"); the rest
// of that range is dropped.
const decode = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\u0085/g, '…').replace(/[\u0080-\u009f]/g, '').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function findAppId(name: string): Promise<number | null> {
  const search = async (term: string): Promise<any[]> => {
    const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`);
    return r.ok ? ((await r.json()) as any)?.items || [] : [];
  };
  const items = await search(name);
  const exact = items.find((i) => norm(i.name) === norm(name));
  if (exact || items[0]) return Number((exact || items[0]).id) || null;
  // Store names change ("The Witcher 3: Wild Hunt - Complete Edition" is now "… — Remastered"): try again without
  // the edition after a dash, and only take a game whose name starts with that shorter name.
  const short = name.split(/\s+[-–—]\s+/)[0].replace(/[™®]/g, '').trim();
  if (!short || short === name) return null;
  const hit = (await search(short)).find((i) => norm(i.name).startsWith(norm(short)));
  return Number(hit?.id) || null;
}

/** Steam's public achievement list for a game (no key needed). */
async function steamList(appId: number): Promise<Ach[]> {
  // Always English: Steam otherwise picks the language from the request (browser language or its language cookie).
  const r = await fetch(`https://steamcommunity.com/stats/${appId}/achievements/?l=english`, {
    headers: { Cookie: 'Steam_Language=english', 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error(`Steam returned ${r.status} for the achievement list`);
  const html = await r.text();
  const rows = html.split('class="achieveRow').slice(1);
  return rows
    .map((row) => {
      const name = decode((row.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '');
      const desc = decode((row.match(/<h5>([\s\S]*?)<\/h5>/) || [])[1] || '');
      const pct = Number(((row.match(/achievePercent">\s*([\d.]+)%/) || [])[1] || 'NaN'));
      const icon = (row.match(/<img src="([^"]+)"/) || [])[1] || '';
      return { name, desc, rarity: Number.isFinite(pct) ? pct : null, icon, hidden: !desc };
    })
    .filter((a) => a.name);
}

async function main() {
  const key = gameKey(game!);
  const lock = await acquireGuideLock(key, 'achievement guide');
  if (isRefusal(lock)) {
    console.log(lockedLine(lock, game!));
    console.log('Done: 0 achievements, 0 searches used, estimated AI cost ≈ $0.00 (skipped: the guide is locked)');
    return setTimeout(() => process.exit(0), 300);
  }
  const guideRef = db().collection('guides').doc(key);
  const info = (await guideRef.get()).data() || {};
  const appId = Number(arg('appid')) || Number(info.appId) || (await findAppId(game!));
  if (!appId) throw new Error(`couldn't find "${game}" on Steam; pass --appid`);
  const list = await steamList(appId);
  if (!list.length) throw new Error(`Steam lists no achievements for app ${appId}`);
  console.log(`${game} (app ${appId}): ${list.length} achievements on Steam`);
  // Only published pages: an achievement linked to a held page would point at nothing.
  const published = new Set((await guideRef.collection('areas').where('status', '==', 'published').get()).docs.map((d) => d.id));
  const areas: { slug: string; name: string }[] = (info.areas || []).filter((a: any) => published.has(a.slug)).map((a: any) => ({ slug: a.slug, name: a.name }));
  const areaBySlugName = new Map(areas.map((a) => [norm(a.name), a]));

  const ai = gemini();
  let searches = 0, dollars = 0;
  const call = async (prompt: string, label: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res: any = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: (attempt && !quick ? 'You must run Google searches before answering.\n\n' : '') + prompt }] }],
        config: { ...(quick ? {} : { tools: [{ googleSearch: {} }] }), temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      const n = searchesIn(res);
      searches += n;
      if (n) recordMonthly(n);
      dollars += estimateCost(MODEL, res) || 0;
      console.log(`  [${label}] ${n} searches (total ${searches}/${maxSearches}, ≈ $${dollars.toFixed(3)})`);
      if (quick || n > 0) return String(res?.text || '');
    }
    throw new Error(`${label}: the research ran no searches`);
  };
  const areaHint = areas.length ? `The guide's areas are: ${areas.map((a) => a.name).join(' | ')}. ` : '';
  // A remake or remaster: tips and the roadmap must be for this version, not the original's achievements or features.
  const edition = await editionOf(info.game || game!, guideRef);
  if (edition.remake) console.log(`  edition: the ${edition.year ? `${edition.year} ` : ''}${edition.kind} of ${edition.original || 'an earlier game'}${edition.originalYear ? ` (${edition.originalYear})` : ''}`);
  const versionNote = editionNote(edition, info.game || game!);

  // What counts as missable, the same for every game.
  const MISSABLE =
    'Missable means only this: the achievement becomes permanently impossible in that playthrough after a specific point ' +
    'in the story (a quest that closes, an area you can never return to, a one-time choice). These are NOT missable: ' +
    'difficulty requirements, collectibles or tasks you can still finish later, and anything you can still get in the ' +
    'post-game or in New Game+. When in doubt, answer no. ';

  /** Ask how to get a batch of achievements, and fill in the ones the reply covers. */
  const askBatch = async (batch: Ach[], label: string) => {
    const text = await call(
      `For the video game "${info.game || game}", explain how to unlock each of these Steam achievements. ${areaHint}${versionNote} ` +
        (quick ? 'Use what you know; leave a field empty if unsure. ' : 'Search the web; do not answer from memory. ') +
        `Write everything in English, in your own words. ${MISSABLE}Reply with one line per achievement, exactly:\n` +
        'ACH: achievement name | missable: yes or no | the guide area where it happens, using an area name from the list above (or empty) | labels: any of collectible (find or collect all of something), cumulative (do something many times), difficulty (needs a difficulty setting or a no-death run), online (needs online or co-op play), buggy (known to sometimes not unlock), separated by commas, or none | how to unlock it, in one or two short sentences\n' +
        batch.map((a) => `- ${a.name}: ${a.desc || '(hidden achievement)'}`).join('\n'),
      label,
    );
    for (const line of text.split('\n')) {
      // Labels between the area and the how-to (older replies without them still read).
      const m = line.match(/^\s*[-*]?\s*ACH:\s*(.+?)\s*\|\s*missable:\s*(yes|no)\s*\|\s*([^|]*?)\s*\|\s*(?:labels?:\s*([^|]*?)\s*\|\s*)?(.+)$/i);
      if (!m) continue;
      const a = batch.find((x) => norm(x.name) === norm(m[1]));
      if (!a) continue;
      a.missable = /yes/i.test(m[2]);
      a.how = m[5].trim().slice(0, 400);
      const labels = String(m[4] || '').toLowerCase().split(/\s*,\s*/).filter((l) => LABELS.includes(l));
      if (labels.length) a.labels = labels;
      const area = areaBySlugName.get(norm(m[3]));
      if (area) {
        a.area = area.slug;
        a.areaName = area.name;
      }
    }
  };

  // How to get each one, 25 at a time.
  for (let i = 0; i < list.length; i += 25) {
    if (!quick && searches >= maxSearches) {
      console.log('Search cap reached: the rest stay without tips for now (run again to finish).');
      break;
    }
    await askBatch(list.slice(i, i + 25), `achievements ${i + 1}-${Math.min(i + 25, list.length)}`);
  }
  // A long batch sometimes skips one (often a hidden achievement); those get one more, smaller try.
  const skipped = list.filter((a) => !a.how);
  if (skipped.length && skipped.length < list.length && (quick || searches < maxSearches)) {
    console.log(`  ${skipped.length} without a tip after the first pass (${skipped.slice(0, 5).map((a) => a.name).join(', ')}): asking again`);
    for (let i = 0; i < skipped.length; i += 10) await askBatch(skipped.slice(i, i + 10), `follow-up ${i + 1}-${Math.min(i + 10, skipped.length)}`);
  }

  // The roadmap.
  let roadmap: any = null;
  try {
    const text = await call(
      `Write a 100% achievement roadmap for the video game "${info.game || game}". ${areaHint}${versionNote} ` +
        (quick ? '' : 'Search the web; do not answer from memory. ') +
        `Write everything in English, in your own words. ${MISSABLE}Reply with these lines only:\n` +
        'TIME: estimated hours to 100%\nDIFFICULTY: x/10\nPLAYTHROUGHS: number needed\n' +
        'STEP: one step of the recommended order (several STEP lines, in order)\n' +
        'NORETURN: a point of no return | what becomes permanently impossible after it (several lines allowed)',
      'roadmap',
    );
    const get = (k: string) => (text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || '';
    roadmap = {
      // The missable count is the list's own, so the roadmap and the list always agree.
      time: get('TIME'), difficulty: get('DIFFICULTY'), playthroughs: get('PLAYTHROUGHS'), missables: String(list.filter((a) => a.missable).length),
      steps: [...text.matchAll(/^\s*STEP:\s*(.+)$/gim)].map((m) => m[1].trim()).slice(0, 15),
      noReturn: [...text.matchAll(/^\s*NORETURN:\s*(.+?)\s*\|\s*(.+)$/gim)].map((m) => ({ point: m[1].trim(), lost: m[2].trim() })).slice(0, 10),
    };
  } catch (e: any) {
    console.warn(`  roadmap skipped: ${e?.message}`);
  }

  const withTips = list.filter((a) => a.how).length;
  await guideRef.collection('achievements').doc('main').set({
    appId, game: info.game || game, updatedAt: Date.now(), verified: !quick, list, roadmap,
  });
  await guideRef.set({ appId, hasAchievements: true }, { merge: true });
  console.log(`Done: ${list.length} achievements, ${withTips} with tips, ${list.filter((a) => a.missable).length} missable, ${list.filter((a) => a.area).length} linked to guide areas, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}`);
  await releaseGuideLocks();
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Achievement guide failed:', e?.message || e);
  releaseGuideLocks().finally(() => process.exit(1));
});
