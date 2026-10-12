/**
 * The usefulness benchmark for compendium pages: what the best quick answer about an entity says (the kind of answer
 * Google's AI overview gives), and whether our page covers it.
 *
 *   one searched call (allowed sources only: Fandom and Fextralife never count): the best quick answer for the entity,
 *     its key points (each marked core or extra, with a kind: location, how to get or unlock, quests and outcomes,
 *     choices and consequences, recruitment and romance, combat and strategy, rewards and drops, timing and missables,
 *     identity and lore, stats and abilities, other), and the questions players most ask about it; the sentences the
 *     sources back become evidence the page build can reuse
 *   one check (no search): which key points the live page covers
 * Saved on the page (entities/{slug}.benchmark) so the rebuild reuses it.
 *
 *   npx tsx scripts/guides/benchmark.ts --estimate                 pages and cost, nothing run
 *   npx tsx scripts/guides/benchmark.ts --all [--only <key>]       every live page (stops at the day's search limit)
 *   npx tsx scripts/guides/benchmark.ts --sample 10 [--reserve 500] each guide's 10 highest-demand pages
 *       (entities/{slug}.demand from scripts/pipeline/scCompendium.ts); stops while --reserve searches are still left
 *       for the day's other runs
 *   npx tsx scripts/guides/benchmark.ts --key <key> --name "<entity>"
 *   npx tsx scripts/guides/benchmark.ts --report                   per guide: pages missing core points, common gaps
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope, searchesIn } from './common';
import { supportedSegments, trustedSites, type Evidence } from './claimCheck';
import { apiLimits, searchesToday, pipelineRoom } from '../../apiLimits';

export const BENCH_COST = 0.065; // dollars a page: the searched answer (about 4 searches) and the check
export const KINDS = ['location', 'how to get or unlock', 'quests and outcomes', 'choices and consequences', 'recruitment and romance', 'combat and strategy', 'rewards and drops', 'timing and missables', 'identity and lore', 'stats and abilities', 'other'] as const;
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};

export type BenchPoint = { point: string; kind: string; core: boolean; covered?: boolean };
export type Benchmark = { at: number; answer: string; points: BenchPoint[]; questions: string[]; evidence: Evidence[]; sites: string[]; cost: { dollars: number; searches: number } };

/** Everything a page says, as plain text (for the coverage check). */
export function pageText(e: any): string {
  const s = e.summary || {};
  const q = e.quest || {};
  const r = e.ref || {};
  return [
    e.overview,
    ...(e.qa || []).map((x: any) => `${x.q}: ${x.a}`),
    s.region, s.where, s.gettingThere,
    ...(s.whereToFind || []).map((w: any) => `${w.when || ''} ${w.where}`),
    ...(s.shops || []).map((x: any) => `${x.name}: ${x.what || ''}`), ...(s.services || []),
    ...(s.places || []).map((x: any) => `${x.name}: ${x.what || ''}`), ...(s.collectibles || []).map((x: any) => `${x.name}: ${x.where || ''}`),
    ...(s.quests || []).map((x: any) => `${x.name} (${x.kind || ''} ${x.chapter || ''})`), ...(s.notes || []),
    q.giver, q.chapter, q.where, ...(q.rewards || []), ...(q.missables || []), ...(q.goldMedal || []), ...(q.choices || []).map((c: any) => `${c.choice} -> ${c.outcome}`),
    ...(q.parts || []).flatMap((p: any) => [p.name, p.where, ...(p.steps || []).map((x: any) => x.text)]),
    ...(r.sections || []).map((x: any) => `${x.heading}: ${x.text}`), ...(r.items || []).map((x: any) => `${x.name}: ${x.where || ''} ${x.notes || ''}`),
  ].filter(Boolean).join('\n');
}

