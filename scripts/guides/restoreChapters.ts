/**
 * The "appears in" links the old chapter check dropped: it asked whether an entity "features in the story chapter X",
 * and in guides whose parts are places (Goblin Camp, Scadu Altus) the answer was always no. Each dropped part (from
 * the page's removed / dropped lists) is checked again, worded as "appears in" (a chapter, act or area), against the
 * page's stored evidence only (no searches); the ones the evidence backs go back on the page.
 *
 *   npx tsx scripts/guides/restoreChapters.ts [--dry] [--only <key>]
 */
import { db, arg, usageScope } from './common';
import { claimCheck, type ClaimSlot, type EvidencePack } from './claimCheck';

const OLD = /features in the story chapter "([^"]+)"/;

async function main() {
  const dry = arg('dry') === 'true';
  const only = arg('only') && arg('only') !== 'true' ? String(arg('only')) : '';
  const scope = { dollars: 0, searches: 0 };
  let restored = 0, checked = 0;
  await usageScope.run(scope, async () => {
    for (const c of (await db().collection('guideCompendium').get()).docs) {
      if (only && c.id !== only) continue;
      const info: any = (await db().collection('guides').doc(c.id).get()).data() || {};
      const parts = new Set((info.areas || []).map((a: any) => String(a.name)));
      const game = String(info.game || c.id);
      for (const d of (await c.ref.collection('entities').where('status', '==', 'published').get()).docs) {
        const e: any = d.data();
        const have = new Set<string>(e.summary?.chapters || []);
        const lost = [...new Set([...(e.removed || []), ...(e.dropped || [])].map((x: string) => String(x).match(OLD)?.[1]).filter((x): x is string => !!x && parts.has(x) && !have.has(x)))];
        if (!lost.length) continue;
        const pack = (await db().collection('evidencePacks').doc(`${c.id}__entity__${d.id}`).get()).data() as EvidencePack | undefined;
        if (!pack?.evidence?.length) { console.log(`${c.id} / ${e.name}: no stored evidence; skipped (${lost.join(', ')})`); continue; }
        const slots: ClaimSlot[] = lost.map((x, i) => ({ id: `K${i + 1}`, label: `P${i + 1}`, kind: 'merchant', text: `${e.name} appears in "${x}" (a part of the game the guide covers: a chapter, act or area)` }));
        const v = await claimCheck(game, e.name, slots, pack);
        const back = lost.filter((_, i) => v.find((x) => x.id === `K${i + 1}`)?.verdict === 'supported');
        checked += lost.length;
        restored += back.length;
        console.log(`${c.id} / ${e.name}: ${back.length} of ${lost.length} back${back.length ? ` (${back.join(', ')})` : ''}`);
        if (back.length && !dry) await d.ref.set({ summary: { chapters: [...have, ...back] }, chaptersRestoredAt: Date.now() }, { merge: true });
      }
    }
  });
  console.log(`\n${restored} of ${checked} dropped "appears in" link(s) ${dry ? 'would come' : 'came'} back; $${scope.dollars.toFixed(3)}.`);
  setTimeout(() => process.exit(0), 300);
}
main().catch((e) => { console.error('restoreChapters failed:', e?.message || e); process.exit(1); });
