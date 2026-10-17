/**
 * The site audit's content work (roadmap item 22), approved by the owner for November 2026: a $115 allowance of its own
 * (system/auditWork), spent at most AUDIT_DAILY a day by the nightly pipeline, in the owner's order:
 *
 *   1. reverify    the queue's pages (highest Search Console impressions first) rebuilt with the evidence method; a page
 *                  goes live only when it passes the review and the rebuild guard agrees
 *   2. epilogue    the RDR2 story missions the plan names but were never built (Epilogue Part 2)
 *   3. places      place pages for held RDR2 places people still search for, at their old addresses
 *   4. missions    RDR2 story missions get their own steps, gold medal and rewards (a failed rebuild keeps the page)
 *   5. glossary    official localised page names for translated guides (sourced only)
 *   6. conflicts   the consistency report's contradictions settled against stored evidence (listed for review)
 *
 *   npx tsx scripts/guides/novemberWork.ts --setup        write the queue and the allowance (no AI)
 *   npx tsx scripts/guides/novemberWork.ts --run [--max 5] do up to $max of the next work (only in November 2026)
 *   npx tsx scripts/guides/novemberWork.ts --status       what's done, spent and left
 * Each step is charged to system/auditWork.spent (and shows in the pipeline's cost lines like any run).
 */
import fs from 'fs';
import { FieldValue } from 'firebase-admin/firestore';
import { db, arg, usageScope } from './common';
import { acquireGuideLock, isRefusal, releaseGuideLocks } from './guideLock';

export const AUDIT_MONTH = '2026-11';
export const AUDIT_BUDGET = 115;
export const AUDIT_DAILY = Number(process.env.AUDIT_DAILY || 5);
const ref = () => db().collection('system').doc('auditWork');
const month = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 7);
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

type Work = { kind: 'reverify' | 'epilogue' | 'place' | 'mission' | 'glossary' | 'conflicts'; key: string; ref: string; impressions?: number };

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

async function doOne(w: Work): Promise<{ status: string; dollars: number; detail: string }> {
  const scope = { dollars: 0, searches: 0 };
  let status = 'done', detail = '';
  const lk = await acquireGuideLock(w.key, `November work: ${w.kind}`);
  if (isRefusal(lk)) return { status: 'busy', dollars: 0, detail: `${w.key} is in use` };
  try {
    await usageScope.run(scope, async () => {
      if (w.kind === 'reverify') {
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
        for (const c of (rep.conflicts || []).slice(0, 25)) {
          const r: any = await resolveConflict(w.key, String(rep.game || w.key), c);
          const wrong = r.verdicts.filter((v: any) => v.verdict === 'contradicted').map((v: any) => v.on);
          if (wrong.length) out.push(`${c.name}: wrong on ${wrong.join(', ')}`);
        }
        await ref().set({ conflicts: { [w.key]: { at: Date.now(), wrong: out } } }, { merge: true });
        detail = `${out.length} contradiction(s) settled for review`;
      }
    });
  } catch (e: any) {
    status = 'error';
    detail = String(e?.message || e).slice(0, 160);
  } finally {
    await lk.release().catch(() => {});
  }
  return { status, dollars: scope.dollars, detail };
}

/** Up to max dollars of the next work today (November 2026 only, within the allowance and the daily cap). */
export async function runAuditWork(max = AUDIT_DAILY): Promise<string[]> {
  if (month() !== AUDIT_MONTH && !process.env.AUDIT_FORCE) return [];
  const st: any = (await ref().get()).data() || {};
  if (!st.approved || !Array.isArray(st.queue)) return [];
  const spentToday = st.day === day() ? Number(st.spentToday || 0) : 0;
  let room = Math.min(max, AUDIT_DAILY - spentToday, AUDIT_BUDGET - Number(st.spent || 0));
  const lines: string[] = [];
  let next = Number(st.next || 0), spent = Number(st.spent || 0), today = spentToday, guess = 0.25;
  while (room > guess && next < st.queue.length) {
    const w: Work = st.queue[next];
    const r = await doOne(w);
    if (r.status === 'busy') break;
    spent += r.dollars; today += r.dollars; room -= r.dollars; guess = Math.max(guess * 0.8, r.dollars);
    next++;
    lines.push(`${w.kind} ${w.key}/${w.ref}: ${r.status}, $${r.dollars.toFixed(3)}${r.detail ? ` (${r.detail})` : ''}`);
    await ref().set({ next, spent, day: day(), spentToday: today, log: FieldValue.arrayUnion({ at: Date.now(), kind: w.kind, key: w.key, ref: w.ref, status: r.status, dollars: Math.round(r.dollars * 1000) / 1000 }) }, { merge: true });
  }
  if (lines.length) lines.unshift(`🧭 November site work (roadmap 22): ${lines.length} item(s) today, $${(today - spentToday).toFixed(2)}; $${spent.toFixed(2)} of $${AUDIT_BUDGET} spent, ${st.queue.length - next} item(s) left.`);
  return lines;
}

async function main() {
  if (arg('setup') === 'true') {
    const gsc = JSON.parse(fs.readFileSync(String(arg('gsc') || 'C:/Users/Noah/Desktop/QC-site-audit/notes/gsc.json'), 'utf8'));
    const queue = await buildQueue(gsc.pages);
    const counts = queue.reduce((m: Record<string, number>, w) => ((m[w.kind] = (m[w.kind] || 0) + 1), m), {});
    await ref().set({ approved: { by: 'owner', at: Date.now(), note: 'roadmap item 22, ~$115, re-verification first by impressions' }, month: AUDIT_MONTH, budget: AUDIT_BUDGET, daily: AUDIT_DAILY, queue, next: 0, spent: 0 }, { merge: true });
    console.log(`Queue written: ${queue.length} item(s) ${JSON.stringify(counts)}; $${AUDIT_BUDGET} for ${AUDIT_MONTH}, at most $${AUDIT_DAILY} a day.`);
  } else if (arg('run') === 'true') {
    for (const l of await runAuditWork(Number(arg('max', String(AUDIT_DAILY))) || AUDIT_DAILY)) console.log(l);
  } else {
    const st: any = (await ref().get()).data() || {};
    console.log(`${st.month}: $${Number(st.spent || 0).toFixed(2)} of $${st.budget} spent; ${Number(st.next || 0)} of ${(st.queue || []).length} item(s) done.`);
  }
  await releaseGuideLocks().catch(() => {});
  setTimeout(() => process.exit(0), 300);
}
if (/novemberWork\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('novemberWork failed:', e?.message || e); process.exit(1); });
