/**
 * The overnight lane of "Worth getting here" on demand (worthOnDemand.ts): areas players reached whose ticket no app
 * redeemed (apps before the on-demand fill, or a fill that waited for search room) are filled here, oldest first, each
 * once, under the same lock and once-per-area rule. Uses the pipeline's search room; stops when it runs out. No dollar
 * cap (owner, Nov 15 2026); the summary warns above $5 a day.
 *
 *   npx tsx scripts/guides/worthNightly.ts [--max-areas 200] [--dry-run]
 */
import { db, arg } from './common';
import { fillArea, worthStatus, type AreaRef } from '../../worthOnDemand';

async function main() {
  const max = Number(arg('max-areas', '200')) || 200;
  const dry = process.argv.includes('--dry-run');
  const wanted = (await db().collection('worthWanted').orderBy('at', 'asc').limit(max * 2).get()).docs;
  let filled = 0, empty = 0, failed = 0, skipped = 0, waiting = 0;
  for (const d of wanted) {
    if (filled + empty + failed >= max) break;
    const w: any = d.data();
    const a: AreaRef = { key: w.key, slug: w.slug, name: w.name, game: w.game, guided: !!w.guided, version: Number(w.version || 0) };
    if (!a.key || !a.slug) { await d.ref.delete(); continue; }
    const st = await worthStatus(a);
    if (st !== 'missing') { skipped++; await d.ref.delete(); continue; }
    if (dry) { console.log(`would fill ${a.game} / ${a.name}`); continue; }
    const r = await fillArea(a, '', 'night');
    if (r === 'ready') filled++;
    else if (r === 'empty') empty++;
    else if (r === 'failed') failed++;
    else if (r === 'missing') { waiting++; break; } // no search room left tonight
  }
  console.log(`Worth overnight: ${filled} area(s) filled, ${empty} with nothing sourced, ${failed} failed, ${skipped} already done${waiting ? '; stopped: no search room left' : ''}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/worthNightly\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('worthNightly failed:', e?.message || e); process.exit(1); });
