/**
 * Guide reviewer: grades a guide (its published and draft pages). Gemini 3.1 Pro for careful builds' final gates (a
 * daily allowance, see reviewerQuota.ts), Gemini 3.8 Flash for everything else (pass mark 80 for quick guides).
 *
 *   npx tsx scripts/guides/review.ts --game "Dead Space"          one guide (or --key dead-space; a staged build is
 *                                                                 --key dead-space--next)
 *   npx tsx scripts/guides/review.ts --all                        every published guide
 *   options: --estimate      count tokens and print the estimated cost; no grading, nothing saved
 *            --verify        spot-check up to 15 specific names with Google Search (up to 30 searches). Games released
 *                            after the reviewer's knowledge cutoff (REVIEWER_CUTOFF) are always spot-checked, and their
 *                            knowledge grade comes only from it: the reviewer can't tell a real name in a game it
 *                            doesn't know from an invented one.
 *            --gate          the publishing gate: on a pass (score ≥ 75 and at least 5 pages) a staged build is
 *                            promoted to the live guide (promote.ts) or a guide's drafts are published; on a fail the
 *                            guide goes to the review queue (reviewQueue in Firestore, shown on /admin/reviews)
 *            --tier flash   review with Gemini 3.8 Flash (bulk audits); the default is Pro, counted against its daily
 *                           allowance as an "other" use (200 of the 250 are kept for careful rebuilds)
 *            --max-dollars N stop --all before the estimate passes N (default 15)
 *            --concurrency N guides graded at once with --all (default 4)
 *            --no-save       grade and write the report file, but don't save the result on the guide
 *
 * Checks: (a) structure: every page is the same kind of unit (places/regions, or chapters; not a mix of places,
 * characters and topics); (b) coverage: page count and content fit the game's size and type; (c) depth: pages have real
 * entries (items, missables, where/how), thin or generic pages are flagged; (d) knowledge: vague or invented-sounding
 * content, especially for games released after the quick build model's knowledge cutoff; (e) ordering fits the game's
 * type. Output: a score 0–100, pass (≥ 75) or fail, a recommended action (keep / fix pages / rebuild careful / rebuild
 * with a different outline), the layout the game should use, and reasons per page. Saved on the guide as `review` and
 * in scratchpad/reviews/{key}.md. Each run logs its searches ("N searches used") and estimated AI cost ("cost ≈ $x").
 */
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import {
  db, gemini, gameKey, arg, parseJson, searchesIn, guideRelease, releasedAfter, isLayout, isStageKey, liveKey,
  LAYOUT_CHOICES, QUICK_MODEL_CUTOFF, REVIEWER_CUTOFF, type Layout,
} from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';
import { promote } from './promote';
import { PRO_MODEL, FLASH_REVIEW_MODEL, takePro, proExhausted, isQuotaError, ProQuotaWait, type ReviewTier, type ProKind } from './reviewerQuota';

// The reviewer is split by importance (reviewerQuota.ts): Gemini 3.1 Pro for careful builds' final gates, counted per
// day and never replaced by another model; Gemini 3.8 Flash for everything else, with a stricter pass mark for quick
// guides (Flash writes those too).
export const PASS = 75;
export const FLASH_QUICK_PASS = 80;
/** The pass mark for a review: 80 when Flash reviews a quick guide, else 75. */
export const passMark = (tier: ReviewTier, buildMode: string) => (tier === 'flash' && buildMode === 'quick' ? FLASH_QUICK_PASS : PASS);
export const MIN_PAGES = 5;
// Per million tokens, for --estimate: gemini-3.1-pro-preview, and gemini-3.8-flash.
const RATES = { pro: { input: 2.0, output: 12.0 }, flash: { input: 0.75, output: 3.75 } };
const OUTPUT_GUESS = 4500; // output + thinking tokens per review, for --estimate (on the safe side of real reviews)
const OUT_DIR = 'scratchpad/reviews';

