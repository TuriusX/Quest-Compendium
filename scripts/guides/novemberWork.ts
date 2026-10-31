/**
 * The site audit's content work (roadmap item 22) for November 2026, in the owner's order. Since Oct 26 2026 (owner) it
 * has no allowance of its own: it is paid from the pipeline's November cap ($60; the nightly run gives it at most
 * AUDIT_DAILY a day, never more than the pipeline has left that day and month, and charges what it spent like any
 * step). Rebuilds keep the old page's entries unless sources contradict them (rebuildGuard.ts). The order:
 *
 *   1. reverify    the queue's pages (highest Search Console impressions first) rebuilt with the evidence method; a page
 *                  goes live only when it passes the review and the rebuild guard agrees
 *   2. epilogue    the RDR2 story missions the plan names but were never built (Epilogue Part 2)
 *   3. places      place pages for held RDR2 places people still search for, at their old addresses
 *   4. missions    RDR2 story missions get their own steps, gold medal and rewards (a failed rebuild keeps the page)
 *   5. glossary    official localised page names for translated guides (sourced only)
 *   6. conflicts   the consistency report's contradictions settled against stored evidence (corrected by autoImprove.ts)
 *
 * Since Oct 31 2026 (owner) area walkthroughs come first, so the quest log can match what the player is doing on every
 * game: RDR2's chapter steps get their place names (stepPlaces.ts), then every page without a walkthrough is rebuilt
 * with one by the same evidence method as re-verification (checked against sources; the rebuild guard keeps its
 * entries), the guides with the most questions and search traffic first (system/demand), a few guides a night: three
 * pages each of three guides, in turn among the twelve most in demand (walkthroughQueue). The queue's other work follows.
 * Every 10 walkthrough pages, fewer than 7 going live pauses it (system/auditWork.paused) until the owner looks.
 *
 *   npx tsx scripts/guides/novemberWork.ts --setup        write the queue and the allowance (no AI)
 *   npx tsx scripts/guides/novemberWork.ts --queue-walkthroughs [--dry]   put the area walkthroughs first (no AI)
 *   npx tsx scripts/guides/novemberWork.ts --run [--max 5] do up to $max of the next work (only in November 2026)
 *   npx tsx scripts/guides/novemberWork.ts --status       what's done, spent and left
 * Each step is charged to system/auditWork.spent (and shows in the pipeline's cost lines like any run).
 */
import fs from 'fs';
import { FieldValue } from 'firebase-admin/firestore';
import { db, arg, usageScope } from './common';
import { acquireGuideLock, isRefusal, releaseGuideLocks } from './guideLock';

export const AUDIT_MONTH = '2026-11';
export const AUDIT_DAILY = Number(process.env.AUDIT_DAILY || 5);
const ref = () => db().collection('system').doc('auditWork');
const month = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 7);
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export type Work = { kind: 'reverify' | 'walkthrough' | 'stepPlaces' | 'epilogue' | 'place' | 'mission' | 'glossary' | 'conflicts'; key: string; ref: string; impressions?: number };
/** Walkthrough pages: this many guides a night, this many pages each, taking turns among this many most in demand. */
const WALK_GUIDES = 3, WALK_PAGES = 3, WALK_POOL = 12;
const hasWalkthrough = (a: any) => (a?.walkthrough || []).some((s: any) => s?.title);

/**
 * The area walkthroughs to build (owner, Oct 31 2026): RDR2's chapters' place names first, then live pages without a
 * walkthrough, the guides with the most demand first (system/demand: search impressions and players' questions), each
 * guide's most-searched pages first (system/searchConsole), then its own order. Three guides a night, three pages each,
 * in turn among the twelve most in demand; a guide that runs out makes room for the next one.
 */
