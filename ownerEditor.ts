/**
 * The owner's editor on questcompendium.com (roadmap: editor mode). Guide pages carry one line (publish.ts
 * editorLoader) that loads the editor only on a device holding an editor key; everyone else, and search engines, get
 * the page as it is. The website can't sign in with Google itself (Firebase doesn't list questcompendium.com), so a
 * device is connected here: the owner signs in on /editor/connect (ADMIN_EMAILS), which makes a long random key for
 * that device (only its SHA-256 is stored, in editorKeys/{hash}) and hands it to the page as #qc-editor=…. Every call
 * the editor makes carries the key and is checked here, as an admin's: a copied flag or a stale key gets nothing.
 *
 *   GET  /editor/connect?to=<guide page URL>   sign in, then back to the page with this device's key
 *   POST /api/editor/connect                   (Firebase admin token) a new key for this device
 *   GET  /editor/qc-editor.js                  the editor (ownerEditorClient.ts), noindex; the website loads it as
 *                                              /_qc/e.js?p=1 and calls /_qc/api/… (its _redirects pass them here)
 *   GET  /api/editor/me                        who, and the counts for the owner bar
 *   POST /api/editor/disconnect   { all? }     this device's key (or every device's) removed
 *   GET  /api/editor/edits?key=&slug=          "Fix now" edits (one page's, or the latest 200)
 *   POST /api/editor/edits                     { key, slug, page, lang, path, before, after, label }
 *   POST /api/editor/edits/:id    { action: undo | restore }
 *   GET  /api/editor/queue                     the owner's pipeline items (contributions with owner: true)
 *   POST /api/editor/queue                     { key, slug, page, lang, anchor, label, kind: correction | missing, text }
 *   POST /api/editor/queue/:id    { action: apply | drop }   a held item: put on the page anyway, or dropped
 * The picture tools use /api/admin/images (guideImages.ts), which take an editor key too (editorOrAuth).
 *
 * Anything the owner changes marks the site changed (system/editor.dirtyAt): the next daily run publishes it.
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { isAdmin } from './reviewQueue';
import { EDIT_PATH } from './scripts/guides/ownerEdits';
import { qcEditorClient } from './ownerEditorClient';

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = { requireAuth: Mw; firebaseWebConfig: Record<string, string> };

const db = () => getFirestore();
const KEYS = () => db().collection('editorKeys');
const EDITS = () => db().collection('guideEdits');
const SITE = 'https://questcompendium.com';
const LANGS = new Set(['en', 'es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh']);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, n);
const line = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Something the owner changed: the next daily run publishes the site. */
export async function markSiteDirty(): Promise<void> {
  await db().collection('system').doc('editor').set({ dirtyAt: Date.now() }, { merge: true }).catch(() => undefined);
}

// Keys looked up recently (a minute), so a page's burst of calls costs one read.
const seen = new Map<string, { email: string; at: number }>();
async function keyUser(key: string): Promise<{ email: string; hash: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(key)) return null;
  const h = sha(key);
  const c = seen.get(h);
  if (c && Date.now() - c.at < 60_000) return { email: c.email, hash: h };
  const doc = await KEYS().doc(h).get();
  const x: any = doc.data();
  if (!x?.email || !isAdmin({ email: x.email, email_verified: true })) { seen.delete(h); return null; }
  seen.set(h, { email: x.email, at: Date.now() });
  if (Date.now() - Number(x.lastUsed || 0) > 3_600_000) doc.ref.set({ lastUsed: Date.now() }, { merge: true }).catch(() => undefined);
  return { email: x.email, hash: h };
}

/** Firebase sign-in as usual, or an editor key (X-QC-Editor), which counts as its admin's sign-in. */
export function editorOrAuth(requireAuth: Mw): Mw {
  return async (req, res, next) => {
    const key = req.get('x-qc-editor');
    if (!key) return requireAuth(req, res, next);
    let u: Awaited<ReturnType<typeof keyUser>> = null;
    try { u = await keyUser(key); } catch { return res.status(503).json({ error: 'The editor is busy for a moment; try again.' }); }
    if (!u) return res.status(401).json({ error: 'This device is no longer connected to the editor.' });
    (req as any).user = { uid: `editor:${u.email}`, email: u.email, email_verified: true, editorKey: u.hash };
    next();
  };
}

