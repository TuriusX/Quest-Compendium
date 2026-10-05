/**
 * Repair a guide the way its review recommends, then put the result through the review gate. Nothing goes live unless
 * the repaired guide passes review: every repair is built into the staged copy (guides/{key}--next) first.
 *
 *   npx tsx scripts/guides/repair.ts --key dead-space --action fix        targeted page fixes from the review's problems
 *   npx tsx scripts/guides/repair.ts --key dead-space --action outline    rebuild with the review's outline (layout)
 *   npx tsx scripts/guides/repair.ts --key hollow-knight --action careful rebuild with research (searches)
 *   options: --plan-only        fix: make and save the fix plan, change nothing (for estimates)
 *            --game "Name"      the game's name, for a game with no guide yet (a new guide is an outline repair)
 *            --quick-only       outline: stop if the game is newer than the quick cutoff ("Not built: ...")
 *            --report "text"    fix: a player's mistake report to fix as well
 *            --max-searches N   the search cap for this repair (careful pages, spot-checks); default 300
 *
 *   fix      A plan from the reviewer's per-page problems (no searches): pages to remove (duplicates, wrong kind of
 *            page), pages to rewrite (with the problem passed to the writer), pages to add (missing areas or
 *            chapters) and pages to move. Applied to a staged copy of the guide; pages are rewritten quick where the
 *            game is older than the quick model's cutoff and the page was quick, otherwise the careful way.
 *   outline  A fresh staged build in the outline the review named (quick for games older than the cutoff).
 *   extend   More pages for a guide (the 3-week revisit of a new release): a staged copy plus careful pages.
 *   upgrade  The guide's quick pages checked the careful way, in a staged copy.
 *   fights   Key fights (bosses, set-piece battles) for published pages that have none (scripts/guides/fights.ts),
 *            in a staged copy: quick pages of games older than the cutoff without searches, the rest with searches.
 *   missables Only the missable entries, rewritten to the standard (findable anchor, exact final step, what locks it
 *            out; scripts/guides/missables.ts), in a staged copy: quick pages of older games without searches, the rest
 *            with searches.
 *   queries  The pages the weekly Search Console check planned (system/searchConsole): entries that answer players'
 *            searches vaguely rewritten, missing answers added, and a clearer title and description for pages ranking
 *            5-20 (scripts/guides/queryRepair.ts), in a staged copy.
 *   careful  A fresh staged build with research, up to the search cap. A build that stops at the cap continues on
 *            the next run (the staged pages are kept); only a finished build goes to the gate.
 * A guide can override its outline for outline and careful rebuilds: guides/{key}.outline = { layout, extraPages:
 * [{ name, story, note }] } (extra pages go first). The gate (review.ts): a pass promotes the staged build to the live guide; a fail puts it on the review queue.
 * Logs "N searches used" and "cost ≈ $x" for the pipeline.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, gameKey, arg, parseJson, guideRelease, releasedAfter, stageKey, liveKey, QUICK_MODEL_CUTOFF } from './common';
import { estimateCost } from '../../usage';
import { stageCopy, discard } from './promote';
import { reviewGuide, gateGuide, type Review } from './review';
import { FLASH_REVIEW_MODEL, ProQuotaWait, type ReviewTier } from './reviewerQuota';
import { writeFights } from './fights';
import { writeMissables } from './missables';
import { writeQueryFixes } from './queryRepair';

// Page fixes are Flash work (reviewerQuota.ts): the fix plan and the fixed guide's gate.
const PLAN_MODEL = FLASH_REVIEW_MODEL;
const key = liveKey(arg('key') || (arg('game') && arg('game') !== 'true' ? gameKey(arg('game')!) : ''));
const ACTIONS = ['fix', 'outline', 'careful', 'extend', 'upgrade', 'fights', 'missables', 'queries'];
const action = arg('action') as 'fix' | 'outline' | 'careful' | 'extend' | 'upgrade' | 'fights' | 'missables' | 'queries';
const gameArg = arg('game') && arg('game') !== 'true' ? arg('game')! : '';
/** outline only: a game newer than the quick cutoff isn't built (the pipeline queues a careful build instead). */
const quickOnly = arg('quick-only') === 'true';
/** fix: a player's mistake report to fix as well (from the review queue). */
const reportText = arg('report') && arg('report') !== 'true' ? arg('report')!.slice(0, 1000) : '';
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
  // Not build.ts's own "Done" line: the pipeline reads this run's totals from repair's Done line.
  const lines = out.split('\n').filter((l) => /^(Areas:|Stopping|Not built|Staged|- |  (draft|held|published))/.test(l));
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
      ...(reportText ? [`A player reported this mistake (fix it too, if it's right): ${reportText}`] : []),
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
  if (!key || !ACTIONS.includes(action)) {
    console.log('Usage: npx tsx scripts/guides/repair.ts --key key [--game "Name"] --action fix|outline|careful|extend|upgrade|fights|missables|queries [--plan-only] [--quick-only] [--report "text"] [--max-searches 300]');
    process.exit(1);
  }
  const live: any = (await db().collection('guides').doc(key).get()).data();
  if (!live && !gameArg) throw new Error(`no guide ${key} (pass --game for a game with no guide yet)`);
  const game = String(live?.game || gameArg);
  let review: Review | undefined = live?.review;
  const rel = await guideRelease(game, live);
  const newer = releasedAfter(rel, QUICK_MODEL_CUTOFF, !!live?.pipeline?.newRelease);
  console.log(`Repair (${action}): ${game}, released ${rel.text}${newer ? ' (after the quick cutoff: careful only)' : ''}.`);
  if (quickOnly && newer && action === 'outline') {
    console.log(`Not built: released ${rel.text}, after the quick model's knowledge cutoff (${QUICK_MODEL_CUTOFF}); it needs a careful build.`);
    console.log(`Done: repair (${action}) of ${game}, 0 searches used, estimated AI cost ≈ $0.00.`);
    return setTimeout(() => process.exit(0), 500);
  }

  // The final gate's reviewer: Pro for careful builds and rebuilds (anything that ends up Checked), Flash for page
  // fixes and quick rebuilds. A careful build whose gate had to wait for Pro (its daily requests used up) goes straight
  // to the gate on the next run, without building again.
  let tier: ReviewTier = action === 'fix' || (action === 'outline' && !newer) ? 'flash' : 'pro';
  const waiting: any = (await db().collection('guides').doc(stageKey(key)).get()).data();
  // Key fights: Pro when any page was searched (it ends up Checked), Flash when every page was quick.
  if ((action === 'fights' || action === 'missables' || action === 'queries') && waiting?.passTier) tier = waiting.passTier;
  const gateOnly = !!waiting?.awaitingGate && waiting.repair === action;
  let ready = true;
  if (gateOnly) console.log('Repair: built earlier; its review waited for the Pro reviewer, so it goes straight to the gate.');
  else if (action === 'fights' || action === 'missables' || action === 'queries') {
    // Page passes: key fights added, missables rewritten to the standard, or search queries answered, page by page in
    // a staged copy.
    if (!live) throw new Error(`no guide ${key}`);
    const what = action === 'fights' ? 'key fights' : action === 'missables' ? 'missables' : 'search query answers';
    const stageRef = db().collection('guides').doc(stageKey(key));
    const staged: any = (await stageRef.get()).data();
    // Another rebuild of this guide is staged (a careful build part-way, say): never thrown away for a page pass.
    if (staged && staged.repair && staged.repair !== action) {
      ready = false;
      console.log(`Repair: a ${staged.repair} rebuild of this guide is staged; ${what} wait and continues on the next run.`);
    } else {
      // A run that stopped at the search cap carries on in its staged copy; otherwise a fresh copy of the live guide.
      const resume = staged?.repair === action && staged?.passPending === true;
      if (!resume) {
        await discard(key);
        await stageCopy(key);
      }
      const r = action === 'fights' ? await writeFights(key, game, live, maxSearches)
        : action === 'missables' ? await writeMissables(key, game, live, maxSearches)
          : await writeQueryFixes(key, game, maxSearches);
      searches += r.searches;
      dollars += r.dollars;
      const found = (resume ? Number(staged.passFound || 0) : 0) + r.found;
      // Pro when any page was searched, in this run or an earlier one.
      tier = r.tier === 'pro' || (resume && staged.passTier === 'pro') ? 'pro' : 'flash';
      await stageRef.set({ repair: action, passTier: tier, passFound: found, passPending: r.left > 0 }, { merge: true });
      if (r.left > 0) {
        ready = false;
        console.log(`Repair: ${r.left} page(s) left at the search cap; ${what} continues on the next run.`);
      } else if (!found) {
        ready = false;
        await discard(key);
        console.log(`Gate: skipped (no ${what} to ${action === 'fights' ? 'add' : 'write'}).`);
      }
    }
  } else if (action === 'fix') {
    // A guide reviewed before (or a player report about one that wasn't): review it first.
    if (!review) {
      const r = await reviewGuide(key, { save: true, verify: false, tier: 'flash' });
      dollars += r.dollars;
      searches += r.searches;
      review = r.review || undefined;
    }
    if (!review) throw new Error('nothing to fix: the guide has no pages');
    ready = await fix(game, review, newer);
  } else if (action === 'extend' || action === 'upgrade') {
    // Adds to the live guide (more pages, or quick pages checked), so the staged build starts as a copy of it.
    await discard(key);
    const r = build(['--game', game, '--stage', '--copy-live', '--max-searches', String(maxSearches),
      ...(action === 'upgrade' ? ['--upgrade'] : ['--part', 'the whole game, especially areas not covered yet', '--areas', '25'])]);
    await db().collection('guides').doc(stageKey(key)).set({ repair: action }, { merge: true }).catch(() => {});
    if (!r.ok && !/Done/.test(r.out)) ready = false;
  } else {
    // A fresh staged build; a careful one that stopped at the search cap last time just continues.
    const staged = (await db().collection('guides').doc(stageKey(key)).get()).data();
    const quickBuild = action === 'outline' && !newer;
    if (staged && (quickBuild || staged.repair !== action)) await discard(key);
    // The outline the review named; a game with no review gets one picked by build.ts.
    // The guide's outline override (guides/{key}.outline: { layout, extraPages }) wins over the review's outline.
    const layout = live?.outline?.layout || review?.layout;
    const quick = quickBuild;
    const r = build(['--game', game, '--stage', ...(layout ? ['--layout', layout] : []), '--part', 'the whole game, in story order', '--areas', '40',
      ...(quick ? ['--quick'] : ['--max-searches', String(maxSearches)])]);
    await db().collection('guides').doc(stageKey(key)).set({ repair: action }, { merge: true }).catch(() => {});
    if (/Stopping: search cap/.test(r.out)) {
      ready = false;
      console.log('Repair: the careful build stopped at the search cap; it continues on the next run.');
    } else {
      // Pages the guide's outline override asks for on top of the layout (Dawnwalker's main questline and its
      // 30-day timer, say), first in the guide.
      const extra: { name: string; story?: string; note?: string }[] = Array.isArray(live?.outline?.extraPages) ? live.outline.extraPages : [];
      for (const p of extra) {
        console.log(`  extra page: ${p.name}`);
        build(['--game', game, '--stage', '--area', `${p.name} | ${p.story || ''}`, '--redo', ...(p.note ? ['--note', p.note] : []),
          ...(quick ? ['--quick'] : ['--max-searches', String(Math.max(30, Math.min(60, maxSearches - searches)))])]);
      }
      if (extra.length) {
        const stageRef = db().collection('guides').doc(stageKey(key));
        const order: any[] = ((await stageRef.get()).data()?.areas || []).slice();
        for (const p of [...extra].reverse()) {
          const i = order.findIndex((o) => o.name === p.name);
          if (i > 0) order.unshift(...order.splice(i, 1));
        }
        await stageRef.set({ areas: order }, { merge: true });
      }
    }
  }
  if (ready) {
    try {
      const r = await reviewGuide(stageKey(key), { save: true, verify: false, tier, proKind: 'careful' });
      dollars += r.dollars;
      searches += r.searches;
      await db().collection('guides').doc(stageKey(key)).set({ awaitingGate: false }, { merge: true }).catch(() => {});
      console.log(r.review ? `Review: ${r.review.score}/100 (pass mark ${r.review.passMark}, ${tier} reviewer), ${r.review.recommendation}.` : 'Review: nothing staged to review.');
      console.log(r.review ? await gateGuide(stageKey(key), game, r.review) : 'Gate: failed (nothing was built).');
    } catch (e: any) {
      if (!(e instanceof ProQuotaWait)) throw e;
      // Never another model for a careful build's gate: it waits (staged, unpublished) for tomorrow's Pro requests.
      await db().collection('guides').doc(stageKey(key)).set({ awaitingGate: true, repair: action }, { merge: true });
      console.log(`Gate: waiting (${e.message}); the staged build is reviewed on the next run.`);
    }
  }
  console.log(`Done: repair (${action}) of ${game}, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Repair failed:', e?.message || e);
  process.exit(1);
});
