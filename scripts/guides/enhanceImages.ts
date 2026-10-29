/**
 * Better pictures, in bulk (imageEnhance.ts; owner, Oct 29 2026).
 *
 *   npx tsx scripts/guides/enhanceImages.ts --all [--cap 3] [--dry-run]   every picture not yet measured (the owner's own
 *       left alone), and the character portraits' upscale within --cap dollars (the one-time pass over the pictures
 *       already on the site: $3, outside the pictures' monthly budget)
 *   --upscaled <id>=<file.png>   use an upscale made before for that picture (still checked like a new one)
 *   (nightly: enhanceNightly() from scripts/pipeline/run.ts, right after the picture finder: new pictures touched up,
 *    and character portraits upscaled within the pictures' budget, $0.50 a night and $5 a month)
 */
import fs from 'fs';
import { db, arg } from './common';
import { enhanceImage, isCharacter, UPSCALE_COST, type Budget, type EnhanceResult } from '../../imageEnhance';
import { pictureBudget } from './pictureFocus';

/** What is still to do: pictures never measured, and character portraits whose upscale hasn't been tried. */
async function todo(): Promise<{ id: string; upscale: boolean; measured: boolean }[]> {
  const snap = await db().collection('guideImages').where('status', 'in', ['waiting', 'suggested', 'approved']).get();
  const out: { id: string; upscale: boolean; measured: boolean }[] = [];
  for (const d of snap.docs) {
    const x: any = d.data();
    if (x.owner) continue;
    const wantsUp = isCharacter(x.target) && !x.enhance?.upscale && (x.crop?.width || x.width || 0) < 1280;
    if (!x.enhance || wantsUp) out.push({ id: d.id, upscale: wantsUp, measured: !!x.enhance });
  }
  // On the site first, then waiting for review.
  const rank: Record<string, number> = { approved: 0, suggested: 1, waiting: 2 };
  const st = new Map(snap.docs.map((d) => [d.id, String(d.get('status'))]));
  return out.sort((a, b) => (rank[st.get(a.id)!] ?? 3) - (rank[st.get(b.id)!] ?? 3));
}

async function run(budget: Budget, given: Record<string, Buffer> = {}, dryRun = false, max = 400) {
  const list = (await todo()).slice(0, max);
  const done: EnhanceResult[] = [];
  const start = Date.now();
  for (const it of list) {
    // Touched up already, its upscale waiting for room in the budget: left as it is until there is room (doing the
    // touch-ups again would only republish the same picture).
    if (it.measured && budget.left() < UPSCALE_COST && !given[it.id]) continue;
    try {
      const r = await enhanceImage(it.id, { upscale: it.upscale, budget, upscaled: given[it.id], dryRun });
      if (r) {
        done.push(r);
        console.log(`  ${it.id}: ${r.changed ? r.ops.join('+') || 'upscale only' : 'nothing to do'}${r.upscale ? ` · upscale ${r.upscale.status}: ${r.upscale.why}` : ''}${r.dollars ? ` · $${r.dollars.toFixed(3)}` : ''}`);
      }
    } catch (e: any) {
      console.log(`  ${it.id}: failed (${e?.message})`);
    }
  }
  const up = done.filter((r) => r.upscale?.status === 'done' && r.upscale.at >= start);
  const failed = done.filter((r) => r.upscale?.status === 'failed' && r.upscale.at >= start);
  const dollars = done.reduce((s, r) => s + r.dollars, 0);
  return { touched: done.filter((r) => r.changed).length, upscaled: up.length, failed, dollars, looked: done.length };
}

/** The nightly step: a line for the run's report, or null when there was nothing to do. */
export async function enhanceNightly(): Promise<string | null> {
  const pb = await pictureBudget();
  const r = await run({ left: () => Math.min(pb.nightLeft, pb.monthLeft), add: pb.add }, {}, false, 60);
  if (!r.looked) return null;
  return `✨ Pictures: ${r.touched} touched up, ${r.upscaled} upscaled${r.failed.length ? `, ${r.failed.length} failed the upscale check (kept as they were)` : ''} ($${r.dollars.toFixed(2)}).`;
}

async function main() {
  if (!process.argv.includes('--all')) { console.log('Use --all (see the header).'); return; }
  const cap = Number(arg('cap') || 3);
  let spent = 0;
  const budget: Budget = { left: () => Math.max(0, cap - spent), add: async (d) => { spent += d; } };
  const given: Record<string, Buffer> = {};
  const u = arg('upscaled');
  if (u && u.includes('=')) { const [id, file] = u.split('='); given[id] = fs.readFileSync(file); }
  const r = await run(budget, given, process.argv.includes('--dry-run'));
  console.log(`Done: ${r.looked} looked at, ${r.touched} touched up, ${r.upscaled} upscaled, ${r.failed.length} failed the check; $${r.dollars.toFixed(2)} (cap $${cap}).`);
  setTimeout(() => process.exit(0), 300);
}
if (process.argv[1] && /enhanceImages\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