const all = arg('all') === 'true';
const estimateOnly = arg('estimate') === 'true';
const verifyArg = arg('verify') === 'true';
/** --tier flash: review with Gemini 3.8 Flash (for bulk audits); the default is Pro, counted as an "other" use. */
const tierArg: ReviewTier = arg('tier') === 'flash' ? 'flash' : 'pro';
const gate = arg('gate') === 'true';
const noSave = arg('no-save') === 'true';
const maxDollars = Number(arg('max-dollars', '15'));
const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency', '4'))));

export type Recommendation = 'keep' | 'fix pages' | 'rebuild careful' | 'rebuild with a different outline';
export type Review = {
  score: number;
  pass: boolean;
  recommendation: Recommendation;
  summary: string;
  /** The layout this game's guide should use (common.ts LAYOUTS); a rebuild with a different outline uses it. */
  layout: Layout;
  structure: { kind: string; consistent: boolean; problems: string[] };
  coverage: { expectedPages: string; ok: boolean; problems: string[] };
  depth: { problems: string[] };
  knowledge: { problems: string[] };
  ordering: { ok: boolean; problems: string[] };
  pages: { name: string; verdict: string; reason: string }[];
  /** The spot-check: names looked up with searches. For games newer than the reviewer, the knowledge grade. */
  verified?: { checked: number; confirmed: number; wrongPlace: number; notFound: string[]; score: number };
  /** Released after the reviewer's knowledge cutoff: knowledge graded by the spot-check only. */
  newerThanReviewer: boolean;
  /** The score from structure, coverage, depth and ordering, before the spot-check was blended in (newer games). */
  baseScore?: number;
  released: string;
  buildMode: 'quick' | 'careful' | 'mixed';
  pageCount: number;
  model: string;
  /** Which reviewer graded it, and the mark it had to reach (80 for a quick guide reviewed by Flash). */
  tier?: ReviewTier;
  passMark?: number;
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
    `## ${cut(p.name, 80)}${p.group ? ` [section: ${cut(p.group, 40)}]` : ''} (${p.verified === false ? 'quick' : 'checked'})`,
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

/** A guide (or a staged build of one): its pages in order, how they were built, and the live guide's details. */
export async function loadGuide(key: string) {
  const ref = db().collection('guides').doc(key);
  const info: any = (await ref.get()).data();
  if (!info) return null;
  // A staged build has no Steam id or pipeline notes of its own (so nothing mistakes it for a live guide).
  const live: any = isStageKey(key) ? (await db().collection('guides').doc(liveKey(key)).get()).data() || {} : info;
  const snap = await ref.collection('areas').get();
  const byslug = new Map(snap.docs.map((d) => [d.id, d.data() as any]));
  const order: { slug: string }[] = Array.isArray(info.areas) ? info.areas : [];
  // In the guide's own order; published and draft pages (held-back pages aren't part of the guide).
  const pages = order.map((o) => byslug.get(o.slug)).filter((p) => p && (p.status === 'published' || p.status === 'draft'));
  const quick = pages.filter((p) => p.verified === false).length;
  const buildMode: Review['buildMode'] = quick === pages.length ? 'quick' : quick === 0 ? 'careful' : 'mixed';
  return { ref, info, live, pages, buildMode, game: String(info.game || live.game || key), appId: Number(live.appId) || undefined, newRelease: !!live.pipeline?.newRelease };
}

function prompt(game: string, released: string, layout: string, buildMode: string, pages: any[], newer: boolean): string {
  return [
    `You are reviewing a video game guide before players rely on it. Game: "${game}" (released on PC: ${released}).`,
    `The guide was written by an AI. Quick pages came from the build model's own knowledge (no research); its knowledge`,
    `stops around ${QUICK_MODEL_CUTOFF}, so quick pages for games released after that are likely vague, generic or invented.`,
    `Checked pages were researched with web searches and two-source confirmation. Build: ${buildMode}. Layout: ${layout}.`,
    `It has ${pages.length} page(s), in the guide's order, condensed below. This summary cuts long text`,
    `short and lists only the first entries of each kind on purpose, to save space: the real pages are complete, so never flag`,
    `cut-off, truncated or mid-sentence text, and judge depth by the entry counts shown in parentheses.`,
    ``,
    `Grade it on:`,
    `(a) structure: every page should be the same kind of unit for this game (places/regions, or the game's chapters/levels).`,
    `    A mix of places, characters, topics or generic labels ("The Fortress of the Antagonist") is a problem.`,
    `(b) coverage: does the page count and content fit the game's size and type? Missing major areas or chapters?`,
    `(c) depth: does each page have real entries (named items, missables, where/how to find them)? Flag thin or generic pages.`,
    newer
      ? `(d) knowledge: SKIP THIS. The game is newer than your knowledge, so you can't tell its real names from invented ones;\n` +
        `    names are checked separately with web searches. Don't call anything invented, fabricated or hallucinated, don't\n` +
        `    lower the score for content you don't recognize, leave "knowledge" problems empty, and only recommend\n` +
        `    "rebuild careful" if the guide is too thin to fix page by page.`
      : `(d) knowledge: flag vague, generic or invented-sounding content (names that don't exist in the game, wrong locations,\n` +
        `    placeholder-like text), especially in quick pages and for games released after ${QUICK_MODEL_CUTOFF}. Only flag what you\n` +
        `    have real reason to doubt; don't flag something just because you don't know it.`,
    `(e) ordering: does the page order fit the game's type (story order for linear games, a sensible route for open worlds)?`,
    ``,
    `Score 0-100 (75+ means players can rely on it as is). Recommend one action: "keep" (fine), "fix pages" (a few pages`,
    `need work), "rebuild careful" (too thin, vague or unreliable to fix page by page: rebuild with research), or "rebuild`,
    `with a different outline" (the pages are the wrong kind of unit or the wrong split for this game).`,
    `Also say which outline this game's guide should use ("layout"), one of:`,
    LAYOUT_CHOICES,
    `In "pages", list only pages with a problem (at most 25), each with a verdict (thin, generic, suspect, wrong-kind,`,
    `out-of-order, duplicate) and a short specific reason.`,
    ``,
    `Reply with JSON only:`,
    `{"score": 0-100, "recommendation": "keep" | "fix pages" | "rebuild careful" | "rebuild with a different outline",`,
    ` "layout": "<one of the outlines above>", "summary": "<two sentences: the guide's main strengths and problems>",`,
    ` "structure": {"kind": "<places | regions | chapters | levels | mixed | other>", "consistent": true|false, "problems": ["..."]},`,
    ` "coverage": {"expectedPages": "<rough page count this game needs, e.g. 20-30>", "ok": true|false, "problems": ["..."]},`,
    ` "depth": {"problems": ["..."]}, "knowledge": {"problems": ["..."]}, "ordering": {"ok": true|false, "problems": ["..."]},`,
    ` "pages": [{"name": "<page name as given>", "verdict": "...", "reason": "..."}]}`,
    ``,
    pages.map(condense).join('\n\n'),
  ].join('\n');
}

const RECS: Recommendation[] = ['keep', 'fix pages', 'rebuild careful', 'rebuild with a different outline'];
function cleanReview(raw: any, base: Pick<Review, 'buildMode' | 'pageCount' | 'model' | 'at' | 'released' | 'newerThanReviewer'>, layout: string): Review {
  const list = (v: any, n = 8) => (Array.isArray(v) ? v.map((x) => cut(x, 240)).filter(Boolean).slice(0, n) : []);
  const score = Math.max(0, Math.min(100, Math.round(Number(raw?.score) || 0)));
  const rec = RECS.includes(raw?.recommendation) ? raw.recommendation : score >= PASS ? 'keep' : 'rebuild careful';
  return {
    score,
    pass: score >= PASS,
    recommendation: rec,
    summary: cut(raw?.summary, 400),
    layout: isLayout(raw?.layout) ? raw.layout : isLayout(layout) ? layout : 'area',
    structure: { kind: cut(raw?.structure?.kind, 30), consistent: raw?.structure?.consistent !== false, problems: list(raw?.structure?.problems) },
    coverage: { expectedPages: cut(raw?.coverage?.expectedPages, 30), ok: raw?.coverage?.ok !== false, problems: list(raw?.coverage?.problems) },
    depth: { problems: list(raw?.depth?.problems) },
    knowledge: { problems: base.newerThanReviewer ? [] : list(raw?.knowledge?.problems) },
    ordering: { ok: raw?.ordering?.ok !== false, problems: list(raw?.ordering?.problems) },
    pages: (Array.isArray(raw?.pages) ? raw.pages : []).slice(0, 25).map((p: any) => ({ name: cut(p?.name, 80), verdict: cut(p?.verdict, 20), reason: cut(p?.reason, 240) })).filter((p: any) => p.name),
    ...base,
  };
}

type Reviewer = { tier: ReviewTier; model: string; kind: ProKind };
const reviewerFor = (tier: ReviewTier, kind: ProKind): Reviewer => ({ tier, kind, model: tier === 'pro' ? PRO_MODEL : FLASH_REVIEW_MODEL });
/** A reviewer call. Pro requests are counted first (ProQuotaWait when today's are used up) and never retried elsewhere. */
async function call(rv: Reviewer, request: any): Promise<any> {
  if (rv.tier === 'pro') await takePro(rv.kind);
  try {
    return await gemini().models.generateContent({ ...request, model: rv.model });
  } catch (e: any) {
    if (rv.tier === 'pro' && isQuotaError(e)) {
      await proExhausted();
      throw new ProQuotaWait();
    }
    throw e;
  }
}

/**
 * The spot-check: specific names from across the guide (an item, or else an enemy or shop, from up to 15 pages spread
 * through it), looked up with Google Search (up to 30 searches). Only checked pages unless `allPages`.
 */
async function spotCheck(rv: Reviewer, game: string, pages: any[], allPages: boolean): Promise<{ result: NonNullable<Review['verified']>; searches: number; dollars: number }> {
  const pool = pages.filter((p) => allPages || p.verified !== false);
  const step = Math.max(1, pool.length / 15);
  const names: string[] = [];
  for (let i = 0; i < pool.length && names.length < 15; i += step) {
    const p = pool[Math.floor(i)];
    const e = (p.items || [])[0] || (p.enemies || [])[0] || (p.shops || [])[0];
    if (e?.name) names.push(`${cut(e.name, 50)}${e.where ? ` (${cut(e.where, 50)})` : ''}, on the page "${cut(p.name, 40)}"`);
  }
  if (!names.length) return { result: { checked: 0, confirmed: 0, wrongPlace: 0, notFound: [], score: 0 }, searches: 0, dollars: 0 };
  let searches = 0, dollars = 0;
  // A grounded reply can't be forced into JSON (and citations can garble it), so it's one line per name. A reply that
  // ran no searches, or that can't be read, is retried once; after that the check counts as not done (checked 0),
  // never as "nothing found".
  for (let attempt = 0; attempt < 2; attempt++) {
    const res: any = await call(rv, {
      contents: [{ role: 'user', parts: [{ text:
        (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') +
        `Search the web to check that each of these really exists in the video game "${game}", at that place in the game. ` +
        `Use at most 30 searches in total. Don't answer from memory: the game may be newer than you.\n` +
        `${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n` +
        `Reply with one line per number and nothing else, exactly: <number>: CONFIRMED | WRONG PLACE | NOT FOUND - <a few words>. ` +
        `CONFIRMED: a source shows it in this game at about that place; WRONG PLACE: it's in the game but somewhere else; ` +
        `NOT FOUND: you found nothing showing it exists in this game.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = searchesIn(res);
    searches += n;
    if (n) recordMonthly(n);
    dollars += estimateCost(rv.model, res) || 0;
    const text = String(res?.text || '');
    if (process.env.REVIEW_DEBUG) console.log('[spot-check]', n, 'searches\n', text.slice(0, 1500));
    const verdicts = new Map<number, string>();
    for (const m of text.matchAll(/^\W*(\d{1,2})\W{0,3}[:.)]\s*\**\s*(CONFIRMED|WRONG PLACE|NOT FOUND)/gim)) verdicts.set(Number(m[1]), m[2].toUpperCase());
    if (!n || verdicts.size < Math.ceil(names.length / 2)) continue;
    const verdict = (i: number) => verdicts.get(i + 1) || 'NOT FOUND';
    const confirmed = names.filter((_, i) => verdict(i) === 'CONFIRMED').length;
    const wrongPlace = names.filter((_, i) => verdict(i) === 'WRONG PLACE').length;
    const notFound = names.filter((_, i) => verdict(i) === 'NOT FOUND').map((x) => cut(x, 100));
    return { result: { checked: names.length, confirmed, wrongPlace, notFound: notFound.slice(0, 10), score: Math.round((100 * (confirmed + wrongPlace / 2)) / names.length) }, searches, dollars };
  }
  console.warn('  spot-check: no usable searched reply, so names are unchecked');
  return { result: { checked: 0, confirmed: 0, wrongPlace: 0, notFound: [], score: 0 }, searches, dollars };
}

function report(game: string, key: string, r: Review): string {
  const sec = (title: string, items: string[]) => (items.length ? `\n**${title}**\n${items.map((x) => `- ${x}`).join('\n')}\n` : '');
  return [
    `# ${game}: guide review`,
    ``,
    `Score **${r.score}/100**: ${r.pass ? 'pass' : 'fail'} (pass mark ${r.passMark ?? PASS}, ${r.tier === 'flash' ? 'Flash' : 'Pro'} reviewer). Recommended: **${r.recommendation}** (outline: ${r.layout}).`,
    `${r.pageCount} pages (${r.buildMode} build), released ${r.released}. Reviewed by ${r.model} on ${new Date(r.at).toISOString().slice(0, 10)}.`,
    r.newerThanReviewer ? `Released after the reviewer's knowledge cutoff: knowledge graded by the spot-check only (structure etc. scored ${r.baseScore}).` : '',
    ``,
    r.summary,
    sec(`Structure (${r.structure.kind}${r.structure.consistent ? ', consistent' : ', not one kind of page'})`, r.structure.problems),
    sec(`Coverage (expected about ${r.coverage.expectedPages} pages)`, r.coverage.problems),
    sec('Depth', r.depth.problems),
    sec('Knowledge', r.knowledge.problems),
    sec('Ordering', r.ordering.problems),
    r.verified ? `\n**Spot-check:** ${r.verified.confirmed}/${r.verified.checked} names confirmed, ${r.verified.wrongPlace} in the wrong place (knowledge ${r.verified.score}/100)${r.verified.notFound.length ? `; not found: ${r.verified.notFound.join('; ')}` : ''}\n` : '',
    r.pages.length ? `\n## Pages with problems\n\n| Page | Verdict | Reason |\n|---|---|---|\n${r.pages.map((p) => `| ${p.name} | ${p.verdict} | ${p.reason.replace(/\|/g, '/')} |`).join('\n')}\n` : '',
    `\nGuide key: ${key}`,
  ].join('\n');
}

/**
 * Review one guide (or a staged build). Returns the review plus what it cost. opts.tier: 'pro' (careful builds' final
 * gates; opts.proKind 'careful' may use the whole daily allowance) or 'flash' (everything else). Throws ProQuotaWait
 * when Pro's daily requests are used up: the caller waits for the next day.
 */
export async function reviewGuide(key: string, opts: { save: boolean; verify: boolean; tier?: ReviewTier; proKind?: ProKind }): Promise<{ review: Review | null; dollars: number; searches: number; game: string }> {
  const rv = reviewerFor(opts.tier || 'pro', opts.proKind || 'other');
  const g = await loadGuide(key);
  if (!g || !g.pages.length) return { review: null, dollars: 0, searches: 0, game: g?.game || key };
  const rel = await guideRelease(g.game, g.live);
  const newer = releasedAfter(rel, REVIEWER_CUTOFF, g.newRelease);
  const layout = String(g.info.layout || 'area');
  const res: any = await call(rv, {
    contents: [{ role: 'user', parts: [{ text: prompt(g.game, rel.text, layout, g.buildMode, g.pages, newer) }] }],
    config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let dollars = estimateCost(rv.model, res) || 0;
  let searches = 0;
  const raw = parseJson(String(res?.text || ''));
  if (!raw) throw new Error('the reviewer did not return a readable grade');
  const review = cleanReview(raw, { buildMode: g.buildMode, pageCount: g.pages.length, model: rv.model, at: Date.now(), released: rel.text, newerThanReviewer: newer }, layout);
  const mark = passMark(rv.tier, g.buildMode);
  review.tier = rv.tier;
  review.passMark = mark;
  review.pass = review.score >= mark;
  // Newer games: always spot-checked (every page), and the knowledge grade is the spot-check's. Older games: on
  // request, checked pages only, and it can only pull a guide down.
  if (newer || (opts.verify && g.buildMode !== 'quick')) {
    const v = await spotCheck(rv, g.game, g.pages, newer);
    review.verified = v.result;
    dollars += v.dollars;
    searches += v.searches;
    const k = v.result;
    if (k.notFound.length) review.knowledge.problems.unshift(`Spot-check: ${k.confirmed} of ${k.checked} names confirmed, ${k.wrongPlace} in the wrong place; not found: ${k.notFound.slice(0, 5).join('; ')}`);
    if (!k.checked) review.knowledge.problems.unshift('Spot-check could not run (no names, or no searched reply): knowledge unchecked.');
    if (newer) {
      review.baseScore = review.score;
      review.score = k.checked ? Math.round(0.6 * review.score + 0.4 * k.score) : Math.min(review.score, mark - 1); // nothing to check: can't pass
      if (k.checked && k.score < 50) review.recommendation = 'rebuild careful';
    } else if (k.checked && k.score < 50) {
      review.score = Math.min(review.score, 60);
      review.recommendation = 'rebuild careful';
    }
    review.pass = review.score >= mark;
    if (review.pass && review.recommendation === 'rebuild careful') review.recommendation = 'fix pages';
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/${key}.md`, report(g.game, key, review));
  if (opts.save) await g.ref.set({ review }, { merge: true });
  return { review, dollars, searches, game: g.game };
}

/** Put a guide that failed review on the review queue (one open entry per guide; the latest review replaces it). */
export async function queueForReview(key: string, game: string, review: Review, staged: boolean) {
  const live = liveKey(key);
  const problems = [...review.structure.problems, ...review.knowledge.problems, ...review.depth.problems, ...review.coverage.problems, ...review.ordering.problems].slice(0, 6);
  await db().collection('reviewQueue').doc(`review-${live}`).set({
    kind: 'review', key: live, game, staged, status: 'open',
    score: review.score, recommendation: review.recommendation, layout: review.layout, summary: review.summary,
    problems, pages: review.pages.slice(0, 15), buildMode: review.buildMode, pageCount: review.pageCount,
    action: null, createdAt: Date.now(), updatedAt: Date.now(),
  }, { merge: true });
}

/** The gate: publish a guide that passes, queue one that doesn't. Returns a line for the log. */
export async function gateGuide(key: string, game: string, review: Review): Promise<string> {
  if (review.pass && review.pageCount >= MIN_PAGES) {
    if (isStageKey(key)) {
      const r = await promote(key);
      await db().collection('reviewQueue').doc(`review-${liveKey(key)}`).set({ status: 'done', resolution: 'passed review', updatedAt: Date.now() }, { merge: true }).catch(() => {});
      return `Gate: passed (${review.score}); promoted, ${r?.published || 0} page(s) live.`;
    }
    const drafts = await db().collection('guides').doc(key).collection('areas').where('status', '==', 'draft').get();
    for (const d of drafts.docs) await d.ref.update({ status: 'published', updatedAt: Date.now() });
    return `Gate: passed (${review.score}); ${drafts.size} draft page(s) published.`;
  }
  await queueForReview(key, game, review, isStageKey(key));
  return `Gate: failed (${review.score}${review.pageCount < MIN_PAGES ? `, only ${review.pageCount} page(s)` : ''}); queued for review: ${review.recommendation}.`;
}

/** The guides --all covers: every live guide with at least one published page. */
async function publishedGuides(): Promise<string[]> {
  const snap = await db().collection('guides').get();
  const keys: string[] = [];
  for (const d of snap.docs) {
    if (isStageKey(d.id)) continue;
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
    const text = prompt(g.game, 'unknown', String(g.info.layout || 'area'), g.buildMode, g.pages, false);
    const c: any = await gemini().models.countTokens({ model: tierArg === 'pro' ? PRO_MODEL : FLASH_REVIEW_MODEL, contents: [{ role: 'user', parts: [{ text }] }] });
    const tokens = Number(c?.totalTokens || 0);
    per.push({ key, tokens, dollars: (tokens * RATES[tierArg].input + OUTPUT_GUESS * RATES[tierArg].output) / 1_000_000 });
  }
  return { total: per.reduce((n, x) => n + x.dollars, 0), per };
}

async function main() {
  const keys = all ? await publishedGuides() : [arg('key') || (arg('game') ? gameKey(arg('game')!) : '')].filter(Boolean);
  if (!keys.length) {
    console.log('Usage: npx tsx scripts/guides/review.ts --game "Game" | --key key | --all  [--estimate] [--verify] [--gate] [--max-dollars 15]');
    process.exit(1);
  }
  const est = await estimate(keys);
  console.log(`${est.per.length} guide(s) to review with ${tierArg === 'pro' ? PRO_MODEL : FLASH_REVIEW_MODEL}: about ${Math.round(est.per.reduce((n, x) => n + x.tokens, 0) / 1000)}k input tokens, estimated cost ≈ $${est.total.toFixed(2)} (plus spot-checks: up to 30 searches for each game newer than ${REVIEWER_CUTOFF}${verifyArg ? ' or checked guide' : ''}).`);
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
        const r = await reviewGuide(key, { save: !noSave, verify: verifyArg, tier: tierArg });
        dollars += r.dollars;
        searches += r.searches;
        done++;
        if (r.review) {
          rows.push({ key, game: r.game, ...r.review });
          const v = r.review.verified;
          console.log(`${r.review.pass ? 'PASS' : 'FAIL'} ${String(r.review.score).padStart(3)} ${r.game} (${r.review.buildMode}, ${r.review.pageCount} pages${v ? `, spot-check ${v.confirmed}/${v.checked}` : ''}): ${r.review.recommendation}, outline ${r.review.layout} | run total ≈ $${dollars.toFixed(3)}`);
          if (gate && !noSave) console.log(await gateGuide(key, r.game, r.review));
        } else if (gate) console.log('Gate: failed (no pages to review).');
      } catch (e: any) {
        if (e instanceof ProQuotaWait) {
          console.log(`Gate: waiting (${e.message}; reviewed tomorrow).`);
          queue.length = 0;
          break;
        }
        failed++;
        console.warn(`failed: ${key}: ${e?.message}`);
      }
    }
  }));
  if (all) fs.writeFileSync(`${OUT_DIR}/audit.json`, JSON.stringify(rows, null, 1));
  console.log(`Done: ${done} guide(s) reviewed, ${rows.filter((r) => r.pass).length} passed, ${failed} failed to review, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
  setTimeout(() => process.exit(failed && !done ? 1 : 0), 1500);
}

if (/review\.ts$/.test(process.argv[1] || '')) {
  main().catch((e) => {
    console.error('Review failed:', e?.message || e);
    process.exit(1);
  });
}