export async function walkthroughQueue(): Promise<Work[]> {
  const { demandScore } = await import('../pipeline/demandReport');
  const dem: any = (await db().collection('system').doc('demand').get()).data() || {};
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const impr = new Map<string, number>();
  for (const p of sc.topPages || []) impr.set(`${p.key}/${p.slug}`, (impr.get(`${p.key}/${p.slug}`) || 0) + Number(p.impressions || 0));
  const out: Work[] = [];
  const rdrInfo: any = (await db().collection('guides').doc('red-dead-redemption-2').get()).data() || {};
  const rdrAt = (s: string) => { const i = (rdrInfo.areas || []).findIndex((o: any) => o.slug === s); return i < 0 ? 999 : i; };
  const chapters = (await db().collection('guides').doc('red-dead-redemption-2').collection('areas').get()).docs
    .filter((d) => { const a: any = d.data(); return a.status === 'published' && hasWalkthrough(a) && /^(chapter|epilogue)/i.test(String(a.name || '')); })
    .sort((a, b) => rdrAt(a.id) - rdrAt(b.id));
  for (const d of chapters) out.push({ kind: 'stepPlaces', key: 'red-dead-redemption-2', ref: d.id });
  // Each guide's pages without a walkthrough, most searched first.
  const lists: { key: string; score: number; pages: Work[] }[] = [];
  for (const g of (await db().collection('guides').get()).docs) {
    if (g.id.includes('--')) continue;
    const order: any[] = (g.data() as any).areas || [];
    const pos = (s: string) => { const i = order.findIndex((o) => o.slug === s); return i < 0 ? 9999 : i; };
    const pages = (await g.ref.collection('areas').get()).docs
      .map((d) => ({ slug: d.id, a: d.data() as any }))
      .filter((x) => x.a.status === 'published' && !hasWalkthrough(x.a))
      .sort((x, y) => (impr.get(`${g.id}/${y.slug}`) || 0) - (impr.get(`${g.id}/${x.slug}`) || 0) || pos(x.slug) - pos(y.slug))
      .map((x): Work => ({ kind: 'walkthrough', key: g.id, ref: x.slug, ...(impr.get(`${g.id}/${x.slug}`) ? { impressions: impr.get(`${g.id}/${x.slug}`) } : {}) }));
    if (pages.length) lists.push({ key: g.id, score: demandScore(dem.guides?.[g.id]), pages });
  }
  lists.sort((a, b) => b.score - a.score);
  const waiting = lists.slice(WALK_POOL);
  const pool = lists.slice(0, WALK_POOL);
  let turn = 0;
  while (pool.length) {
    // A night: the next three guides in turn, three pages each.
    const night = pool.slice(turn, turn + WALK_GUIDES);
    if (night.length < WALK_GUIDES) night.push(...pool.slice(0, Math.min(WALK_GUIDES - night.length, turn)));
    for (const g of night) out.push(...g.pages.splice(0, WALK_PAGES));
    turn += WALK_GUIDES;
    // Guides with nothing left make room for the next in demand (in their place in the turn).
    for (let i = 0; i < pool.length; i++) if (!pool[i].pages.length) {
      const nextG = waiting.shift();
      if (nextG) pool[i] = nextG;
      else { pool.splice(i, 1); if (i < turn) turn--; i--; }
    }
    if (pool.length) turn %= pool.length;
  }
  return out;
}

