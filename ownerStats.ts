/**
 * The owner's /stats (the Discord bot, discord.ts): activity at a glance from the counts the server already keeps, no AI.
 *
 *   - Questions, players (signed in / guests) and platforms (desktop / Deck / web) over a rolling window, from the
 *     hourly counts (statsHours/{UTC hour}, searchGuard.ts recordDailyActivity). Before those began (Oct 29 2026) the
 *     window falls back to the daily counts (stats/{day}, Central time) for the days it covers, and says so (≈).
 *   - Sign-ups from Firebase Auth (account creation time); accounts in total.
 *   - Premium subscribers (users.isPremium) and this month's player AI cost (playerCosts/{month}).
 *   - Answer cost: the players' average cost per question, day by day for the last 7 days (stats/{day}.costs), and how
 *     many of those questions searched (counted from Nov 1 2026: the answers' new guide and search rules, Oct 31).
 *   - "Site": the website's ask box (siteAsk.ts), its questions and their cost, apart from the players' numbers.
 *   - The nightly guide improver's spending this month against its own cap (autoChanges.ts improverMonth).
 *   - "Locate me": the app's checks (by hand and automatic), how many found the place, and their cost
 *     (statsHours/{UTC hour}.loc, locateMe.ts).
 * Left out everywhere: the owner's accounts (ADMIN_EMAILS, config/players.ownerHashes, stats/{day}.owners) and test
 * traffic (never recorded: testTraffic.ts) and test accounts (an e2e / test address, or config/players.testUids).
 */
import { worthDays, ALERT_DOLLARS } from './worthOnDemand';
import { factsDays } from './answerFacts';
import crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { siteAskWindow } from './siteAskStats';
import { improverMonth } from './autoChanges';
import { visualAnswersOn, visualStatsFor, visualStatsLine } from './visualServer';
import { searchBillLine, searchMonth } from './searchGuard';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const DAY_TZ = 'America/Chicago';
const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: DAY_TZ });
export const playerHash = (uid: string) => crypto.createHash('sha256').update(`qc:${uid}`).digest('hex').slice(0, 12);
/** The hourly bucket's id: the UTC hour ("2026-10-29T14"). */
export const hourId = (t = Date.now()) => new Date(t).toISOString().slice(0, 13);
const TEST_EMAIL = /(^|[.+_-])(e2e|test|tests|qa|sim)([.+_-]|\d|@)|@(example|test)\./i;
const ownerEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

type Who = { ownerHashes: Set<string>; testUids: Set<string> };
async function whoToLeaveOut(): Promise<Who> {
  const c: any = (await getFirestore().collection('config').doc('players').get()).data() || {};
  return { ownerHashes: new Set<string>(c.ownerHashes || []), testUids: new Set<string>(c.testUids || []) };
}
const isLeftOut = (u: UserRecord, w: Who) =>
  ownerEmails().includes(String(u.email || '').toLowerCase()) || w.ownerHashes.has(playerHash(u.uid)) || w.testUids.has(u.uid) || TEST_EMAIL.test(String(u.email || ''));

/** Real accounts that signed up on the website (users.signupSource "site"), with their creation times. */
async function siteSignups(w: Who): Promise<number[]> {
  const ids = (await getFirestore().collection('users').where('signupSource', 'in', ['site', 'homepage']).get()).docs.map((d) => d.id);
  const out: number[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await getAuth().getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const u of r.users) if (!isLeftOut(u, w)) out.push(Date.parse(u.metadata.creationTime));
  }
  return out;
}

