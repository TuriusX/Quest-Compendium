/**
 * "Suggest an edit": players' corrections and extra detail for any guide section or compendium entry, credited to
 * them once published. Nothing reaches a page without the owner's approval.
 *
 *   1. Submit: the guide pages' "Suggest an edit" links open /suggest on this server (the same Google sign-in as the
 *      admin page; guests can't submit). The player picks correction or extra detail, writes it, chooses whether to
 *      be credited (by a display name) and accepts the contributor terms (their version is recorded). Saved as
 *      contributions/{id}: status "pending". At most 10 a day per player; spam-looking text is refused.
 *   2. Check (scripts/guides/contributions.ts, nightly): one targeted search and the claim check; the verdict
 *      (supported, contradicted, unverifiable), its evidence and a proposed wording. Status "checked".
 *   3. Decide (the Contributions tab of /admin/reviews): approve (with the wording edited if need be), reject, or
 *      remove a published one. Approved ones show on the page at their spot with the contributor's credit from the
 *      next publish, go into rebuilds as owner-approved evidence, and stop showing separately once a rebuilt page
 *      states them ("absorbed").
 *
 * Off until config/contrib.enabled is true (admins can always submit, to test). Screenshots come later.
 *
 * Routes:
 *   GET  /suggest?key&slug&page&anchor&label     the form
 *   POST /api/contributions                      { key, slug, page, anchor, label, kind, text, credit, displayName, termsVersion }
 *   GET  /api/admin/contributions                open (pending, checked) and the last decided
 *   POST /api/admin/contributions/:id            { action: 'approve' | 'reject' | 'remove', text? }
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { looksLikeSpam } from './corrections';

type Mw = (req: Request, res: Response, next: NextFunction) => any;
/** The contributor terms' version a submission must accept (the page at questcompendium.com/contributor-terms/). */
export const CONTRIB_TERMS_VERSION = '2026-10-draft-1';
const DAILY_LIMIT = 10;
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const db = () => getFirestore();
const enabled = async () => (await db().collection('config').doc('contrib').get()).data()?.enabled === true;

