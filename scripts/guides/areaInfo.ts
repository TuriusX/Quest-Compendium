/**
 * The summary box and the way here, for published pages that don't have them yet (GuideInfo in common.ts): region or
 * parent area, level range, quests, services and important NPCs, enemy types; directions from a named neighbouring
 * place, the areas it connects to, and map coordinates when the game shows them.
 *
 * Used by repair.ts --action info (staged copy, then the review gate), and on its own for the plan:
 *   npx tsx scripts/guides/areaInfo.ts --plan-only     pages, searches and cost for the 10 most-used guides
 *   npx tsx scripts/guides/areaInfo.ts --queue         add them to the pipeline's repair queue (mode "info")
 *
 * Pages are written quick (Flash, no searches) when the game is older than the quick model's cutoff and the page was
 * quick; otherwise with Google Search (one call a page), keeping only a reply that searched and names its sources.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, searchesIn, sourcesIn, stageKey, gameKey, guideRelease, releasedAfter, QUICK_MODEL_CUTOFF, INFO_FORMAT, WAY_FORMAT, parseInfoFields, parseWayFields, hasInfo, type GuideInfo } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';
import { TOP_GUIDES } from './missables';

/** Estimates (per page) for the plan. */
export const INFO_EST = { searchesPerPage: 4, carefulPageDollars: 0.011, quickPageDollars: 0.004, flashGateDollars: 0.03, proGateDollars: 0.08 };

/** INFO and WAY lines from a reply. */
export function parseInfoReply(text: string, sources: string[] = []): GuideInfo | null {
  let info: GuideInfo = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*]?\s*(INFO|WAY):\s*(.+)$/i);
    if (!m) continue;
    const f = m[2].replace(/\[S\d+\]/g, '').replace(/\*\*/g, '').split('|').map((x) => x.trim());
    info = (m[1].toUpperCase() === 'INFO' ? parseInfoFields : parseWayFields)(f, info);
  }
  if (!hasInfo(info)) return null;
  return sources.length ? { ...info, sources: sources.slice(0, 5) } : info;
}

const prompt = (game: string, page: any, neighbours: string[], grounded: boolean) => [
  `For the video game "${game}", the area "${page.name}"${page.story ? ` (${page.story})` : ''}: write its summary and how to get there.`,
  grounded ? 'Search guides and wikis for this game first; write only what the sources say.' : 'Only write what you are sure of; leave a field empty otherwise.',
  neighbours.length ? `Other areas in this guide near it, in story order: ${neighbours.join(', ')}.` : '',
  page.overview ? `The page says: ${String(page.overview).slice(0, 400)}` : '',
  'Reply with exactly these two lines:',
  INFO_FORMAT,
  WAY_FORMAT,
  'Use the game\'s own names. Directions start from somewhere a player can find (a waypoint, a named place, a landmark).',
].filter(Boolean).join('\n');

/** One page's info: quick (no searches) or grounded (nothing from a reply that didn't search or name sources). */
export async function infoForPage(game: string, page: any, neighbours: string[], quick: boolean): Promise<{ info: GuideInfo | null; searches: number; dollars: number; checked: boolean }> {
  let searches = 0, dollars = 0;
  for (let attempt = 0; attempt < (quick ? 1 : 2); attempt++) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt(game, page, neighbours, !quick) }] }],
      config: { ...(quick ? {} : { tools: [{ googleSearch: {} }] }), temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = quick ? 0 : searchesIn(res);
    if (n) recordMonthly(n);
    searches += n;
    dollars += estimateCost(MODEL, res) || 0;
    if (quick) return { info: parseInfoReply(String(res?.text || '')), searches, dollars, checked: true };
    if (!n) continue;
    const sources = sourcesIn(res);
    return { info: sources.length ? parseInfoReply(String(res?.text || ''), sources) : null, searches, dollars, checked: true };
  }
  return { info: null, searches, dollars, checked: false };
}

/** Published pages without a summary box yet (and not checked for one already), and how each would be written. */
export async function infoPlan(key: string, game: string, live: any, from = key) {
  const newer = releasedAfter(await guideRelease(game, live), QUICK_MODEL_CUTOFF, !!live?.pipeline?.newRelease);
  const liveSnap = await db().collection('guides').doc(key).collection('areas').get();
  const published = new Set(liveSnap.docs.filter((d) => d.data().status === 'published').map((d) => d.id));
  const snap = from === key ? liveSnap : await db().collection('guides').doc(from).collection('areas').get();
  const pages = snap.docs
    .map((d) => ({ slug: d.id, ...(d.data() as any) }))
    .filter((p) => published.has(p.slug) && !p.infoChecked && !hasInfo(p.info))
    .map((p) => ({ ...p, quick: !newer && p.verified === false }));
  const careful = pages.filter((p) => !p.quick).length;
  const quick = pages.length - careful;
  const tier: 'flash' | 'pro' = careful ? 'pro' : 'flash';
  const searches = careful * INFO_EST.searchesPerPage;
  const dollars = careful * INFO_EST.carefulPageDollars + quick * INFO_EST.quickPageDollars + (pages.length ? (tier === 'pro' ? INFO_EST.proGateDollars : INFO_EST.flashGateDollars) : 0);
  return { newer, pages, careful, quick, tier, searches, dollars };
}

