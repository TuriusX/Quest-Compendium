/**
 * Google's API limits for our project (Tier 2), in Firestore config/apiLimits so they change without a deploy:
 *   proDaily              Gemini 3.1 Pro requests a day (50,000). Pro is otherwise limited only by our dollar caps.
 *   proCarefulReserve     of those, kept for the guide pipeline's careful-rebuild reviews (other Pro uses stop short of it)
 *   searchDaily           Gemini 3 search grounding: searches a day across players and the pipeline (1,500)
 *   pipelineSearchDaily   the most of them the pipeline (and the flagship job) may use in a day (1,000), so at least
 *                         searchDaily - pipelineSearchDaily always stay for players
 *
 * Searches are counted per day in searchDays/{YYYY-MM-DD} { total, pipeline, players }, the day as Google counts it
 * (it resets at midnight Pacific time). The server counts players' searches; the pipeline's call wrapper
 * (scripts/guides/common.ts) counts its own.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export type ApiLimits = { proDaily: number; proCarefulReserve: number; searchDaily: number; pipelineSearchDaily: number };
export const LIMIT_DEFAULTS: ApiLimits = { proDaily: 50000, proCarefulReserve: 2000, searchDaily: 1500, pipelineSearchDaily: 1000 };

/** Today as Google's daily quotas count it (midnight Pacific time). */
export const quotaDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const pos = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
export function normalizeLimits(d: any): ApiLimits {
  const l = {
    proDaily: pos(d?.proDaily, LIMIT_DEFAULTS.proDaily),
    proCarefulReserve: pos(d?.proCarefulReserve, LIMIT_DEFAULTS.proCarefulReserve),
    searchDaily: pos(d?.searchDaily, LIMIT_DEFAULTS.searchDaily),
    pipelineSearchDaily: pos(d?.pipelineSearchDaily, LIMIT_DEFAULTS.pipelineSearchDaily),
  };
  // The pipeline never gets the whole search allowance, nor careful rebuilds all of Pro's.
  l.pipelineSearchDaily = Math.min(l.pipelineSearchDaily, l.searchDaily);
  l.proCarefulReserve = Math.min(l.proCarefulReserve, l.proDaily);
  return l;
}

let limitsCache: { at: number; value: ApiLimits } | null = null;
/** The limits (cached for a minute). */
export async function apiLimits(): Promise<ApiLimits> {
  if (limitsCache && Date.now() - limitsCache.at < 60_000) return limitsCache.value;
  let value = LIMIT_DEFAULTS;
  try {
    value = normalizeLimits((await getFirestore().collection('config').doc('apiLimits').get()).data() || {});
  } catch {
    /* defaults */
  }
  limitsCache = { at: Date.now(), value };
  return value;
}

export type SearchDay = { day: string; total: number; pipeline: number; players: number };
let dayCache: { at: number; value: SearchDay } | null = null;
/** Today's searches (cached for 20 seconds, plus what this process recorded since). */
export async function searchesToday(fresh = false): Promise<SearchDay> {
  const day = quotaDay();
  if (!fresh && dayCache && dayCache.value.day === day && Date.now() - dayCache.at < 20_000) return dayCache.value;
  let value: SearchDay = { day, total: 0, pipeline: 0, players: 0 };
  try {
    const d: any = (await getFirestore().collection('searchDays').doc(day).get()).data() || {};
    value = { day, total: Number(d.total) || 0, pipeline: Number(d.pipeline) || 0, players: Number(d.players) || 0 };
  } catch {
    if (dayCache?.value.day === day) value = dayCache.value;
  }
  dayCache = { at: Date.now(), value };
  return value;
}

/** Count searches toward today's total (fire-and-forget safe). */
export async function recordSearchDay(n: number, who: 'pipeline' | 'players'): Promise<void> {
  if (!(n > 0)) return;
  const day = quotaDay();
  if (dayCache?.value.day === day) dayCache.value = { ...dayCache.value, total: dayCache.value.total + n, [who]: dayCache.value[who] + n };
  try {
    await getFirestore().collection('searchDays').doc(day).set({ day, total: FieldValue.increment(n), [who]: FieldValue.increment(n), updatedAt: Date.now() }, { merge: true });
  } catch (e: any) {
    console.warn('[search] could not update the daily count:', e?.message);
  }
}

/** Searches the pipeline may still run today: its own share, and never past the day's total. */
export const pipelineRoom = (l: ApiLimits, d: SearchDay) => Math.max(0, Math.min(l.pipelineSearchDaily - d.pipeline, l.searchDaily - d.total));
/** Whether players' answers may still search today. */
export const playerSearchOk = (l: ApiLimits, d: SearchDay) => d.total < l.searchDaily;

/** "412 of 1,500 searches today (pipeline 300 of 1,000)" */
export const searchDayLine = (l: ApiLimits, d: SearchDay) =>
  `${d.total.toLocaleString('en-US')} of ${l.searchDaily.toLocaleString('en-US')} searches today (pipeline ${d.pipeline.toLocaleString('en-US')} of ${l.pipelineSearchDaily.toLocaleString('en-US')}, players ${d.players.toLocaleString('en-US')})`;

/** A search the pipeline may not run today: the work waits for tomorrow (the pipeline treats it as deferred). */
export class SearchDayWait extends Error {
  constructor(msg = "search day limit: the pipeline's searches for today are used up") {
    super(msg);
    this.name = 'SearchDayWait';
  }
}
