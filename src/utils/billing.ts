/**
 * Premium checkout and "Manage or cancel" (the Stripe customer portal).
 *   - Web: the page goes to Stripe and comes back to the web app.
 *   - Desktop: Stripe opens in the system browser (the overlay stays as it is), and the app asks for its plan again
 *     every few seconds for a few minutes, so Premium shows up by itself once paid (qc-refresh-plan, useCloudSync).
 */
import { auth } from '../lib/firebase';
import { getApiBaseUrl } from './api';

const isDesktop = () => typeof window !== 'undefined' && !!(window as any).electronAPI;

/** The plan asked for again: every 5 s for 3 minutes, and when the app gets focus back. */
let watch: ReturnType<typeof setInterval> | null = null;
export function watchPlan(): void {
  const ask = () => window.dispatchEvent(new CustomEvent('qc-refresh-plan'));
  if (watch) clearInterval(watch);
  const until = Date.now() + 3 * 60_000;
  watch = setInterval(() => {
    if (Date.now() > until && watch) { clearInterval(watch); watch = null; return; }
    ask();
  }, 5000);
  const onFocus = () => ask();
  window.addEventListener('focus', onFocus);
  setTimeout(() => window.removeEventListener('focus', onFocus), 10 * 60_000);
}
/** Premium arrived: stop asking. */
export function stopWatchingPlan(): void {
  if (watch) clearInterval(watch);
  watch = null;
}

/** Premium's two plans: monthly (the default) and yearly. The yearly saving is against twelve months at the monthly price. */
export type Interval = 'month' | 'year';
export const PRICES = { month: { label: '$4.99', cents: 499 }, year: { label: '$39.99', cents: 3999 }, yearPerMonth: '$3.33', savePercent: Math.floor((1 - 3999 / (499 * 12)) * 100) };

async function open(path: '/api/checkout' | '/api/billing-portal', extra: Record<string, unknown> = {}): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('signin');
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ client: isDesktop() ? 'desktop' : 'web', ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.url) throw new Error(data?.error || 'unavailable');
  if (isDesktop()) {
    (window as any).electronAPI?.openExternal?.(data.url);
    watchPlan();
  } else {
    window.location.href = data.url;
  }
}

/** Subscribe to Premium (signed-in players). Throws 'signin' for a guest. */
export const startCheckout = (interval: Interval = 'month') => open('/api/checkout', { interval });
/** Change the card, see invoices, cancel (Premium players managed by Stripe). */
export const openBillingPortal = () => open('/api/billing-portal');
