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
import { db, gemini, MODEL, gameKey, arg, searchesIn } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';

const game = arg('game');
const quick = arg('quick') === 'true';
const maxSearches = Math.max(10, Number(arg('max-searches', '120')));
if (!game) {
  console.log('Usage: npx tsx scripts/guides/achievements.ts --game "Game" [--appid N] [--quick] [--max-searches 120]');
  process.exit(1);
}

type Ach = { name: string; desc: string; rarity: number | null; icon: string; hidden: boolean; missable?: boolean; how?: string; area?: string; areaName?: string };

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function findAppId(name: string): Promise<number | null> {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=english`);
  if (!r.ok) return null;
  const d: any = await r.json();
  const items: any[] = d?.items || [];
  const exact = items.find((i) => norm(i.name) === norm(name));
  return Number((exact || items[0])?.id) || null;
}

/** Steam's public achievement list for a game (no key needed). */
async function steamList(appId: number): Promise<Ach[]> {
  const r = await fetch(`https://steamcommunity.com/stats/${appId}/achievements/?l=english`);
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
  const guideRef = db().collection('guides').doc(key);
  const info = (await guideRef.get()).data() || {};
  const appId = Number(arg('appid')) || Number(info.appId) || (await findAppId(game!));
  if (!appId) throw new Error(`couldn't find "${game}" on Steam; pass --appid`);
  const list = await steamList(appId);
  if (!list.length) throw new Error(`Steam lists no achievements for app ${appId}`);
  console.log(`${game} (app ${appId}): ${list.length} achievements on Steam`);
  const areas: { slug: string; name: string }[] = (info.areas || []).map((a: any) => ({ slug: a.slug, name: a.name }));
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

  // How to get each one, 25 at a time.
  for (let i = 0; i < list.length; i += 25) {
    if (!quick && searches >= maxSearches) {
      console.log('Search cap reached: the rest stay without tips for now (run again to finish).');
      break;
    }
    const batch = list.slice(i, i + 25);
    const text = await call(
      `For the video game "${info.game || game}", explain how to unlock each of these Steam achievements. ${areaHint}` +
        (quick ? 'Use what you know; leave a field empty if unsure. ' : 'Search the web; do not answer from memory. ') +
        'Write in your own words. Reply with one line per achievement, exactly:\n' +
        'ACH: achievement name | missable: yes or no | the guide area where it happens, using an area name from the list above (or empty) | how to unlock it, in one or two short sentences\n' +
        batch.map((a) => `- ${a.name}: ${a.desc || '(hidden achievement)'}`).join('\n'),
      `achievements ${i + 1}-${i + batch.length}`,
    );
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*[-*]?\s*ACH:\s*(.+?)\s*\|\s*missable:\s*(yes|no)\s*\|\s*([^|]*?)\s*\|\s*(.+)$/i);
      if (!m) continue;
      const a = batch.find((x) => norm(x.name) === norm(m[1]));
      if (!a) continue;
      a.missable = /yes/i.test(m[2]);
      a.how = m[4].trim().slice(0, 400);
      const area = areaBySlugName.get(norm(m[3]));
      if (area) {
        a.area = area.slug;
        a.areaName = area.name;
      }
    }
  }

  // The roadmap.
  let roadmap: any = null;
  try {
    const text = await call(
      `Write a 100% achievement roadmap for the video game "${info.game || game}". ${areaHint}` +
        (quick ? '' : 'Search the web; do not answer from memory. ') +
        'Write in your own words. Reply with these lines only:\n' +
        'TIME: estimated hours to 100%\nDIFFICULTY: x/10\nPLAYTHROUGHS: number needed\nMISSABLES: how many achievements can be missed\n' +
        'STEP: one step of the recommended order (several STEP lines, in order)\n' +
        'NORETURN: a point of no return | what can no longer be done after it (several lines allowed)',
      'roadmap',
    );
    const get = (k: string) => (text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || '';
    roadmap = {
      time: get('TIME'), difficulty: get('DIFFICULTY'), playthroughs: get('PLAYTHROUGHS'), missables: get('MISSABLES'),
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
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Achievement guide failed:', e?.message || e);
  process.exit(1);
});