/** The queue, in the owner's order (re-verification first, highest impressions first). */
export async function buildQueue(gscPages: [string, number, number, number][]): Promise<Work[]> {
  const q: Work[] = [];
  // 1. Re-verification: English guide pages with impressions that aren't checked yet, most impressions first (top 300).
  const rows = gscPages
    .map(([u, , impr]) => ({ m: u.match(/^https:\/\/questcompendium\.com\/guides\/([a-z0-9-]+)\/([a-z0-9-]+)\/$/), impr }))
    .filter((r) => r.m && r.m[2] !== 'achievements')
    .sort((a, b) => b.impr - a.impr);
  for (const r of rows) {
    if (q.length >= 300) break;
    const [key, slug] = [r.m![1], r.m![2]];
    const a: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
    if (!a || a.status !== 'published' || a.verified === true) continue;
    q.push({ kind: 'reverify', key, ref: slug, impressions: r.impr });
  }
  // 2. Epilogue Part 2 missions (the cut-off): the plan's unbuilt names.
  const bp: any = (await db().doc('guideBlueprints/red-dead-redemption-2').get()).data() || {};
  const prog = bp.progress?.['story-quests'] || {};
  const names = [...(prog.plan || []), ...Object.keys(prog.planChapters || {}).filter((n: string) => !(prog.plan || []).includes(n))];
  const built = new Set((await db().collection('guideCompendium/red-dead-redemption-2/entities').get()).docs.map((d) => String((d.data() as any).name)));
  for (const n of names) if (!built.has(n) && /epilogue/i.test(String(prog.planChapters?.[n] || ''))) q.push({ kind: 'epilogue', key: 'red-dead-redemption-2', ref: n });
  // 3. Places: held RDR2 places with impressions, most first (top 40).
  const red = rows.filter((r) => r.m![1] === 'red-dead-redemption-2');
  let places = 0;
  for (const r of red) {
    if (places >= 40) break;
    const a: any = (await db().collection('guides/red-dead-redemption-2/areas').doc(r.m![2]).get()).data();
    if (a?.status !== 'held' || !/^[A-Z]/.test(String(a.name || '')) || /^(chapter|epilogue)/i.test(String(a.name))) continue;
    q.push({ kind: 'place', key: 'red-dead-redemption-2', ref: String(a.name), impressions: r.impr });
    places++;
  }
  // 4. Story missions without their own steps.
  for (const d of (await db().collection('guideCompendium/red-dead-redemption-2/entities').where('type', '==', 'story-missions').get()).docs) {
    const e: any = d.data();
    if (e.status === 'published' && !(e.quest?.parts || []).some((p: any) => (p.steps || []).length)) q.push({ kind: 'mission', key: 'red-dead-redemption-2', ref: String(e.name) });
  }
  // 5. Glossaries: every translated guide and language.
  for (const g of (await db().collection('guides').get()).docs) {
    if (g.id.endsWith('--next')) continue;
    for (const l of (await g.ref.collection('i18n').get()).docs) if ((l.data() as any).areas) q.push({ kind: 'glossary', key: g.id, ref: l.id });
  }
  // 6. Contradictions, game by game (the four compendium games first).
  for (const key of ['elden-ring', 'baldur-s-gate-3', 'the-witcher-3-wild-hunt-complete-edition', 'red-dead-redemption-2']) q.push({ kind: 'conflicts', key, ref: key });
  return q;
}

