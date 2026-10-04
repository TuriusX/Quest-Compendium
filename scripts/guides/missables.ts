/**
 * Missables made findable: rewrites only the missable entries of published pages to the standard (MISSABLE_STANDARD in
 * common.ts): "where" from a findable anchor to the exact container or object, "how" the exact final step (the action
 * or check), and "missable because" what locks it out. Missable items, and the entries of a page's missable checklist.
 *
 * Used by repair.ts --action missables (staged copy, then the review gate), and on its own for the plan:
 *   npx tsx scripts/guides/missables.ts --plan-only       pages, searches and cost for the 10 most-used guides
 *   npx tsx scripts/guides/missables.ts --queue           add them to the pipeline's repair queue (mode "missables")
 *
 * Pages are rewritten quick (Flash, no searches) when the game is older than the quick model's cutoff and the page was
 * quick; otherwise with Google Search (one call a page), keeping only a reply that searched and names its sources.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, searchesIn, sourcesIn, stageKey, guideRelease, releasedAfter, QUICK_MODEL_CUTOFF, MISSABLE_STANDARD, parseItem, gameKey } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';

/** Estimates for the plan (from typical calls of this shape). */
export const MISS_EST = { searchesPerPage: 5, carefulPageDollars: 0.014, quickPageDollars: 0.006, flashGateDollars: 0.03, proGateDollars: 0.08 };

/** The 10 most-used guides (the same list as the Key fights repairs), Baldur's Gate 3 first. */
export const TOP_GUIDES = ["Baldur's Gate 3", 'The Witcher 3: Wild Hunt - Complete Edition', 'Cyberpunk 2077', 'Red Dead Redemption 2', 'ELDEN RING',
  'The Elder Scrolls V: Skyrim Special Edition', 'Black Myth: Wukong', 'RuneScape: Dragonwilds', 'CONTROL Resonant', 'Resident Evil 4'];

type Missable = { id: string; kind: 'item' | 'event'; name: string; where?: string; how?: string; lockout?: string; text?: string; sec?: number };

const isMissSection = (x: any) => x?.check && /miss/i.test(String(x.title || ''));

/** A page's missable entries: missable items, and its missable checklist's lines. */
export function missablesOf(page: any): Missable[] {
  const out: Missable[] = [];
  for (const e of page.items || []) if (e?.missable) out.push({ id: String(e.id), kind: 'item', name: String(e.name || ''), where: e.where, how: e.how, lockout: e.lockout });
  (page.sections || []).forEach((x: any, i: number) => {
    if (isMissSection(x)) for (const e of x.entries || []) out.push({ id: String(e.id), kind: 'event', name: String(e.text || '').slice(0, 80), text: String(e.text || ''), sec: i });
  });
  return out;
}

const prompt = (game: string, page: any, list: Missable[], grounded: boolean) => [
  `For the video game "${game}", the area "${page.name}"${page.story ? ` (${page.story})` : ''}: rewrite these missable guide entries`,
  `so a player can actually find them. ${MISSABLE_STANDARD}`,
  grounded ? 'Search guides and wikis for this game first; write only what the sources say.' : 'Only write what you are sure of; keep the entry as it is otherwise.',
  `Entries (id | what | where | how | missable because):`,
  ...list.map((m) => (m.kind === 'item'
    ? `- ${m.id} | item: ${m.name} | ${m.where || '-'} | ${m.how || '-'} | ${m.lockout || '-'}`
    : `- ${m.id} | missable: ${m.text}`)),
  ``,
  `Reply with one line per entry, the same ids, in this format only:`,
  `MISS: id | what it is (the item or event, as named above) | where: from the findable anchor to the exact container or object | how: the exact final step | missable because: what locks it out`,
  `Keep each field to one sentence. If something isn't missable after all, write "missable because: not missable".`,
].join('\n');

export type MissRewrite = { id: string; name: string; where: string; how?: string; lockout?: string; missable: boolean };

/** MISS lines from a reply, for the given ids. */
export function parseMissLines(text: string, ids: Set<string>): MissRewrite[] {
  const out: MissRewrite[] = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*]?\s*MISS:\s*(.+)$/i);
    if (!m) continue;
    const f = m[1].replace(/\[S\d+\]/g, '').split('|').map((x) => x.replace(/\*\*/g, '').trim());
    const id = f[0];
    if (!ids.has(id) || !f[2]) continue;
    const notMissable = /^(missable\s+because\s*:\s*)?not missable\.?$/i.test(f[4] || '');
    const e = parseItem([f[1].replace(/^(item|missable|what)\s*:\s*/i, ''), f[2], f[3] || '', notMissable ? '' : f[4] || ''], id);
    if (!e.where || e.where.length < 10) continue;
    out.push({ id, name: e.name || '', where: e.where.slice(0, 400), how: e.how, lockout: e.lockout, missable: !notMissable && !!e.lockout });
  }
  return out;
}