export function registerContributions(app: Express, deps: { requireAuth: Mw; isAdmin: (user: any) => boolean; firebaseWebConfig: Record<string, string> }) {
  const requireAdmin: Mw = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));

  app.get('/suggest', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    // What the suggestion is for, in words: the game's proper name (IGDB's, else the guide's) and the page's name.
    const key = cut(req.query.key, 120).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const slug = cut(req.query.slug, 160).toLowerCase().replace(/[^a-z0-9-]/g, '');
    let game = '', pageName = '';
    try {
      if (key) { const g: any = (await db().collection('guides').doc(key).get()).data() || {}; game = String((g.igdb && !g.igdb.missing && g.igdb.name) || g.game || ''); }
      if (key && slug) {
        const e: any = req.query.page === 'entity' ? (await db().collection('guideCompendium').doc(key).collection('entities').doc(slug).get()).data() : (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
        pageName = String(e?.name || '');
      }
    } catch { /* the form still works without the names */ }
    res.type('html').send(suggestPage(deps.firebaseWebConfig, { game, pageName }));
  });

  app.post('/api/contributions', deps.requireAuth, async (req: Request, res: Response) => {
    const user = (req as any).user || {};
    if (user.isGuest) return res.status(401).json({ error: 'Sign in with Google to suggest an edit.' });
    if (!(await enabled()) && !deps.isAdmin(user)) return res.status(403).json({ error: 'Suggestions are not open yet.' });
    const b = req.body || {};
    const key = cut(b.key, 120).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const slug = cut(b.slug, 160).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const text = String(b.text ?? '').trim().slice(0, 2000);
    const kind = b.kind === 'correction' ? 'correction' : 'detail';
    if (!key || !slug) return res.status(400).json({ error: 'Which page is this for?' });
    if (text.length < 20) return res.status(400).json({ error: 'Please write at least a sentence (20 characters).' });
    if (looksLikeSpam(text)) return res.status(400).json({ error: 'That looks like spam (links are not allowed). Please describe the fix in your own words.' });
    if (b.termsVersion !== CONTRIB_TERMS_VERSION) return res.status(400).json({ error: 'Please accept the contributor terms.' });
    const page = b.page === 'entity' ? 'entity' : 'area';
    const exists = page === 'entity'
      ? (await db().collection('guideCompendium').doc(key).collection('entities').doc(slug).get()).exists
      : (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).exists;
    if (!exists) return res.status(404).json({ error: 'No such guide page.' });
    const since = Date.now() - 24 * 3600_000;
    // One field per query (no composite index): the player's latest suggestions, counted for the last day here.
    const mine = await db().collection('contributions').where('uid', '==', String(user.uid)).get();
    if (mine.docs.filter((d) => Number(d.data().at) >= since).length >= DAILY_LIMIT) return res.status(429).json({ error: `That's ${DAILY_LIMIT} suggestions today. Thank you! Please come back tomorrow.` });
    const credit = b.credit === true && cut(b.displayName, 40).length >= 2;
    const ref = await db().collection('contributions').add({
      key, slug, page, anchor: cut(b.anchor, 120), label: cut(b.label, 200), kind, text, lang: cut(b.lang, 5) || 'en',
      credit, ...(credit ? { displayName: cut(b.displayName, 40) } : {}),
      uid: String(user.uid), termsVersion: CONTRIB_TERMS_VERSION, termsAcceptedAt: Date.now(),
      status: 'pending', at: Date.now(),
    });
    res.json({ ok: true, id: ref.id });
  });

  app.get('/api/admin/contributions', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const open = (await db().collection('contributions').where('status', 'in', ['pending', 'checked']).limit(200).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const decided = (await db().collection('contributions').where('status', 'in', ['approved', 'rejected', 'removed']).limit(300).get()).docs
        .map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => Number(b.decided?.at || 0) - Number(a.decided?.at || 0)).slice(0, 40);
      const strip = (x: any) => { const { uid, ...rest } = x; return rest; };
      res.json({ open: open.sort((a, b) => Number(a.at) - Number(b.at)).map(strip), decided: decided.map(strip), enabled: await enabled() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load suggestions.' });
    }
  });

  app.post('/api/admin/contributions/:id', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const action = String(req.body?.action || '');
    if (!['approve', 'reject', 'remove'].includes(action)) return res.status(400).json({ error: 'approve, reject or remove' });
    const ref = db().collection('contributions').doc(String(req.params.id));
    const c: any = (await ref.get()).data();
    if (!c) return res.status(404).json({ error: 'No such suggestion.' });
    const text = cut(req.body?.text, 2000) || c.check?.proposal || c.text;
    await ref.set({
      status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'removed',
      decided: { by: String((req as any).user?.email || ''), at: Date.now(), ...(action === 'approve' ? { text } : {}) },
      ...(action === 'approve' ? { absorbed: FieldValue.delete() } : {}),
    }, { merge: true });
    res.json({ ok: true });
  });
}

