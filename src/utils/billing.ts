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

async function open(path: '/api/checkout' | '/api/billing-portal'): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('signin');
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ client: isDesktop() ? 'desktop' : 'web' }),
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
export const startCheckout = () => open('/api/checkout');
/** Change the card, see invoices, cancel (Premium players managed by Stripe). */
export const openBillingPortal = () => open('/api/billing-portal');