/** One page's missables rewritten: quick (no searches) or grounded (nothing from a reply that didn't search). */
export async function missablesForPage(game: string, page: any, quick: boolean): Promise<{ rewrites: MissRewrite[]; sources: string[]; searches: number; dollars: number; checked: boolean }> {
  const list = missablesOf(page);
  const ids = new Set(list.map((m) => m.id));
  let searches = 0;
  let dollars = 0;
  for (let attempt = 0; attempt < (quick ? 1 : 2); attempt++) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt(game, page, list, !quick) }] }],
      config: { ...(quick ? {} : { tools: [{ googleSearch: {} }] }), temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = quick ? 0 : searchesIn(res);
    if (n) recordMonthly(n);
    searches += n;
    dollars += estimateCost(MODEL, res) || 0;
    if (quick) return { rewrites: parseMissLines(String(res?.text || ''), ids), sources: [], searches, dollars, checked: true };
    if (!n) continue;
    const sources = sourcesIn(res);
    return { rewrites: sources.length ? parseMissLines(String(res?.text || ''), ids) : [], sources, searches, dollars, checked: true };
  }
  return { rewrites: [], sources: [], searches, dollars, checked: false };
}

/** The page with the rewrites applied: items get where / how / lockout; checklist lines become one findable line. */
export function applyMissRewrites(page: any, rewrites: MissRewrite[], sources: string[]) {
  const by = new Map(rewrites.map((r) => [r.id, r]));
  const mark = { updatedFrom: 'missables repair', ...(sources.length ? { sources: sources.slice(0, 5) } : {}) };
  const items = (page.items || []).map((e: any) => {
    const r = by.get(String(e.id));
    if (!r) return e;
    const { how: _h, lockout: _l, ...rest } = e;
    return { ...rest, where: r.where, ...(r.how ? { how: r.how } : {}), ...(r.lockout ? { lockout: r.lockout } : {}), missable: r.missable, ...mark };
  });
  const sections = (page.sections || []).map((x: any) =>
    isMissSection(x)
      ? {
          ...x,
          entries: (x.entries || []).map((e: any) => {
            const r = by.get(String(e.id));
            if (!r) return e;
            const name = r.name || String(e.text || '').split(/[:.]/)[0];
            const sentence = (v: string) => (v.charAt(0).toUpperCase() + v.slice(1)).replace(/\.?$/, '.');
            return { ...e, text: `${name}: ${sentence(r.where)}${r.how ? ` ${sentence(r.how)}` : ''}${r.lockout ? ` Missable: ${r.lockout.replace(/\.?$/, '.')}` : ''}`.slice(0, 700) };
          }),
        }
      : x,
  );
  return { items, sections };
}

/** Published pages with missables not rewritten yet, and how each would be done. `from`: the copy to read. */
export async function missPlan(key: string, game: string, live: any, from = key) {
  const newer = releasedAfter(await guideRelease(game, live), QUICK_MODEL_CUTOFF, !!live?.pipeline?.newRelease);
  const liveSnap = await db().collection('guides').doc(key).collection('areas').get();
  const published = new Set(liveSnap.docs.filter((d) => d.data().status === 'published').map((d) => d.id));
  const snap = from === key ? liveSnap : await db().collection('guides').doc(from).collection('areas').get();
  const pages = snap.docs
    .map((d) => ({ slug: d.id, ...(d.data() as any) }))
    .filter((p) => published.has(p.slug) && !p.missablesChecked && missablesOf(p).length)
    .map((p) => ({ ...p, quick: !newer && p.verified === false }));
  const careful = pages.filter((p) => !p.quick).length;
  const quick = pages.length - careful;
  const entries = pages.reduce((n, p) => n + missablesOf(p).length, 0);
  const tier: 'flash' | 'pro' = careful ? 'pro' : 'flash';
  const searches = careful * MISS_EST.searchesPerPage;
  const dollars = careful * MISS_EST.carefulPageDollars + quick * MISS_EST.quickPageDollars + (pages.length ? (tier === 'pro' ? MISS_EST.proGateDollars : MISS_EST.flashGateDollars) : 0);
  return { newer, pages, careful, quick, entries, tier, searches, dollars };
}