/** Real accounts (not the owner's, not test ones), with their creation times. */
export async function realAccounts(w?: Who): Promise<number[]> {
  const who = w || (await whoToLeaveOut());
  const out: number[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) if (!isLeftOut(u, who)) out.push(Date.parse(u.metadata.creationTime));
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

type Activity = { questions: number; players: number; guests: number; apps: Record<string, number>; approx: boolean; ids: Set<string> };

/** Questions, players and platforms in [from, to): hourly counts, else (before they began) the daily ones. */
async function activity(from: number, to: number, w: Who, owners: Set<string>): Promise<Activity> {
  const db = getFirestore();
  const players = new Set<string>(), guests = new Set<string>(), apps: Record<string, number> = {};
  let questions = 0, approx = false;
  const hours = (await db.collection('statsHours').where('at', '>=', from - HOUR + 1).get()).docs.map((d) => d.data() as any).filter((h) => h.at < to);
  const first = (await db.collection('statsHours').orderBy('at').limit(1).get()).docs[0]?.data()?.at ?? Infinity;
  for (const h of hours) {
    for (const [who, p] of Object.entries((h.p || {}) as Record<string, any>)) {
      if (owners.has(who)) continue;
      questions += Number(p.q) || 0;
      (p.g ? guests : players).add(who);
      for (const [a, n] of Object.entries((p.a || {}) as Record<string, number>)) apps[a] = (apps[a] || 0) + (Number(n) || 0);
    }
  }
  // The part of the window before hourly counting began: the days it covers, from the daily counts.
  if (from < first) {
    approx = true;
    const days = new Set<string>();
    for (let t = from; t < Math.min(to, first); t += HOUR) days.add(dayOf(t));
    if (first !== Infinity) days.delete(dayOf(first)); // that day's hours are counted above (from where they began)
    for (const id of days) {
      const st: any = (await db.collection('stats').doc(id).get()).data();
      if (!st) continue;
      const own = new Set<string>([...owners, ...(st.owners || [])]);
      (st.players || []).filter((h: string) => !own.has(h)).forEach((h: string) => players.add(h));
      (st.guests || []).filter((h: string) => !own.has(h)).forEach((h: string) => guests.add(h));
      // Questions without the owner's: the per-player counts (from when they were kept), else the day's total.
      const costs = Object.entries((st.costs || {}) as Record<string, any>);
      questions += costs.length ? costs.filter(([h]) => !own.has(h)).reduce((n, [, c]) => n + (Number(c.questions) || 0), 0) : Number(st.questions) || 0;
      for (const [a, n] of Object.entries((st.apps || {}) as Record<string, number>)) apps[a] = (apps[a] || 0) + (Number(n) || 0);
    }
  }
  return { questions, players: players.size, guests: guests.size, apps, approx, ids: new Set([...players, ...guests]) };
}

/** How many of `ids` were seen before `from` (in the daily counts): the window's returning players. */
async function returningOf(ids: Set<string>, from: number): Promise<number> {
  if (!ids.size) return 0;
  const start = dayOf(from);
  const seen = new Set<string>();
  for (const d of (await getFirestore().collection('stats').get()).docs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.id) || d.id >= start) continue;
    const s: any = d.data();
    for (const h of [...(s.players || []), ...(s.guests || [])]) if (ids.has(h)) seen.add(h);
  }
  return seen.size;
}

/** The games asked about most in [from, to) (answerGames/{UTC day}: questions per game; your own included). */
async function topGames(from: number, to: number, n = 5): Promise<{ name: string; q: number }[]> {
  const ids: string[] = [];
  for (let t = from; t < to + DAY; t += DAY) ids.push(new Date(t).toISOString().slice(0, 10));
  const docs = await Promise.all([...new Set(ids)].map((id) => getFirestore().collection('answerGames').doc(id).get()));
  const by = new Map<string, { name: string; q: number }>();
  for (const d of docs) for (const [k, g] of Object.entries((d.data() || {}) as Record<string, any>)) {
    const cur = by.get(k) || { name: String(g?.name || k), q: 0 };
    cur.q += Number(g?.q) || 0;
    by.set(k, cur);
  }
  return [...by.values()].filter((g) => g.q).sort((a, b) => b.q - a.q).slice(0, n);
}

/**
 * Answer feedback in [from, to): thumbs up and down (answerFeedback; a signed-in vote is keyed by the player's hash, so
 * yours and test accounts' are left out) and reports (answerReports, with the ones still open).
 */
async function feedbackIn(from: number, to: number, owners: Set<string>): Promise<{ up: number; down: number; reports: number; open: number }> {
  const db = getFirestore();
  const [fb, rep] = await Promise.all([
    db.collection('answerFeedback').where('at', '>=', from).get(),
    db.collection('answerReports').where('createdAt', '>=', from).get(),
  ]);
  const votes = fb.docs.map((d) => d.data() as any).filter((x) => x.at < to && !owners.has(String(x.voterKey || '')));
  const reports = rep.docs.map((d) => d.data() as any).filter((x) => x.createdAt < to);
  return {
    up: votes.filter((v) => v.vote === 'up').length,
    down: votes.filter((v) => v.vote === 'down').length,
    reports: reports.length,
    open: reports.filter((r) => r.status === 'open').length,
  };
}

