/**
 * Guide reviewer: grades a guide (its published and draft pages) with a stronger model than quick builds use.
 *
 *   npx tsx scripts/guides/review.ts --game "Dead Space"          one guide (or --key dead-space)
 *   npx tsx scripts/guides/review.ts --all                        every published guide
 *   options: --estimate      count tokens and print the estimated cost; no grading, nothing saved
 *            --verify        for checked (careful) pages: spot-check up to 30 specific names with Google Search
 *            --max-dollars N stop --all before the estimate passes N (default 15)
 *            --concurrency N guides graded at once with --all (default 4)
 *            --no-save       grade and write the report file, but don't save the result on the guide
 *
 * Checks: (a) structure: every page is the same kind of unit (places/regions, or chapters; not a mix of places,
 * characters and topics); (b) coverage: page count and content fit the game's size and type; (c) depth: pages have real
 * entries (items, missables, where/how), thin or generic pages are flagged; (d) knowledge: vague or invented-sounding
 * content, especially for games released after the quick build model's knowledge cutoff (QUICK_MODEL_CUTOFF, default
 * 2025-01, from how quick builds of 2024 and 2025 games turned out); (e) ordering fits the game's type.
 * Output: a score 0–100, pass (≥ 75) or fail, a recommended action (keep / fix pages / rebuild careful / rebuild with a
 * different outline), and reasons per page. Saved on the guide as `review` and in scratchpad/reviews/{key}.md.
 * No searches unless --verify. Each run logs its estimated AI cost ("cost ≈ $x").
 */
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, gameKey, arg, parseJson, searchesIn } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';

const REVIEW_MODEL = process.env.REVIEW_MODEL || 'gemini-3.1-pro-preview'; // stronger than the build model (gemini-3.8-flash)
const QUICK_MODEL_CUTOFF = process.env.QUICK_MODEL_CUTOFF || '2025-01';
const PASS = 75;
const RATES = { input: 2.0, output: 12.0 }; // per million tokens, for --estimate (gemini-3.1-pro-preview)
const OUTPUT_GUESS = 4500; // output + thinking tokens per review, for --estimate (measured on real reviews)
const OUT_DIR = 'scratchpad/reviews';

const all = arg('all') === 'true';
const estimateOnly = arg('estimate') === 'true';
const verify = arg('verify') === 'true';
const noSave = arg('no-save') === 'true';
const maxDollars = Number(arg('max-dollars', '15'));
const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency', '4'))));

export type Recommendation = 'keep' | 'fix pages' | 'rebuild careful' | 'rebuild with a different outline';
export type Review = {
  score: number;
  pass: boolean;
  recommendation: Recommendation;
  summary: string;
  structure: { kind: string; consistent: boolean; problems: string[] };
  coverage: { expectedPages: string; ok: boolean; problems: string[] };
  depth: { problems: string[] };
  knowledge: { problems: string[] };
  ordering: { ok: boolean; problems: string[] };
  pages: { name: string; verdict: string; reason: string }[];
  verified?: { checked: number; confirmed: number; notFound: string[] };
  buildMode: 'quick' | 'careful' | 'mixed';
  pageCount: number;
  model: string;
  at: number;
};

