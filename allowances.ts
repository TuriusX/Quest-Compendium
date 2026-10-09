/**
 * Question allowances, in two models (server-side, changeable without a deploy): Firestore config/allowances.
 *
 *   premium  { pro: 8, flash: 25, rollover: true, cap: 100 }   a day; unused questions carry over, each model's banked
 *                                                               balance capped at `cap`
 *   free     { pro: 2, flash: 5, rollover: false }             a day for signed-in players; no carry-over
 *   guest    { pro: 1, flash: 3, rollover: false }             a day without signing in (signing in unlocks free's)
 *
 * "Pro" answers come from Gemini Pro (the best answers), "Fast" ones from Flash. The player picks one next to the send
 * button; when the picked one is used up the other answers instead (the app says so), and when both are used up the
 * player gets the limit message with the reset time. Locate me has its own allowance (locateMe.ts), never these.
 *
 * The day resets at midnight in the player's time zone (the app sends it; UTC when it doesn't), with the carry-over
 * applied then. A day string only moves forward, so changing the time zone can't give a second reset the same day.
 */
import { getFirestore } from 'firebase-admin/firestore';

export type Bucket = 'pro' | 'flash';
export type PlanAllowance = { pro: number; flash: number; rollover: boolean; cap: number };
export type Allowances = { premium: PlanAllowance; free: PlanAllowance; guest: PlanAllowance };
export const ALLOWANCE_DEFAULTS: Allowances = {
  premium: { pro: 8, flash: 25, rollover: true, cap: 100 },
  free: { pro: 2, flash: 5, rollover: false, cap: 0 },
  guest: { pro: 1, flash: 3, rollover: false, cap: 0 },
};

const int = (v: unknown, d: number, max = 10_000) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(max, Math.floor(Number(v))) : d);
export function normalizeAllowances(d: any): Allowances {
  const plan = (x: any, def: PlanAllowance): PlanAllowance => ({
    pro: int(x?.pro, def.pro),
    flash: int(x?.flash, def.flash),
    rollover: typeof x?.rollover === 'boolean' ? x.rollover : def.rollover,
    cap: int(x?.cap, def.cap),
  });
  return { premium: plan(d?.premium, ALLOWANCE_DEFAULTS.premium), free: plan(d?.free, ALLOWANCE_DEFAULTS.free), guest: plan(d?.guest, ALLOWANCE_DEFAULTS.guest) };
}

let cache: { at: number; value: Allowances } | null = null;
/** The allowances (cached for a minute). ALLOWANCES (JSON) overrides them for a local test server. */
export async function allowances(): Promise<Allowances> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = ALLOWANCE_DEFAULTS;
  try {
    const d: any = process.env.ALLOWANCES ? JSON.parse(process.env.ALLOWANCES) : (await getFirestore().collection('config').doc('allowances').get()).data() || {};
    value = normalizeAllowances(d);
  } catch {
    /* defaults */
  }
  cache = { at: Date.now(), value };
  return value;
}

/** A time zone the player's device reported, if it's a real one; else UTC. */
export function safeTimeZone(tz: unknown): string {
  const z = String(tz || '').slice(0, 64);
  if (!z) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return 'UTC';
  }
}
/** Today in a time zone, as YYYY-MM-DD. */
export const dayIn = (tz: string, t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: safeTimeZone(tz) });
/** Whole days from one YYYY-MM-DD to another (0 if not later). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 86_400_000) : 0;
}
/** When the next day starts in this time zone (ms since epoch): the reset time shown to players. */
export function nextReset(tz: string, t = Date.now()): number {
  const zone = safeTimeZone(tz);
  const today = dayIn(zone, t);
  // Step forward to the first minute that is already tomorrow there (time zones have whole- or half-hour offsets).
  let lo = t, hi = t + 26 * 3_600_000;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayIn(zone, mid) === today) lo = mid;
    else hi = mid;
  }
  return hi - (hi % 60_000);
}

/** The balances a player has (the fields on their user document; guests keep the same shape in memory). */
export type Balances = { proQueriesAvailable?: number; flashQueriesAvailable?: number; lastResetDate?: string; allowancePlan?: 'premium' | 'free' | 'guest' };

/**
 * Balances brought up to today: at a new day, Premium adds each day's allowance to what's left (one per day passed),
 * each model capped at `cap`; free players start the day fresh. On the same day, a player who became Premium is topped
 * up to Premium's daily allowance once, and one whose Premium ended keeps no more than the free allowance. Guests
 * (guest = true) get the guest allowance.
 */
export function applyDay(b: Balances, a: Allowances, premium: boolean, today: string, guest = false): Required<Balances> {
  const plan = guest ? a.guest : premium ? a.premium : a.free;
  const planName = guest ? 'guest' : premium ? 'premium' : 'free';
  let pro = Number.isFinite(Number(b.proQueriesAvailable)) ? Math.max(0, Number(b.proQueriesAvailable)) : plan.pro;
  let flash = Number.isFinite(Number(b.flashQueriesAvailable)) ? Math.max(0, Number(b.flashQueriesAvailable)) : plan.flash;
  const last = String(b.lastResetDate || '');
  const days = last ? daysBetween(last, today) : 1;
  const firstTime = !last || b.allowancePlan === undefined; // before two models: start from today's allowance
  if (firstTime) {
    pro = plan.pro;
    flash = plan.flash;
  } else if (days > 0) {
    if (plan.rollover) {
      pro = Math.min(plan.cap, pro + plan.pro * days);
      flash = Math.min(plan.cap, flash + plan.flash * days);
    } else {
      pro = plan.pro;
      flash = plan.flash;
    }
  } else if (planName !== b.allowancePlan) {
    // The plan changed today: up to Premium's day (keeping what's left), or down to the free day.
    if (premium) {
      pro = Math.max(pro, plan.pro);
      flash = Math.max(flash, plan.flash);
    } else {
      pro = Math.min(pro, plan.pro);
      flash = Math.min(flash, plan.flash);
    }
  }
  // A day string only moves forward (a time-zone change never resets twice).
  const day = !last || today > last ? today : last;
  return { proQueriesAvailable: pro, flashQueriesAvailable: flash, lastResetDate: day, allowancePlan: planName };
}

/**
 * Which model answers: the one the player picked if it has questions left, else the other one (switched), or none
 * when both are used up.
 */
export function pickBucket(want: Bucket, b: { pro: number; flash: number }): { bucket: Bucket | null; switched: boolean } {
  const other: Bucket = want === 'pro' ? 'flash' : 'pro';
  if (b[want] > 0) return { bucket: want, switched: false };
  if (b[other] > 0) return { bucket: other, switched: true };
  return { bucket: null, switched: false };
}

/** The player's choice from a request: "pro" or "fast" (older apps send preferredModel "pro" / "flash"). */
export function wantedBucket(body: any): Bucket {
  const m = String(body?.answerModel ?? body?.preferredModel ?? 'pro').toLowerCase();
  return m === 'fast' || m === 'flash' ? 'flash' : 'pro';
}
