/**
 * Who has Premium, with Stripe as the source of truth.
 *
 * Before 0.6.1 an account marked Premium stayed Premium for good: the server only ever turned it on. With the Stripe
 * customer portal players can cancel, so the status check now also turns it off, for accounts Stripe manages only:
 *   - Stripe has an active (or trialing, or past-due while Stripe retries) subscription: Premium, and the customer id is
 *     remembered (users/{uid}.stripeCustomerId) so later checks don't depend on the email address.
 *   - Stripe knows the player (a customer for their id or email) but no live subscription: not Premium.
 *   - A manual grant (users/{uid}.premiumGrant, or an owner account in ADMIN_EMAILS): Premium whatever Stripe says.
 *   - Stripe can't be reached: no change (the last saved status stands).
 * Lookups are cached per player for a few minutes, so a question doesn't wait on Stripe every time.
 */
import type Stripe from 'stripe';

export type StripeView = {
  /** A Stripe customer for this player was found (by the saved id or the account email). */
  customerId: string | null;
  /** A live subscription: active, trialing, or past due (Stripe is still retrying the payment). */
  active: boolean;
  /** When the current period ends (ms), for "renews on" / "ends on". */
  periodEnd?: number;
  /** Cancelled in the portal: it stays Premium until periodEnd, then ends. */
  cancelAtPeriodEnd?: boolean;
  /** Billed monthly or yearly (the subscription's price), for "Premium, yearly". */
  interval?: 'month' | 'year';
};

export type PremiumDecision = {
  isPremium: boolean;
  /** Who manages it: 'stripe' (can be managed or cancelled in the portal), 'grant' (manual), or 'none'. */
  source: 'stripe' | 'grant' | 'none';
  /** Fields to save on users/{uid} (only what changed). */
  save: Record<string, unknown>;
};

const LIVE = new Set(['active', 'trialing', 'past_due']);

/** The decision from the saved user document and what Stripe said (null: Stripe couldn't be reached). */
export function decidePremium(doc: any, stripe: StripeView | null, opts: { owner?: boolean } = {}): PremiumDecision {
  const d = doc || {};
  const granted = d.premiumGrant === true || opts.owner === true;
  if (!stripe) {
    // No answer from Stripe: keep what was saved.
    const was = d.isPremium === true || d.subscriptionStatus === 'active';
    return { isPremium: was || granted, source: granted ? 'grant' : was ? (d.stripeCustomerId ? 'stripe' : 'none') : 'none', save: {} };
  }
  const save: Record<string, unknown> = {};
  if (stripe.customerId && d.stripeCustomerId !== stripe.customerId) save.stripeCustomerId = stripe.customerId;
  if (stripe.active) {
    if (d.isPremium !== true) save.isPremium = true;
    if (d.subscriptionStatus !== 'active') save.subscriptionStatus = 'active';
    if (stripe.periodEnd && d.premiumPeriodEnd !== stripe.periodEnd) save.premiumPeriodEnd = stripe.periodEnd;
    if (!!stripe.cancelAtPeriodEnd !== !!d.premiumCancelAtPeriodEnd) save.premiumCancelAtPeriodEnd = !!stripe.cancelAtPeriodEnd;
    if (stripe.interval && d.premiumInterval !== stripe.interval) save.premiumInterval = stripe.interval;
    return { isPremium: true, source: 'stripe', save };
  }
  if (granted) return { isPremium: true, source: 'grant', save };
  // Stripe manages this player (a customer, or one saved before) and there's no live subscription: Premium ends.
  if (stripe.customerId || d.stripeCustomerId) {
    if (d.isPremium !== false) save.isPremium = false;
    if (d.subscriptionStatus !== 'inactive') save.subscriptionStatus = 'inactive';
    if (d.premiumCancelAtPeriodEnd) save.premiumCancelAtPeriodEnd = false;
    return { isPremium: false, source: 'none', save };
  }
  // Never a Stripe customer and no grant: whatever was saved stands (an account set by hand before grants existed).
  const was = d.isPremium === true;
  return { isPremium: was, source: was ? 'grant' : 'none', save };
}

/** The current period's end, from the subscription or (newer API versions) its first item. */
function periodEndOf(sub: any): number | undefined {
  const s = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end);
  return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
}

/** What Stripe knows about this player: by the saved customer id, else by the account email. */
export async function stripeViewFor(stripe: Stripe, savedCustomerId: string | undefined, email: string | null): Promise<StripeView> {
  const customers: string[] = [];
  if (savedCustomerId) customers.push(savedCustomerId);
  if (email) {
    const list = await stripe.customers.list({ email, limit: 5 });
    for (const c of list.data) if (!customers.includes(c.id)) customers.push(c.id);
  }
  let firstCustomer: string | null = customers[0] || null;
  for (const id of customers) {
    const subs = await stripe.subscriptions.list({ customer: id, status: 'all', limit: 5 });
    const live = subs.data.find((s: any) => LIVE.has(s.status));
    if (live) {
      const iv = (live as any).items?.data?.[0]?.price?.recurring?.interval;
      return { customerId: id, active: true, periodEnd: periodEndOf(live), cancelAtPeriodEnd: !!(live as any).cancel_at_period_end || !!(live as any).cancel_at, ...(iv === 'year' || iv === 'month' ? { interval: iv } : {}) };
    }
  }
  return { customerId: firstCustomer, active: false };
}

/** A few minutes' cache per player, so questions don't each wait on Stripe. */
const cache = new Map<string, { at: number; view: StripeView }>();
const CACHE_MS = 5 * 60_000;
export async function cachedStripeView(uid: string, load: () => Promise<StripeView>, fresh = false): Promise<StripeView | null> {
  const hit = cache.get(uid);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.view;
  try {
    const view = await load();
    cache.set(uid, { at: Date.now(), view });
    return view;
  } catch (e: any) {
    console.warn('[premium] Stripe lookup failed:', e?.message);
    return hit ? hit.view : null;
  }
}
/** A change came in (checkout finished, portal used): look again next time. */
export const forgetStripeView = (uid: string) => cache.delete(uid);
