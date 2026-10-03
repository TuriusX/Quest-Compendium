/**
 * Promote a staged guide (guides/{key}--next, built with build.ts --stage) to the live guide, once it has passed review.
 * (stageCopy starts a staged build as a copy of the live guide, for fixes, extensions and upgrades.)
 *
 *   npx tsx scripts/guides/promote.ts --key dead-space            (review.ts --gate calls this itself on a pass)
 *   npx tsx scripts/guides/promote.ts --key dead-space --discard  throw the staged build away instead
 *
 * The staged pages replace the live guide: they're published under the live key in the staged order and layout, and
 * live pages that aren't in the new outline are held back (never deleted). The guide's other data (Steam id,
 * achievement guide, translations, pipeline notes) stays. Then the staging document is deleted. Republish the website.
 */
import { db, arg, stageKey, liveKey } from './common';

export const REPLACED = 'replaced by a reviewed rebuild';

/** Returns how many pages went live, or null if there was nothing staged. */
export async function promote(key: string): Promise<{ published: number; retired: number } | null> {
  const live = liveKey(key);
  const stageRef = db().collection('guides').doc(stageKey(live));
  const stage: any = (await stageRef.get()).data();
  if (!stage) return null;
  const liveRef = db().collection('guides').doc(live);
  const before: any = (await liveRef.get()).data() || {};
  const pages = new Map((await stageRef.collection('areas').get()).docs.map((d) => [d.id, d.data() as any]));
  const order = (Array.isArray(stage.areas) ? stage.areas : []).filter((o: any) => ['draft', 'published'].includes(pages.get(o.slug)?.status));
  let batch = db().batch();
  let ops = 0;
  const flush = async () => {
    if (ops) await batch.commit();
    batch = db().batch();
    ops = 0;
  };
  for (const [i, o] of order.entries()) {
    const { staged, ...page } = pages.get(o.slug);
    batch.set(liveRef.collection('areas').doc(o.slug), { ...page, order: i, status: 'published', heldReason: null, unpublishedAt: null, updatedAt: Date.now() });
    if (++ops >= 400) await flush();
  }
  const keep = new Set(order.map((o: any) => o.slug));
  let retired = 0;
  for (const d of (await liveRef.collection('areas').get()).docs) {
    if (keep.has(d.id) || !['draft', 'published'].includes(d.data().status)) continue;
    batch.update(d.ref, { status: 'held', heldReason: REPLACED, updatedAt: Date.now() });
    retired++;
    if (++ops >= 400) await flush();
  }
  batch.set(liveRef, {
    game: stage.game || before.game,
    title: stage.title || before.title || `${stage.game} guide`,
    areas: order,
    layout: stage.layout || before.layout || 'area',
    ...(stage.edition && !before.edition ? { edition: stage.edition } : {}),
    ...(stage.review ? { review: stage.review } : {}),
    unpublished: null,
    rebuiltAt: Date.now(),
    updatedAt: Date.now(),
    ...(before.createdAt ? {} : { createdAt: Date.now() }),
  }, { merge: true });
  ops++;
  await flush();
  await db().recursiveDelete(stageRef);
  return { published: order.length, retired };
}

/** Start a staged build as a copy of the live guide (its published and draft pages, as drafts), to fix or extend it. */
export async function stageCopy(key: string): Promise<number> {
  const live = liveKey(key);
  const liveRef = db().collection('guides').doc(live);
  const info: any = (await liveRef.get()).data() || {};
  const stageRef = db().collection('guides').doc(stageKey(live));
  const pages = (await liveRef.collection('areas').get()).docs.filter((d) => ['published', 'draft'].includes(d.data().status));
  const keep = new Set(pages.map((d) => d.id));
  let batch = db().batch();
  let ops = 0;
  // No Steam id or pipeline notes on the staged copy, so nothing mistakes it for a live guide.
  batch.set(stageRef, {
    game: info.game, title: info.title || `${info.game} guide`, stagingFor: live, layout: info.layout || 'area',
    areas: (info.areas || []).filter((o: any) => keep.has(o.slug)), aliases: info.aliases || {},
    ...(info.edition ? { edition: info.edition } : {}), createdAt: Date.now(),
  });
  for (const d of pages) {
    batch.set(stageRef.collection('areas').doc(d.id), { ...d.data(), status: 'draft', staged: 'copy' });
    if (++ops >= 400) {
      await batch.commit();
      batch = db().batch();
      ops = 0;
    }
  }
  await batch.commit();
  return pages.length;
}

export async function discard(key: string): Promise<boolean> {
  const ref = db().collection('guides').doc(stageKey(liveKey(key)));
  if (!(await ref.get()).exists) return false;
  await db().recursiveDelete(ref);
  return true;
}

if (/promote\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    const key = arg('key');
    if (!key || key === 'true') {
      console.log('Usage: npx tsx scripts/guides/promote.ts --key key [--discard]');
      process.exit(1);
    }
    if (arg('discard') === 'true') console.log((await discard(key)) ? `Discarded the staged build of ${key}.` : `Nothing staged for ${key}.`);
    else {
      const r = await promote(key);
      console.log(r ? `Promoted ${key}: ${r.published} page(s) live, ${r.retired} old page(s) held back.` : `Nothing staged for ${key}.`);
    }
    setTimeout(() => process.exit(0), 500);
  })().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