/** The players' answer cost by day (Central days, the last `days`): questions, dollars, and how many searched. */
export async function answerCostDays(now: number, owners: Set<string>, days = 7): Promise<{ day: string; q: number; dollars: number; searched: number | null }[]> {
  const ids = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY));
  const docs = await Promise.all(ids.map((id) => getFirestore().collection('stats').doc(id).get()));
  return ids.map((day, i) => {
    const st: any = docs[i].data() || {};
    const own = new Set<string>([...owners, ...(st.owners || [])]);
    let q = 0, dollars = 0, searched = 0, counted = false;
    for (const [h, c] of Object.entries((st.costs || {}) as Record<string, any>)) {
      if (own.has(h)) continue;
      q += Number(c.questions) || 0;
      dollars += Number(c.dollars) || 0;
      if (c.searched !== undefined || c.shots !== undefined) counted = true;
      searched += Number(c.searched) || 0;
    }
    // Searches counted from Nov 1 2026 on; before, unknown.
    return { day, q, dollars, searched: counted || day >= '2026-11-01' ? searched : null };
  });
}
export function answerCostLine(rows: { day: string; q: number; dollars: number; searched: number | null }[]): string {
  const per = (r: { q: number; dollars: number }) => (r.q ? `$${(r.dollars / r.q).toFixed(3)}` : '–');
  const all = rows.reduce((a, r) => ({ q: a.q + r.q, dollars: a.dollars + r.dollars }), { q: 0, dollars: 0 });
  // Day by day for the last 7 at most (a month of days would crowd the reply); the average covers them all.
  const days = rows.slice(-7).map((r) => `${r.day.slice(5)} ${per(r)} (${r.q}q${r.searched !== null && r.q ? `, ${Math.round((100 * r.searched) / r.q)}% searched` : ''})`).join(' · ');
  return `**Answer cost per question** (last ${rows.length} days: ${all.q} questions, $${all.dollars.toFixed(2)}): ${per(all)} on average\n${days}`;
}

/** Locate me checks in [from, to) (locateMe.ts statsHours.loc): all, automatic, the ones that found the place, cost. */
async function locates(from: number, to: number, owners: Set<string>): Promise<{ n: number; auto: number; found: number; dollars: number }> {
  const out = { n: 0, auto: 0, found: 0, dollars: 0 };
  const hours = (await getFirestore().collection('statsHours').where('at', '>=', from - HOUR + 1).get()).docs.map((d) => d.data() as any).filter((h) => h.at < to);
  for (const h of hours) {
    for (const [who, l] of Object.entries((h.loc || {}) as Record<string, any>)) {
      if (owners.has(who)) continue;
      out.n += Number(l.n) || 0;
      out.auto += Number(l.a) || 0;
      out.found += Number(l.f) || 0;
      out.dollars += (Number(l.c) || 0) / 1e6;
    }
  }
  return out;
}

type LimitTally = Record<'free' | 'guest' | 'premium', { players: number; refused: number }>;
/** Players who hit their daily question limit in [from, to), by tier, and how many questions were refused (statsHours.lh). */
export function tallyLimits(hours: any[], owners: Set<string>): LimitTally {
  const by: Record<string, { players: Set<string>; refused: number }> = {};
  for (const h of hours) for (const [who, l] of Object.entries((h.lh || {}) as Record<string, any>)) {
    if (owners.has(who)) continue;
    const t = ['free', 'guest', 'premium'].includes(l?.t) ? l.t : 'free';
    const g = (by[t] ||= { players: new Set(), refused: 0 });
    g.players.add(who);
    g.refused += Number(l?.n) || 0;
  }
  const one = (t: string) => ({ players: by[t]?.players.size || 0, refused: by[t]?.refused || 0 });
  return { free: one('free'), guest: one('guest'), premium: one('premium') };
}
export function limitLine(label: string, l: LimitTally): string {
  const part = (name: string, x: { players: number; refused: number }) => `${name} ${x.players} (${x.refused} refused)`;
  return `${label}: ${part('free', l.free)} · ${part('guests', l.guest)} · ${part('Premium', l.premium)}`;
}
async function limitsIn(from: number, to: number, owners: Set<string>): Promise<LimitTally> {
  const hours = (await getFirestore().collection('statsHours').where('at', '>=', from - HOUR + 1).get()).docs.map((d) => d.data() as any).filter((h) => h.at < to);
  return tallyLimits(hours, owners);
}