/** Missables rewritten in the staged copy (guides/{key}--next), up to the search cap. */
export async function writeMissables(key: string, game: string, live: any, maxSearches: number) {
  const plan = await missPlan(key, game, live, stageKey(key));
  let searches = 0, dollars = 0, written = 0, found = 0, careful = 0, left = 0;
  const stage = db().collection('guides').doc(stageKey(key)).collection('areas');
  for (const p of plan.pages) {
    if (!p.quick && searches + MISS_EST.searchesPerPage > maxSearches) {
      left++;
      continue;
    }
    try {
      const r = await missablesForPage(game, p, p.quick);
      searches += r.searches;
      dollars += r.dollars;
      written++;
      if (!p.quick) careful++;
      found += r.rewrites.length;
      console.log(`  ${p.quick ? 'quick' : 'searched'} ${p.name}: ${r.rewrites.length}/${missablesOf(p).length} missables rewritten${r.checked ? '' : ' (no searches ran; asked again next run)'}${r.searches ? ` (${r.searches} searches)` : ''}`);
      if (r.rewrites.length || r.checked) {
        await stage.doc(p.slug).set({ ...(r.rewrites.length ? applyMissRewrites(p, r.rewrites, r.sources) : {}), ...(r.checked ? { missablesChecked: true } : {}) }, { merge: true });
      }
    } catch (e: any) {
      console.log(`  failed ${p.name}: ${e?.message || e}`);
    }
  }
  console.log(`Missables: ${found} rewritten on ${written}/${plan.pages.length} pages${left ? ` (${left} left at the search cap)` : ''}.`);
  return { searches, dollars, written, found, left, tier: (careful ? 'pro' : 'flash') as 'flash' | 'pro' };
}

async function cli() {
  let total = { searches: 0, dollars: 0, pages: 0, entries: 0, careful: 0, quick: 0, pro: 0 };
  console.log('Missables plan: the 10 most-used guides');
  for (const game of TOP_GUIDES) {
    const key = gameKey(game);
    const live: any = (await db().collection('guides').doc(key).get()).data();
    if (!live) {
      console.log(`- ${game}: no guide`);
      continue;
    }
    const p = await missPlan(key, game, live);
    total = { searches: total.searches + p.searches, dollars: total.dollars + p.dollars, pages: total.pages + p.pages.length, entries: total.entries + p.entries, careful: total.careful + p.careful, quick: total.quick + p.quick, pro: total.pro + (p.pages.length && p.tier === 'pro' ? 1 : 0) };
    console.log(`- ${game}: ${p.entries} missables on ${p.pages.length} pages (${p.careful} searched, ${p.quick} quick), ≈ ${p.searches} searches, ≈ $${p.dollars.toFixed(2)}, ${p.pages.length ? `${p.tier} gate` : 'nothing to do'}`);
  }
  console.log(`Total: ${total.entries} missables on ${total.pages} pages (${total.careful} searched, ${total.quick} quick), ≈ ${total.searches} searches, ≈ $${total.dollars.toFixed(2)} AI, ${total.pro} Pro gate request(s).`);
  if (arg('queue') === 'true') {
    const ref = db().collection('system').doc('pipeline');
    const state: any = (await ref.get()).data() || {};
    const queue: any[] = Array.isArray(state.carefulQueue) ? state.carefulQueue : [];
    const add = TOP_GUIDES.filter((g) => !queue.some((q) => q.game === g && q.mode === 'missables')).map((game) => ({ game, mode: 'missables', addedAt: Date.now(), why: 'missables made findable for a most-used guide' }));
    // After the queued Key fights repairs, ahead of the rebuilds.
    const at = queue.reduce((n, q, k) => (q.mode === 'fights' || q.mode === 'missables' ? k + 1 : n), 0);
    queue.splice(at, 0, ...add);
    await ref.set({ carefulQueue: queue }, { merge: true });
    console.log(`Queued: ${add.length} guides (mode missables).`);
  }
  setTimeout(() => process.exit(0), 500);
}

if (/missables\.ts$/.test(process.argv[1] || '')) cli().catch((e) => {
  console.error('missables failed:', e?.message || e);
  process.exit(1);
});
