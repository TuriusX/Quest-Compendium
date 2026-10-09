/**
 * Where a player came from: the ?from= tag on links into the app (website guide pages, the homepage, the stores,
 * Discord). The first one seen is kept on this device and sent with questions (X-QC-From), so the daily summary can
 * show which sources bring players who ask and sign up. The tag is taken off the address bar once read.
 */
export const SOURCES = ['guide', 'home', 'store', 'discord'] as const;
const KEY = 'qc_from';

export function captureSource(): void {
  try {
    const url = new URL(window.location.href);
    const from = (url.searchParams.get('from') || '').toLowerCase();
    if (!from) return;
    if ((SOURCES as readonly string[]).includes(from) && !localStorage.getItem(KEY)) localStorage.setItem(KEY, from);
    url.searchParams.delete('from');
    window.history.replaceState(window.history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch {
    /* not remembered */
  }
}

export function appSource(): string {
  try {
    const v = localStorage.getItem(KEY) || '';
    return (SOURCES as readonly string[]).includes(v) ? v : '';
  } catch {
    return '';
  }
}

/** Phones and tablets: there's no game on this screen to capture, so the app leads with typing and the guides. */
export const isPhone = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