function suggestPage(firebaseConfig: Record<string, string>, names: { game: string; pageName: string } = { game: '', pageName: '' }): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  const namesJson = JSON.stringify(names).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Suggest an edit | Quest Compendium</title>
<style>
  :root { --bg:#07070a; --card:#121218; --line:#26262f; --text:#e8e6f0; --dim:#9a97a8; --accent:#a87ffb; --bad:#ff8a80; --ok:#6fd3a0; color-scheme: dark; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; padding:0 16px; }
  main { max-width:640px; margin:0 auto; padding-block:32px 64px; display:grid; gap:16px; }
  h1 { font-size:1.5rem; margin:0; } .dim { color:var(--dim); font-size:.9rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; display:grid; gap:12px; }
  label { display:grid; gap:6px; } textarea, input[type=text] { width:100%; box-sizing:border-box; background:#1b1b24; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:10px; font:inherit; }
  textarea { min-height:150px; } .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  button { background:#1b1b24; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:9px 14px; font:inherit; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#120c22; font-weight:600; } button:disabled { opacity:.5; cursor:default; }
  .kind { display:flex; gap:8px; flex-wrap:wrap; } .kind label { display:flex; gap:6px; align-items:center; border:1px solid var(--line); border-radius:10px; padding:8px 12px; cursor:pointer; }
  a { color:var(--accent); } #msg.bad { color:var(--bad); } #msg.ok { color:var(--ok); }
</style>
</head>
<body><main>
  <div><div class="dim" id="where">Quest Compendium guides</div><h1>Suggest an edit</h1></div>
  <p class="dim">Spotted a mistake, or know a detail the guide is missing? Tell us. Every suggestion is checked against sources and reviewed before it goes on the page. If you like, we'll credit you by name.</p>
  <div class="card" id="gate">
    <div>Sign in with Google to send a suggestion (so we can credit you and keep out spam).</div>
    <div class="row"><button class="primary" id="signin">Sign in with Google</button><button id="redirect">Sign in (if the popup is blocked)</button></div>
    <div class="dim" id="gateMsg"></div>
  </div>
  <form class="card" id="form" hidden>
    <div class="kind">
      <label><input type="radio" name="kind" value="correction" checked> Something is wrong</label>
      <label><input type="radio" name="kind" value="detail"> Add a detail</label>
    </div>
    <label>What should the guide say? <span class="dim">Be specific: names, places, what to do. No links.</span><textarea id="text" maxlength="2000" required></textarea></label>
    <div class="row"><label class="row" style="display:flex"><input type="checkbox" id="credit"> Credit me as</label><input type="text" id="name" maxlength="40" placeholder="Your display name" style="flex:1;min-width:180px"></div>
    <label class="row" style="display:flex"><input type="checkbox" id="terms" required> I agree to the <a href="https://questcompendium.com/contributor-terms/" target="_blank" rel="noopener">contributor terms</a> (you let us publish, edit and translate your suggestion, and it's your own work).</label>
    <div class="row"><button class="primary" type="submit" id="send">Send suggestion</button><span id="msg"></span></div>
    <div class="dim" id="who"></div>
  </form>
</main>
<script type="module">
  const q = new URLSearchParams(location.search);
  const ctx = { key: q.get('key') || '', slug: q.get('slug') || '', page: q.get('page') || 'area', anchor: q.get('anchor') || '', label: q.get('label') || '', lang: q.get('lang') || 'en' };
  const $ = (id) => document.getElementById(id);
  const names = ${namesJson};
  $('where').textContent = [names.game, names.pageName, ctx.label && ctx.label !== names.pageName ? ctx.label : ''].filter(Boolean).join(' · ') || 'Quest Compendium guides';
  if (names.game) document.title = 'Suggest an edit: ' + names.game + ' | Quest Compendium';
  let fb;
  try {
    fb = { ...(await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js')), ...(await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js')) };
  } catch (e) { $('gateMsg').textContent = 'Sign-in could not load. A blocker may be stopping www.gstatic.com: allow it, or open this page in Chrome, Edge or Firefox.'; throw e; }
  const { initializeApp, getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged } = fb;
  const fbCfg = ${cfg};
  if (location.hostname === 'questcompendium.com' || location.hostname === 'www.questcompendium.com') fbCfg.authDomain = location.hostname;
  const auth = getAuth(initializeApp(fbCfg));
  getRedirectResult(auth).catch((e) => { $('gateMsg').textContent = 'Sign-in failed: ' + (e.code || e.message); });
  $('signin').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('gateMsg').textContent = 'Sign-in failed: ' + (e.code || e.message); });
  $('redirect').onclick = () => signInWithRedirect(auth, new GoogleAuthProvider());
  onAuthStateChanged(auth, (u) => {
    $('gate').hidden = !!u; $('form').hidden = !u;
    if (u) { $('who').textContent = 'Signed in as ' + (u.email || 'your Google account') + '.'; if (!$('name').value) $('name').value = (u.displayName || '').split(' ')[0]; }
  });
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('msg'); msg.className = ''; msg.textContent = 'Sending…'; $('send').disabled = true;
    try {
      const token = await auth.currentUser.getIdToken();
      const body = { ...ctx, kind: document.querySelector('input[name=kind]:checked').value, text: $('text').value, credit: $('credit').checked, displayName: $('name').value, termsVersion: $('terms').checked ? '${CONTRIB_TERMS_VERSION}' : '' };
      const r = await fetch('/api/contributions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
      msg.className = 'ok'; msg.textContent = 'Thank you! We check every suggestion and review it before it goes on the page.';
      $('text').value = '';
    } catch (err) { msg.className = 'bad'; msg.textContent = err.message; }
    $('send').disabled = false;
  });
</script>
</body></html>`;
}
