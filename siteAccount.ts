/**
 * Signed in on questcompendium.com (owner, Oct 29 2026): the website's guide ticks follow the account like the app's
 * and the Deck's (users/{uid}.settings.guideDone, "key:slug" -> ticked ids; the app adds what it finds there).
 *
 *   POST /api/site/ticks { merge: { "key:slug": ids } }   sign-in: the browser's ticks added to the account's (never
 *                                                            removing any); the account's whole set comes back
 *   POST /api/site/ticks { set: { "key:slug": ids } }     a page ticked or unticked on the site: that page's ids
 * Only the first playthrough's ticks (no "~pt" scope): the website has one playthrough.
 */
import { type Express, type Request, type Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';

const KEY = /^[a-z0-9-]{1,120}:[a-z0-9_-]{1,160}$/;
const clean = (m: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (!m || typeof m !== 'object') return out;
  for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 2000)) {
    if (!KEY.test(k) || !Array.isArray(v)) continue;
    out[k] = [...new Set(v.map(String).filter((x) => x.length > 0 && x.length <= 200))].slice(0, 1000);
  }
  return out;
};

export function registerSiteAccount(app: Express, deps: { requireAuth: any }) {
  app.post('/api/site/ticks', deps.requireAuth, async (req: any, res: Response) => {
    if (!req.user || req.user.isGuest) return res.status(401).json({ error: 'Sign in first.' });
    const merge = clean(req.body?.merge), set = clean(req.body?.set);
    const ref = getFirestore().collection('users').doc(String(req.user.uid));
    try {
      const done = await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur: Record<string, string[]> = { ...((snap.data() as any)?.settings?.guideDone || {}) };
        for (const [k, ids] of Object.entries(merge)) cur[k] = [...new Set([...(cur[k] || []), ...ids])];
        for (const [k, ids] of Object.entries(set)) { if (ids.length) cur[k] = ids; else delete cur[k]; }
        // The whole field is replaced (a merge would keep pages the site just emptied).
        if (Object.keys(merge).length || Object.keys(set).length) {
          if (snap.exists) tx.update(ref, { 'settings.guideDone': cur });
          else tx.set(ref, { settings: { guideDone: cur } }, { merge: true });
        }
        return cur;
      });
      res.json({ done: Object.fromEntries(Object.entries(done).filter(([k]) => !k.split(':')[0].includes('~'))) });
    } catch (e: any) {
      console.error('[site-ticks]', e?.message);
      res.status(500).json({ error: 'failed' });
    }
  });
}
