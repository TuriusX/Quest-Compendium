/**
 * The log of the guides' nightly improvements (scripts/guides/autoImprove.ts; owner, Oct 29 2026), on /admin/asked:
 * every change with its reason, where it came from, what it changed and the sources that back it, and a one-click
 * undo. It replaces the review queue that page had: nothing waits for approval any more.
 *
 *   GET  /api/admin/auto?status=live|undone   the changes, newest first (200)
 *   POST /api/admin/auto/:id                  { action: 'undo' | 'restore' }
 *
 * An undo takes the change off the pages at the next site publish (the nightly pipeline run republishes when
 * system/editor.dirtyAt is newer than its last publish): its overlay edits (guideEdits with auto: the change's id)
 * stop being laid over the page, its "Players asked" entry comes off, a merged page comes back at its own address.
 * An undone change is never made again (autoImprove.ts keeps its signature). "Put back" undoes the undo.
 *
 * The Monday Discord summary's lines (autoWeekLines) are here too: Firestore only, so the pipeline can read them.
 */
import { type Express, type Request, type Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { isAdmin } from './reviewQueue';
import { markSiteDirty } from './ownerEditor';
import { ADMIN_THEME_HEAD, ADMIN_THEME_BUTTON } from './adminTheme';

const SITE = () => (process.env.QC_SITE_URL || 'https://questcompendium.com').replace(/\/$/, '');
const col = () => getFirestore().collection('autoChanges');

/** Undo (status "undone") or put back (status "live") one change, with its edits and its "Players asked" entry. */
export async function setChange(id: string, live: boolean, by: string): Promise<boolean> {
  const db = getFirestore();
  const ref = col().doc(id);
  const cur: any = (await ref.get()).data();
  if (!cur) return false;
  const batch = db.batch();
  batch.set(ref, { status: live ? 'live' : 'undone', ...(live ? { restored: { by, at: Date.now() } } : { undone: { by, at: Date.now() } }) }, { merge: true });
  for (const d of (await db.collection('guideEdits').where('auto', '==', id).get()).docs) batch.set(d.ref, { status: live ? 'live' : 'undone' }, { merge: true });
  for (const d of (await db.collection('playersAsked').where('auto', '==', id).get()).docs) batch.set(d.ref, { status: live ? 'approved' : 'undone' }, { merge: true });
  await batch.commit();
  await markSiteDirty();
  return true;
}

export function registerAutoChanges(app: Express, deps: { requireAuth: any; firebaseWebConfig: Record<string, string> }) {
  const requireAdmin = (req: any, res: Response, next: () => void) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  app.get('/api/admin/auto', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const status = req.query.status === 'undone' ? 'undone' : 'live';
    const docs = (await col().where('status', '==', status).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const last: any = (await getFirestore().collection('system').doc('autoImprove').get()).data()?.lastRun || null;
    res.json({ items: docs.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 200), lastRun: last });
  });
  app.post('/api/admin/auto/:id', deps.requireAuth, requireAdmin, async (req: any, res: Response) => {
    const action = String(req.body?.action || '');
    if (!['undo', 'restore'].includes(action)) return res.status(400).json({ error: 'bad request' });
    const ok = await setChange(String(req.params.id), action === 'restore', String(req.user?.email || ''));
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'not found' });
  });
  app.get('/admin/asked', (_req: Request, res: Response) => res.type('html').send(logPage(deps.firebaseWebConfig)));
}