export function registerOwnerEditor(app: Express, deps: Deps) {
  const auth = editorOrAuth(deps.requireAuth);
  const admin: Mw = (req, res, next) => (isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  const by = (req: Request) => String((req as any).user?.email || '');

  app.get('/editor/connect', (req: Request, res: Response) => {
    const to = String(req.query.to || '');
    const target = to.startsWith(`${SITE}/`) ? to.split('#')[0] : `${SITE}/guides/`;
    res.set('X-Robots-Tag', 'noindex, nofollow').type('html').send(connectPage(deps.firebaseWebConfig, target));
  });

  app.post('/api/editor/connect', deps.requireAuth, admin, async (req: Request, res: Response) => {
    const key = crypto.randomBytes(32).toString('base64url');
    await KEYS().doc(sha(key)).set({ email: by(req), createdAt: Date.now(), lastUsed: Date.now(), device: line(req.body?.device || req.get('user-agent'), 160) });
    res.json({ key });
  });

  app.get('/editor/qc-editor.js', (req: Request, res: Response) => {
    // Loaded through the website (/_qc/e.js?p=1): its calls go the same way, so blockers see the site's own address.
    const cfg = { api: req.query.p === '1' ? `${SITE}/_qc` : `https://${req.get('host')}`, site: SITE };
    res.set('X-Robots-Tag', 'noindex, nofollow').set('Cache-Control', 'no-cache').type('application/javascript')
      // (__name: a helper some TypeScript builds wrap named functions in; defined here so the function runs on its own.)
      .send(`/* Quest Compendium owner editor: does nothing without a connected device. */\n(function(){var __name=function(f){return f};(${qcEditorClient.toString()})(${JSON.stringify(cfg)});})();\n`);
  });

  app.get('/api/editor/me', auth, admin, async (req: Request, res: Response) => {
    const [devices, live, queue] = await Promise.all([
      KEYS().where('email', '==', by(req)).count().get(),
      EDITS().where('status', '==', 'live').limit(500).get(),
      db().collection('contributions').where('owner', '==', true).limit(300).get(),
    ]);
    const edits = live.docs.map((d) => d.data() as any);
    const q = queue.docs.map((d) => d.data() as any);
    res.json({
      email: by(req), devices: devices.data().count, connected: !!(req as any).user?.editorKey,
      edits: { live: edits.length, waiting: edits.filter((e) => !e.state).length, stale: edits.filter((e) => e.state === 'stale').length },
      queue: { waiting: q.filter((c) => c.status === 'pending').length, held: q.filter((c) => c.status === 'checked').length },
    });
  });

  app.post('/api/editor/disconnect', auth, admin, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (req.body?.all) {
      const all = await KEYS().where('email', '==', by(req)).get();
      await Promise.all(all.docs.map((d) => d.ref.delete()));
      seen.clear();
      return res.json({ ok: true, removed: all.size });
    }
    if (u?.editorKey) { await KEYS().doc(u.editorKey).delete(); seen.delete(u.editorKey); }
    res.json({ ok: true, removed: u?.editorKey ? 1 : 0 });
  });

  // ---- Fix now ----
  app.get('/api/editor/edits', auth, admin, async (req: Request, res: Response) => {
    const key = line(req.query.key, 80), slug = line(req.query.slug, 120);
    const q = key && slug ? EDITS().where('key', '==', key).where('slug', '==', slug) : EDITS().limit(400);
    const rows = (await q.get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
    res.json({ edits: rows.map(({ tr, ...x }) => x) });
  });

  app.post('/api/editor/edits', auth, admin, async (req: Request, res: Response) => {
    const b = req.body || {};
    const key = line(b.key, 80), slug = line(b.slug, 120), page = b.page === 'entity' ? 'entity' : 'area', lang = LANGS.has(b.lang) ? b.lang : 'en';
    const path = line(b.path, 200), before = cut(b.before, 4000), after = cut(b.after, 4000);
    if (!/^[a-z0-9-]+$/.test(key) || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Which page is this?' });
    if (!EDIT_PATH.test(path)) return res.status(400).json({ error: 'That part of the page can\'t be edited.' });
    if (!before.trim() || before === after) return res.status(400).json({ error: 'Nothing changed.' });
    const ref = page === 'entity' ? db().collection('guideCompendium').doc(key).collection('entities').doc(slug) : db().collection('guides').doc(key).collection('areas').doc(slug);
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'No such guide page.' });
    const doc = await EDITS().add({ key, slug, page, lang, path, before, after, label: line(b.label, 200), status: 'live', by: by(req), createdAt: Date.now() });
    await markSiteDirty();
    res.json({ ok: true, id: doc.id });
  });

  app.post('/api/editor/edits/:id', auth, admin, async (req: Request, res: Response) => {
    const ref = EDITS().doc(String(req.params.id));
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'No such edit.' });
    const action = req.body?.action;
    if (action !== 'undo' && action !== 'restore') return res.status(400).json({ error: 'Unknown action.' });
    await ref.set({ status: action === 'undo' ? 'undone' : 'live', ...(action === 'undo' ? { undoneAt: Date.now() } : { state: null }), updatedBy: by(req), updatedAt: Date.now() }, { merge: true });
    await markSiteDirty();
    res.json({ ok: true });
  });

  // ---- Send to pipeline, Add a missing item (the players' suggestions store, marked as the owner's) ----
  app.get('/api/editor/queue', auth, admin, async (_req: Request, res: Response) => {
    const rows = (await db().collection('contributions').where('owner', '==', true).limit(300).get()).docs
      .map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => Number(b.at) - Number(a.at)).slice(0, 100);
    res.json({ items: rows.map((c) => ({ id: c.id, key: c.key, slug: c.slug, page: c.page, lang: c.lang, kind: c.kind, label: c.label, text: c.text, status: c.status, at: c.at, check: c.check ? { verdict: c.check.verdict, reason: c.check.reason, proposal: c.check.proposal } : null, decided: c.decided || null })) });
  });

  app.post('/api/editor/queue', auth, admin, async (req: Request, res: Response) => {
    const b = req.body || {};
    const key = line(b.key, 80), slug = line(b.slug, 120), page = b.page === 'entity' ? 'entity' : 'area';
    const kind = b.kind === 'missing' ? 'missing' : 'correction', text = line(b.text, 2000);
    if (!/^[a-z0-9-]+$/.test(key) || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Which page is this?' });
    if (text.length < 10) return res.status(400).json({ error: 'Say a little more (at least a few words).' });
    const ref = await db().collection('contributions').add({
      key, slug, page, anchor: line(b.anchor, 120), label: line(b.label, 200), kind, text, lang: LANGS.has(b.lang) ? b.lang : 'en',
      credit: false, owner: true, uid: `owner:${by(req)}`, status: 'pending', at: Date.now(),
    });
    res.json({ ok: true, id: ref.id });
  });

  app.post('/api/editor/queue/:id', auth, admin, async (req: Request, res: Response) => {
    const ref = db().collection('contributions').doc(String(req.params.id));
    const c: any = (await ref.get()).data();
    if (!c?.owner) return res.status(404).json({ error: 'No such item.' });
    const action = req.body?.action;
    if (action === 'apply') {
      await ref.set({ status: 'approved', decided: { by: by(req), at: Date.now(), text: String(c.check?.proposal || c.text) } }, { merge: true });
      await markSiteDirty();
    } else if (action === 'drop') await ref.set({ status: 'rejected', decided: { by: by(req), at: Date.now() } }, { merge: true });
    else return res.status(400).json({ error: 'Unknown action.' });
    res.json({ ok: true });
  });
}

