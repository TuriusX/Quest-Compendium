/**
 * The owner's stats page (owner, Nov 22 2026): questcompendium.com/admin/stats, the Discord /stats as a web page with
 * 30 days of charts. Signed in with Google and only for the admin accounts (reviewQueue.ts isAdmin), like /admin/asked.
 *
 *   GET /admin/stats                       the page
 *   GET /api/admin/stats?window=24h|7d|30d the numbers (cached a minute per window)
 *
 * The same counts as ownerStats.ts (statsText) and the same rule: the owner's accounts, test accounts and test traffic
 * are left out everywhere except "Top games" (yours included, as in /stats). Days are Central time, like the daily counts.
 */
import { type Express, type Request, type Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { isAdmin } from './reviewQueue';
import { ADMIN_THEME_HEAD, ADMIN_THEME_BUTTON } from './adminTheme';
import {
  whoToLeaveOut, isLeftOut, realAccounts, siteSignups, activity, returningOf, topGames, feedbackIn, locates, limitsIn,
  trialsIn, answerCostDays, playerHash, dayOf, type Who,
} from './ownerStats';
import { siteAskWindow } from './siteAskStats';
import { improverMonth } from './autoChanges';
import { visualAnswersOn, visualStatsFor, visualStatsLine } from './visualServer';
import { searchBillLine, searchMonth } from './searchGuard';
import { factsDays } from './answerFacts';
import { worthDays } from './worthOnDemand';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const WINDOWS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY } as const;
type Win = keyof typeof WINDOWS;
const SERIES_DAYS = 30;

/** The owner's anonymous ids and test accounts' (as statsText builds them). */
async function ownersOf(w: Who): Promise<Set<string>> {
  const owners = new Set<string>(w.ownerHashes);
  const days = await getFirestore().collection('stats').where('owners', '!=', null).get();
  for (const d of days.docs) for (const h of ((d.data() as any).owners || [])) owners.add(h);
  for (const uid of w.testUids) owners.add(playerHash(uid));
  return owners;
}

/** Day by day (Central days, the last 30): questions, players, platforms, sign-ups, locate checks, site questions. */
async function series(now: number, owners: Set<string>, signups: number[]) {
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => dayOf(now - (SERIES_DAYS - 1 - i) * DAY));
  const by = new Map(days.map((d) => [d, { day: d, q: 0, players: new Set<string>(), guests: new Set<string>(), desktop: 0, deck: 0, web: 0, signups: 0, loc: 0, locFound: 0, site: 0, limitRefused: 0 }]));
  const from = now - SERIES_DAYS * DAY - DAY;
  const hours = (await getFirestore().collection('statsHours').where('at', '>=', from).get()).docs.map((d) => d.data() as any);
  for (const h of hours) {
    const row = by.get(dayOf(Number(h.at)));
    if (!row) continue;
    for (const [who, p] of Object.entries((h.p || {}) as Record<string, any>)) {
      if (owners.has(who)) continue;
      row.q += Number(p.q) || 0;
      (p.g ? row.guests : row.players).add(who);
      for (const [a, n] of Object.entries((p.a || {}) as Record<string, number>)) if (a === 'desktop' || a === 'deck' || a === 'web') row[a] += Number(n) || 0;
    }
    for (const [who, l] of Object.entries((h.loc || {}) as Record<string, any>)) {
      if (owners.has(who)) continue;
      row.loc += Number(l.n) || 0;
      row.locFound += Number(l.f) || 0;
    }
    for (const [who, l] of Object.entries((h.lh || {}) as Record<string, any>)) if (!owners.has(who)) row.limitRefused += Number(l?.n) || 0;
  }
  for (const t of signups) by.get(dayOf(t)) && by.get(dayOf(t))!.signups++;
  const qs = (await getFirestore().collection('siteQuestions').where('at', '>=', from).get()).docs.map((d) => d.data() as any);
  for (const q of qs) if (!q.test) { const r = by.get(dayOf(Number(q.at))); if (r) r.site++; }
  const costs = await answerCostDays(now, owners, SERIES_DAYS);
  const costBy = new Map(costs.map((c) => [c.day, c]));
  return [...by.values()].map((r) => {
    const c = costBy.get(r.day);
    return { day: r.day, q: r.q, players: r.players.size, guests: r.guests.size, desktop: r.desktop, deck: r.deck, web: r.web, signups: r.signups, loc: r.loc, locFound: r.locFound, site: r.site, limitRefused: r.limitRefused, costQ: c?.q || 0, dollars: c?.dollars || 0, searched: c?.searched ?? null };
  });
}