/** One piece of work, with what it cost (searches included) and how many searches it made. */
export async function doOne(w: Work): Promise<{ status: string; dollars: number; detail: string; searches: number }> {
  const scope = { dollars: 0, searches: 0 };
  let status = 'done', detail = '';
  const lk = await acquireGuideLock(w.key, `November work: ${w.kind}`);
  if (isRefusal(lk)) return { status: 'busy', dollars: 0, detail: `${w.key} is in use`, searches: 0 };
  try {
    await usageScope.run(scope, async () => {
      if (w.kind === 'stepPlaces') {
        const { stepPlaces } = await import('./stepPlaces');
        const r = await stepPlaces(w.key, w.ref);
        status = r.status;
        detail = r.detail.slice(0, 160);
      } else if (w.kind === 'reverify' || w.kind === 'walkthrough') {
        // A walkthrough page is built the same way as a re-verification (owner, Oct 31 2026): from evidence, every claim
        // checked against sources, live only when the review passes and the rebuild guard keeps its entries.
        const { buildPageEvidenceForCore, writePageForCore } = await import('./flagship');
        const info: any = (await db().collection('guides').doc(w.key).get()).data();
        const r: any = await buildPageEvidenceForCore(w.key, String(info.game || w.key), w.ref, info.areas || [], w.key);
        if (r?.review?.status === 'passed') {
          const live = await writePageForCore(w.key, w.ref, r.proto);
          status = live ? 'live' : 'held by the rebuild guard';
          if (live) await db().collection('guides').doc(w.key).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(w.ref) } }, { merge: true });
        } else status = `not live (${r?.review?.status || 'not built'})`;
        detail = String(r?.review?.reason || '').slice(0, 160);
      } else if (w.kind === 'epilogue' || w.kind === 'mission') {
        const { buildQuest } = await import('./quests');
        process.env.QUEST_STORY_STEPS = w.kind === 'mission' ? 'on' : '';
        const r: any = await buildQuest(w.key, w.ref, 'story');
        process.env.QUEST_STORY_STEPS = '';
        status = String(r.status);
      } else if (w.kind === 'place') {
        const { buildEntity } = await import('./compendium');
        const r = await buildEntity(w.key, w.ref, { type: 'locations' });
        status = r.status;
        detail = (r.reasons || []).join(' | ').slice(0, 160);
      } else if (w.kind === 'glossary') {
        const { officialNames } = await import('./officialNames');
        const r = await officialNames(w.key, w.ref);
        detail = `${r.found} found, ${r.changed.length} renamed${r.changed.length ? `: ${r.changed.slice(0, 5).join('; ')}` : ''}`;
      } else if (w.kind === 'conflicts') {
        const { consistencyReport } = await import('./consistency');
        const { resolveConflict } = await import('./resolveConflicts');
        const rep: any = await consistencyReport(w.key);
        const out: string[] = [];
        // Each wrong statement with what the evidence backs instead: the nightly improvements (autoImprove.ts) correct them.
        const items: { name: string; on: string; text: string; why: string; right: string[] }[] = [];
        for (const c of (rep.conflicts || []).slice(0, 25)) {
          const r: any = await resolveConflict(w.key, String(rep.game || w.key), c);
          const wrong = r.verdicts.filter((v: any) => v.verdict === 'contradicted');
          const right = r.verdicts.filter((v: any) => v.verdict === 'supported').map((v: any) => String(v.text).slice(0, 400));
          if (wrong.length) out.push(`${c.name}: wrong on ${wrong.map((v: any) => v.on).join(', ')}`);
          for (const v of wrong) items.push({ name: String(c.name).slice(0, 120), on: String(v.on), text: String(v.text).slice(0, 400), why: String(v.why || '').slice(0, 300), right });
        }
        await ref().set({ conflicts: { [w.key]: { at: Date.now(), wrong: out, items } } }, { merge: true });
        detail = `${out.length} contradiction(s) settled for review`;
      }
    });
  } catch (e: any) {
    status = 'error';
    detail = String(e?.message || e).slice(0, 160);
  } finally {
    await lk.release().catch(() => {});
  }
  return { status, dollars: scope.dollars, detail, searches: scope.searches };
}

/**
 * Up to max dollars of the next work today (November 2026 only). The caller passes what the pipeline has left (its
 * November cap); at most AUDIT_DAILY a day. Returns the summary lines and what it spent, for the pipeline to charge.
 */
