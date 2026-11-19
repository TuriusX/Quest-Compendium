// Sourced advice test (Nov 19 2026): pages built with the advice research and rule, NOT made live (the prototype only),
// compared with the live page: the short version (matters / skip / mistakes), step tips and warnings, review score.
//   npx tsx scripts/evals/adviceTest.ts key/slug key/slug ...   (PIPELINE_OPENAI=1)
import fs from 'fs';
import { db, ledgerDollars } from '../guides/common';

const { buildPageEvidenceForCore } = await import('../guides/flagship');
const out: any[] = [];
const adv = (a: any) => ({ matters: a?.matters || [], skip: a?.skip || [], mistakes: a?.mistakes || [] });
const tips = (w: any[]) => (w || []).flatMap((s: any) => [s.tip, s.warn].filter(Boolean));
for (const id of process.argv.slice(2)) {
  const [key, slug] = id.split('/');
  const g: any = (await db().collection('guides').doc(key).get()).data() || {};
  const live: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data() || {};
  const t0 = Date.now();
  try {
    const r: any = await buildPageEvidenceForCore(key, String(g.game || key), slug, g.areas || [], key);
    const p = r?.proto || {};
    const row = {
      id, ms: Date.now() - t0, review: `${r?.review?.status} ${r?.review?.score}`,
      before: { advice: adv(live.advice), tips: tips(live.walkthrough) },
      after: { advice: adv(p.advice), tips: tips(p.walkthrough) },
    };
    out.push(row);
    const n = (x: any) => x.advice.matters.length + x.advice.skip.length + x.advice.mistakes.length;
    console.log(`${id}: review ${row.review}; short version ${n(row.before)} -> ${n(row.after)} lines; step tips ${row.before.tips.length} -> ${row.after.tips.length}; $${ledgerDollars().toFixed(3)} so far`);
  } catch (e: any) { console.log(`${id}: error ${String(e?.message).slice(0, 150)}`); }
  fs.mkdirSync('scratchpad/advice-test', { recursive: true });
  fs.writeFileSync('scratchpad/advice-test/results.json', JSON.stringify(out, null, 1));
}
process.exit(0);
