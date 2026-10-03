/**
 * Which model reviews what, and the daily count of Gemini 3.1 Pro requests (our Paid Tier 1 allows Pro 250 requests
 * a day; Gemini 3.8 Flash 10K). The reviewer is split by importance:
 *   Pro    the final review gate of careful builds and rebuilds (careful, extend, upgrade, and outline rebuilds of games
 *          too new for quick mode): anything that ends up Checked. When Pro's daily requests are used up these wait for
 *          the next day; they never fall back to another model.
 *   Flash  everything else: page fixes, quick-build and quick-rebuild gates, player corrections and their rewrites.
 *          Flash also writes quick guides, so its pass mark for them is stricter (80 instead of 75).
 * The count lives in system/proBudget, per day as the quota counts it (midnight Pacific time). Careful rebuilds may use
 * all of it; every other Pro use (a manual review, say) stops at PRO_DAILY - PRO_CAREFUL_RESERVE, so at least 200 are
 * always left for them. Player corrections never use Pro.
 */
import { db, MODEL } from './common';

export const PRO_MODEL = process.env.REVIEW_MODEL || 'gemini-3.1-pro-preview';
export const FLASH_REVIEW_MODEL = process.env.FLASH_REVIEW_MODEL || MODEL; // gemini-3.8-flash
const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);
export const PRO_DAILY = num(process.env.PRO_DAILY_REQUESTS, 250);
export const PRO_CAREFUL_RESERVE = num(process.env.PRO_CAREFUL_RESERVE, 200);

export type ReviewTier = 'pro' | 'flash';
/** What a Pro request is for: careful rebuild gates may use the whole day's allowance, anything else stops short of the reserve. */
export type ProKind = 'careful' | 'other';

/** The Pro reviewer's daily requests are used up (for this kind of use): the work waits for tomorrow. */
export class ProQuotaWait extends Error {
  constructor(msg = 'the Pro reviewer\'s daily requests are used up') {
    super(msg);
    this.name = 'ProQuotaWait';
  }
}

/** Today as the quota counts it (it resets at midnight Pacific time). */
const quotaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const ref = () => db().collection('system').doc('proBudget');

/** Count n Pro requests before making them, or throw ProQuotaWait if they'd go past today's allowance for this kind. */
export async function takePro(kind: ProKind, n = 1): Promise<void> {
  const day = quotaDay();
  await db().runTransaction(async (t) => {
    const d: any = (await t.get(ref())).data() || {};
    const today = d.day === day ? d : { day, count: 0, careful: 0, other: 0 };
    const limit = kind === 'careful' ? PRO_DAILY : PRO_DAILY - PRO_CAREFUL_RESERVE;
    if (Number(today.count || 0) + n > limit) throw new ProQuotaWait(`the Pro reviewer's daily requests are used up (${today.count}/${PRO_DAILY} today${kind === 'other' ? `, ${PRO_CAREFUL_RESERVE} kept for careful rebuilds` : ''})`);
    t.set(ref(), { day, count: Number(today.count || 0) + n, careful: Number(today.careful || 0) + (kind === 'careful' ? n : 0), other: Number(today.other || 0) + (kind === 'other' ? n : 0), updatedAt: Date.now() });
  });
}

/** Google said the quota is used up (another process, or the count was off): no more Pro today. */
export async function proExhausted(): Promise<void> {
  const day = quotaDay();
  const d: any = (await ref().get()).data() || {};
  await ref().set({ ...(d.day === day ? d : { careful: 0, other: 0 }), day, count: PRO_DAILY, exhaustedAt: Date.now() });
}

/** Pro requests counted today. */
export async function proUsedToday(): Promise<number> {
  const d: any = (await ref().get()).data() || {};
  return d.day === quotaDay() ? Number(d.count || 0) : 0;
}

/** A 429 / quota error from the API. */
export const isQuotaError = (e: any) => /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message || e));