/** Free trials: started, converted and cancelled in [from, to), and how many are in their trial now. */
async function trialsIn(from: number, to: number): Promise<{ started: number; converted: number; cancelled: number; live: number }> {
  const docs = (await getFirestore().collection('trials').get()).docs.map((d) => d.data() as any);
  const inWin = (t: any) => Number(t) >= from && Number(t) < to;
  return {
    started: docs.filter((t) => inWin(t.started)).length,
    converted: docs.filter((t) => inWin(t.converted)).length,
    cancelled: docs.filter((t) => inWin(t.cancelled)).length,
    live: docs.filter((t) => t.status === 'started' && Number(t.trialEnd) > to).length,
  };
}

const APP_NAMES: [string, string][] =[['desktop', 'desktop'], ['deck', 'Deck'], ['web', 'web']];
const change = (now: number, before: number) => (before ? ` (${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%)` : now ? ' (new)' : '');
const money = (n: number) => `$${n.toFixed(2)}`;

function block(title: string, a: Activity, signups: number, prev?: { a: Activity; signups: number }, fromSite = 0, returning = -1): string {
  const vs = (now: number, before?: number) => (prev && before !== undefined ? ` vs ${before}${change(now, before)}` : '');
  const plat = APP_NAMES.map(([k, label]) => `${label} ${a.apps[k] || 0}`).join(' · ');
  const all = a.players + a.guests;
  return [
    `**${title}**${a.approx || prev?.a.approx ? ' ≈' : ''}`,
    `Questions: ${a.questions}${vs(a.questions, prev?.a.questions)}${all ? ` · ${(a.questions / all).toFixed(1)} a player` : ''}`,
    `Players: ${all} (${a.players} signed in, ${a.guests} guest${a.guests === 1 ? '' : 's'})${vs(all, prev ? prev.a.players + prev.a.guests : undefined)}`,
    ...(returning >= 0 && all ? [`New vs returning: ${all - returning} new, ${returning} returning`] : []),
    `By platform (questions): ${plat}`,
    `New sign-ups: ${signups}${fromSite ? ` (${fromSite} from the site)` : ''}${vs(signups, prev?.signups)}`,
  ].join('\n');
}