/** The connect page: Google sign-in (an admin), a key for this device, back to the guide page. */
function connectPage(firebaseConfig: Record<string, string>, to: string): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  const dest = JSON.stringify(to).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Connect the editor</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0a07; color: #eadfc8; font: 15px/1.5 system-ui, sans-serif; padding: 16px; }
  .box { max-width: 420px; width: 100%; border: 1px solid #f5b942; border-radius: 14px; padding: 22px; background: #17130b; }
  h1 { margin: 0 0 6px; font-size: 18px; color: #f5b942; } p { margin: 6px 0; color: #c9bda4; }
  button { margin-top: 12px; width: 100%; padding: 11px; border-radius: 9px; border: 0; background: #f5b942; color: #1a1408; font-weight: 700; font-size: 15px; cursor: pointer; }
  #msg { min-height: 1.5em; margin-top: 10px; }
</style></head>
<body><div class="box">
  <h1>Edit the guide on this device</h1>
  <p>Sign in with the owner's Google account. This device then shows the editor on guide pages until you turn it off (from "Your edits" in the editor).</p>
  <button id="go" hidden>Sign in with Google</button>
  <div id="msg">Loading…</div>
</div>
<script type="module">
  const msg = (t) => { document.getElementById('msg').textContent = t; };
  const fb = { ...(await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js')), ...(await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js')) };
  const auth = fb.getAuth(fb.initializeApp(${cfg}));
  const provider = new fb.GoogleAuthProvider();
  fb.getRedirectResult(auth).catch((e) => msg('Sign-in failed: ' + (e.code || e.message)));
  const go = document.getElementById('go');
  go.onclick = () => fb.signInWithPopup(auth, provider).catch(() => fb.signInWithRedirect(auth, provider));
  fb.onAuthStateChanged(auth, async (u) => {
    if (!u) { go.hidden = false; msg(''); return; }
    go.hidden = true;
    msg('Connecting this device…');
    try {
      const r = await fetch('/api/editor/connect', { method: 'POST', headers: { Authorization: 'Bearer ' + (await u.getIdToken()), 'Content-Type': 'application/json' }, body: JSON.stringify({ device: navigator.userAgent }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg(r.status === 403 ? u.email + ' is not an owner account.' : (j.error || 'Could not connect.')); return; }
      location.replace(${dest} + '#qc-editor=' + j.key);
    } catch (e) { msg('Could not connect: ' + e.message); }
  });
</script></body></html>`;
}