/** The best quick answer, its key points and the top questions, searched (allowed sources only). */
export async function benchmarkAnswer(game: string, name: string, typeLabel: string): Promise<Omit<Benchmark, 'at' | 'cost'>> {
  const prompt = [
    `A player of the video game "${game}" searches for "${name}" (${typeLabel}). Search the web (the game's wikis and guides; never fandom.com or fextralife.com) and write the best possible quick answer: what a player most needs to know, the way a top search answer would put it.`,
    'Then list its key points and the questions players most ask about it. Use exactly this layout:',
    'ANSWER:',
    '<4 to 8 sentences>',
    'POINTS:',
    `- core | <kind> | <one specific fact>   (core = a player would expect any good page to say it; extra = nice to have; kind is one of: ${KINDS.join(', ')})`,
    'QUESTIONS:',
    '- <a question players ask about it>',
    'Give 5 to 10 points and 3 to 8 questions, most important first. Only facts the sources state.',
  ].join('\n');
  let res: any = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const r: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `${attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : ''}${prompt}` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    if (searchesIn(r)) res = r;
  }
  if (!res) throw new Error(`the benchmark for "${name}" ran no searches twice; not using a memory answer`);
  const text = String(res?.text || '');
  const part = (label: string, next?: string) => {
    const i = text.indexOf(`${label}:`);
    if (i < 0) return '';
    const j = next ? text.indexOf(`${next}:`, i) : -1;
    return text.slice(i + label.length + 1, j < 0 ? undefined : j).trim();
  };
  const points: BenchPoint[] = part('POINTS', 'QUESTIONS').split('\n').map((l) => l.replace(/^[\s*-]+/, '').trim()).filter(Boolean).map((l) => {
    const [a, b, ...rest] = l.split('|').map((x) => x.trim());
    if (!rest.length) return null;
    const kind = (KINDS as readonly string[]).find((k) => k === String(b || '').toLowerCase()) || 'other';
    return { point: cut(rest.join(' | '), 240), kind, core: /core/i.test(a) };
  }).filter((x): x is BenchPoint => !!x && x.point.length > 5).slice(0, 12);
  const questions = part('QUESTIONS').split('\n').map((l) => cut(l.replace(/^[\s*-]+/, ''), 160)).filter((l) => l.length > 5).slice(0, 8);
  // The sentences the sources back (allowed sources only) are evidence the rebuild can reuse.
  const evidence: Evidence[] = [];
  const sites = new Set<string>();
  for (const seg of supportedSegments(res)) {
    const src = trustedSites(seg.sites);
    if (!src.length || evidence.some((x) => x.text === seg.text)) continue;
    evidence.push({ id: `b${evidence.length + 1}`, text: cut(seg.text, 400), sources: src.slice(0, 4), topic: 'benchmark' });
    src.forEach((s) => sites.add(s));
  }
  return { answer: cut(part('ANSWER', 'POINTS'), 1500), points, questions, evidence, sites: [...sites] };
}

/** Which key points a page covers (no search). */
export async function coverage(game: string, name: string, page: string, points: BenchPoint[]): Promise<boolean[]> {
  if (!points.length) return [];
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `Our compendium page about "${name}" in the video game "${game}":`,
      page || '(empty)',
      '',
      'For each key point below, does the page state that fact (same meaning; wording may differ)? A page that only hints at it, or states something different, does not cover it.',
      ...points.map((p, i) => `P${i + 1}: ${p.point}`),
      'Reply with JSON only: {"covered": [true, false, ...]} (one per point, in order).',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const c = objOf(String(res?.text || '')).covered;
  return points.map((_, i) => (Array.isArray(c) ? c[i] === true : false));
}

