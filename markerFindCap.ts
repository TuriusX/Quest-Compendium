/**
 * Markers v2 (Nov 2026): the daily cap on finding markers again (the desktop app finds an answer's markers again when
 * the view changes, and when the player asks). Each find is one /api/refind call, about half a cent. The first
 * placement when an answer arrives is never capped; only finding again pauses once the day's amount is spent.
 *
 *   config/markers       { findAgainDailyDollars: 2 }   (owner, Nov 17 2026: $2 suggested; 0 turns finding again off)
 *   system/markerFindAgain { day: 'YYYY-MM-DD' (UTC), calls, dollars }
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** What one find costs, at most (the look plus the people check: ~$0.005 + $0.001 measured on Nov 17 2026). */
export const FIND_AGAIN_DOLLARS = 0.006;
export const FIND_AGAIN_DAILY_DEFAULT = 2;

/** The day's cap in dollars from config/markers (default $2; a negative or broken value means the default). */
export function dailyCapOf(cfg: any): number {
  const v = Number(cfg?.findAgainDailyDollars);
  return Number.isFinite(v) && v >= 0 ? v : FIND_AGAIN_DAILY_DEFAULT;
}

/** Whether one more find fits under the cap, given what today has spent (a new day starts from zero). */
export function fitsCap(day: string, counter: { day?: string; dollars?: number } | undefined, cap: number): boolean {
  const spent = counter?.day === day ? Number(counter.dollars) || 0 : 0;
  return spent + FIND_AGAIN_DOLLARS <= cap + 1e-9;
}

let capCache: { at: number; cap: number } | null = null;
async function dailyCap(): Promise<number> {
  if (capCache && Date.now() - capCache.at < 60_000) return capCache.cap;
  let cap = FIND_AGAIN_DAILY_DEFAULT;
  try {
    cap = dailyCapOf((await getFirestore().collection('config').doc('markers').get()).data());
  } catch {
    /* the default */
  }
  capCache = { at: Date.now(), cap };
  return cap;
}

let pausedLogged = '';
/**
 * Take one find from today's allowance: true if it fits (and it's counted), false once the day's cap is reached.
 * If the counter can't be read, the find goes ahead (an outage never turns markers off; the per-player hourly limit
 * still applies).
 */
export async function takeFindAgain(now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const cap = await dailyCap();
  if (cap <= 0) return false;
  const ref = getFirestore().collection('system').doc('markerFindAgain');
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const cur: any = (await tx.get(ref)).data();
      if (!fitsCap(day, cur, cap)) {
        if (pausedLogged !== day) {
          pausedLogged = day;
          console.warn(`[markers] finding again is paused for today: the $${cap} daily cap is reached`);
        }
        return false;
      }
      if (cur?.day === day) tx.update(ref, { calls: FieldValue.increment(1), dollars: FieldValue.increment(FIND_AGAIN_DOLLARS) });
      else tx.set(ref, { day, calls: 1, dollars: FIND_AGAIN_DOLLARS });
      return true;
    });
  } catch (e: any) {
    console.warn('[markers] find-again counter unavailable:', e?.message);
    return true;
  }
}
