/**
 * The owner's /stats (the Discord bot, discord.ts): activity at a glance from the counts the server already keeps, no AI.
 *
 *   - Questions, players (signed in / guests) and platforms (desktop / Deck / web) over a rolling window, from the
 *     hourly counts (statsHours/{UTC hour}, searchGuard.ts recordDailyActivity). Before those began (Oct 29 2026) the
 *     window falls back to the daily counts (stats/{day}, Central time) for the days it covers, and says so (≈).
 *   - Sign-ups from Firebase Auth (account creation time); accounts in total.
 *   - Premium subscribers (users.isPremium) and this month's player AI cost (playerCosts/{month}).
 *   - "Site": the website's ask box (siteAsk.ts), its questions and their cost, apart from the players' numbers.
 * Left out everywhere: the owner's accounts (ADMIN_EMAILS, config/players.ownerHashes, stats/{day}.owners) and test
 * traffic (never recorded: testTraffic.ts) and test accounts (an e2e / test address, or config/players.testUids).
 */
import crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { siteAskWindow } from './siteAskStats';

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
  const ids = (await getFirestore().collection('users').where('signupSource', '==', 'site').get()).docs.map((d) => d.id);
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

type Activity = { questions: number; players: number; guests: number; apps: Record<string, number>; approx: boolean };

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
  return { questions, players: players.size, guests: guests.size, apps, approx };
}

const APP_NAMES: [string, string][] = [['desktop', 'desktop'], ['deck', 'Deck'], ['web', 'web']];
const change = (now: number, before: number) => (before ? ` (${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%)` : now ? ' (new)' : '');
const money = (n: number) => `$${n.toFixed(2)}`;

function block(title: string, a: Activity, signups: number, prev?: { a: Activity; signups: number }, fromSite = 0): string {
  const vs = (now: number, before?: number) => (prev && before !== undefined ? ` vs ${before}${change(now, before)}` : '');
  const plat = APP_NAMES.map(([k, label]) => `${label} ${a.apps[k] || 0}`).join(' · ');
  return [
    `**${title}**${a.approx || prev?.a.approx ? ' ≈' : ''}`,
    `Questions: ${a.questions}${vs(a.questions, prev?.a.questions)}`,
    `Players: ${a.players + a.guests} (${a.players} signed in, ${a.guests} guest${a.guests === 1 ? '' : 's'})${vs(a.players + a.guests, prev ? prev.a.players + prev.a.guests : undefined)}`,
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
  if (day) parts.push(block('Last 24 hours', day, signedUp(now - DAY, now), undefined, fromSite(now - DAY, now)));
  if (long && prev) {
    const n = longMs / DAY;
    parts.push(block(`Last ${n} days (vs the ${n} before)`, long, signedUp(now - longMs, now), { a: prev, signups: signedUp(now - 2 * longMs, now - longMs) }, fromSite(now - longMs, now)));
  }
  // The website's ask box, apart from the players' numbers above (siteAsk.ts).
  const siteMs = window === '30d' ? 30 * DAY : window === '7d' ? 7 * DAY : DAY;
  const site = await siteAskWindow(now - siteMs, now);
  parts.push(`**Site** (${window === '30d' ? 'last 30 days' : window === '7d' ? 'last 7 days' : 'last 24 hours'}): ${site.questions} question(s) in the guide pages' ask box, ${site.uncovered} the guide couldn't answer · $${site.dollars.toFixed(2)}`);
  // Premium subscribers (not the owner's accounts) and this month's player AI cost.
  const cost = costs.docs.filter((d) => !owners.has(playerHash(d.id))).reduce((n, d) => n + (Number((d.data() as any).dollars) || 0), 0);
  parts.push(`**Premium subscribers:** ${subs}\n**Player AI cost this month:** ${money(cost)}\n**Accounts:** ${created.length}`);
  const approx = parts.some((p) => p.includes(' ≈'));
  return parts.join('\n\n') + `\n\n-# Without your accounts and test traffic.${approx ? ' ≈: part of the window is from the daily counts (before hourly counting began), so whole days and your own platform use may be in it.' : ''}`;
}