// ---- the Monday summary --------------------------------------------------------------------------------------------
const KIND_LABEL: Record<string, string> = { add: 'fact added', opening: 'fuller opening', asked: '"Players asked"', correct: 'corrected', merge: 'merged', move: 'moved', order: 'reordered' };
export async function autoWeekLines(now = Date.now()): Promise<string[]> {
  const week = (await col().where('at', '>=', now - 7 * 86_400_000).get()).docs.map((d) => d.data() as any);
  const link = `${SITE()}/admin/asked`;
  if (!week.length) return [`🔧 Guide improvements this week: none. Log: ${link}`];
  const live = week.filter((c) => c.status === 'live');
  const pages = new Map<string, { name: string; n: number }>();
  for (const c of live) {
    const k = `${c.key}/${c.slug}`;
    pages.set(k, { name: String(c.name || c.slug || c.key), n: (pages.get(k)?.n || 0) + 1 });
  }
  const kinds = Object.entries(live.reduce((m: Record<string, number>, c) => ({ ...m, [c.kind]: (m[c.kind] || 0) + 1 }), {})).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`);
  const top = [...pages.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((p) => `${p.name}${p.n > 1 ? ` (${p.n})` : ''}`);
  const out = [`🔧 Guide improvements this week: ${live.length} change(s) on ${pages.size} page(s) (${kinds.join(', ')}): ${top.join(', ')}${pages.size > top.length ? ', …' : ''}.${week.length > live.length ? ` ${week.length - live.length} undone.` : ''} Log and undo: ${link}`];
  const gone = live.filter((c) => c.destructive);
  if (gone.length) out.push(`🗑️ Deleted, merged or replaced: ${gone.slice(0, 10).map((c) => `${c.name} (${c.key}): ${c.reason}`).join(' · ')}${gone.length > 10 ? ` · and ${gone.length - 10} more on the log` : ''}`);
  return out;
}

function logPage(firebaseConfig: Record<string, string>): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head>${ADMIN_THEME_HEAD}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Guide improvements</title>
<style>
  :root { color-scheme: dark; --bg: #07070a; --card: #111118; --line: #24242e; --text: #e4e4e7; --dim: #a1a1aa; --accent: #a87ffb; --ok: #4ade80; --bad: #f87171; }
  * { box-sizing: border-box; } body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; background: rgba(7,7,10,.92); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; flex: 1; } main { max-width: 900px; margin: 0 auto; padding: 16px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin: 22px 0 8px; }
  button { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); } .tab.on { border-color: var(--accent); background: #2a2140; color: #fff; }
  html.qc-light .tab.on { background: #ece6ff; color: var(--text); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 0 0 10px; }
  .row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; } .row b { flex: 1; min-width: 0; }
  .kind { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--dim); }
  .kind.del { color: var(--bad); border-color: var(--bad); }
  .dim { color: var(--dim); } a { color: var(--accent); } p { margin: 6px 0; }
  .diff { white-space: pre-wrap; font-size: 13px; border-left: 3px solid var(--line); padding: 4px 10px; margin: 6px 0; }
  .diff.before { border-color: var(--bad); } .diff.after { border-color: var(--ok); }
  ul { margin: 6px 0; padding-left: 18px; } .actions { margin-top: 8px; }
</style></head><body>
<header><h1>Guide improvements</h1><button class="tab on" data-s="live">Live</button><button class="tab" data-s="undone">Undone</button><span id="who" class="dim"></span>${ADMIN_THEME_BUTTON}</header>
<main><p class="dim">Made each night without approval, at most 20 a night (at most 5 deleting or replacing anything); every new or changed fact was checked against sources first. Undo takes a change off the site at the next publish (tonight's pipeline run) and it is never made again. Pictures are never changed here: they wait for you on <a href="/admin/images">/admin/images</a>.</p><p class="dim" id="last"></p><div id="gateMsg" class="dim"></div><div id="list"></div></main>
<script type="module">
  let fb;
  try { fb = { ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js")), ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js")) }; }
  catch (e) { document.getElementById('gateMsg').textContent = 'Sign-in could not load: allow www.gstatic.com for this page.'; throw e; }
  const { initializeApp, getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } = fb;
  const auth = getAuth(initializeApp(${cfg}));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const LABEL = ${JSON.stringify(KIND_LABEL)};
  const DESTRUCTIVE = ['correct', 'merge', 'move'];
  let status = 'live';
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  }
  const pageUrl = (x) => '${SITE()}/guides/' + esc(x.key) + '/' + (x.kind === 'merge' && x.status === 'live' ? esc(x.merge?.to || '') + '/' : x.slug ? esc(x.slug) + '/' : '');
  function card(x) {
    const del = DESTRUCTIVE.includes(x.kind);
    const ev = (x.evidence || []).map((e) => '<li>' + esc(e.text) + ' <span class="dim">(' + (e.sources || []).map((s) => esc(s)).join(', ') + ')</span></li>').join('');
    return '<div class="card" data-id="' + esc(x.id) + '"><div class="row"><span class="kind' + (del ? ' del' : '') + '">' + esc(LABEL[x.kind] || x.kind) + '</span><b>' + esc(x.name) + ' <span class="dim">· ' + esc(x.key) + '</span></b><a target="_blank" rel="noopener" href="' + pageUrl(x) + '">open the page</a></div>'
      + '<p>' + esc(x.reason) + '</p><p class="dim">From ' + esc(x.from) + ' · ' + new Date(x.at).toLocaleString() + (x.undone ? ' · undone ' + new Date(x.undone.at).toLocaleString() : '') + '</p>'
      + (x.before ? '<div class="diff before">' + esc(x.before) + '</div>' : '') + (x.after ? '<div class="diff after">' + esc(x.after) + '</div>' : '')
      + (ev ? '<details><summary class="dim">Sources that back it</summary><ul>' + ev + '</ul></details>' : '')
      + '<div class="actions">' + (status === 'live' ? '<button data-a="undo">Undo</button>' : '<button data-a="restore">Put back</button>') + '</div></div>';
  }
  async function load() {
    $('list').innerHTML = '<p class="dim">Loading…</p>';
    try {
      const { items, lastRun } = await api('/api/admin/auto?status=' + status);
      if (lastRun) $('last').textContent = 'Last night: ' + lastRun.changes + ' change(s), ' + lastRun.skipped + ' left as they were (sources didn’t confirm), $' + Number(lastRun.dollars || 0).toFixed(2) + ', ' + new Date(lastRun.at).toLocaleString() + '.';
      const days = new Map();
      for (const x of items) days.set(x.day, [...(days.get(x.day) || []), x]);
      $('list').innerHTML = items.length ? [...days].map(([d, xs]) => '<h2>' + esc(d) + ' · ' + xs.length + '</h2>' + xs.map(card).join('')).join('') : '<p class="dim">Nothing here yet.</p>';
    } catch (e) { $('list').innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; }
  }
  $('list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const card = b.closest('.card');
    b.disabled = true;
    try { await api('/api/admin/auto/' + card.dataset.id, { action: b.dataset.a }); card.remove(); }
    catch (err) { b.textContent = 'Failed: ' + err.message; b.disabled = false; }
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t)); status = t.dataset.s; load(); }));
  onAuthStateChanged(auth, (u) => { if (u) { $('who').textContent = u.email; $('gateMsg').textContent = ''; load(); } else { $('gateMsg').innerHTML = '<button class="primary" id="in">Sign in with Google</button>'; $('in').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()); } });
</script></body></html>`;
}
