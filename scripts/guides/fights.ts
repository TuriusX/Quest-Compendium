/**
 * Key fights for published guides: bosses and major set-piece battles (a siege, a gate defence, an ambush the story
 * forces) written onto area pages that have none, with the enemies, their notable abilities and threats, weaknesses
 * and resistances, the tactics and positions that win, and the rewards.
 *
 * Used by repair.ts --action fights (staged copy, then the review gate), and on its own for the plan:
 *   npx tsx scripts/guides/fights.ts --top 10 --plan-only     the 10 most-used published guides: pages, searches, cost
 *   npx tsx scripts/guides/fights.ts --top 10 --queue         add them to the pipeline's repair queue (mode "fights")
 *
 * Pages are written quick (Flash, no searches) when the game is older than the quick model's cutoff and the page was
 * quick; otherwise with Google Search (one call a page), keeping only fights from a reply that searched.
 * "Most-used": the app's players and questions (gameStats), then Steam's current players (guide page views aren't counted).
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, searchesIn, sourcesIn, stageKey, guideRelease, releasedAfter, QUICK_MODEL_CUTOFF, type GuideFight } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';

/** Estimates for the plan (from typical calls of this shape). */
export const FIGHT_EST = {
  /** Searches a grounded page call runs. */
  searchesPerPage: 5,
  /** A grounded page call (search results in the prompt). */
  carefulPageDollars: 0.012,
  /** A quick page call (no searches). */
  quickPageDollars: 0.005,
  /** The gate's review of the whole guide. */
  flashGateDollars: 0.03,
  proGateDollars: 0.08,
};

export const FIGHT_FORMAT =
  'FIGHT: name of the boss or set-piece battle | the enemies | their notable abilities and threats | weaknesses and resistances | the tactics and positions that win it | the rewards';

const none = (v: string | undefined) => !v || /^(none|n\/a|-|unknown|not applicable)$/i.test(v.trim());

/** FIGHT lines from a reply: "FIGHT: a | b | c | d | e | f" (blank or "none" fields left out). */
export function parseFightLines(text: string, sources: string[] = []): GuideFight[] {
  const out: GuideFight[] = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*]?\s*FIGHT:\s*(.+)$/i);
    if (!m) continue;
    const f = m[1].replace(/\[S\d+\]/g, '').split('|').map((x) => x.replace(/\*\*/g, '').trim());
    if (none(f[0])) continue;
    // Blank fields are left out entirely: Firestore refuses undefined values.
    const fields = { enemies: f[1], threats: f[2], weaknesses: f[3], tactics: f[4], rewards: f[5] };
    out.push({
      id: `f${out.length + 1}`, name: f[0].slice(0, 100),
      ...Object.fromEntries(Object.entries(fields).filter(([, x]) => !none(x)).map(([k, x]) => [k, x.slice(0, 400)])),
      ...(sources.length ? { sources: sources.slice(0, 5) } : {}),
    });
  }
  return out.slice(0, 6);
}

const prompt = (game: string, p: any, grounded: boolean) => [
  `For the video game "${game}", the area "${p.name}"${p.story ? ` (${p.story})` : ''}.`,
  `List this area's key fights: bosses and major set-piece battles (a siege, a defence, an ambush the story forces, a`,
  `fight with a named leader and their followers). Never ordinary enemies or random encounters. Only fights that happen`,
  `in this area.${grounded ? ' Search guides and wikis for this game first; write only what the sources say.' : ' Only fights you are sure of.'}`,
  `One line per fight, in the order players meet them:`,
  FIGHT_FORMAT,
  `Be specific: name abilities, damage types, positions (high ground, chokepoints, the gate), and the tactic that works.`,
  `If the area has no key fights, reply NONE.`,
  ...((p.enemies || []).length ? [`Enemies the page already lists: ${(p.enemies || []).map((e: any) => e.name).join(', ').slice(0, 300)}.`] : []),
].join('\n');

