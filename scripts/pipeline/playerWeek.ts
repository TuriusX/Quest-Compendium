/**
 * The weekly player section of the Monday Discord summary (run.ts), read only:
 *   - active players this week vs last week (signed in and guests), new vs returning;
 *   - the AI cost of players' questions this week (not the pipeline's): total, per question and per player, free vs
 *     Premium (guests apart);
 *   - free players who ran out of questions on some day this week;
 *   - an alert when players' AI cost passes ALERT_MONTH_DOLLARS this month, or more than ALERT_LIMIT_SHARE of the week's
 *     free players ran out (the owner then revisits the free limits).
 * From the daily stats (stats/{day}, Central time: players, guests, costs, limitHit, owners) and the month's player
 * costs (playerCosts/{month}/players). Left out: the owner's accounts (ADMIN_EMAILS on the server, marked in
 * stats/{day}.owners, and config/players.ownerHashes) and test traffic (test guest ids and local servers, never recorded: testTraffic.ts).
 */
import crypto from 'crypto';
import { db } from '../guides/common';

export const ALERT_MONTH_DOLLARS = 20;
export const ALERT_LIMIT_SHARE = 0.1;
const DAY_TZ = 'America/Chicago';
const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: DAY_TZ });
const hashOf = (uid: string) => crypto.createHash('sha256').update(`qc:${uid}`).digest('hex').slice(0, 12);
const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

type Day = { id: string; players: string[]; guests: string[]; costs: Record<string, { dollars: number; questions: number; tier: string }>; limitHit: Record<string, string>; owners: string[] };

/** The section's numbers for the week ending yesterday (pure: the days and month costs passed in). */
export function playerWeek(days: Day[], monthCosts: { hash: string; dollars: number }[], today = Date.now(), ownerHashes: string[] = []) {
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayOf(today - (i + 1) * 86_400_000)));
  const prev = new Set(Array.from({ length: 7 }, (_, i) => dayOf(today - (i + 8) * 86_400_000)));
  const weekStart = [...week].sort()[0];
  const owners = new Set([...ownerHashes, ...days.flatMap((d) => d.owners || [])]);
  const keep = (h: string) => !owners.has(h);
  const active = (set: Set<string>) => {
    const players = new Set<string>(), guests = new Set<string>();
    for (const d of days) if (set.has(d.id)) { (d.players || []).filter(keep).forEach((h) => players.add(h)); (d.guests || []).filter(keep).forEach((h) => guests.add(h)); }
    return { players, guests };
  };
  const now = active(week), before = active(prev);
  const seenBefore = new Set(days.filter((d) => d.id < weekStart).flatMap((d) => [...(d.players || []), ...(d.guests || [])]));
  const all = [...now.players, ...now.guests];
  const fresh = all.filter((h) => !seenBefore.has(h)).length;
  // Cost by tier, and who was free this week (anyone with a free answer or a free limit hit).
  const cost: Record<string, { dollars: number; questions: number; players: Set<string> }> = {};
  const freePlayers = new Set<string>(), hitFree = new Set<string>();
  let costDays = 0;
  for (const d of days) {
    if (!week.has(d.id)) continue;
    if (Object.keys(d.costs || {}).length) costDays++;
    for (const [h, c] of Object.entries(d.costs || {})) {
      if (!keep(h)) continue;
      const t = c.tier || 'free';
      const g = (cost[t] ||= { dollars: 0, questions: 0, players: new Set() });
      g.dollars += Number(c.dollars) || 0; g.questions += Number(c.questions) || 0; g.players.add(h);
      if (t === 'free') freePlayers.add(h);
    }
    for (const [h, t] of Object.entries(d.limitHit || {})) {
      if (!keep(h) || t !== 'free') continue;
      freePlayers.add(h); hitFree.add(h);
    }
  }
  const monthDollars = monthCosts.filter((c) => !owners.has(c.hash)).reduce((n, c) => n + c.dollars, 0);
  const hitShare = freePlayers.size ? hitFree.size / freePlayers.size : 0;
  return { now, before, fresh, returning: all.length - fresh, cost, freePlayers: freePlayers.size, hitFree: hitFree.size, hitShare, monthDollars, owners: owners.size, costDays };
}

/** The Discord lines (Mondays). */
export async function playerWeekLines(today = Date.now()): Promise<string[]> {
  const days = (await db().collection('stats').get()).docs
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.id))
    .map((d) => ({ id: d.id, ...(d.data() as any) })) as Day[];
  const month = new Date(today).toISOString().slice(0, 7);
  const monthCosts = (await db().collection('playerCosts').doc(month).collection('players').get()).docs
    .map((d) => ({ hash: hashOf(d.id), dollars: Number((d.data() as any).dollars) || 0 }));
  // The owner's accounts: config/players.ownerHashes (set once from ADMIN_EMAILS), plus any the server marks.
  const ownerHashes = (((await db().collection('config').doc('players').get()).data() || {}) as any).ownerHashes || [];
  const w = playerWeek(days, monthCosts, today, ownerHashes);
  const n = (s: Set<string>) => s.size;
  const lines = [
    `👥 Players this week: ${n(w.now.players) + n(w.now.guests)} active (${n(w.now.players)} signed in, ${n(w.now.guests)} guests) vs ${n(w.before.players) + n(w.before.guests)} last week; ${w.fresh} new, ${w.returning} returning.`,
  ];
  const part = (t: string, label: string) => {
    const c = w.cost[t];
    return c && c.questions ? `${label} ${money(c.dollars)} (${c.questions} questions, ${money(c.dollars / c.questions)} each, ${money(c.dollars / c.players.size)} per player)` : `${label} $0`;
  };
  const total = Object.values(w.cost).reduce((a, c) => a + c.dollars, 0);
  const qs = Object.values(w.cost).reduce((a, c) => a + c.questions, 0);
  lines.push(w.costDays
    ? `💸 Player AI cost this week: ${money(total)}${qs ? `, ${money(total / qs)} a question` : ''} · ${part('free', 'free')} · ${part('premium', 'Premium')} · ${part('guest', 'guests')}${w.costDays < 7 ? ` (counted for ${w.costDays} of 7 days so far)` : ''}. This month: ${money(w.monthDollars)}.`
    : `💸 Player AI cost this week: counted from the next deploy on (this month so far: ${money(w.monthDollars)}).`);
  lines.push(`🚧 Free players who ran out of questions this week: ${w.hitFree} of ${w.freePlayers} (${Math.round(w.hitShare * 100)}%).`);
  const alerts = [
    w.monthDollars > ALERT_MONTH_DOLLARS ? `players' AI cost is ${money(w.monthDollars)} this month (over $${ALERT_MONTH_DOLLARS})` : '',
    w.freePlayers && w.hitShare > ALERT_LIMIT_SHARE ? `${Math.round(w.hitShare * 100)}% of free players ran out of questions (over ${Math.round(ALERT_LIMIT_SHARE * 100)}%)` : '',
  ].filter(Boolean);
  if (alerts.length) lines.unshift(`⚠️ Time to revisit the free limits: ${alerts.join('; ')}.`);
  lines.push(`(Left out: your own account${w.owners > 1 ? 's' : ''}, from ADMIN_EMAILS on the server, ${w.owners} anonymous id(s) so far; and test traffic: test guest ids and local servers.)`);
  return lines;
}
