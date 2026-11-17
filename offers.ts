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

/**
 * The free trial of monthly Premium (owner, Nov 2026): config/offers.trial { on: true, days: 7, from: "2026-11-26" }.
 * Card up front; one per player (trialEligible); never on yearly (the holiday coupon is yearly's). Stays on until `on`
 * is turned off.
 */
export type Trial = { days: number };
export function activeTrial(cfg: any, today = day()): Trial | null {
  const t = cfg?.trial;
  if (t?.on !== true) return null;
  if (t.from && today < String(t.from)) return null;
  if (t.until && today > String(t.until)) return null;
  const days = Math.floor(Number(t.days) || 7);
  return days >= 1 && days <= 30 ? { days } : null;
}

/**
 * Whether this player may start a free trial: never had one (users/{uid}.trialUsed), never Premium before
 * (premiumEver), and none of their Stripe customers ever had a subscription. Pure: the facts passed in.
 */
export function trialEligible(doc: any, everSubscribed: boolean): boolean {
  // subscriptionStatus "inactive": a subscription that ended (saved before premiumEver existed).
  return !doc?.trialUsed && !doc?.premiumEver && doc?.isPremium !== true && doc?.subscriptionStatus !== 'inactive' && !everSubscribed;
}

/**
 * What a subscription event means for a free trial (for /stats, trials/{subscription}):
 *   started   created while trialing
 *   converted the trial ended and it's active (the first payment went through)
 *   cancelled cancelled during the trial (cancel at trial end, or deleted before any payment)
 */
export function trialStep(type: string, sub: any, prev: any): 'started' | 'converted' | 'cancelled' | null {
  if (!sub?.trial_end) return null;
  if (type === 'customer.subscription.created' && sub.status === 'trialing') return 'started';
  if (type === 'customer.subscription.updated') {
    if (prev?.status === 'trialing' && sub.status === 'active') return 'converted';
    if (sub.status === 'trialing' && (sub.cancel_at_period_end || sub.cancel_at) && !(prev?.cancel_at_period_end || prev?.cancel_at)) return 'cancelled';
  }
  if (type === 'customer.subscription.deleted' && (sub.status === 'canceled' || sub.status === 'incomplete_expired')) {
    const ended = Number(sub.ended_at || sub.canceled_at || 0);
    if (ended && ended <= Number(sub.trial_end) + 3600) return 'cancelled';
  }
  return null;
}

let cache: { at: number; value: { offer: Offer | null; trial: Trial | null } } | null = null;
async function load() {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = { offer: null as Offer | null, trial: null as Trial | null };
  try {
    const cfg = (await getFirestore().collection('config').doc('offers').get()).data();
    value = { offer: activeOffer(cfg), trial: activeTrial(cfg) };
  } catch {
    /* no offer */
  }
  cache = { at: Date.now(), value };
  return value;
}
/** Today's offer (cached for a minute). */
export async function currentOffer(): Promise<Offer | null> {
  return (await load()).offer;
}
/** Today's free trial, if it's on (cached for a minute). */
export async function currentTrial(): Promise<Trial | null> {
  return (await load()).trial;
}
