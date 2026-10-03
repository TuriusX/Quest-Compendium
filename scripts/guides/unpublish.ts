/**
 * Take a guide off the site (its published pages become held back, with a reason), or put it back.
 *
 *   npx tsx scripts/guides/unpublish.ts --key bioshock-infinite --why "review: invented content"
 *   npx tsx scripts/guides/unpublish.ts --key bioshock-infinite --restore     the pages this script held, published again
 *
 * Held pages aren't part of the guide: the site, the apps and the reviewer skip them, and no build publishes them
 * by accident (a quick build publishes drafts). A careful build with --restructure replaces them. The guide's
 * achievement guide follows its visibility. Several keys: --keys a,b,c. Republish the website afterwards.
 */
import { db, gameKey, arg } from './common';

const keys = (arg('keys') || arg('key') || (arg('game') ? gameKey(arg('game')!) : '')).split(',').map((k) => k.trim()).filter(Boolean);
const restore = arg('restore') === 'true';
const why = arg('why', 'unpublished')!;

async function main() {
  if (!keys.length) {
    console.log('Usage: npx tsx scripts/guides/unpublish.ts --key key | --keys a,b,c [--why "reason"] [--restore]');
    process.exit(1);
  }
  for (const key of keys) {
    const ref = db().collection('guides').doc(key);
    const info: any = (await ref.get()).data();
    if (!info) {
      console.log(`?? ${key}: no such guide`);
      continue;
    }
    const pages = await ref.collection('areas').where('status', '==', restore ? 'held' : 'published').get();
    const batch = db().batch();
    let n = 0;
    for (const d of pages.docs) {
      const p: any = d.data();
      if (restore) {
        if (!p.unpublishedAt) continue; // held for its own reasons by a build; not ours to publish
        batch.update(d.ref, { status: 'published', heldReason: null, unpublishedAt: null });
      } else {
        batch.update(d.ref, { status: 'held', heldReason: `unpublished: ${why}`, unpublishedAt: Date.now() });
      }
      n++;
    }
    batch.set(ref, { unpublished: restore ? null : { at: Date.now(), why, pages: n } }, { merge: true });
    await batch.commit();
    console.log(`${restore ? 'restored' : 'unpublished'} ${info.game || key}: ${n} page(s)`);
  }
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
