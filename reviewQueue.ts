/**
 * The guide review queue: guides that failed the publishing review (scripts/guides/review.ts --gate) and mistakes
 * players report from the website ("Spot a mistake? Report it here"), with a page for the admin to decide what happens.
 *
 *   POST /api/guides/report              public: { key, page, text, lang, path } from a guide page; rate-limited
 *   GET  /admin/reviews                  the admin page (sign in with Google; only ADMIN_EMAILS get the data)
 *   GET  /api/admin/review-queue         open items, then the last decided ones
 *   POST /api/admin/review-queue/:id     { action }: publish (a staged rebuild, as it is), fix, outline, careful
 *                                        (repair.ts), unpublish, dismiss, reopen
 *
 * Decisions are carried out by the next guide pipeline run (scripts/pipeline/run.ts), which also repairs, re-reviews
 * and publishes; a dismissal takes effect at once. Items live in Firestore reviewQueue/{id}: one "review-{key}" item
 * per guide (the latest review replaces it) and one item per player report.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore } from 'firebase-admin/firestore';

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = { requireAuth: Mw; optionalAuth: Mw; firebaseWebConfig: Record<string, string> };

export const ADMIN_ACTIONS = ['publish', 'fix', 'outline', 'careful', 'unpublish', 'dismiss', 'reopen'] as const;
const admins = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (user: any) => !!user?.email && user.email_verified !== false && admins().includes(String(user.email).toLowerCase());

// Reports: at most 5 an hour from one address and 300 a day in all (kept in memory; a restart resets them).
const perIp = new Map<string, number[]>();
let day = '', dayCount = 0;
function reportAllowed(ip: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
    perIp.clear();
  }
  const recent = (perIp.get(ip) || []).filter((t) => Date.now() - t < 3_600_000);
  if (recent.length >= 5 || dayCount >= 300) return false;
  recent.push(Date.now());
  perIp.set(ip, recent);
  dayCount++;
  return true;
}

export function registerReviewQueue(app: Express, deps: Deps) {
  const queue = () => getFirestore().collection('reviewQueue');

  app.post('/api/guides/report', deps.optionalAuth, async (req: Request, res: Response) => {
    const b = req.body || {};
    const key = String(b.key || '').trim();
    const page = String(b.page || '').trim();
    const text = String(b.text || '').trim().slice(0, 1000);
    if (key && !/^[a-z0-9-]{1,80}$/.test(key)) return res.status(400).json({ error: 'Unknown guide.' });
    if (page && !/^[a-z0-9-]{1,100}$/.test(page)) return res.status(400).json({ error: 'Unknown page.' });
    if (text.length < 5) return res.status(400).json({ error: 'Please say what is wrong.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!reportAllowed(ip)) return res.status(429).json({ error: 'Too many reports right now. Please try again later.' });
    try {
      let game = '', pageName = '';
      if (key) {
        const g = await getFirestore().collection('guides').doc(key).get();
        game = String(g.data()?.game || '');
        if (page) pageName = String((await g.ref.collection('areas').doc(page).get()).data()?.name || '');
      }
      await queue().add({
        kind: 'report', key, game, page, pageName, text,
        lang: String(b.lang || 'en').slice(0, 5), path: String(b.path || '').slice(0, 200),
        uid: (req as any).user?.uid || null, status: 'open', action: null, createdAt: Date.now(), updatedAt: Date.now(),
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[report] save failed:', e?.message);
      res.status(500).json({ error: 'Could not save the report.' });
    }
  });

  const requireAdmin: Mw = (req, res, next) => (isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));

  app.get('/api/admin/review-queue', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await queue().orderBy('updatedAt', 'desc').limit(300).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const open = items.filter((i) => i.status === 'open' || i.status === 'queued');
      const decided = items.filter((i) => i.status === 'done').slice(0, 40);
      res.json({ open, decided });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the queue.' });
    }
  });

  app.post('/api/admin/review-queue/:id', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const action = String(req.body?.action || '');
    if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    const ref = queue().doc(String(req.params.id));
    const item = (await ref.get()).data();
    if (!item) return res.status(404).json({ error: 'No such item.' });
    if (action !== 'dismiss' && action !== 'reopen' && !item.key) return res.status(400).json({ error: 'This report is not about a guide.' });
    const by = String((req as any).user?.email || '');
    const update =
      action === 'dismiss' ? { status: 'done', resolution: 'dismissed', action: null }
      : action === 'reopen' ? { status: 'open', resolution: null, action: null }
      : { status: 'queued', action };
    await ref.set({ ...update, actedBy: by, actedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true });
  });

  app.get('/admin/reviews', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.type('html').send(adminPage(deps.firebaseWebConfig));
  });
}

function adminPage(firebaseConfig: Record<string, string>): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Review queue</title>
<style>
  :root { color-scheme: dark; --bg: #07070a; --card: #111118; --line: #24242e; --text: #e4e4e7; --dim: #a1a1aa; --accent: #a87ffb; --ok: #4ade80; --bad: #f87171; --warn: #fbbf24; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; background: rgba(7,7,10,.9); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; flex: 1; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  button, select { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 0 0 12px; }
  .row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .game { font-weight: 700; font-size: 15px; }
  .chip { font-size: 11px; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--line); color: var(--dim); }
  .chip.report { color: var(--warn); border-color: #fbbf2455; }
  .chip.review { color: var(--accent); border-color: #a87ffb55; }
  .chip.queued { color: var(--ok); border-color: #4ade8055; }
  .score { font-weight: 700; }
  .dim { color: var(--dim); }
  ul { margin: 6px 0; padding-left: 18px; }
  li { margin: 2px 0; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  blockquote { margin: 8px 0; padding: 8px 10px; border-left: 3px solid var(--warn); background: #fbbf2410; border-radius: 0 8px 8px 0; white-space: pre-wrap; }
  a { color: var(--accent); }
  #msg { color: var(--dim); }
  details summary { cursor: pointer; color: var(--dim); }
</style>
</head>
<body>
<header>
  <h1>Guide review queue</h1>
  <select id="filter" aria-label="Show"><option value="all">All open</option><option value="review">Failed reviews</option><option value="report">Player reports</option></select>
  <button id="signin" class="primary">Sign in with Google</button>
</header>
<main>
  <p id="msg">Sign in to see the queue. Decisions are carried out by the next guide pipeline run (daily, 9:00 Chicago time); a dismissal is immediate.</p>
  <div id="list"></div>
  <details id="decidedBox" hidden><summary>Recently decided</summary><div id="decided"></div></details>
</main>
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
  const auth = getAuth(initializeApp(${cfg}));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SITE = 'https://questcompendium.com/guides/';
  const LABEL = { publish: 'Publish as is', fix: 'Fix pages', outline: 'Rebuild: new outline', careful: 'Rebuild careful', unpublish: 'Unpublish', dismiss: 'Dismiss', reopen: 'Reopen' };
  let data = { open: [], decided: [] };

  async function api(path, body) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function card(i, decided) {
    const link = i.key ? '<a href="' + SITE + esc(i.key) + '/' + (i.page ? esc(i.page) + '/' : '') + '" target="_blank" rel="noopener">open on the site</a>' : '';
    const head = '<div class="row"><span class="game">' + esc(i.game || i.key || 'General report') + '</span>'
      + '<span class="chip ' + esc(i.kind) + '">' + (i.kind === 'report' ? 'player report' : 'failed review') + '</span>'
      + (i.status === 'queued' ? '<span class="chip queued">next run: ' + esc(LABEL[i.action] || i.action) + '</span>' : '')
      + (i.kind === 'review' ? '<span class="score">' + esc(i.score) + '/100</span><span class="dim">recommends ' + esc(i.recommendation) + (i.layout ? ' (' + esc(i.layout) + ' outline)' : '') + (i.staged ? ' · a staged rebuild is waiting' : '') + '</span>' : '')
      + '<span class="dim">' + new Date(i.updatedAt || i.createdAt).toLocaleString() + '</span> ' + link + '</div>';
    let body = '';
    if (i.kind === 'report') body = (i.pageName || i.page ? '<div class="dim">Page: ' + esc(i.pageName || i.page) + '</div>' : '') + '<blockquote>' + esc(i.text) + '</blockquote>';
    else body = '<div>' + esc(i.summary) + '</div>'
      + (i.problems?.length ? '<ul>' + i.problems.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '')
      + (i.pages?.length ? '<details><summary>' + i.pages.length + ' page(s) with problems</summary><ul>' + i.pages.map((p) => '<li><b>' + esc(p.name) + '</b> (' + esc(p.verdict) + '): ' + esc(p.reason) + '</li>').join('') + '</ul></details>' : '');
    const acts = decided ? ['reopen'] : i.kind === 'report' ? ['fix', 'careful', 'unpublish', 'dismiss'] : [...(i.staged ? ['publish'] : []), 'fix', 'outline', 'careful', 'unpublish', 'dismiss'];
    const buttons = '<div class="actions">' + acts.map((a) => '<button data-id="' + esc(i.id) + '" data-act="' + a + '"' + (a === (i.recommendation === 'rebuild careful' ? 'careful' : i.recommendation === 'fix pages' ? 'fix' : i.recommendation === 'rebuild with a different outline' ? 'outline' : '') ? ' class="primary"' : '') + '>' + LABEL[a] + '</button>').join('') + '</div>';
    return '<div class="card">' + head + body + buttons + '</div>';
  }
  function render() {
    const f = $('filter').value;
    const open = data.open.filter((i) => f === 'all' || i.kind === f);
    $('list').innerHTML = open.length ? open.map((i) => card(i, false)).join('') : '<p class="dim">Nothing waiting. 🎉</p>';
    $('decided').innerHTML = data.decided.map((i) => card(i, true)).join('');
    $('decidedBox').hidden = !data.decided.length;
    $('msg').textContent = data.open.length + ' open item(s). Decisions run on the next pipeline run (daily, 9:00 Chicago time); a dismissal is immediate.';
  }
  async function load() {
    try { data = await api('/api/admin/review-queue'); render(); }
    catch (e) { $('msg').textContent = e.message === 'Not an admin.' ? 'This account is not an admin (ADMIN_EMAILS on the server).' : 'Could not load the queue: ' + e.message; }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    b.disabled = true;
    try { await api('/api/admin/review-queue/' + encodeURIComponent(b.dataset.id), { action: b.dataset.act }); await load(); }
    catch (err) { alert(err.message); b.disabled = false; }
  });
  $('filter').addEventListener('change', render);
  $('signin').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('msg').textContent = 'Sign-in failed: ' + (e.code || e.message); }));
  onAuthStateChanged(auth, (u) => { $('signin').hidden = !!u; if (u) load(); });
</script>
</body>
</html>`;
}