export async function runAuditWork(max = AUDIT_DAILY): Promise<{ lines: string[]; dollars: number; searches: number }> {
  const none = { lines: [] as string[], dollars: 0, searches: 0 };
  if (month() !== AUDIT_MONTH && !process.env.AUDIT_FORCE) return none;
  const st: any = (await ref().get()).data() || {};
  if (!st.approved || !Array.isArray(st.queue) || st.paused) return none;
  const spentToday = st.day === day() ? Number(st.spentToday || 0) : 0;
  let room = Math.min(max, AUDIT_DAILY - spentToday);
  let searches = 0;
  const lines: string[] = [];
  let next = Number(st.next || 0), spent = Number(st.spent || 0), today = spentToday, guess = 0.25;
  let reverifySpent = Number(st.reverifySpent || 0);
  while (room > guess && next < st.queue.length) {
    const w: Work = st.queue[next];
    // Already checked since the queue was made (the October fund, the core programme): skipped, free. So is a
    // walkthrough page that has one by now (the core programme built it).
    if (w.kind === 'reverify' || w.kind === 'walkthrough') {
      const a: any = (await db().collection('guides').doc(w.key).collection('areas').doc(w.ref).get()).data();
      if (!a || a.status !== 'published' || (w.kind === 'reverify' ? a.verified === true : hasWalkthrough(a))) { next++; continue; }
    }
    const r = await doOne(w);
    if (r.status === 'busy') break;
    spent += r.dollars; today += r.dollars; room -= r.dollars; searches += r.searches; guess = Math.max(guess * 0.8, r.dollars);
    if (w.kind === 'reverify') reverifySpent += r.dollars;
    next++;
    lines.push(`${w.kind} ${w.key}/${w.ref}: ${r.status}, $${r.dollars.toFixed(3)}${r.detail ? ` (${r.detail})` : ''}`);
    await ref().set({ next, spent, reverifySpent, day: day(), spentToday: today, log: FieldValue.arrayUnion({ at: Date.now(), kind: w.kind, key: w.key, ref: w.ref, status: r.status, dollars: Math.round(r.dollars * 1000) / 1000 }) }, { merge: true });
    // The walkthroughs' checkpoint: every 10 pages, fewer than 7 live pauses the work until the owner looks.
    if (w.kind === 'walkthrough') {
      const cp = await walkCheckpoint();
      if (cp) { lines.push(`⚠️ ${cp}`); break; }
    }
  }
  if (lines.length) lines.unshift(`🧭 November site work (roadmap 22, from the pipeline's November cap): ${lines.length} item(s) today, $${(today - spentToday).toFixed(2)}; $${spent.toFixed(2)} so far this month, ${st.queue.length - next} item(s) left.`);
  return { lines, dollars: today - spentToday, searches };
}

/** Every 10 walkthrough pages since the last check: fewer than 7 live pauses the November work. The reason, or null. */
async function walkCheckpoint(): Promise<string | null> {
  const st: any = (await ref().get()).data() || {};
  const since = Number(st.walkCheckAt || 0);
  const runs = ((st.log || []) as any[]).filter((x) => x.kind === 'walkthrough' && Number(x.at) > since).sort((a, b) => a.at - b.at);
  if (runs.length < 10) return null;
  const ten = runs.slice(0, 10);
  const live = ten.filter((x) => x.status === 'live').length;
  await ref().set({ walkCheckAt: ten[9].at }, { merge: true });
  if (live >= 7) return null;
  const why = `Area walkthroughs paused: ${live} of the last 10 pages went live (under 7). Nothing more is built until the owner looks (system/auditWork.paused).`;
  await ref().set({ paused: { why, at: Date.now() } }, { merge: true });
  return why;
}

/**
 * Monday's Discord summary (owner, Oct 31 2026): the area walkthroughs' week (pages live, held or not live, the guides,
 * what it cost) and what's left.
 */
export async function walkthroughWeekLines(): Promise<string[]> {
  const st: any = (await ref().get()).data() || {};
  const queue: Work[] = st.queue || [];
  if (!queue.some((w) => w.kind === 'walkthrough' || w.kind === 'stepPlaces')) return [];
  const week = Date.now() - 7 * 86_400_000;
  const log = ((st.log || []) as any[]).filter((x) => Number(x.at) > week && (x.kind === 'walkthrough' || x.kind === 'stepPlaces'));
  const pages = log.filter((x) => x.kind === 'walkthrough');
  const live = pages.filter((x) => x.status === 'live');
  const held = pages.filter((x) => x.status === 'held by the rebuild guard').length;
  const guides = [...new Set(live.map((x) => String(x.key)))];
  const chapters = log.filter((x) => x.kind === 'stepPlaces' && x.status === 'done').length;
  const left = queue.slice(Number(st.next || 0)).filter((w) => w.kind === 'walkthrough').length;
  const dollars = log.reduce((s, x) => s + Number(x.dollars || 0), 0);
  const out = [
    `🗺️ Area walkthroughs this week: ${live.length} page(s) live in ${guides.length} guide(s)${guides.length ? ` (${guides.slice(0, 8).join(', ')}${guides.length > 8 ? ', …' : ''})` : ''}, ` +
      `${held} held by the rebuild guard, ${pages.length - live.length - held} not live; ${chapters ? `RDR2 place names on ${chapters} chapter(s); ` : ''}` +
      `$${dollars.toFixed(2)}. ${left} page(s) without a walkthrough still queued.`,
  ];
  if (st.paused?.why) out.push(`⚠️ ${st.paused.why}`);
  return out;
}

