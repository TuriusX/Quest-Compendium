/**
 * The guide review queue: guides that failed the publishing review (scripts/guides/review.ts --gate) and mistakes
 * players report from the website ("Spot a mistake? Report it here"), with a page for the admin to decide what happens.
 *
 *   POST /api/guides/report              public: { key, page, text, entry?, correct?, lang, path } from a guide page;
 *                                        rate-limited, obvious spam dropped. With an entry and "what's correct", it's a
 *                                        player correction (corrections.ts) instead: verified like the app's, an
 *                                        anonymous one counting as half a reporter (keyed by a hash of the IP)
 *   GET  /admin/reviews                  the admin page (sign in with Google; only ADMIN_EMAILS get the data)
 *   GET  /api/admin/review-queue         open items, then the last decided ones
 * The page's Corrections tab lists player corrections to the guides (corrections.ts) with apply / dismiss, and its
 * Reports tab the players' reports on AI answers (answerReports.ts) with open / reviewed / actioned.
 *   POST /api/admin/review-queue/:id     { action }: publish (a staged rebuild, as it is), fix, outline, careful
 *                                        (repair.ts), unpublish, dismiss, reopen
 *
 * Decisions are carried out by the next guide pipeline run (scripts/pipeline/run.ts), which also repairs, re-reviews
 * and publishes; a dismissal takes effect at once. Items live in Firestore reviewQueue/{id}: one "review-{key}" item
 * per guide (the latest review replaces it) and one item per player report.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { saveCandidate, entryById, looksLikeSpam, playerHash, REPORTER_WEIGHT } from './corrections';

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = { requireAuth: Mw; optionalAuth: Mw; firebaseWebConfig: Record<string, string> };

export const ADMIN_ACTIONS = ['publish', 'fix', 'outline', 'careful', 'unpublish', 'dismiss', 'reopen'] as const;
const admins = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (user: any) => !!user?.email && user.email_verified !== false && admins().includes(String(user.email).toLowerCase());

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
    const entryId = String(b.entry || '').trim();
    const correct = String(b.correct || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    // Obvious spam is dropped quietly (a normal reply, so it isn't worth retrying).
    if (looksLikeSpam(text) && !(correct && !looksLikeSpam(correct))) return res.json({ ok: true });
    try {
      // A report that names an entry and says what's correct: a correction candidate for the daily check.
      if (key && page && /^[A-Za-z0-9_-]{1,40}$/.test(entryId) && correct && !looksLikeSpam(correct)) {
        const found = await entryById(key, page, entryId);
        if (found) {
          const uid = (req as any).user?.uid as string | undefined;
          const signedIn = !!uid && !String(uid).startsWith('guest_');
          const reporterKey = signedIn ? playerHash(uid!) : `ip:${crypto.createHash('sha256').update(`${process.env.CORRECTION_SALT || 'qc-corrections'}:ip:${ip}`).digest('hex').slice(0, 20)}`;
          await saveCandidate({
            gameKey: key, game: found.game, area: page, areaName: found.areaName, entry: found.entry, claim: correct, field: 'where',
            via: 'report', question: text, reporterKey, source: 'website',
            weight: signedIn ? 1 : REPORTER_WEIGHT.website, guest: !signedIn, dailyLimit: signedIn ? 20 : 5,
          });
          return res.json({ ok: true });
        }
      }
      let game = '', pageName = '';
      if (key) {
        const g = await getFirestore().collection('guides').doc(key).get();
        game = String(g.data()?.game || '');
        if (page) pageName = String((await g.ref.collection('areas').doc(page).get()).data()?.name || '');
      }
      await queue().add({
        kind: 'report', key, game, page, pageName, text, ...(correct ? { correct } : {}), ...(entryId ? { entry: entryId.slice(0, 40) } : {}),
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

  // The weekly Search Console summary (scripts/pipeline/searchConsole.ts): the Search tab.
  app.get('/api/admin/search-console', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json((await getFirestore().collection('system').doc('searchConsole').get()).data() || {});
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the Search Console summary.' });
    }
  });

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
  .tabs { display: flex; gap: 4px; }
  .tab { border-radius: 8px; }
  .tab.on { border-color: var(--accent); color: #fff; background: #2a2140; }
  .chip.pending { color: var(--warn); border-color: #fbbf2455; }
  .chip.src { color: var(--text); border-color: #ffffff30; }
  .chip.disputed { color: var(--bad); border-color: #f8717155; }
  .chip.approved { color: var(--ok); border-color: #4ade8055; }
  .chip.fight { color: #f87171; border-color: #f8717155; }
  .said { margin: 6px 0; padding: 8px 10px; border-left: 3px solid var(--accent); background: #a87ffb10; border-radius: 0 8px 8px 0; }
  .chip.harmful { color: var(--bad); border-color: #f8717155; }
  .chip.wrong { color: var(--warn); border-color: #fbbf2455; }
  .answer { margin: 6px 0; padding: 8px 10px; border-left: 3px solid var(--line); background: #ffffff06; border-radius: 0 8px 8px 0; white-space: pre-wrap; max-height: 320px; overflow: auto; }
  input.claim { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; flex: 1; min-width: 220px; }
  .guide { margin: 6px 0; padding: 8px 10px; border-left: 3px solid var(--line); background: #ffffff08; border-radius: 0 8px 8px 0; }
</style>
</head>
<body>
<header>
  <h1>Guide review queue</h1>
  <nav class="tabs"><button id="tabGuides" class="tab on">Guides</button><button id="tabCorr" class="tab">Corrections</button><button id="tabSearch" class="tab">Search</button><button id="tabReports" class="tab">Reports</button><button id="tabQuality" class="tab">Quality</button></nav>
  <select id="filter" aria-label="Show"><option value="all">All open</option><option value="review">Failed reviews</option><option value="report">Player reports</option></select>
  <button id="signin" class="primary">Sign in with Google</button>
</header>
<main>
  <p id="msg">Sign in to see the queue. Decisions are carried out by the next guide pipeline run (daily, 9:00 Chicago time); a dismissal is immediate.</p>
  <div id="list"></div>
  <div id="corr" hidden></div>
  <div id="search" hidden></div>
  <div id="reports" hidden></div>
  <div id="quality" hidden></div>
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
  let corr = { open: [], decided: [] };
  let tab = 'guides';
  const SOURCE = { app: 'App', website: 'Website', discord: 'Discord' };
  const VERDICT = { confirmed: 'sources confirm the players', contradicted: 'sources contradict the players', unclear: 'sources do not settle it' };
  // A correction: what the guide says, what players said, the source check, and apply / dismiss.
  function corrCard(g) {
    const head = '<div class="row"><span class="game">' + esc(g.game) + ' · ' + esc(g.areaName) + '</span>'
      + (g.entryKind === 'fight' ? '<span class="chip fight">Missing fight</span>' : '')
      + '<span class="chip ' + esc(g.status) + '">' + esc(g.status === 'approved' ? 'applying next run' : g.status) + '</span>'
      + '<span class="dim">reporters worth ' + esc(g.players || 0) + ' of 3, ' + esc(g.reports?.length || g.reports || 0) + ' report(s)' + (g.modConfirmed ? ', confirmed by a moderator' : '') + '</span>'
      + (Array.isArray(g.sources) ? g.sources.map((x) => '<span class="chip src">' + esc(SOURCE[x] || x) + '</span>').join('') : '')
      + '<span class="dim">' + new Date(g.updatedAt || g.createdAt).toLocaleString() + '</span>'
      + ' <a href="' + SITE + esc(g.gameKey) + '/' + esc(g.area) + '/" target="_blank" rel="noopener">open on the site</a></div>';
    const guide = g.entryKind === 'fight'
      ? '<div class="guide"><b>Not in the guide:</b> ' + esc(g.entryName) + (g.enemies && g.enemies.length ? ' <span class="dim">(enemies: ' + esc(g.enemies.join(', ')) + ')</span>' : '') + '. Battle plans from players below; Apply adds it to the key fights on that page.</div>'
      : '<div class="guide"><b>The guide says</b> (' + esc(g.entryName) + '): ' + esc(g.guideText || '(nothing)') + '</div>';
    const how = (r) => r.source === 'website' ? 'website report' + (r.weight < 1 ? ', anonymous (counts half)' : ', signed in')
      : r.source === 'discord' ? 'Discord /correction'
      : (r.via === 'combat' ? 'app: battle plan for a fight the guide lacks' : r.via === 'pushback' ? 'app: after the player pushed back' : 'app: answer contradicted the guide') + (r.placeConfirmed ? ', place confirmed' : '') + (r.guest ? ', guest (does not count)' : '');
    const said = (Array.isArray(g.reports) ? g.reports : []).map((r) => '<div class="said"><span class="chip src">' + esc(SOURCE[r.source] || 'App') + '</span> ' + esc(r.claim)
      + ' <span class="dim">(' + esc(how(r)) + ')</span></div>').join('');
    const sc = g.sourceCheck;
    const check = sc ? '<div class="dim">Source check: <b>' + esc(VERDICT[sc.verdict] || sc.verdict) + '</b>. ' + esc(sc.evidence || '') + (sc.sources?.length ? ' (' + esc(sc.sources.join(', ')) + ')' : '') + (sc.reviewer ? ' Reviewer: ' + esc(sc.reviewer) : '') + '</div>' : '<div class="dim">Not checked against sources yet (the next pipeline run does).</div>';
    const buttons = '<div class="actions"><button class="primary" data-cid="' + esc(g.id) + '" data-cact="apply">Apply</button><button data-cid="' + esc(g.id) + '" data-cact="dismiss">Dismiss</button></div>';
    return '<div class="card">' + head + guide + said + check + buttons + '</div>';
  }
  function renderCorr() {
    $('corr').innerHTML = (corr.open.length ? corr.open.map(corrCard).join('') : '<p class="dim">No corrections waiting.</p>')
      + (corr.decided.length ? '<details><summary>Recently decided</summary>' + corr.decided.map((g) => '<div class="card"><div class="row"><span class="game">' + esc(g.game) + ' · ' + esc(g.areaName) + ' · ' + esc(g.entryName) + '</span>' + (g.entryKind === 'fight' ? '<span class="chip fight">Missing fight</span>' : '') + '<span class="chip">' + esc(g.status) + '</span></div>' + (g.verifiedText ? '<div class="said">' + esc(g.verifiedText.fight ? [g.verifiedText.fight.name, g.verifiedText.fight.enemies, g.verifiedText.fight.tactics].filter(Boolean).join(' · ') : [g.verifiedText.where, g.verifiedText.how, g.verifiedText.notes].filter(Boolean).join(' ')) + '</div>' : '') + '</div>').join('') + '</details>' : '');
    if (tab === 'corr') $('msg').textContent = corr.open.length + ' correction(s) waiting. Apply writes it into the guide on the next pipeline run (through the review gate); dismiss is immediate.';
  }
  // Reports: players' reports on AI answers (Store policy 11.16): what was asked and answered, why, and the decision.
  let reps = { open: [], decided: [] };
  const REASON = { harmful: 'Offensive or harmful', wrong: 'Wrong or misleading', other: 'Other' };
  function repCard(r, decided) {
    const head = '<div class="row"><span class="game">' + esc(r.game || 'No game') + (r.place ? ' · ' + esc(r.place) : '') + '</span>'
      + '<span class="chip ' + esc(r.reason) + '">' + esc(REASON[r.reason] || r.reason) + '</span>'
      + (decided ? '<span class="chip">' + esc(r.status) + '</span>' : '')
      + '<span class="dim">' + esc([r.model, r.client, r.appVersion && 'v' + r.appVersion, r.signedIn ? 'signed in' : 'not signed in'].filter(Boolean).join(' · ')) + '</span>'
      + '<span class="dim">' + new Date(r.createdAt).toLocaleString() + '</span></div>';
    const body = (r.comment ? '<blockquote>' + esc(r.comment) + '</blockquote>' : '')
      + (r.question ? '<div class="guide"><b>Asked:</b> ' + esc(r.question) + '</div>' : '')
      + '<details' + (decided ? '' : ' open') + '><summary>The answer</summary><div class="answer">' + esc(r.answer) + '</div></details>';
    const entries = (r.guide && r.guide.entries) || [];
    const cand = !decided && r.reason === 'wrong' && r.guide
      ? (entries.length
        ? '<div class="row" style="margin-top:8px"><span class="dim">Guide page ' + esc(r.guide.name) + ':</span><select data-rentry="' + esc(r.id) + '">' + entries.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.kind + ': ' + e.name) + '</option>').join('') + '</select>'
          + '<input class="claim" data-rclaim="' + esc(r.id) + '" placeholder="What is correct (becomes a correction candidate)" value="' + esc(r.comment || '') + '"><button data-rid="' + esc(r.id) + '" data-ract="candidate">Make correction candidate</button></div>'
        : '<div class="dim">Guide page ' + esc(r.guide.name) + ': the answer names none of its entries.</div>')
      : (r.candidateId ? '<div class="dim">Became correction candidate ' + esc(r.candidateId) + ' (Corrections tab).</div>' : '');
    const acts = decided ? ['open'] : ['reviewed', 'actioned'];
    const LBL = { open: 'Reopen', reviewed: 'Reviewed (no action)', actioned: 'Actioned' };
    const buttons = '<div class="actions">' + acts.map((a) => '<button data-rid="' + esc(r.id) + '" data-ract="' + a + '"' + (a === 'reviewed' ? ' class="primary"' : '') + '>' + LBL[a] + '</button>').join('') + '</div>';
    return '<div class="card">' + head + body + cand + buttons + '</div>';
  }
  function renderReports() {
    $('reports').innerHTML = (reps.open.length ? reps.open.map((r) => repCard(r, false)).join('') : '<p class="dim">No reports waiting.</p>')
      + (reps.decided.length ? '<details><summary>Recently decided</summary>' + reps.decided.map((r) => repCard(r, true)).join('') + '</details>' : '');
    if (tab === 'reports') $('msg').textContent = reps.open.length + ' open report(s) on AI answers. Reviewed: looked at, nothing to change; actioned: something was done about it.';
  }
  // Quality: players' 👍 / 👎 on answers (last 30 days) per game, question type and model, recent 👎s with their
  // answers, and how often the markers' close-up check drops a marker, per game.
  let qual = {};
  const WHY = { place: 'Wrong place', info: 'Wrong info', marker: 'Marker off', unhelpful: 'Not helpful' };
  function renderQuality() {
    const tbl = (title, rows, first) => '<div class="card"><b>' + esc(title) + '</b>' + (rows && rows.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:13px"><tr><th style="text-align:left;padding:4px">' + esc(first) + '</th><th style="text-align:right;padding:4px">👍</th><th style="text-align:right;padding:4px">👎</th><th style="text-align:right;padding:4px">👍 rate</th></tr>'
        + rows.map((r) => '<tr><td style="padding:4px;border-top:1px solid var(--line)">' + esc(r.key) + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)">' + r.up + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)">' + r.down + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)"><b>' + r.rate + '%</b></td></tr>').join('') + '</table>'
      : '<p class="dim">No votes yet.</p>') + '</div>';
    const t = qual.total || {};
    const reasons = Object.entries(qual.reasons || {}).filter(([, n]) => n).map(([k, n]) => esc(WHY[k] || k) + ' ' + n).join(' · ');
    const mk = qual.markers || [];
    const markers = '<div class="card"><b>Markers dropped by the close-up check</b>' + (mk.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:13px"><tr><th style="text-align:left;padding:4px">Game</th><th style="text-align:right;padding:4px">Checked</th><th style="text-align:right;padding:4px">Dropped</th><th style="text-align:right;padding:4px">Drop rate</th></tr>'
        + mk.map((m) => '<tr><td style="padding:4px;border-top:1px solid var(--line)">' + esc(m.game) + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)">' + m.checked + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)">' + m.dropped + '</td><td style="text-align:right;padding:4px;border-top:1px solid var(--line)"><b>' + m.rate + '%</b></td></tr>').join('') + '</table>'
      : '<p class="dim">No checks counted yet.</p>') + '</div>';
    const downs = (qual.recentDown || []).map((r) => '<div class="card"><div class="row"><span class="game">' + esc(r.game || 'No game') + '</span>'
      + (r.reason ? '<span class="chip wrong">' + esc(WHY[r.reason] || r.reason) + '</span>' : '')
      + '<span class="dim">' + esc([r.qtype, r.model, r.markers ? 'markers shown' : '', r.client].filter(Boolean).join(' · ')) + '</span>'
      + '<span class="dim">' + new Date(r.at).toLocaleString() + '</span></div>'
      + (r.question ? '<div class="guide"><b>Asked:</b> ' + esc(r.question) + '</div>' : '')
      + '<details><summary>The answer</summary><div class="answer">' + esc(r.answer || '') + '</div></details></div>').join('');
    $('quality').innerHTML = '<div class="card"><b>Last 30 days:</b> ' + (t.up || 0) + ' 👍, ' + (t.down || 0) + ' 👎' + (t.rate != null ? ', <b>' + t.rate + '%</b> 👍' : '') + (reasons ? '<div class="dim">What was wrong: ' + reasons + '</div>' : '') + '</div>'
      + tbl('Per question type', qual.byType, 'Type') + tbl('Per model', qual.byModel, 'Model') + tbl('With and without markers', qual.byMarkers, 'Markers') + tbl('Per game', qual.byGame, 'Game')
      + markers + '<h3>Recent 👎</h3>' + (downs || '<p class="dim">None.</p>');
    if (tab === 'quality') $('msg').textContent = 'Answer quality from players’ votes, and marker drops from the close-up check.';
  }
  // Search: the weekly Search Console summary (last 28 days), the pages planned for a repair, games from searches.
  let sc = {};
  function renderSearch() {
    if (!sc.pulledAt) { $('search').innerHTML = '<p class="dim">No Search Console data yet: the pipeline pulls it weekly.</p>'; if (tab === 'search') $('msg').textContent = ''; return; }
    const t = sc.totals || {};
    const pct = (x) => (Math.round((x || 0) * 1000) / 10) + '%';
    const table = (head, rows) => '<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>' + head.map((h) => '<th style="text-align:left;padding:4px;border-bottom:1px solid var(--line)">' + esc(h) + '</th>').join('') + '</tr>' + rows.map((r) => '<tr>' + r.map((c) => '<td style="padding:4px;border-bottom:1px solid var(--line)">' + c + '</td>').join('') + '</tr>').join('') + '</table>';
    const est = sc.estimate || {};
    $('search').innerHTML =
      '<div class="card"><div class="row"><span class="game">' + esc(sc.site || '') + '</span><span class="dim">' + esc((sc.range || {}).start || '') + ' to ' + esc((sc.range || {}).end || '') + '</span></div>'
      + '<div>' + (t.impressions || 0).toLocaleString() + ' impressions, ' + (t.clicks || 0).toLocaleString() + ' clicks, CTR ' + pct(t.ctr) + '</div></div>'
      + '<div class="card"><b>Plan</b> ' + (sc.repairsOn ? '(repairs on: queued weekly)' : '(repairs off: nothing queued yet)') + ': ' + (est.pages || 0) + ' page(s) in ' + (est.guides || 0) + ' guide(s), about ' + (est.searches || 0) + ' searches and $' + (est.dollars || 0) + ' a week'
      + ((sc.plan || []).length ? table(['Page', 'Impressions', 'Position', 'What to answer'], sc.plan.map((p) => [esc(p.game + ' / ' + p.name) + (p.striking ? ' <span class="chip queued">5-20</span>' : ''), String(p.impressions), String(p.position), esc(p.fixes.map((f) => '"' + f.query + '" ' + f.verdict).join('; ') || 'title and description')])) : '') + '</div>'
      + '<div class="card"><b>Top queries</b>' + table(['Query', 'Impressions', 'Clicks', 'Position'], (sc.topQueries || []).slice(0, 25).map((q) => [esc(q.query), String(q.impressions), String(q.clicks), String(q.position)])) + '</div>'
      + '<div class="card"><b>Top guide pages</b>' + table(['Page', 'Impressions', 'Clicks', 'CTR', 'Position', 'Top query'], (sc.topPages || []).slice(0, 25).map((p) => [esc(p.key + '/' + p.slug), String(p.impressions), String(p.clicks), pct(p.ctr), String(p.position), esc(p.topQuery || '')])) + '</div>'
      + ((sc.gained || []).length ? '<div class="card"><b>Gained clicks this week</b> ' + sc.gained.map((g) => esc(g.key + '/' + g.slug) + ' +' + g.gain).join(', ') + '</div>' : '')
      + ((sc.wishes || []).length ? '<div class="card"><b>Games people search for without a guide</b> (on the wish list) ' + sc.wishes.slice(0, 20).map((w) => esc(w.game) + ' (' + w.impressions + ')').join(', ') + '</div>' : '');
    if (tab === 'search') $('msg').textContent = 'Search Console, pulled ' + new Date(sc.pulledAt).toLocaleString() + '.';
  }
  function showTab(t) {
    tab = t;
    $('tabGuides').classList.toggle('on', t === 'guides');
    $('tabCorr').classList.toggle('on', t === 'corr');
    $('tabSearch').classList.toggle('on', t === 'search');
    $('tabReports').classList.toggle('on', t === 'reports');
    $('tabQuality').classList.toggle('on', t === 'quality');
    $('reports').hidden = t !== 'reports';
    $('quality').hidden = t !== 'quality';
    $('list').hidden = t !== 'guides';
    $('decidedBox').hidden = t !== 'guides' || !data.decided.length;
    $('filter').hidden = t !== 'guides';
    $('corr').hidden = t !== 'corr';
    $('search').hidden = t !== 'search';
    if (t === 'corr') renderCorr(); else if (t === 'search') renderSearch(); else if (t === 'reports') renderReports(); else if (t === 'quality') renderQuality(); else render();
  }

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
    if (tab !== 'guides') return;
    $('msg').textContent = data.open.length + ' open item(s). Decisions run on the next pipeline run (daily, 9:00 Chicago time); a dismissal is immediate.';
  }
  async function load() {
    try {
      [data, corr, sc, reps, qual] = await Promise.all([api('/api/admin/review-queue'), api('/api/admin/corrections'), api('/api/admin/search-console').catch(() => ({})), api('/api/admin/answer-reports').catch(() => ({ open: [], decided: [] })), api('/api/admin/answer-quality').catch(() => ({}))]);
      render();
      renderCorr();
      renderReports();
      showTab(tab);
    }
    catch (e) { $('msg').textContent = e.message === 'Not an admin.' ? 'This account is not an admin (ADMIN_EMAILS on the server).' : 'Could not load the queue: ' + e.message; }
  }
  document.addEventListener('click', async (e) => {
    const rb = e.target.closest('button[data-ract]');
    if (rb) {
      const id = rb.dataset.rid;
      const body = { action: rb.dataset.ract };
      if (body.action === 'candidate') {
        body.entryId = document.querySelector('select[data-rentry="' + CSS.escape(id) + '"]')?.value;
        body.claim = document.querySelector('input[data-rclaim="' + CSS.escape(id) + '"]')?.value;
      }
      rb.disabled = true;
      try { await api('/api/admin/answer-reports/' + encodeURIComponent(id), body); await load(); }
      catch (err) { alert(err.message); rb.disabled = false; }
      return;
    }
    const c = e.target.closest('button[data-cact]');
    if (c) {
      c.disabled = true;
      try { await api('/api/admin/corrections/' + encodeURIComponent(c.dataset.cid), { action: c.dataset.cact }); await load(); }
      catch (err) { alert(err.message); c.disabled = false; }
      return;
    }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    b.disabled = true;
    try { await api('/api/admin/review-queue/' + encodeURIComponent(b.dataset.id), { action: b.dataset.act }); await load(); }
    catch (err) { alert(err.message); b.disabled = false; }
  });
  $('filter').addEventListener('change', render);
  $('tabGuides').addEventListener('click', () => showTab('guides'));
  $('tabCorr').addEventListener('click', () => showTab('corr'));
  $('tabSearch').addEventListener('click', () => showTab('search'));
  $('tabReports').addEventListener('click', () => showTab('reports'));
  $('tabQuality').addEventListener('click', () => showTab('quality'));
  $('signin').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('msg').textContent = 'Sign-in failed: ' + (e.code || e.message); }));
  onAuthStateChanged(auth, (u) => { $('signin').hidden = !!u; if (u) load(); });
</script>
</body>
</html>`;
}
