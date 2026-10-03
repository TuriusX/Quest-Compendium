/**
 * Repair a guide the way its review recommends, then put the result through the review gate. Nothing goes live unless
 * the repaired guide passes review: every repair is built into the staged copy (guides/{key}--next) first.
 *
 *   npx tsx scripts/guides/repair.ts --key dead-space --action fix        targeted page fixes from the review's problems
 *   npx tsx scripts/guides/repair.ts --key dead-space --action outline    rebuild with the review's outline (layout)
 *   npx tsx scripts/guides/repair.ts --key hollow-knight --action careful rebuild with research (searches)
 *   options: --plan-only        fix: make and save the fix plan, change nothing (for estimates)
 *            --max-searches N   the search cap for this repair (careful pages, spot-checks); default 300
 *
 *   fix      A plan from the reviewer's per-page problems (no searches): pages to remove (duplicates, wrong kind of
 *            page), pages to rewrite (with the problem passed to the writer), pages to add (missing areas or
 *            chapters) and pages to move. Applied to a staged copy of the guide; pages are rewritten quick where the
 *            game is older than the quick model's cutoff and the page was quick, otherwise the careful way.
 *   outline  A fresh staged build in the outline the review named (quick for games older than the cutoff).
 *   careful  A fresh staged build with research, up to the search cap. A build that stops at the cap continues on
 *            the next run (the staged pages are kept); only a finished build goes to the gate.
 * The gate (review.ts): a pass promotes the staged build to the live guide; a fail puts it on the review queue.
 * Logs "N searches used" and "cost ≈ $x" for the pipeline.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, arg, parseJson, releaseInfo, releasedAfter, stageKey, liveKey, QUICK_MODEL_CUTOFF } from './common';
import { estimateCost } from '../../usage';
import { stageCopy, discard } from './promote';
import { reviewGuide, gateGuide, type Review } from './review';

const PLAN_MODEL = process.env.REVIEW_MODEL || 'gemini-3.1-pro-preview';
const key = liveKey(arg('key') || '');
const action = arg('action') as 'fix' | 'outline' | 'careful';
const planOnly = arg('plan-only') === 'true';
const maxSearches = Math.max(30, Number(arg('max-searches', '300')));
const CAREFUL_PAGE_SEARCHES = 40; // a careful page rewrite: research plus fact-check

let searches = 0;
let dollars = 0;

/** Run build.ts (directly with node, so names with spaces need no shell quoting) and read what it spent. */
function build(args: string[]): { ok: boolean; out: string } {
  const cli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const r = spawnSync(process.execPath, [cli, 'scripts/guides/build.ts', ...args], { encoding: 'utf8', timeout: 45 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  searches += Number((out.match(/(\d+) searches used/) || [])[1] || 0);
  dollars += Number((out.match(/cost ≈ \$(\d+(?:\.\d+)?)/i) || [])[1] || 0);
  const lines = out.split('\n').filter((l) => /^(Areas:|Done|Stopping|Not built|Staged|- |  (draft|held|published))/.test(l));
  console.log(lines.map((l) => `    ${l}`).join('\n'));
  return { ok: r.status === 0, out };
}

type FixPlan = {
  remove: string[];
  redo: { page: string; note: string }[];
  add: { name: string; story: string; after: string }[];
  move: { page: string; after: string }[];
};

/** The fix plan: what to change, from the review, as a small list of page operations. */
async function makePlan(game: string, review: Review, pages: { name: string; story: string; quick: boolean }[]): Promise<FixPlan> {
  const res: any = await gemini().models.generateContent({
    model: PLAN_MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `A review of the player's guide for the video game "${game}" scored it ${review.score}/100 and recommends fixing pages.`,
      `Turn the review into a short list of page fixes. Only fix what the review found; leave good pages alone.`,
      `- remove: a page that duplicates another, or is the wrong kind of page for this guide (a topic, character or overview`,
      `  page in a guide of places, say). Its useful content isn't lost: the rewrites can mention it in their notes.`,
      `- redo: a page with wrong, invented, misplaced or thin content. Give a note saying exactly what's wrong and what the page`,
      `  must cover, so the writer can fix it.`,
      `- add: a major area or chapter the guide is missing, with a few words on when it happens, after an existing page.`,
      `- move: a page in the wrong place in the order, after another page ("" for the very start).`,
      `Use the page names exactly as listed. At most 12 operations, most important first.`,
      ``,
      `Review summary: ${review.summary}`,
      `Problems: ${[...review.structure.problems, ...review.coverage.problems, ...review.depth.problems, ...review.knowledge.problems, ...review.ordering.problems].join(' / ')}`,
      `Problem pages:`,
      ...review.pages.map((p) => `- ${p.name} (${p.verdict}): ${p.reason}`),
      ``,
      `The guide's pages, in order (outline: ${review.layout}):`,
      ...pages.map((p) => `- ${p.name}${p.story ? `: ${p.story}` : ''}`),
      ``,
      `Reply with JSON only: {"remove": ["page"], "redo": [{"page": "...", "note": "..."}], "add": [{"name": "...", "story": "...", "after": "page"}], "move": [{"page": "...", "after": "page"}]}`,
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  dollars += estimateCost(PLAN_MODEL, res) || 0;
  const j: any = parseJson(String(res?.text || '')) || {};
  const names = new Set(pages.map((p) => p.name));
  const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
  const plan: FixPlan = {
    remove: (j.remove || []).map((x: any) => s(x, 100)).filter((n: string) => names.has(n)),
    redo: (j.redo || []).map((x: any) => ({ page: s(x?.page, 100), note: s(x?.note, 500) })).filter((x: any) => names.has(x.page)),
    add: (j.add || []).map((x: any) => ({ name: s(x?.name, 100), story: s(x?.story, 120), after: s(x?.after, 100) })).filter((x: any) => x.name && !names.has(x.name)),
    move: (j.move || []).map((x: any) => ({ page: s(x?.page, 100), after: s(x?.after, 100) })).filter((x: any) => names.has(x.page)),
  };
  const removed = new Set(plan.remove);
  plan.redo = plan.redo.filter((x) => !removed.has(x.page));
  plan.move = plan.move.filter((x) => !removed.has(x.page));
  return plan;
}

/** Put `slug` right after the page named `after` ("" = first) in the staged order. */
function placeAfter(order: any[], slug: string, after: string) {
  const i = order.findIndex((o) => o.slug === slug);
  if (i < 0) return;
  const [item] = order.splice(i, 1);
  const j = after ? order.findIndex((o) => o.name === after) : -1;
  order.splice(j + 1, 0, item);
}

async function fix(game: string, review: Review, newer: boolean): Promise<boolean> {
  const liveRef = db().collection('guides').doc(key);
  const info: any = (await liveRef.get()).data() || {};
  const docs = new Map((await liveRef.collection('areas').get()).docs.map((d) => [d.id, d.data() as any]));
  const pages = (info.areas || []).map((o: any) => ({ ...o, page: docs.get(o.slug) })).filter((o: any) => ['published', 'draft'].includes(o.page?.status));
  const plan = await makePlan(game, review, pages.map((o: any) => ({ name: o.page.name || o.name, story: o.page.story || o.story || '', quick: o.page.verified === false })));
  fs.mkdirSync('scratchpad/reviews', { recursive: true });
  fs.writeFileSync(`scratchpad/reviews/${key}.fix.json`, JSON.stringify(plan, null, 1));
  await liveRef.set({ fixPlan: { ...plan, at: Date.now() } }, { merge: true });
  console.log(`Fix plan: remove ${plan.remove.length}, rewrite ${plan.redo.length}, add ${plan.add.length}, move ${plan.move.length}.`);
  for (const r of plan.remove) console.log(`  remove ${r}`);
  for (const r of plan.redo) console.log(`  rewrite ${r.page}: ${r.note}`);
  for (const r of plan.add) console.log(`  add ${r.name} (${r.story}) after ${r.after || 'the start'}`);
  for (const r of plan.move) console.log(`  move ${r.page} after ${r.after || 'the start'}`);
  if (planOnly) return false;

  await discard(key); // start from the live guide as it is now
  await stageCopy(key);
  const stageRef = db().collection('guides').doc(stageKey(key));
  const byName = (n: string) => pages.find((o: any) => (o.page.name || o.name) === n);
  for (const n of plan.remove) {
    const o = byName(n);
    if (o) await stageRef.collection('areas').doc(o.slug).update({ status: 'held', heldReason: 'removed by a review fix' });
  }
  // Rewrites and additions, one page each. Quick only for a quick page of a game older than the cutoff.
  const jobs = [
    ...plan.redo.map((r) => ({ name: r.page, story: byName(r.page)?.page.story || '', note: r.note, quick: !newer && byName(r.page)?.page.verified === false })),
    ...plan.add.map((a) => ({ name: a.name, story: a.story, note: 'This page is new: the guide was missing it.', quick: !newer && review.buildMode !== 'careful' })),
  ];
  for (const j of jobs) {
    if (!j.quick && searches + CAREFUL_PAGE_SEARCHES > maxSearches) {
      console.log(`  skipped ${j.name}: the search cap is reached`);
      continue;
    }
    console.log(`  ${j.quick ? 'quick' : 'careful'}: ${j.name}`);
    build(['--game', game, '--stage', '--area', `${j.name} | ${j.story}`, '--redo', '--note', j.note,
      ...(j.quick ? ['--quick'] : ['--max-searches', String(Math.min(CAREFUL_PAGE_SEARCHES, maxSearches - searches))])]);
  }
  // The order: removed pages out, added and moved pages where the plan says.
  const st: any = (await stageRef.get()).data() || {};
  const held = new Set((await stageRef.collection('areas').where('status', '==', 'held').get()).docs.map((d) => d.id));
  const order = (st.areas || []).filter((o: any) => !held.has(o.slug));
  for (const a of plan.add) {
    const o = order.find((x: any) => x.name === a.name);
    if (o) placeAfter(order, o.slug, a.after);
  }
  for (const m of plan.move) {
    const o = byName(m.page);
    if (o) placeAfter(order, o.slug, m.after);
  }
  await stageRef.set({ areas: order }, { merge: true });
  return true;
}

async function main() {
  if (!key || !['fix', 'outline', 'careful'].includes(action)) {
    console.log('Usage: npx tsx scripts/guides/repair.ts --key key --action fix|outline|careful [--plan-only] [--max-searches 300]');
    process.exit(1);
  }
  const live: any = (await db().collection('guides').doc(key).get()).data();
  if (!live) throw new Error(`no guide ${key}`);
  const game = String(live.game || key);
  const review: Review | undefined = live.review;
  const rel = await releaseInfo(game, Number(live.appId) || undefined);
  const newer = releasedAfter(rel, QUICK_MODEL_CUTOFF, !!live.pipeline?.newRelease);
  console.log(`Repair (${action}): ${game}, released ${rel.text}${newer ? ' (after the quick cutoff: careful only)' : ''}.`);

  let ready = true;
  if (action === 'fix') {
    if (!review) throw new Error('no review to fix from: run review.ts first');
    ready = await fix(game, review, newer);
  } else {
    // A fresh staged build; a careful one that stopped at the search cap last time just continues.
    const staged = (await db().collection('guides').doc(stageKey(key)).get()).data();
    if (staged && (action === 'outline' || staged.repair !== 'careful')) await discard(key);
    const layout = review?.layout || live.layout || 'area';
    const quick = action === 'outline' && !newer;
    const r = build(['--game', game, '--stage', '--layout', layout,
      ...(quick ? ['--quick', '--part', 'the whole game, in story order', '--areas', '40'] : ['--part', 'the whole game, in story order', '--areas', '40', '--max-searches', String(maxSearches)])]);
    await db().collection('guides').doc(stageKey(key)).set({ repair: action }, { merge: true }).catch(() => {});
    if (/Stopping: search cap/.test(r.out)) {
      ready = false;
      console.log('Repair: the careful build stopped at the search cap; it continues on the next run.');
    }
  }
  if (ready) {
    const r = await reviewGuide(stageKey(key), { save: true, verify: false });
    dollars += r.dollars;
    searches += r.searches;
    console.log(r.review ? `Review: ${r.review.score}/100, ${r.review.recommendation}.` : 'Review: nothing staged to review.');
    if (r.review) console.log(await gateGuide(stageKey(key), game, r.review));
  }
  console.log(`Done: repair (${action}) of ${game}, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Repair failed:', e?.message || e);
  process.exit(1);
});