export async function statsData(win: Win, now = Date.now()) {
  const db = getFirestore();
  const ms = WINDOWS[win];
  const w = await whoToLeaveOut();
  const month = new Date(now).toISOString().slice(0, 7);
  const [owners, created, siteCreated, premium, costs] = await Promise.all([
    ownersOf(w), realAccounts(w), siteSignups(w),
    db.collection('users').where('isPremium', '==', true).get(),
    db.collection('playerCosts').doc(month).collection('players').get(),
  ]);
  const signedUp = (from: number, to: number) => created.filter((t) => t >= from && t < to).length;
  const [cur, prev, lim, fb, games, loc, site, trials, days, imp, sm, facts, worth, subs] = await Promise.all([
    activity(now - ms, now, w, owners),
    activity(now - 2 * ms, now - ms, w, owners),
    limitsIn(now - ms, now, owners),
    feedbackIn(now - ms, now, owners).catch(() => null),
    topGames(now - ms, now, 10).catch(() => []),
    locates(now - ms, now, owners),
    siteAskWindow(now - ms, now),
    trialsIn(now - ms, now).catch(() => null),
    series(now, owners, created),
    improverMonth(now),
    searchMonth(true).catch(() => null),
    factsDays(30).catch(() => []),
    worthDays(31).catch(() => []),
    premium.empty ? Promise.resolve(0) : getAuth().getUsers(premium.docs.map((d) => ({ uid: d.id }))).then((r) => r.users.filter((u) => !isLeftOut(u, w)).length),
  ]);
  const returning = await returningOf(cur.ids, now - ms);
  // Cost is kept by Central day: today for 24 hours, else the last 7 or 30 days, today included.
  const costRows = days.slice(-Math.round(ms / DAY));
  const factRows = facts.filter((r) => r.day >= new Date(now - ms).toISOString().slice(0, 10));
  const worthRows = worth.filter((r) => r.day >= new Date(now - ms).toISOString().slice(0, 10));
  const visual = visualAnswersOn() ? visualStatsLine(await visualStatsFor(win === '30d' ? 30 : win === '7d' ? 7 : 1), win === '24h' ? 'today' : `last ${ms / DAY} days`) : '';
  const homeUsers = async (field: string, value: string) => (await db.collection('users').where(field, '==', value).get()).docs.map((d) => d.data() as any);
  const homeSignups = (await homeUsers('signupSource', 'homepage')).length;
  const homePremium = (await homeUsers('premiumFrom', 'homepage')).filter((u) => Number(u.premiumFromAt) >= now - ms).length;
  const strip = (a: typeof cur) => ({ questions: a.questions, players: a.players, guests: a.guests, apps: a.apps, approx: a.approx });
  return {
    at: now, window: win,
    now: { ...strip(cur), returning, signups: signedUp(now - ms, now), fromSite: siteCreated.filter((t) => t >= now - ms && t < now).length },
    prev: { ...strip(prev), signups: signedUp(now - 2 * ms, now - ms) },
    limits: lim, feedback: fb, games, locate: loc,
    site: { ...site, homePremium, homeSignups },
    cost: { q: costRows.reduce((n, r) => n + r.costQ, 0), dollars: costRows.reduce((n, r) => n + r.dollars, 0), searched: costRows.reduce((n, r) => n + (r.searched || 0), 0) },
    facts: { answers: factRows.reduce((n, r) => n + r.answers, 0), searched: factRows.reduce((n, r) => n + r.searched, 0), flagged: factRows.reduce((n, r) => n + r.flagged, 0), confirmed: factRows.reduce((n, r) => n + r.confirmed, 0), corrected: factRows.reduce((n, r) => n + r.corrected, 0), disputed: factRows.reduce((n, r) => n + r.disputed, 0) },
    worth: { areas: worthRows.reduce((n, r) => n + r.areas, 0), dollars: worthRows.reduce((n, r) => n + r.dollars, 0), empty: worthRows.reduce((n, r) => n + r.empty, 0), failed: worthRows.reduce((n, r) => n + r.failed, 0) },
    visual, trials, series: days,
    business: {
      premium: subs, playerCostMonth: costs.docs.filter((d) => !owners.has(playerHash(d.id))).reduce((n, d) => n + (Number((d.data() as any).dollars) || 0), 0),
      accounts: created.length, improver: imp, search: sm ? searchBillLine(sm) : '',
    },
  };
}

