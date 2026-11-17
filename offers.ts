/**
 * Dated Premium offers (owner, Nov 16 2026: the holiday offer), changeable without a deploy: Firestore config/offers.
 *
 *   holiday { from: "2026-11-26", until: "2027-01-04", coupon: "<Stripe coupon id>", line: "Holiday offer: first year
 *             $29.99 (until Jan 4)" }
 *
 * From `from` through `until` (both included, Central time), and only while `coupon` is set: yearly checkouts get the
 * coupon (the first year's price; Stripe applies it, so the coupon itself decides the amount and the "first year"), and
 * the limit message and the Premium card show `line`. Afterwards everything is as before, by itself. The coupon is made
 * in the Stripe dashboard (a fixed amount off, once, on the Premium product).
 */
import { getFirestore } from 'firebase-admin/firestore';

export type Offer = { from: string; until: string; coupon: string; line: string };
const day = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

/** The offer that's on today, if any (pure: the config passed in). */
export function activeOffer(cfg: any, today = day()): Offer | null {
  const o = cfg?.holiday;
  if (!o?.from || !o?.until || !o?.coupon || today < String(o.from) || today > String(o.until)) return null;
  return { from: String(o.from), until: String(o.until), coupon: String(o.coupon), line: String(o.line || '') };
}

let cache: { at: number; value: Offer | null } | null = null;
/** Today's offer (cached for a minute). */
export async function currentOffer(): Promise<Offer | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value: Offer | null = null;
  try {
    value = activeOffer((await getFirestore().collection('config').doc('offers').get()).data());
  } catch {
    /* no offer */
  }
  cache = { at: Date.now(), value };
  return value;
}