/** Benchmark one live page and save the result on it. */
export async function benchmarkPage(key: string, slug: string) {
  const ref = db().collection('guideCompendium').doc(key).collection('entities').doc(slug);
  const e: any = (await ref.get()).data();
  if (!e) throw new Error(`no page ${key}/${slug}`);
  const game = String((await db().collection('guides').doc(key).get()).data()?.game || key);
  const scope = { dollars: 0, searches: 0 };
  const b = await usageScope.run(scope, async () => {
    const a = await benchmarkAnswer(game, e.name, e.typeLabel || e.type);
    const cov = await coverage(game, e.name, pageText(e), a.points);
    return { ...a, points: a.points.map((p, i) => ({ ...p, covered: cov[i] })) };
  });
  const out: Benchmark = { at: Date.now(), ...b, cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches } };
  await ref.set({ benchmark: JSON.parse(JSON.stringify(out)) }, { merge: true });
  const missing = out.points.filter((p) => p.core && !p.covered);
  console.log(`${key} / ${e.name}: ${out.points.filter((p) => p.covered).length}/${out.points.length} points covered, ${missing.length} core missing${missing.length ? ` (${missing.map((p) => p.kind).join(', ')})` : ''}, $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
  return out;
}

async function livePages(only?: string) {
  const out: { key: string; slug: string; e: any }[] = [];
  for (const c of (await db().collection('guideCompendium').get()).docs) {
    if (only && c.id !== only) continue;
    for (const d of (await c.ref.collection('entities').where('status', '==', 'published').get()).docs) out.push({ key: c.id, slug: d.id, e: d.data() });
  }
  return out;
}

/** Per guide: pages with a core point missing, and the most common kinds missing. */
export async function report(only?: Set<string>) {
  const pages = (await livePages()).filter((p) => !only || only.has(`${p.key}/${p.slug}`));
  const by = new Map<string, { pages: number; benched: number; missingCore: number; kinds: Map<string, number>; cost: number }>();
  for (const p of pages) {
    const g = by.get(p.key) || { pages: 0, benched: 0, missingCore: 0, kinds: new Map(), cost: 0 };
    g.pages++;
    const b = p.e.benchmark;
    if (b?.points) {
      g.benched++;
      g.cost += Number(b.cost?.dollars || 0);
      const miss = b.points.filter((x: BenchPoint) => x.core && !x.covered);
      if (miss.length) g.missingCore++;
      for (const m of miss) g.kinds.set(m.kind, (g.kinds.get(m.kind) || 0) + 1);
    }
    by.set(p.key, g);
  }
  for (const [k, g] of by) console.log(`${k}: ${g.missingCore} of ${g.benched} benchmarked page(s) miss a core point (${g.pages} live); most missing: ${[...g.kinds].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([kind, n]) => `${kind} ${n}`).join(', ') || '-'}; $${g.cost.toFixed(2)}`);
}

async function main() {
  const only = arg('only') && arg('only') !== 'true' ? String(arg('only')) : undefined;
  if (arg('estimate') === 'true') {
    const pages = await livePages(only);
    console.log(`${pages.length} live page(s), about $${(pages.length * BENCH_COST).toFixed(2)} and ${pages.length * 4} searches.`);
  } else if (arg('report') === 'true') await report();
  else if (arg('all') === 'true' || arg('sample')) {
    let total = 0;
    let pages = await livePages(only);
    const reserve = Math.max(15, Number(arg('reserve')) || 0);
    if (arg('sample')) {
      const n = Number(arg('sample')) || 10;
      const by = new Map<string, typeof pages>();
      for (const p of pages) by.set(p.key, [...(by.get(p.key) || []), p]);
      pages = [...by.values()].flatMap((xs) => xs.sort((a, b) => Number(b.e.demand?.score || 0) - Number(a.e.demand?.score || 0)).slice(0, n));
      console.log(`Sample: ${pages.length} page(s): ${pages.map((p) => `${p.key.split('-')[0]}/${p.e.name} ${p.e.demand?.score ?? '?'}`).join(', ')}`);
    }
    for (const p of pages) {
      if (p.e.benchmark?.points && arg('again') !== 'true') continue;
      if (pipelineRoom(await apiLimits(), await searchesToday(true)) < reserve) { console.log(`Stopping: fewer than ${reserve} of today's pipeline searches left; run again later (benchmarked pages are skipped).`); break; }
      try { total += (await benchmarkPage(p.key, p.slug)).cost.dollars; } catch (e: any) { console.log(`${p.key} / ${p.e.name}: ${cut(e?.message || e, 120)}`); if (/search day limit/i.test(String(e?.message))) break; }
    }
    console.log(`\nBenchmark: $${total.toFixed(2)} this run.`);
    await report(arg('sample') ? new Set(pages.map((p) => `${p.key}/${p.slug}`)) : undefined);
  } else if (arg('key') && arg('name')) {
    const { entitySlug } = await import('./compendium');
    await benchmarkPage(String(arg('key')), entitySlug(String(arg('name'))));
  }
  setTimeout(() => process.exit(0), 300);
}
if (/benchmark\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('benchmark failed:', e?.message || e); process.exit(1); });
