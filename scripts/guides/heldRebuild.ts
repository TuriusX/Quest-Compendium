/**
 * Held pages brought back (owner, Nov 19 2026: "get the site fixed and improved"): area pages held for having too few
 * details are rebuilt with the evidence method (the same build as a re-verification: researched evidence, every claim
 * checked, the review), now on OpenAI, which wrote fuller pages in the tests. A page that passes goes live (its old
 * entries kept unless sources contradict them, the rebuild guard as for any rebuild); one that fails stays held.
 *
 *   npx tsx scripts/guides/heldRebuild.ts --keys the-witcher-3-wild-hunt,elden-ring [--max-dollars 10] [--max-pages 40] [--reason "too few"] [--dry]
 * Pages by search impressions first (system/searchConsolePages), then guide order. Stops before a page could pass
 * --max-dollars (a page's worst case is about $0.75).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db, arg, usageScope, ledgerDollars } from './common';
import { acquireGuideLock, isRefusal, releaseGuideLocks } from './guideLock';

const PAGE_WORST = 0.75;

async function main() {
  const keys = String(arg('keys') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const max = Number(arg('max-dollars', '5')) || 5;
  const maxPages = Number(arg('max-pages', '40')) || 40;
  const reason = new RegExp(String(arg('reason', 'too few')), 'i');
  const dry = arg('dry') === 'true';
  if (!keys.length) throw new Error('--keys is required');
  const { loadPageStats } = await import('./pageStats');
  const stats = await loadPageStats();
  const { buildPageEvidenceForCore, writePageForCore } = await import('./flagship');
  let done = 0, live = 0;
  const lines: string[] = [];
  for (const key of keys) {
    const info: any = (await db().collection('guides').doc(key).get()).data();
    if (!info) { lines.push(`${key}: no such guide`); continue; }
    const order: { slug: string; name: string }[] = info.areas || [];
    const inOrder = new Map(order.map((o, i) => [o.slug, i]));
    const held = (await db().collection('guides').doc(key).collection('areas').where('status', '==', 'held').get()).docs
      .map((d) => ({ slug: d.id, ...(d.data() as any) }))
      .filter((a) => reason.test(String(a.heldReason || '')) && inOrder.has(a.slug))
      .sort((a, b) => (Number(stats[`${key}/${b.slug}`]?.[0]) || 0) - (Number(stats[`${key}/${a.slug}`]?.[0]) || 0) || (inOrder.get(a.slug)! - inOrder.get(b.slug)!));
    console.log(`${key}: ${held.length} held page(s) matching /${reason.source}/ in the guide's order`);
    if (dry) { console.log(`  first: ${held.slice(0, 10).map((a) => a.slug).join(', ')}`); continue; }
    for (const a of held) {
      if (done >= maxPages) break;
      if (ledgerDollars() + PAGE_WORST > max) { lines.push(`stopped at $${ledgerDollars().toFixed(2)} (the next page could pass $${max})`); break; }
      const lk = await acquireGuideLock(key, 'held page rebuild');
      if (isRefusal(lk)) { lines.push(`${key}: in use, skipped`); break; }
      const scope = { dollars: 0, searches: 0 };
      let status = '';
      try {
        await usageScope.run(scope, async () => {
          const r: any = await buildPageEvidenceForCore(key, String(info.game || key), a.slug, order, key);
          if (r?.review?.status === 'passed') {
            await writePageForCore(key, a.slug, r.proto);
            await db().collection('guides').doc(key).collection('areas').doc(a.slug).set({ status: 'published', heldReason: FieldValue.delete(), unheldAt: Date.now(), unheldBy: 'held page rebuild (Nov 19 2026)' }, { merge: true });
            await db().collection('guides').doc(key).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(a.slug) } }, { merge: true });
            status = `live (review ${r.review.score})`;
            live++;
          } else status = `still held (${r?.review?.status || 'not built'} ${r?.review?.score ?? ''}: ${String(r?.review?.reason || '').slice(0, 80)})`;
        });
      } catch (e: any) {
        status = `error: ${String(e?.message || e).slice(0, 120)}`;
      } finally {
        await lk.release().catch(() => {});
      }
      done++;
      const line = `${key}/${a.slug}: ${status}, $${scope.dollars.toFixed(3)} (${scope.searches} searches)`;
      lines.push(line);
      console.log(line);
      if (/search day limit/i.test(status)) break;
    }
  }
  console.log(`\nHeld pages: ${done} rebuilt, ${live} live; $${ledgerDollars().toFixed(3)} spent.`);
  for (const l of lines.filter((l) => !/: (live|still held|error)/.test(l))) console.log(l);
  await releaseGuideLocks().catch(() => {});
  setTimeout(() => process.exit(0), 300);
}

if (/heldRebuild\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('heldRebuild failed:', e?.message || e); process.exit(1); });