/** One page's key fights: quick (no searches) or grounded (searches; nothing from a reply that ran none). */
export async function fightsForPage(game: string, page: any, quick: boolean): Promise<{ fights: GuideFight[]; searches: number; dollars: number; checked: boolean }> {
  let searches = 0;
  let dollars = 0;
  // Searching is optional for the model: a searched page whose reply ran none is asked once more, more firmly.
  for (let attempt = 0; attempt < (quick ? 1 : 2); attempt++) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt(game, page, !quick) }] }],
      config: { ...(quick ? {} : { tools: [{ googleSearch: {} }] }), temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = quick ? 0 : searchesIn(res);
    if (n) recordMonthly(n);
    searches += n;
    dollars += estimateCost(MODEL, res) || 0;
    if (quick) return { fights: parseFightLines(String(res?.text || '')), searches, dollars, checked: true };
    if (!n) continue;
    // Searched pages (checked pages, and every page of a game past the quick model's cutoff): fights only from a reply
    // that searched and names its sources; nothing from memory.
    const sources = sourcesIn(res);
    return { fights: sources.length ? parseFightLines(String(res?.text || ''), sources) : [], searches, dollars, checked: true };
  }
  // Never searched: nothing written, and the page is asked again on a later run.
  return { fights: [], searches, dollars, checked: false };
}


/**
 * Published pages with no key fights yet (and not checked for them already), and how each would be written. `from` is
 * the copy to read: the live guide for the plan, the staged copy while writing (a run that stopped at the search cap
 * carries on there).
 */
export async function fightPlan(key: string, game: string, live: any, from = key) {
  const newer = releasedAfter(await guideRelease(game, live), QUICK_MODEL_CUTOFF, !!live?.pipeline?.newRelease);
  // The pages published in the live guide (a staged copy marks every page as a draft).
  const liveSnap = await db().collection('guides').doc(key).collection('areas').get();
  const published = new Set(liveSnap.docs.filter((d) => d.data().status === 'published').map((d) => d.id));
  const snap = from === key ? liveSnap : await db().collection('guides').doc(from).collection('areas').get();
  const pages = snap.docs
    .map((d) => ({ slug: d.id, ...(d.data() as any) }))
    .filter((p) => published.has(p.slug) && !p.fightsChecked && !(Array.isArray(p.fights) && p.fights.length))
    .map((p) => ({ ...p, quick: !newer && p.verified === false }));
  const careful = pages.filter((p) => !p.quick).length;
  const quick = pages.length - careful;
  const tier: 'flash' | 'pro' = careful ? 'pro' : 'flash';
  const searches = careful * FIGHT_EST.searchesPerPage;
  const dollars = careful * FIGHT_EST.carefulPageDollars + quick * FIGHT_EST.quickPageDollars + (tier === 'pro' ? FIGHT_EST.proGateDollars : FIGHT_EST.flashGateDollars);
  return { newer, pages, careful, quick, tier, searches, dollars };
}

/**
 * Key fights written into the staged copy (guides/{key}--next, already copied from the live guide), up to the search
 * cap. Returns what it spent and the gate's reviewer: Pro when any page was written with searches (it ends up
 * Checked), Flash when every page was quick.
 */
export async function writeFights(key: string, game: string, live: any, maxSearches: number) {
  const plan = await fightPlan(key, game, live, stageKey(key));
  let searches = 0;
  let dollars = 0;
  let written = 0;
  let found = 0;
  let careful = 0;
  let left = 0;
  const stage = db().collection('guides').doc(stageKey(key)).collection('areas');
  for (const p of plan.pages) {
    if (!p.quick && searches + FIGHT_EST.searchesPerPage > maxSearches) {
      left++;
      continue;
    }
    try {
      const r = await fightsForPage(game, p, p.quick);
      searches += r.searches;
      dollars += r.dollars;
      written++;
      if (!p.quick) careful++;
      console.log(`  ${p.quick ? 'quick' : 'searched'} ${p.name}: ${r.fights.length ? r.fights.map((f) => f.name).join('; ') : r.checked ? 'no key fights' : 'no searches ran (asked again next run)'}${r.searches ? ` (${r.searches} searches)` : ''}`);
      if (r.fights.length) found += r.fights.length;
      // Checked (with or without fights): a run that carries on doesn't ask about this page again. A searched page
      // whose reply never searched isn't checked: it's asked again next time.
      if (r.fights.length || r.checked) await stage.doc(p.slug).set({ ...(r.fights.length ? { fights: r.fights } : {}), ...(r.checked ? { fightsChecked: true } : {}) }, { merge: true });
    } catch (e: any) {
      console.log(`  failed ${p.name}: ${e?.message || e}`);
    }
  }
  console.log(`Key fights: ${found} fights on ${written}/${plan.pages.length} pages${left ? ` (${left} left at the search cap)` : ''}.`);
  return { searches, dollars, written, found, left, tier: (careful ? 'pro' : 'flash') as 'flash' | 'pro' };
}

