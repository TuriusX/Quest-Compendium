/**
 * Approved player suggestions (contributions.ts) for a page, for the builders and the site: as owner-approved evidence
 * lines for a rebuild (so a rebuilt page keeps them), and as the notes the site shows at their spot until a rebuilt
 * page states them itself ("absorbed").
 */
import { db } from './common';
import type { Evidence } from './claimCheck';

export type ApprovedContribution = { id: string; key: string; slug: string; page: string; anchor: string; label: string; kind: string; text: string; credit: boolean; displayName?: string; lang: string; absorbed?: boolean; decidedAt: number };

/** The approved suggestions, by guide and page ("key/slug"), or for one guide. */
export async function approvedContributions(key?: string): Promise<ApprovedContribution[]> {
  let q: FirebaseFirestore.Query = db().collection('contributions').where('status', '==', 'approved');
  if (key) q = q.where('key', '==', key);
  const snap = await q.get().catch(() => null);
  return (snap?.docs || []).map((d) => {
    const c: any = d.data();
    return { id: d.id, key: c.key, slug: c.slug, page: c.page, anchor: c.anchor || '', label: c.label || '', kind: c.kind, text: String(c.decided?.text || c.text), credit: !!c.credit, displayName: c.displayName, lang: c.lang || 'en', absorbed: !!c.absorbed, decidedAt: Number(c.decided?.at || 0) };
  });
}

/** A page's approved suggestions as evidence lines a rebuild must keep (the owner approved them after a source check). */
export async function contributionEvidence(key: string, slug: string): Promise<Evidence[]> {
  const mine = (await approvedContributions(key)).filter((c) => c.slug === slug);
  return mine.map((c, i) => ({ id: `pc${i + 1}`, text: c.text, sources: ['questcompendium.com (owner-approved player suggestion)'], topic: 'player' } as Evidence));
}