/** The summary boxes written into the staged copy (guides/{key}--next), up to the search cap. */
export async function writeAreaInfo(key: string, game: string, live: any, maxSearches: number) {
  const plan = await infoPlan(key, game, live, stageKey(key));
  const order: string[] = (live.areas || []).map((o: any) => String(o.name || ''));
  let searches = 0, dollars = 0, written = 0, found = 0, careful = 0, left = 0;
  const stage = db().collection('guides').doc(stageKey(key)).collection('areas');
  for (const p of plan.pages) {
    if (!p.quick && searches + INFO_EST.searchesPerPage > maxSearches) { left++; continue; }
    const i = order.indexOf(String(p.name));
    const neighbours = i >= 0 ? order.slice(Math.max(0, i - 3), i + 4).filter((n) => n && n !== p.name) : [];
    try {
      const r = await infoForPage(game, p, neighbours, p.quick);
      searches += r.searches;
      dollars += r.dollars;
      written++;
      if (!p.quick) careful++;
      if (r.info) found++;
      console.log(`  ${p.quick ? 'quick' : 'searched'} ${p.name}: ${r.info ? [r.info.region, r.info.directions && 'directions', r.info.coords && `coords ${r.info.coords}`].filter(Boolean).join(', ') : r.checked ? 'nothing confirmed' : 'no searches ran (asked again next run)'}${r.searches ? ` (${r.searches} searches)` : ''}`);
      if (r.info || r.checked) await stage.doc(p.slug).set({ ...(r.info ? { info: r.info } : {}), ...(r.checked ? { infoChecked: true } : {}) }, { merge: true });
    } catch (e: any) {
      console.log(`  failed ${p.name}: ${e?.message || e}`);
    }
  }
  console.log(`Summary boxes: ${found} written on ${written}/${plan.pages.length} pages${left ? ` (${left} left at the search cap)` : ''}.`);
  return { searches, dollars, written, found, left, tier: (careful ? 'pro' : 'flash') as 'flash' | 'pro' };
}

async function cli() {
  let total = { searches: 0, dollars: 0, pages: 0, careful: 0, quick: 0, pro: 0 };
  console.log('Summary boxes and directions: the 10 most-used guides');
  for (const game of TOP_GUIDES) {
    const key = gameKey(game);
    const live: any = (await db().collection('guides').doc(key).get()).data();
    if (!live) { console.log(`- ${game}: no guide`); continue; }
    const p = await infoPlan(key, game, live);
    total = { searches: total.searches + p.searches, dollars: total.dollars + p.dollars, pages: total.pages + p.pages.length, careful: total.careful + p.careful, quick: total.quick + p.quick, pro: total.pro + (p.pages.length && p.tier === 'pro' ? 1 : 0) };
    console.log(`- ${game}: ${p.pages.length} pages (${p.careful} searched, ${p.quick} quick), ≈ ${p.searches} searches, ≈ $${p.dollars.toFixed(2)}, ${p.pages.length ? `${p.tier} gate` : 'nothing to do'}`);
  }
  console.log(`Total: ${total.pages} pages (${total.careful} searched, ${total.quick} quick), ≈ ${total.searches} searches, ≈ $${total.dollars.toFixed(2)} AI, ${total.pro} Pro gate request(s).`);
  if (arg('queue') === 'true') {
    const ref = db().collection('system').doc('pipeline');
    const state: any = (await ref.get()).data() || {};
    const queue: any[] = Array.isArray(state.carefulQueue) ? state.carefulQueue : [];
    const add = TOP_GUIDES.filter((g) => !queue.some((q) => q.game === g && q.mode === 'info')).map((game) => ({ game, mode: 'info', addedAt: Date.now(), why: 'summary box and directions for a most-used guide' }));
    const at = queue.reduce((n, q, k) => (['fights', 'missables', 'info'].includes(q.mode) ? k + 1 : n), 0);
    queue.splice(at, 0, ...add);
    await ref.set({ carefulQueue: queue }, { merge: true });
    console.log(`Queued: ${add.length} guides (mode info).`);
  }
  setTimeout(() => process.exit(0), 500);
}

if (/areaInfo\.ts$/.test(process.argv[1] || '')) cli().catch((e) => {
  console.error('area info failed:', e?.message || e);
  process.exit(1);
});
