/**
 * Guide blueprints on the server: the admin page's Blueprints tab (scripts/guides/blueprint.ts writes them) and the
 * anonymous grounding-miss log the monthly report reads.
 *
 *   GET  /api/admin/blueprints               every blueprint (newest first)
 *   POST /api/admin/blueprints/:key          { action: 'approve' } or { action: 'save', sections, notes }
 *     approve: status "approved" (builds may follow it); save: edited sections, back to "proposed" (version + 1)
 *
 * groundingMisses/{YYYY-MM}: { [guide key]: { [page slug or "-"]: { "<question type>:<reason>": count } } }, where a
 * reason is "no-page" (the game has a guide but no page matched where the player is), "unchecked" (the page isn't
 * checked, so it isn't used) or "not-used" (a checked page, but the answer used none of its entries). No user id, no
 * question text; test traffic isn't counted.
 */
import type { Express, Request, Response, RequestHandler } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { isTestTraffic } from './testTraffic';

const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const safeKey = (v: unknown) => String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || '-';

export type MissReason = 'no-page' | 'unchecked' | 'not-used';
export function recordGroundingMiss(m: { uid: string; key: string; page?: string; qtype?: string; reason: MissReason }): void {
  if (!m.key || isTestTraffic(m.uid)) return;
  const month = new Date().toISOString().slice(0, 7);
  void getFirestore().collection('groundingMisses').doc(month)
    .set({ [safeKey(m.key)]: { [safeKey(m.page || '-')]: { [`${safeKey(m.qtype || 'general')}:${m.reason}`]: FieldValue.increment(1) } }, updatedAt: Date.now() }, { merge: true })
    .catch(() => {});
}

export function registerBlueprints(app: Express, deps: { requireAuth: RequestHandler; isAdmin: (user: any) => boolean }): void {
  const requireAdmin: RequestHandler = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  app.get('/api/admin/blueprints', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await getFirestore().collection('guideBlueprints').get();
      const list = snap.docs.map((d) => ({ key: d.id, ...(d.data() as any) })).sort((a: any, b: any) => (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0));
      res.json({ blueprints: list });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed' });
    }
  });
  app.post('/api/admin/blueprints/:key', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const key = safeKey(req.params.key);
    const ref = getFirestore().collection('guideBlueprints').doc(key);
    const cur: any = (await ref.get()).data();
    if (!cur) return res.status(404).json({ error: 'No such blueprint.' });
    const who = clean((req as any).user?.email, 120);
    if (req.body?.action === 'approve') {
      await ref.set({ status: 'approved', approvedAt: Date.now(), approvedBy: who, updatedAt: Date.now() }, { merge: true });
      return res.json({ ok: true, status: 'approved' });
    }
    if (req.body?.action === 'save') {
      const sections = Array.isArray(req.body.sections) ? req.body.sections : null;
      if (!sections || sections.some((s: any) => !s || typeof s !== 'object' || !s.id)) return res.status(400).json({ error: 'Sections must be a list of objects, each with an id.' });
      const tidy = sections.slice(0, 40).map((s: any) => ({
        id: safeKey(s.id), title: clean(s.title, 120), kind: clean(s.kind, 30), what: clean(s.what, 400), why: clean(s.why, 400),
        unit: clean(s.unit, 30), units: Math.max(0, Math.min(5000, Number(s.units) || 0)), ...(s.cap != null ? { cap: Math.max(0, Math.min(5000, Number(s.cap) || 0)) } : {}),
        priority: Math.max(1, Math.min(99, Number(s.priority) || 99)), cost: Math.max(0, Number(s.cost) || 0),
      }));
      await ref.set({ sections: tidy, notes: clean(req.body.notes, 2000), status: 'proposed', version: (Number(cur.version) || 1) + 1, editedAt: Date.now(), editedBy: who, updatedAt: Date.now(), buildCost: Math.round(tidy.reduce((n: number, s: any) => n + s.cost, 0) * 100) / 100 }, { merge: true });
      return res.json({ ok: true, status: 'proposed' });
    }
    res.status(400).json({ error: 'Unknown action.' });
  });
}