async function main() {
  if (arg('queue-walkthroughs') === 'true') {
    // The area walkthroughs go first (owner, Oct 31 2026): the work done stays as it was and the rest follows them. A
    // re-verification of a page that gets a walkthrough is the same build, so it isn't queued twice.
    const st: any = (await ref().get()).data() || {};
    const next = Number(st.next || 0);
    const old: Work[] = st.queue || [];
    const walks = await walkthroughQueue();
    const covered = new Set(walks.map((w) => `${w.key}/${w.ref}`));
    const rest = old.slice(next).filter((w) => w.kind !== 'walkthrough' && w.kind !== 'stepPlaces' && !(w.kind === 'reverify' && covered.has(`${w.key}/${w.ref}`)));
    const queue = [...old.slice(0, next), ...walks, ...rest];
    const counts = queue.slice(next).reduce((m: Record<string, number>, w) => ((m[w.kind] = (m[w.kind] || 0) + 1), m), {});
    const dry = arg('dry') === 'true';
    if (!dry) await ref().set({ queue, walkQueued: { by: 'owner', at: Date.now(), note: 'area walkthroughs first, within the pipeline budget and caps' } }, { merge: true });
    console.log(`${dry ? '(dry run) ' : ''}Queue from item ${next}: ${queue.length - next} item(s) ${JSON.stringify(counts)}.`);
    const pages = walks.filter((w) => w.kind === 'walkthrough');
    for (let n = 0; n < 4; n++) console.log(`  night ${n + 1}: ${pages.slice(n * 9, n * 9 + 9).map((w) => `${w.key}/${w.ref}`).join(', ')}`);
  } else if (arg('setup') === 'true') {
    const gsc = JSON.parse(fs.readFileSync(String(arg('gsc') || 'C:/Users/Noah/Desktop/QC-site-audit/notes/gsc.json'), 'utf8'));
    const queue = await buildQueue(gsc.pages);
    const counts = queue.reduce((m: Record<string, number>, w) => ((m[w.kind] = (m[w.kind] || 0) + 1), m), {});
    await ref().set({ approved: { by: 'owner', at: Date.now(), note: 'roadmap item 22, ~$115, re-verification first by impressions' }, month: AUDIT_MONTH, budget: "the pipeline's November cap", daily: AUDIT_DAILY, queue, next: 0, spent: 0 }, { merge: true });
    console.log(`Queue written: ${queue.length} item(s) ${JSON.stringify(counts)}; paid from the pipeline's ${AUDIT_MONTH} cap, at most $${AUDIT_DAILY} a day.`);
  } else if (arg('run') === 'true') {
    for (const l of (await runAuditWork(Number(arg('max', String(AUDIT_DAILY))) || AUDIT_DAILY)).lines) console.log(l);
  } else {
    const st: any = (await ref().get()).data() || {};
    console.log(`${st.month}: $${Number(st.spent || 0).toFixed(2)} spent (from the pipeline's cap); ${Number(st.next || 0)} of ${(st.queue || []).length} item(s) done.`);
  }
  await releaseGuideLocks().catch(() => {});
  setTimeout(() => process.exit(0), 300);
}
if (/novemberWork\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('novemberWork failed:', e?.message || e); process.exit(1); });
