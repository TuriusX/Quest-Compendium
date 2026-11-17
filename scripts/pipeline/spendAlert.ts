/**
 * Today's AI spend for the pipeline's Discord summary, and an alert when it passes the owner's daily threshold
 * (owner, Nov 16 2026: holiday plan, item 3).
 *
 *   - pipeline: system/pipeline.spend (today's guide-pipeline dollars, Central day; searches included)
 *   - flagship builds: system/flagship.spentToday (its own budget)
 *   - players: stats/{day}.costs (their answers' AI cost, Central day; your own and test accounts left out)
 *   - searches: searchDays/{Pacific day} (Google's day), at $14 per 1,000 from the first, scaled for the queries the
 *     counter misses (searchGuard.ts billedSearchDollars)
 *
 * The threshold is config/alerts.dailyAiDollars (default $10): change it in Firestore, no deploy needed. The alert is
 * posted once a day at most (system/spendAlert.day).
 */
import { db } from '../guides/common';
import { quotaDay } from '../../apiLimits';
import { searchMonth, billedSearchDollars } from '../../searchGuard';
import crypto from 'crypto';

export const DEFAULT_DAILY_ALERT = 10;
const chicagoDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const hashOf = (uid: string) => crypto.createHash('sha256').update(`qc:${uid}`).digest('hex').slice(0, 12);

export type DaySpend = { day: string; pipeline: number; flagship: number; players: number; total: number; searches: number; pipelineSearches: number; playerSearches: number; searchDollars: number };

/** Pure: today's spend from the documents (for tests). */
export function daySpendFrom(o: { day: string; pipeline: any; flagship: any; stats: any; searchDay: any; monthCount: number; leaveOut: Set<string> }): DaySpend {
  const pipeline = o.pipeline?.spend?.day === o.day ? Number(o.pipeline.spend.dollars) || 0 : 0;
  const flagship = o.flagship?.day === o.day ? Number(o.flagship.spentToday) || 0 : 0;
  const own = new Set<string>([...o.leaveOut, ...((o.stats?.owners as string[]) || [])]);
  let players = 0;
  for (const [h, c] of Object.entries((o.stats?.costs || {}) as Record<string, any>)) if (!own.has(h)) players += Number(c?.dollars) || 0;
  const searches = Number(o.searchDay?.total) || 0;
  return {
    day: o.day, pipeline, flagship, players, total: pipeline + flagship + players, searches,
    pipelineSearches: Number(o.searchDay?.pipeline) || 0, playerSearches: Number(o.searchDay?.players) || 0, searchDollars: billedSearchDollars(searches),
  };
}

export const spendLine = (s: DaySpend, threshold: number) =>
  `📊 AI spend today: $${s.total.toFixed(2)} (pipeline $${s.pipeline.toFixed(2)}, flagship $${s.flagship.toFixed(2)}, players $${s.players.toFixed(2)}) · ` +
  `${s.searches.toLocaleString('en-US')} search queries (pipeline ${s.pipelineSearches.toLocaleString('en-US')}, players ${s.playerSearches.toLocaleString('en-US')}), ≈$${s.searchDollars.toFixed(2)} of it billed for search. Alert at $${threshold}.`;

export async function daySpend(pipelineToday?: number): Promise<{ spend: DaySpend; threshold: number }> {
  const d = db();
  const day = chicagoDay();
  const [pipeline, flagship, stats, searchDay, alerts, players, month] = await Promise.all([
    d.collection('system').doc('pipeline').get(),
    d.collection('system').doc('flagship').get(),
    d.collection('stats').doc(day).get(),
    d.collection('searchDays').doc(quotaDay()).get(),
    d.collection('config').doc('alerts').get(),
    d.collection('config').doc('players').get(),
    searchMonth(true),
  ]);
  const p: any = players.data() || {};
  const leaveOut = new Set<string>([...(p.ownerHashes || []), ...((p.testUids || []) as string[]).map(hashOf)]);
  const threshold = Number((alerts.data() as any)?.dailyAiDollars) || DEFAULT_DAILY_ALERT;
  // This run's own spend isn't saved yet: the running pipeline passes today's total itself.
  const pipe: any = pipelineToday === undefined ? pipeline.data() : { spend: { day, dollars: pipelineToday } };
  return { spend: daySpendFrom({ day, pipeline: pipe, flagship: flagship.data(), stats: stats.data(), searchDay: searchDay.data(), monthCount: month.count, leaveOut }), threshold };
}

/** The summary's line, and the alert to post (once a day) when today's total is past the threshold. */
/** Players' search queries this month as billed ($14 per 1,000 from the first, scaled for missed queries). */
export const playerSearchDollars = (players: number) => billedSearchDollars(players);
export const DEFAULT_PLAYER_SEARCH_ALERT = 50;

export async function spendReport(pipelineToday?: number): Promise<{ line: string; alert: string | null }> {
  const { spend, threshold } = await daySpend(pipelineToday);
  const line = spendLine(spend, threshold);
  const ref = db().collection('system').doc('spendAlert');
  const last: any = (await ref.get()).data() || {};
  const alerts: string[] = [];
  if (spend.total > threshold && last.day !== spend.day) {
    await ref.set({ day: spend.day, total: spend.total, at: Date.now() }, { merge: true });
    alerts.push(`⚠️ **AI spend alert**: $${spend.total.toFixed(2)} today, past the $${threshold} daily alert (pipeline $${spend.pipeline.toFixed(2)}, flagship $${spend.flagship.toFixed(2)}, players $${spend.players.toFixed(2)}; ${spend.searches.toLocaleString('en-US')} search queries). Change the alert in config/alerts.dailyAiDollars.`);
  }
  // Players' search spend this month (owner, Nov 16 2026: the holiday reserve), once a month past its alert.
  const m = await searchMonth(true);
  const playerDollars = playerSearchDollars(m.players);
  const cfg: any = (await db().collection('config').doc('alerts').get()).data() || {};
  const playerAlert = Number(cfg.playerSearchMonthDollars) || DEFAULT_PLAYER_SEARCH_ALERT;
  if (playerDollars > playerAlert && last.playerMonth !== m.month) {
    await ref.set({ playerMonth: m.month, playerDollars, at: Date.now() }, { merge: true });
    alerts.push(`⚠️ **Player search alert**: players' searches this month are ≈$${playerDollars.toFixed(2)} (${m.players.toLocaleString('en-US')} queries), past the $${playerAlert} alert. Change it in config/alerts.playerSearchMonthDollars.`);
  }
  return { line, alert: alerts.length ? alerts.join('\n') : null };
}