const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A page, condensed: what's on it and where, enough to judge structure, depth and how real it sounds. */
function condense(p: any): string {
  const items = (p.items || []).slice(0, 14).map((e: any) => `${cut(e.name, 50)}${e.where ? ` @ ${cut(e.where, 70)}` : ''}${e.missable ? ' [missable]' : ''}`);
  const secrets = (p.secrets || []).slice(0, 6).map((e: any) => cut(e.text || e.name, 90));
  const enemies = (p.enemies || []).slice(0, 8).map((e: any) => `${cut(e.name, 40)}${e.weakness ? ` (weak: ${cut(e.weakness, 30)})` : ''}`);
  const shops = (p.shops || []).slice(0, 4).map((e: any) => cut(e.name, 40));
  const sections = (p.sections || []).slice(0, 4).map((x: any) => `${cut(x.title, 40)}: ${(x.entries || []).slice(0, 4).map((e: any) => cut(e.text, 60)).join('; ')}`);
  const tips = (p.tips || []).slice(0, 3).map((t: any) => cut(t, 90));
  return [
    `## ${cut(p.name, 80)}${p.group ? ` [section: ${cut(p.group, 40)}]` : ''} (${p.verified === false ? 'quick' : 'checked'}, ${p.status})`,
    p.story ? `when: ${cut(p.story, 120)}` : '',
    p.overview ? `overview: ${cut(p.overview, 220)}` : '',
    items.length ? `items (${(p.items || []).length}): ${items.join(' | ')}` : 'items: none',
    secrets.length ? `secrets (${(p.secrets || []).length}): ${secrets.join(' | ')}` : '',
    enemies.length ? `enemies (${(p.enemies || []).length}): ${enemies.join(' | ')}` : '',
    shops.length ? `shops: ${shops.join(' | ')}` : '',
    sections.length ? `sections: ${sections.join(' || ')}` : '',
    tips.length ? `tips: ${tips.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
}

/** The game's release date on Steam (the PC date; a console original may be earlier). */
async function releaseDate(appId?: number): Promise<string> {
  if (!appId) return 'unknown';
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=release_date&cc=us&l=english`);
    const d: any = (await r.json())?.[appId]?.data;
    return d?.release_date?.date || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function loadGuide(key: string) {
  const ref = db().collection('guides').doc(key);
  const info: any = (await ref.get()).data();
  if (!info) return null;
  const snap = await ref.collection('areas').get();
  const byslug = new Map(snap.docs.map((d) => [d.id, d.data() as any]));
  const order: { slug: string }[] = Array.isArray(info.areas) ? info.areas : [];
  // In the guide's own order; published and draft pages (held-back pages aren't part of the guide).
  const pages = order.map((o) => byslug.get(o.slug)).filter((p) => p && (p.status === 'published' || p.status === 'draft'));
  const quick = pages.filter((p) => p.verified === false).length;
  const buildMode: Review['buildMode'] = quick === pages.length ? 'quick' : quick === 0 ? 'careful' : 'mixed';
  return { ref, info, pages, buildMode, game: String(info.game || key) };
}

function prompt(game: string, released: string, layout: string, buildMode: string, pages: any[]): string {
  return [
    `You are reviewing a video game guide before players rely on it. Game: "${game}" (released on PC: ${released}).`,
    `The guide was written by an AI. Quick pages came from the build model's own knowledge (no research); its knowledge`,
    `stops around ${QUICK_MODEL_CUTOFF}, so quick pages for games released after that are likely vague, generic or invented.`,
    `Checked pages were researched with web searches and two-source confirmation. Build: ${buildMode}. Layout: ${layout}.`,
    `It has ${pages.length} page(s), in the guide's order, condensed below (entries are trimmed).`,
    ``,
    `Grade it on:`,
    `(a) structure: every page should be the same kind of unit for this game (places/regions, or the game's chapters/levels).`,
    `    A mix of places, characters, topics or generic labels ("The Fortress of the Antagonist") is a problem.`,
    `(b) coverage: does the page count and content fit the game's size and type? Missing major areas or chapters?`,
    `(c) depth: does each page have real entries (named items, missables, where/how to find them)? Flag thin or generic pages.`,
    `(d) knowledge: flag vague, generic or invented-sounding content (names that don't exist in the game, wrong locations,`,
    `    placeholder-like text), especially in quick pages and for games released after ${QUICK_MODEL_CUTOFF}. Only flag what you`,
    `    have real reason to doubt; don't flag something just because you don't know it.`,
    `(e) ordering: does the page order fit the game's type (story order for linear games, a sensible route for open worlds)?`,
    ``,
    `Score 0-100 (75+ means players can rely on it as is). Recommend one action: "keep" (fine), "fix pages" (a few pages`,
    `need work), "rebuild careful" (too thin, vague or unreliable to fix page by page: rebuild with research), or "rebuild`,
    `with a different outline" (the pages are the wrong kind of unit or the wrong split for this game).`,
    `In "pages", list only pages with a problem (at most 25), each with a verdict (thin, generic, suspect, wrong-kind,`,
    `out-of-order, duplicate) and a short specific reason.`,
    ``,
    `Reply with JSON only:`,
    `{"score": 0-100, "recommendation": "keep" | "fix pages" | "rebuild careful" | "rebuild with a different outline",`,
    ` "summary": "<two sentences: the guide's main strengths and problems>",`,
    ` "structure": {"kind": "<places | regions | chapters | levels | mixed | other>", "consistent": true|false, "problems": ["..."]},`,
    ` "coverage": {"expectedPages": "<rough page count this game needs, e.g. 20-30>", "ok": true|false, "problems": ["..."]},`,
    ` "depth": {"problems": ["..."]}, "knowledge": {"problems": ["..."]}, "ordering": {"ok": true|false, "problems": ["..."]},`,
    ` "pages": [{"name": "<page name as given>", "verdict": "...", "reason": "..."}]}`,
    ``,
    pages.map(condense).join('\n\n'),
  ].join('\n');
}

const RECS: Recommendation[] = ['keep', 'fix pages', 'rebuild careful', 'rebuild with a different outline'];
function cleanReview(raw: any, base: Pick<Review, 'buildMode' | 'pageCount' | 'model' | 'at'>): Review {
  const list = (v: any, n = 8) => (Array.isArray(v) ? v.map((x) => cut(x, 240)).filter(Boolean).slice(0, n) : []);
  const score = Math.max(0, Math.min(100, Math.round(Number(raw?.score) || 0)));
  const rec = RECS.includes(raw?.recommendation) ? raw.recommendation : score >= PASS ? 'keep' : 'rebuild careful';
  return {
    score,
    pass: score >= PASS,
    recommendation: rec,
    summary: cut(raw?.summary, 400),
    structure: { kind: cut(raw?.structure?.kind, 30), consistent: raw?.structure?.consistent !== false, problems: list(raw?.structure?.problems) },
    coverage: { expectedPages: cut(raw?.coverage?.expectedPages, 30), ok: raw?.coverage?.ok !== false, problems: list(raw?.coverage?.problems) },
    depth: { problems: list(raw?.depth?.problems) },
    knowledge: { problems: list(raw?.knowledge?.problems) },
    ordering: { ok: raw?.ordering?.ok !== false, problems: list(raw?.ordering?.problems) },
    pages: (Array.isArray(raw?.pages) ? raw.pages : []).slice(0, 25).map((p: any) => ({ name: cut(p?.name, 80), verdict: cut(p?.verdict, 20), reason: cut(p?.reason, 240) })).filter((p: any) => p.name),
    ...base,
  };
}

/** --verify: spot-check up to 10 specific names from checked pages with Google Search (up to 30 searches). */
async function spotCheck(game: string, pages: any[]): Promise<{ result: Review['verified']; searches: number; dollars: number }> {
  const names = pages
    .filter((p) => p.verified !== false)
    .flatMap((p) => (p.items || []).slice(0, 2).map((e: any) => `${cut(e.name, 50)} (${cut(p.name, 40)})`))
    .slice(0, 10);
  if (!names.length) return { result: { checked: 0, confirmed: 0, notFound: [] }, searches: 0, dollars: 0 };
  const res: any = await gemini().models.generateContent({
    model: REVIEW_MODEL,
    contents: [{ role: 'user', parts: [{ text:
      `Search the web to check that each of these really exists in the video game "${game}" at that place. Use at most 30 searches in total.\n` +
      `${names.map((n) => `- ${n}`).join('\n')}\nReply with JSON only: {"confirmed": ["<names you found>"], "notFound": ["<names you couldn't confirm>"]}` }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const searches = searchesIn(res);
  if (searches) recordMonthly(searches);
  const j: any = parseJson(String(res?.text || '')) || {};
  return {
    result: { checked: names.length, confirmed: Array.isArray(j.confirmed) ? j.confirmed.length : 0, notFound: (Array.isArray(j.notFound) ? j.notFound : []).map((x: any) => cut(x, 80)).slice(0, 10) },
    searches,
    dollars: estimateCost(REVIEW_MODEL, res) || 0,
  };
}

function report(game: string, key: string, released: string, r: Review): string {
  const sec = (title: string, items: string[]) => (items.length ? `\n**${title}**\n${items.map((x) => `- ${x}`).join('\n')}\n` : '');
  return [
    `# ${game}: guide review`,
    ``,
    `Score **${r.score}/100**: ${r.pass ? 'pass' : 'fail'}. Recommended: **${r.recommendation}**.`,
    `${r.pageCount} pages (${r.buildMode} build), released ${released}. Reviewed by ${r.model} on ${new Date(r.at).toISOString().slice(0, 10)}.`,
    ``,
    r.summary,
    sec(`Structure (${r.structure.kind}${r.structure.consistent ? ', consistent' : ', not one kind of page'})`, r.structure.problems),
    sec(`Coverage (expected about ${r.coverage.expectedPages} pages)`, r.coverage.problems),
    sec('Depth', r.depth.problems),
    sec('Knowledge', r.knowledge.problems),
    sec('Ordering', r.ordering.problems),
    r.verified ? `\n**Spot-check:** ${r.verified.confirmed}/${r.verified.checked} names confirmed${r.verified.notFound.length ? `; not found: ${r.verified.notFound.join(', ')}` : ''}\n` : '',
    r.pages.length ? `\n## Pages with problems\n\n| Page | Verdict | Reason |\n|---|---|---|\n${r.pages.map((p) => `| ${p.name} | ${p.verdict} | ${p.reason.replace(/\|/g, '/')} |`).join('\n')}\n` : '',
    `\nGuide key: ${key}`,
  ].join('\n');
}

/** Review one guide. Returns the review plus what it cost. */
export async function reviewGuide(key: string, opts: { save: boolean; verify: boolean }): Promise<{ review: Review | null; dollars: number; searches: number; game: string; released: string }> {
  const g = await loadGuide(key);
  if (!g || !g.pages.length) return { review: null, dollars: 0, searches: 0, game: g?.game || key, released: '' };
  const released = await releaseDate(Number(g.info.appId) || undefined);
  const res: any = await gemini().models.generateContent({
    model: REVIEW_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt(g.game, released, String(g.info.layout || 'area'), g.buildMode, g.pages) }] }],
    config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let dollars = estimateCost(REVIEW_MODEL, res) || 0;
  let searches = 0;
  const raw = parseJson(String(res?.text || ''));
  if (!raw) throw new Error('the reviewer did not return a readable grade');
  const review = cleanReview(raw, { buildMode: g.buildMode, pageCount: g.pages.length, model: REVIEW_MODEL, at: Date.now() });
  if (opts.verify && g.buildMode !== 'quick') {
    const v = await spotCheck(g.game, g.pages);
    review.verified = v.result;
    dollars += v.dollars;
    searches += v.searches;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/${key}.md`, report(g.game, key, released, review));
  if (opts.save) await g.ref.set({ review }, { merge: true });
  return { review, dollars, searches, game: g.game, released };
}

/** The guides --all covers: every guide with at least one published page. */
async function publishedGuides(): Promise<string[]> {
  const snap = await db().collection('guides').get();
  const keys: string[] = [];
  for (const d of snap.docs) {
    const pub = await d.ref.collection('areas').where('status', '==', 'published').limit(1).get();
    if (!pub.empty) keys.push(d.id);
  }
  return keys;
}

async function estimate(keys: string[]): Promise<{ total: number; per: { key: string; tokens: number; dollars: number }[] }> {
  const per: { key: string; tokens: number; dollars: number }[] = [];
  for (const key of keys) {
    const g = await loadGuide(key);
    if (!g || !g.pages.length) continue;
    const text = prompt(g.game, 'unknown', String(g.info.layout || 'area'), g.buildMode, g.pages);
    const c: any = await gemini().models.countTokens({ model: REVIEW_MODEL, contents: [{ role: 'user', parts: [{ text }] }] });
    const tokens = Number(c?.totalTokens || 0);
    per.push({ key, tokens, dollars: (tokens * RATES.input + OUTPUT_GUESS * RATES.output) / 1_000_000 });
  }
  return { total: per.reduce((n, x) => n + x.dollars, 0), per };
}

async function main() {
  const keys = all ? await publishedGuides() : [arg('key') || (arg('game') ? gameKey(arg('game')!) : '')].filter(Boolean);
  if (!keys.length) {
    console.log('Usage: npx tsx scripts/guides/review.ts --game "Game" | --key key | --all  [--estimate] [--verify] [--max-dollars 15]');
    process.exit(1);
  }
  const est = await estimate(keys);
  console.log(`${est.per.length} guide(s) to review with ${REVIEW_MODEL}: about ${Math.round(est.per.reduce((n, x) => n + x.tokens, 0) / 1000)}k input tokens, estimated cost ≈ $${est.total.toFixed(2)}${verify ? ' (plus spot-check searches)' : ''}.`);
  if (estimateOnly) {
    for (const x of est.per.sort((a, b) => b.dollars - a.dollars).slice(0, 10)) console.log(`  ${x.key}: ${x.tokens} tokens, ≈ $${x.dollars.toFixed(3)}`);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  if (all && est.total > maxDollars) {
    console.log(`Stopping: the estimate (≈ $${est.total.toFixed(2)}) is over the $${maxDollars} limit.`);
    setTimeout(() => process.exit(1), 500);
    return;
  }
  let dollars = 0, searches = 0, done = 0, failed = 0;
  const rows: any[] = [];
  const queue = [...est.per.map((x) => x.key)];
  await Promise.all(Array.from({ length: all ? concurrency : 1 }, async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
      if (dollars > maxDollars) break;
      try {
        const r = await reviewGuide(key, { save: !noSave, verify });
        dollars += r.dollars;
        searches += r.searches;
        done++;
        if (r.review) {
          rows.push({ key, game: r.game, released: r.released, ...r.review });
          console.log(`${r.review.pass ? 'PASS' : 'FAIL'} ${String(r.review.score).padStart(3)} ${r.game} (${r.review.buildMode}, ${r.review.pageCount} pages): ${r.review.recommendation} | run total ≈ $${dollars.toFixed(3)}`);
        }
      } catch (e: any) {
        failed++;
        console.warn(`failed: ${key}: ${e?.message}`);
      }
    }
  }));
  if (all) fs.writeFileSync(`${OUT_DIR}/audit.json`, JSON.stringify(rows, null, 1));
  console.log(`Done: ${done} guide(s) reviewed, ${rows.filter((r) => r.pass).length} passed, ${failed} failed to review, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
  setTimeout(() => process.exit(failed && !done ? 1 : 0), 1000);
}

main().catch((e) => {
  console.error('Review failed:', e?.message || e);
  process.exit(1);
});