const cache = new Map<Win, { at: number; data: any }>();

export function registerOwnerStatsPage(app: Express, deps: { requireAuth: any; firebaseWebConfig: Record<string, string> }) {
  const requireAdmin = (req: any, res: Response, next: () => void) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  app.get('/api/admin/stats', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const win: Win = (['24h', '7d', '30d'] as const).find((x) => x === req.query.window) || '7d';
    const hit = cache.get(win);
    if (hit && Date.now() - hit.at < 60_000 && req.query.fresh !== '1') return res.json(hit.data);
    try {
      const data = await statsData(win);
      cache.set(win, { at: Date.now(), data });
      res.set('Cache-Control', 'no-store').json(data);
    } catch (e: any) {
      console.warn('[admin-stats]', e?.message || e);
      res.status(500).json({ error: 'Could not read the stats.' });
    }
  });
  app.get('/admin/stats', (_req: Request, res: Response) => res.type('html').send(page(deps.firebaseWebConfig)));
}

export function page(firebaseConfig: Record<string, string>): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head>${ADMIN_THEME_HEAD}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Quest Compendium stats</title>
<style>
  :root { color-scheme: dark; --bg: #07070a; --card: #111118; --line: #24242e; --text: #e4e4e7; --dim: #a1a1aa; --accent: #a87ffb; --ok: #4ade80; --bad: #f87171; --warn: #fbbf24; --bar2: #5eead4; }
  html.qc-light { --bar2: #0f766e; }
  * { box-sizing: border-box; } body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; z-index: 2; background: rgba(7,7,10,.92); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; flex: 1; min-width: 140px; } main { max-width: 1100px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 0 0 10px; font-weight: 600; }
  button { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); } .tab.on { border-color: var(--accent); background: #2a2140; color: #fff; }
  button.primary { background: var(--accent); color: #16101f; border-color: var(--accent); font-weight: 600; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; min-width: 0; }
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; } @media (min-width: 560px) { .kpis { grid-template-columns: repeat(3, 1fr); } } @media (min-width: 1000px) { .kpis { grid-template-columns: repeat(6, 1fr); } }
  .kpi .v { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .kpi .l { font-size: 12px; color: var(--dim); } .kpi .s { font-size: 12px; color: var(--dim); margin-top: 2px; font-variant-numeric: tabular-nums; }
  .up { color: var(--ok); } .down { color: var(--bad); }
  .grid2 { display: grid; grid-template-columns: 1fr; gap: 14px; } @media (min-width: 760px) { .grid2 { grid-template-columns: 1fr 1fr; } }
  .chart.small text { font-size: 11px; }
  .chart { width: 100%; height: auto; display: block; } .chart text { fill: var(--dim); font-size: 10px; font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 14px; font-size: 12px; color: var(--dim); margin-top: 6px; flex-wrap: wrap; } .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; } td { padding: 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; } td:last-child { text-align: right; padding-left: 12px; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; } .dim { color: var(--dim); } .note { font-size: 12px; color: var(--dim); }
  .bar { height: 6px; border-radius: 3px; background: var(--accent); opacity: .7; margin-top: 3px; }
  #tip { position: fixed; pointer-events: none; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; font-size: 12px; display: none; z-index: 5; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
</style></head><body>
<header><h1>Quest Compendium stats</h1><button class="tab" data-w="24h">24 hours</button><button class="tab on" data-w="7d">7 days</button><button class="tab" data-w="30d">30 days</button><button id="refresh" title="Read the numbers again">Refresh</button>${ADMIN_THEME_BUTTON}</header>
<main><div id="gate" class="dim"></div><div id="out"></div></main><div id="tip"></div>
<script type="module">
  let fb;
  try { fb = { ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js")), ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js")) }; }
  catch (e) { document.getElementById('gate').textContent = 'Sign-in could not load: allow www.gstatic.com for this page.'; throw e; }
  const { initializeApp, getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } = fb;
  const auth = getAuth(initializeApp(${cfg}));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let win = '7d';
  try { win = localStorage.getItem('qc-stats-window') || '7d'; } catch {}
  const money = (n, d = 2) => '$' + Number(n || 0).toFixed(d);
  const LABEL = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' };
  const PREV = { '24h': 'the 24 hours before', '7d': 'the 7 days before', '30d': 'the 30 days before' };
  function delta(now, before) {
    if (!before) return now ? '<span class="up">new</span>' : '';
    const p = Math.round(((now - before) / before) * 100);
    return '<span class="' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '') + p + '%</span> vs ' + before;
  }
  const kpi = (l, v, s) => '<div class="card kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  const rows = (list) => '<table>' + list.map(([a, b]) => '<tr><td>' + a + '</td><td>' + b + '</td></tr>').join('') + '</table>';

  // A bar chart of the daily series (one or two stacked values a day), drawn to one scale.
  function bars(days, keys, colors, opts = {}) {
    const W = opts.w || 640, H = opts.h || 170, L = opts.money ? 40 : 28, B = 22, T = 8, R = 6;
    const tot = days.map((d) => keys.reduce((n, k) => n + (Number(d[k]) || 0), 0));
    let max = Math.max(opts.money ? 0.01 : 1, ...tot);
    const nice = (x) => { const e = Math.pow(10, Math.floor(Math.log10(x))); const f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
    const step = opts.money ? nice(max / 4) : Math.max(1, nice(max / 4));
    max = Math.ceil(max / step - 1e-9) * step;
    const y = (v) => T + (H - T - B) * (1 - v / max), bw = (W - L - R) / days.length;
    let s = '<svg class="chart' + (opts.small ? ' small' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || '') + '">';
    for (let i = 0, v = 0; v <= max + 1e-9; i++, v = i * step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 5) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + (opts.money ? '$' + v.toFixed(v < 0.1 ? 3 : 2) : v) + '</text>';
    days.forEach((d, i) => {
      let base = 0;
      keys.forEach((k, j) => {
        const v = Number(d[k]) || 0; if (!v) return;
        s += '<rect x="' + (L + i * bw + 1.5) + '" y="' + y(base + v) + '" width="' + Math.max(1, bw - 3) + '" height="' + (y(base) - y(base + v)) + '" rx="2" fill="' + colors[j] + '"/>';
        base += v;
      });
      s += '<rect x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent" data-tip="' + esc(opts.tip(d)) + '"/>';
      if (i % (opts.small ? 7 : 5) === (days.length - 1) % (opts.small ? 7 : 5)) s += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + d.day.slice(5).replace('-', '/') + '</text>';
    });
    return s + '</svg>';
  }
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]'), tip = $('tip');
    if (!t) { tip.style.display = 'none'; return; }
    tip.innerHTML = t.dataset.tip; tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });

  function render(d) {
    const n = d.now, p = d.prev, all = n.players + n.guests, pAll = p.players + p.guests;
    const perQ = d.cost.q ? money(d.cost.dollars / d.cost.q, 3) : '–';
    const limTotal = d.limits.free.players + d.limits.guest.players + d.limits.premium.players;
    const k = [
      kpi('Questions', n.questions, delta(n.questions, p.questions) + (all ? ' · ' + (n.questions / all).toFixed(1) + ' a player' : '')),
      kpi('Players', all, n.players + ' signed in, ' + n.guests + ' guest' + (n.guests === 1 ? '' : 's') + ' · ' + delta(all, pAll)),
      kpi('New vs returning', (all - n.returning) + ' / ' + n.returning, 'new / returning players'),
      kpi('Sign-ups', n.signups, delta(n.signups, p.signups) + (n.fromSite ? ' · ' + n.fromSite + ' from the site' : '')),
      kpi('Cost per question', perQ, (d.window === '24h' ? 'today: ' : '') + d.cost.q + ' questions, ' + money(d.cost.dollars) + (d.cost.q ? ' · ' + Math.round(100 * d.cost.searched / d.cost.q) + '% searched' : '')),
      kpi('Hit the daily limit', limTotal, 'free ' + d.limits.free.players + ' · guests ' + d.limits.guest.players + ' · Premium ' + d.limits.premium.players),
    ].join('');
    const s = d.series;
    const plat = [['Desktop', n.apps.desktop || 0], ['Deck', n.apps.deck || 0], ['Web', n.apps.web || 0]];
    const pmax = Math.max(1, ...plat.map((x) => x[1]));
    const gmax = Math.max(1, ...d.games.map((g) => g.q));
    const f = d.feedback;
    $('out').innerHTML =
      '<div class="kpis">' + k + '</div>' +
      '<div class="card"><h2>Questions a day · last 30 days</h2>' + bars(s, ['desktop', 'deck', 'web'], ['var(--accent)', 'var(--bar2)', 'var(--warn)'], { label: 'Questions a day', ...(innerWidth < 600 ? { w: 380, small: true } : {}), tip: (x) => '<b>' + x.day + '</b><br>' + x.q + ' questions · ' + (x.players + x.guests) + ' players<br>desktop ' + x.desktop + ' · Deck ' + x.deck + ' · web ' + x.web }) +
        '<div class="legend"><span><i class="sw" style="background:var(--accent)"></i>Desktop</span><span><i class="sw" style="background:var(--bar2)"></i>Deck</span><span><i class="sw" style="background:var(--warn)"></i>Web</span></div></div>' +
      '<div class="grid2">' +
        '<div class="card"><h2>Players a day</h2>' + bars(s, ['players', 'guests'], ['var(--accent)', 'var(--bar2)'], { w: 380, h: 170, small: true, label: 'Players a day', tip: (x) => '<b>' + x.day + '</b><br>' + x.players + ' signed in · ' + x.guests + ' guests' }) + '<div class="legend"><span><i class="sw" style="background:var(--accent)"></i>Signed in</span><span><i class="sw" style="background:var(--bar2)"></i>Guests</span></div></div>' +
        '<div class="card"><h2>Sign-ups a day</h2>' + bars(s, ['signups'], ['var(--ok)'], { w: 380, h: 170, small: true, label: 'Sign-ups a day', tip: (x) => '<b>' + x.day + '</b><br>' + x.signups + ' sign-up(s)' }) + '</div>' +
        '<div class="card"><h2>Answer cost per question</h2>' + bars(s.map((x) => ({ ...x, per: x.costQ ? x.dollars / x.costQ : 0 })), ['per'], ['var(--warn)'], { w: 380, h: 170, small: true, money: true, label: 'Cost per question', tip: (x) => '<b>' + x.day + '</b><br>' + (x.costQ ? money(x.dollars / x.costQ, 3) + ' a question<br>' + x.costQ + ' questions, ' + money(x.dollars) + (x.searched !== null ? ', ' + Math.round(100 * x.searched / x.costQ) + '% searched' : '') : 'no questions') }) + '</div>' +
        '<div class="card"><h2>Website ask box a day</h2>' + bars(s, ['site'], ['var(--bar2)'], { w: 380, h: 170, small: true, label: 'Website questions a day', tip: (x) => '<b>' + x.day + '</b><br>' + x.site + ' question(s)' }) + '</div>' +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card"><h2>Top games · ' + LABEL[d.window] + ' (yours included)</h2>' + (d.games.length ? rows(d.games.map((g) => [esc(g.name) + '<div class="bar" style="width:' + (100 * g.q / gmax) + '%"></div>', g.q])) : '<p class="dim">No questions.</p>') + '</div>' +
        '<div class="card"><h2>Questions by platform</h2>' + rows(plat.map(([a, v]) => [a + '<div class="bar" style="width:' + (100 * v / pmax) + '%"></div>', v])) +
          '<h2 style="margin-top:16px">Answer feedback</h2>' + (f ? rows([['👍 Helpful', f.up], ['👎 Not helpful', f.down], ['Reports', f.reports + (f.open ? ' (' + f.open + ' open)' : '')]]) : '<p class="dim">Could not read.</p>') + '</div>' +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card"><h2>Features · ' + LABEL[d.window] + '</h2>' + rows([
          ['Locate me checks', d.locate.n + ' (' + d.locate.auto + ' automatic, ' + d.locate.found + ' found the place) · ' + money(d.locate.dollars)],
          ['Website ask box', d.site.questions + ' (' + d.site.uncovered + ' the guide couldn’t answer) · ' + money(d.site.dollars)],
          ['Homepage app', d.site.home + ' tries (' + d.site.homeShots + ' with a screenshot) · ' + d.site.homePremium + ' Premium start(s)'],
          ['Checked facts in answers', d.facts.answers + ' answers, ' + d.facts.searched + ' searched anyway' + (d.facts.flagged ? ' · 👎 re-checks ' + d.facts.flagged : '')],
          ['Worth getting here', d.worth.areas + ' area(s), ' + d.worth.failed + ' failed · ' + money(d.worth.dollars)],
          ['Daily limit refusals', 'free ' + d.limits.free.refused + ' · guests ' + d.limits.guest.refused + ' · Premium ' + d.limits.premium.refused],
        ]) + (d.visual ? '<p class="note">' + esc(d.visual.replace(/\\*\\*/g, '')) + '</p>' : '') + '</div>' +
        '<div class="card"><h2>Business</h2>' + rows([
          ['Premium subscribers', d.business.premium],
          ['Accounts', d.business.accounts],
          ['Player AI cost this month', money(d.business.playerCostMonth)],
          ['Guide improvements this month', money(d.business.improver.dollars) + ' of ' + money(d.business.improver.cap, 0) + (d.business.improver.capAt ? ' (cap reached)' : '')],
          ...(d.trials ? [['Free trials · ' + LABEL[d.window], d.trials.started + ' started · ' + d.trials.converted + ' converted · ' + d.trials.cancelled + ' cancelled' + (d.trials.live ? ' · ' + d.trials.live + ' in trial' : '')]] : []),
          ['Homepage app sign-ups (all time)', d.site.homeSignups],
        ]) + (d.business.search ? '<p class="note">Search: ' + esc(d.business.search) + '</p>' : '') + '</div>' +
      '</div>' +
      '<p class="note">Without your accounts, test accounts and test traffic (except Top games). Comparisons are against ' + PREV[d.window] + '. Days are Central time. Read ' + new Date(d.at).toLocaleString() + (d.now.approx ? ' · part of this window is from the daily counts, before hourly counting began.' : '') + '</p>';
  }

  async function load(fresh) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.w === win));
    if (!$('out').innerHTML) $('out').innerHTML = '<p class="dim">Loading…</p>';
    try {
      const r = await fetch('/api/admin/stats?window=' + win + (fresh ? '&fresh=1' : ''), { headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken() } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      render(j);
    } catch (e) { $('out').innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; }
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { win = t.dataset.w; try { localStorage.setItem('qc-stats-window', win); } catch {} if (auth.currentUser) load(); }));
  $('refresh').addEventListener('click', () => auth.currentUser && load(true));
  onAuthStateChanged(auth, (u) => {
    if (u) { $('gate').textContent = ''; load(); }
    else { $('out').innerHTML = ''; $('gate').innerHTML = '<button class="primary" id="in">Sign in with Google</button>'; $('in').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()); }
  });
</script></body></html>`;
}