/** Players in the game on Steam right now (a public endpoint, no key); 0 when unknown. */
async function steamPlayers(appId: unknown): Promise<number> {
  if (!Number(appId)) return 0;
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${Number(appId)}`);
    return Number((await r.json())?.response?.player_count || 0);
  } catch {
    return 0;
  }
}

/**
 * The most-used published guides: by the app's players and questions (gameStats, matched to the guide's key or an
 * edition of it), then, for the many guides the app hasn't seen asked about yet, by Steam's current players.
 */
async function topGuides(n: number) {
  const stats = (await db().collection('gameStats').get()).docs.map((d) => ({ key: d.id, ...(d.data() as any) }));
  const snap = await db().collection('guides').get();
  const live = snap.docs.filter((d) => !d.id.endsWith('--next') && !d.data().unpublished && (d.data().areas || []).length);
  const rows = await Promise.all(live.map(async (d) => {
    const info: any = d.data();
    const st = stats.filter((s) => s.key === d.id || d.id.startsWith(`${s.key}-`) || s.key.startsWith(`${d.id}-`));
    return {
      key: d.id, game: String(info.game || d.id), live: info,
      players: st.reduce((x, s) => x + (s.players?.length || 0), 0),
      questions: st.reduce((x, s) => x + (s.questions || 0), 0),
      steam: await steamPlayers(info.appId),
    };
  }));
  rows.sort((a, b) => b.players - a.players || b.questions - a.questions || b.steam - a.steam);
  // Guides with pages still to do (one whose published pages all have key fights is skipped).
  const out: ((typeof rows)[number] & { plan: Awaited<ReturnType<typeof fightPlan>> })[] = [];
  for (const r of rows) {
    if (out.length >= n) break;
    const plan = await fightPlan(r.key, r.game, r.live);
    if (plan.pages.length) out.push({ ...r, plan });
  }
  return out;
}

async function cli() {
  const n = Number(arg('top', '10'));
  const guides = await topGuides(n);
  let total = { searches: 0, dollars: 0, pages: 0, careful: 0, quick: 0, pro: 0 };
  console.log(`Key fights plan: the ${guides.length} most-used published guides`);
  for (const g of guides) {
    const p = g.plan;
    total = { searches: total.searches + p.searches, dollars: total.dollars + p.dollars, pages: total.pages + p.pages.length, careful: total.careful + p.careful, quick: total.quick + p.quick, pro: total.pro + (p.tier === 'pro' ? 1 : 0) };
    console.log(`- ${g.game} (${g.players ? `${g.players} app players, ${g.questions} questions` : `${g.steam.toLocaleString()} on Steam now`}): ${p.pages.length} pages without key fights (${p.careful} searched, ${p.quick} quick), ≈ ${p.searches} searches, ≈ $${p.dollars.toFixed(2)}, ${p.tier} gate`);
  }
  console.log(`Total: ${total.pages} pages (${total.careful} searched, ${total.quick} quick), ≈ ${total.searches} searches, ≈ $${total.dollars.toFixed(2)} AI, ${total.pro} Pro gate request(s).`);
  if (arg('queue') === 'true') {
    const ref = db().collection('system').doc('pipeline');
    const state: any = (await ref.get()).data() || {};
    const queue: any[] = Array.isArray(state.carefulQueue) ? state.carefulQueue : [];
    for (const g of guides) {
      if (queue.some((q) => q.game === g.game && q.mode === 'fights')) continue;
      queue.push({ game: g.game, mode: 'fights', addedAt: Date.now(), why: 'key fights for a most-used guide' });
    }
    await ref.set({ carefulQueue: queue }, { merge: true });
    console.log(`Queued: ${guides.length} guides (mode fights).`);
  }
  setTimeout(() => process.exit(0), 500);
}

if (/fights\.ts$/.test(process.argv[1] || '')) cli().catch((e) => {
  console.error('fights failed:', e?.message || e);
  process.exit(1);
});