/** The reply: the last 24 hours and the last 7 days against the 7 before (or the given window against the one before). */
export async function statsText(window: '24h' | '7d' | '30d' | '' = '', now = Date.now()): Promise<string> {
  const db = getFirestore();
  const month = new Date(now).toISOString().slice(0, 7);
  const [w, ownerDays, premium, costs] = await Promise.all([
    whoToLeaveOut(),
    db.collection('stats').where('owners', '!=', null).get(),
    db.collection('users').where('isPremium', '==', true).get(),
    db.collection('playerCosts').doc(month).collection('players').get(),
  ]);
  // The owner's anonymous ids: config/players.ownerHashes and the ones the server marked in the daily counts.
  const owners = new Set<string>(w.ownerHashes);
  for (const d of ownerDays.docs) for (const h of ((d.data() as any).owners || [])) owners.add(h);
  // Test accounts (config/players.testUids) are left out of the activity, costs and checks too, not only sign-ups.
  for (const uid of w.testUids) owners.add(playerHash(uid));
  const span = (ms: number) => activity(now - ms, now, w, owners);
  const before = (ms: number) => activity(now - 2 * ms, now - ms, w, owners);
  const longMs = (window === '30d' ? 30 : 7) * DAY;
  const [created, siteCreated, day, long, prev, subs] = await Promise.all([
    realAccounts(w),
    siteSignups(w),
    !window || window === '24h' ? span(DAY) : null,
    window !== '24h' ? span(longMs) : null,
    window !== '24h' ? before(longMs) : null,
    premium.empty ? Promise.resolve(0) : getAuth().getUsers(premium.docs.map((d) => ({ uid: d.id }))).then((r) => r.users.filter((u) => !isLeftOut(u, w)).length),
  ]);
  const signedUp = (from: number, to: number) => created.filter((t) => t >= from && t < to).length;
  const parts: string[] = [];
  const fromSite = (from: number, to: number) => siteCreated.filter((t) => t >= from && t < to).length;
  const [dayBack, longBack] = await Promise.all([day ? returningOf(day.ids, now - DAY) : -1, long ? returningOf(long.ids, now - longMs) : -1]);
  if (day) parts.push(block('Last 24 hours', day, signedUp(now - DAY, now), undefined, fromSite(now - DAY, now), dayBack));
  if (long && prev) {
    const n = longMs / DAY;
    parts.push(block(`Last ${n} days (vs the ${n} before)`, long, signedUp(now - longMs, now), { a: prev, signups: signedUp(now - 2 * longMs, now - longMs) }, fromSite(now - longMs, now), longBack));
  }
  // The website's ask box, apart from the players' numbers above (siteAsk.ts).
  const siteMs = window === '30d' ? 30 * DAY : window === '7d' ? 7 * DAY : DAY;
  const winLabel = window === '30d' ? 'last 30 days' : window === '7d' ? 'last 7 days' : 'last 24 hours';
  // What players asked about, and what they thought of the answers (the longer window when there are two).
  const talkMs = window === '24h' ? DAY : longMs, talkLabel = window === '24h' ? 'last 24 hours' : `last ${longMs / DAY} days`;
  const [games, fb] = await Promise.all([topGames(now - talkMs, now).catch(() => []), feedbackIn(now - talkMs, now, owners).catch(() => null)]);
  if (games.length) parts.push(`**Top games** (${talkLabel}, by questions, yours included): ${games.map((g) => `${g.name} ${g.q}`).join(' · ')}`);
  // Players who hit their daily question limit (counted from Nov 17 2026): shows when they regularly run out.
  const [lim24, lim7] = await Promise.all([limitsIn(now - DAY, now, owners), limitsIn(now - 7 * DAY, now, owners)]).catch(() => [null, null]);
  if (lim24 && lim7) parts.push(`**Hit the daily question limit** (players, questions refused after it)\n${limitLine('Last 24 hours', lim24)}\n${limitLine('Last 7 days', lim7)}`);
  if (fb) parts.push(`**Answer feedback** (${talkLabel}): 👍 ${fb.up} · 👎 ${fb.down}${fb.up + fb.down ? ` (${Math.round((100 * fb.up) / (fb.up + fb.down))}% positive)` : ''} · ${fb.reports} report(s)${fb.open ? `, ${fb.open} still open` : ''}`);
  const site = await siteAskWindow(now - siteMs, now);
  // The homepage's app (scripts/guides/homeApp.ts): tries, sign-ups and Premium starts from it.
  const homeUsers = async (field: string, value: string) => (await getFirestore().collection('users').where(field, '==', value).get()).docs.map((d) => d.data() as any);
  const homeSignups = (await homeUsers('signupSource', 'homepage')).length;
  const homePremium = (await homeUsers('premiumFrom', 'homepage')).filter((u) => Number(u.premiumFromAt) >= now - siteMs).length;
  parts.push(`**Homepage app** (${winLabel}): ${site.home} tries (${site.homeShots} with a screenshot, ${site.homeNoGuide} about a game with no guide), ${homePremium} Premium start(s); ${homeSignups} sign-ups from it in all`);
  // Locate me in the app (by hand and automatic: locateMe.ts), counted since Oct 31 2026.
  const loc = await locates(now - siteMs, now, owners);
  parts.push(`**Locate me** (${winLabel}): ${loc.n} check(s), ${loc.auto} automatic, ${loc.found} found the place · $${loc.dollars.toFixed(2)}${loc.n ? ` ($${(loc.dollars / loc.n).toFixed(4)} each)` : ''}`);
  parts.push(`**Site** (${winLabel}): ${site.questions} question(s) in the guide pages' ask box, ${site.uncovered} the guide couldn't answer · $${site.dollars.toFixed(2)}`);
  // What an answer costs, day by day (the effect of the Oct 31 answer rules: guide as reference, search with screenshots).
  parts.push(answerCostLine(await answerCostDays(now, owners, window === '30d' ? 30 : 7)));
  // Checked facts in answers (answerFacts.ts, roadmap 31 step 1): answers that had them, and the searches they saved.
  const fd = (await factsDays(window === '30d' ? 30 : 7).catch(() => [])).filter((r) => r.day >= new Date(now - Math.max(siteMs, DAY)).toISOString().slice(0, 10));
  const fa = fd.reduce((n, r) => n + r.answers, 0), fs2 = fd.reduce((n, r) => n + r.searched, 0);
  const sumF = (k: 'flagged' | 'confirmed' | 'corrected' | 'disputed') => fd.reduce((n, r) => n + r[k], 0);
  if (fa || sumF('flagged')) parts.push(`**Checked facts in answers** (${winLabel}): ${fa} answer(s) had them, ${fs2} searched anyway · ${fa - fs2} search(es) saved (≈$${((fa - fs2) * 0.014).toFixed(2)})` +
    (sumF('flagged') ? `\n👎 sent ${sumF('flagged')} fact(s) back for re-checking: ${sumF('confirmed')} confirmed, ${sumF('corrected')} corrected, ${sumF('disputed')} disputed` : ''));
  // Visual answers (visualServer.ts, Nov 14 2026): once they're on (counted per UTC day; your own answers included).
  if (visualAnswersOn()) parts.push(visualStatsLine(await visualStatsFor(window === '30d' ? 30 : window === '7d' ? 7 : 1), window === '30d' ? 'last 30 days' : window === '7d' ? 'last 7 days' : 'today'));
  // "Worth getting here" on demand (worthOnDemand.ts, Nov 15 2026): areas filled for players and what they cost, by
  // UTC day. No cap; the nightly summary warns above $5 a day.
  // The UTC days the window touches (the tally is kept by UTC day), with the 24-hour window counting today and yesterday.
  const worthFrom = new Date(now - Math.max(siteMs, DAY)).toISOString().slice(0, 10);
  const wd: Awaited<ReturnType<typeof worthDays>> = (await worthDays(31).catch(() => [])).filter((r) => r.day >= worthFrom);
  if (wd.length) {
    const sum = wd.reduce((s: { dollars: number; areas: number; empty: number; failed: number }, r) => ({ dollars: s.dollars + r.dollars, areas: s.areas + r.areas, empty: s.empty + r.empty, failed: s.failed + r.failed }), { dollars: 0, areas: 0, empty: 0, failed: 0 });
    parts.push(`**Worth getting here on demand** (${winLabel}, UTC days): ${sum.areas} area(s), ${sum.empty} with nothing sourced, ${sum.failed} failed · $${sum.dollars.toFixed(2)}${sum.areas ? ` ($${(sum.dollars / Math.max(1, sum.areas)).toFixed(3)} an area)` : ''}\n` +
      wd.slice(-7).map((r) => `${r.day.slice(5)} ${r.areas} area(s) $${r.dollars.toFixed(2)}${r.dollars > ALERT_DOLLARS ? ' ⚠️' : ''}`).join(' · '));
  }
  // The nightly guide improver (autoImprove.ts): month to date against its own cap.
  const imp = await improverMonth(now);
  parts.push(`**Guide improvements this month:** $${imp.dollars.toFixed(2)} of the $${imp.cap} cap${imp.capAt ? ' (reached: stopped until the 1st)' : ''}`);
  // Premium subscribers (not the owner's accounts) and this month's player AI cost.
  const cost = costs.docs.filter((d) => !owners.has(playerHash(d.id))).reduce((n, d) => n + (Number((d.data() as any).dollars) || 0), 0);
  parts.push(`**Premium subscribers:** ${subs}\n**Player AI cost this month:** ${money(cost)}\n**Accounts:** ${created.length}`);
  // Free trials of monthly Premium (offers.ts, trials/{subscription}): started, converted and cancelled in the window.
  const tr = await trialsIn(now - siteMs, now).catch(() => null);
  if (tr && (tr.started || tr.converted || tr.cancelled)) parts.push(`**Free trials** (${winLabel}): ${tr.started} started · ${tr.converted} converted · ${tr.cancelled} cancelled${tr.live ? ` · ${tr.live} still in trial` : ''}`);
  // Google search grounding, all of it (pipeline, flagship builds, players): Google bills every query, $14 per 1,000.
  const sm = await searchMonth(true).catch(() => null);
  if (sm) parts.push(`**Search:** ${searchBillLine(sm)}`);
  const approx = parts.some((p) => p.includes(' ≈'));
  return parts.join('\n\n') + `\n\n-# Without your accounts, test accounts and test traffic.${approx ? ' ≈: part of the window is from the daily counts (before hourly counting began), so whole days and your own platform use may be in it.' : ''}`;
}
