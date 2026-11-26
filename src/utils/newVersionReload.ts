/**
 * The web app picks up a new version on the first open after a release (owner, Nov 14 2026: the iPhone ran the
 * service worker's stored copy from before visual answers, so the Nagakiba question got no video).
 *
 * The service worker (vite-plugin-pwa, autoUpdate: skipWaiting + clientsClaim) downloads a new version in the
 * background and then takes over the page ("controllerchange"). If nothing has been asked on this page yet and nothing
 * is typed in a box, the page reloads once onto the new version; otherwise it keeps running and the next open gets it.
 * Not for the desktop app (it updates with its installer) or the first install of the service worker (same version).
 */
let asked = false;
const KEY = 'qc_new_version_reload_at';

/** A question was sent from this page: never reload under it. */
export function markAsked(): void {
  asked = true;
}

/** Something typed but not sent (the question box, a note): reloading would lose it. */
function typing(): boolean {
  return Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"], input:not([type])'))
    .some((el) => !el.readOnly && !el.disabled && String(el.value || '').trim().length > 0);
}

/**
 * A part of the app that a release removed (an older stored copy asking for the old file; web audit Nov 25 2026: the
 * page fell to "Compendium Recovery"). True when this error is that and the page is reloading onto the current version;
 * at most once a minute, so it can never loop.
 */
const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Failed to fetch dynamically/i;
export function reloadForMissingPart(err: unknown): boolean {
  if (typeof window === 'undefined' || (window as any).electronAPI) return false;
  if (!STALE.test(String((err as any)?.message || err || ''))) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function reloadOnNewVersion(): void {
  // Vite's own signal that a lazily loaded part failed to load.
  if (typeof window !== 'undefined' && !(window as any).electronAPI) {
    window.addEventListener('vite:preloadError', (ev: any) => { if (reloadForMissingPart(ev?.payload || 'Failed to fetch dynamically imported module')) ev.preventDefault?.(); });
  }
  if (typeof window === 'undefined' || (window as any).electronAPI || !('serviceWorker' in navigator)) return;
  // No service worker in control yet: this is its first install, of the version already running.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || asked || typing()) return;
    // At most once a minute, so a broken update can never loop.
    try {
      const last = Number(sessionStorage.getItem(KEY)) || 0;
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return; // no session storage: no way to guard against a loop, so no reload
    }
    window.location.reload();
  });
}
