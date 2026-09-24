/**
 * Lo-fi pixel art for Quest Compendium's "Lo-fi pixel" interface style.
 *
 * - Pixel versions of the lucide icons the app uses (10x10 grid, drawn by hand). They only render while
 *   <html data-ui> is not "classic"; in Classic style the original lucide icons render exactly as before.
 * - Pixel medals and the "thinking" dots used by the achievements drawer and chat.
 * Purely visual: no app state, storage or network code lives here.
 */
import React, { forwardRef, useSyncExternalStore } from 'react';
import * as Lucide from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';

// ---- Interface style (read from <html data-ui="lofi|classic">, set by App from settings) -------------------
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui'] });
  }
  return () => {
    listeners.delete(cb);
  };
}
const isLofiNow = () => typeof document === 'undefined' || document.documentElement.dataset.ui !== 'classic';

/** True while the Lo-fi pixel style is active. */
export function useLofi(): boolean {
  return useSyncExternalStore(subscribe, isLofiNow, () => true);
}

const PATHS: Record<string, string> = {
  "square": "M1 1h8v1h-8zM1 2h8v1h-8zM1 3h8v1h-8zM1 4h8v1h-8zM1 5h8v1h-8zM1 6h8v1h-8zM1 7h8v1h-8zM1 8h8v1h-8z",
  "trophy": "M1 0h8v1h-8zM0 1h2v1h-2zM3 1h4v1h-4zM8 1h2v1h-2zM0 2h1v1h-1zM3 2h4v1h-4zM9 2h1v1h-1zM0 3h2v1h-2zM3 3h4v1h-4zM8 3h2v1h-2zM1 4h8v1h-8zM3 5h4v1h-4zM4 6h2v1h-2zM4 7h2v1h-2zM2 8h6v1h-6zM2 9h6v1h-6z",
  "gear": "M4 0h2v1h-2zM1 1h1v1h-1zM3 1h4v1h-4zM8 1h1v1h-1zM2 2h6v1h-6zM1 3h3v1h-3zM6 3h3v1h-3zM0 4h3v1h-3zM7 4h3v1h-3zM0 5h3v1h-3zM7 5h3v1h-3zM1 6h3v1h-3zM6 6h3v1h-3zM2 7h6v1h-6zM1 8h1v1h-1zM3 8h4v1h-4zM8 8h1v1h-1zM4 9h2v1h-2z",
  "close": "M0 0h2v1h-2zM8 0h2v1h-2zM0 1h3v1h-3zM7 1h3v1h-3zM1 2h3v1h-3zM6 2h3v1h-3zM2 3h6v1h-6zM3 4h4v1h-4zM3 5h4v1h-4zM2 6h6v1h-6zM1 7h3v1h-3zM6 7h3v1h-3zM0 8h3v1h-3zM7 8h3v1h-3zM0 9h2v1h-2zM8 9h2v1h-2z",
  "plus": "M4 0h2v1h-2zM4 1h2v1h-2zM4 2h2v1h-2zM4 3h2v1h-2zM0 4h10v1h-10zM0 5h10v1h-10zM4 6h2v1h-2zM4 7h2v1h-2zM4 8h2v1h-2zM4 9h2v1h-2z",
  "globe": "M2 0h6v1h-6zM1 1h1v1h-1zM4 1h2v1h-2zM8 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM6 2h1v1h-1zM9 2h1v1h-1zM0 3h10v1h-10zM0 4h1v1h-1zM3 4h1v1h-1zM6 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM0 6h10v1h-10zM0 7h1v1h-1zM3 7h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM1 8h1v1h-1zM4 8h2v1h-2zM8 8h1v1h-1zM2 9h6v1h-6z",
  "notes": "M1 0h9v1h-9zM0 1h2v1h-2zM9 1h1v1h-1zM1 2h1v1h-1zM3 2h5v1h-5zM9 2h1v1h-1zM0 3h2v1h-2zM9 3h1v1h-1zM1 4h1v1h-1zM3 4h5v1h-5zM9 4h1v1h-1zM0 5h2v1h-2zM9 5h1v1h-1zM1 6h1v1h-1zM3 6h3v1h-3zM9 6h1v1h-1zM0 7h2v1h-2zM9 7h1v1h-1zM1 8h1v1h-1zM9 8h1v1h-1zM1 9h9v1h-9z",
  "camera": "M3 1h3v1h-3zM0 2h10v1h-10zM0 3h3v1h-3zM7 3h3v1h-3zM0 4h2v1h-2zM4 4h2v1h-2zM8 4h2v1h-2zM0 5h2v1h-2zM3 5h4v1h-4zM8 5h2v1h-2zM0 6h2v1h-2zM4 6h2v1h-2zM8 6h2v1h-2zM0 7h3v1h-3zM7 7h3v1h-3zM0 8h10v1h-10z",
  "mic": "M3 0h4v1h-4zM3 1h4v1h-4zM3 2h4v1h-4zM0 3h1v1h-1zM3 3h4v1h-4zM9 3h1v1h-1zM0 4h1v1h-1zM3 4h4v1h-4zM9 4h1v1h-1zM0 5h2v1h-2zM8 5h2v1h-2zM1 6h8v1h-8zM4 7h2v1h-2zM4 8h2v1h-2zM2 9h6v1h-6z",
  "send": "M4 0h2v1h-2zM3 1h4v1h-4zM2 2h6v1h-6zM1 3h3v1h-3zM6 3h3v1h-3zM0 4h3v1h-3zM4 4h2v1h-2zM7 4h3v1h-3zM0 5h2v1h-2zM4 5h2v1h-2zM8 5h2v1h-2zM4 6h2v1h-2zM4 7h2v1h-2zM4 8h2v1h-2zM4 9h2v1h-2z",
  "speaker": "M4 0h1v1h-1zM3 1h2v1h-2zM8 1h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM9 2h1v1h-1zM0 3h5v1h-5zM7 3h1v1h-1zM9 3h1v1h-1zM0 4h5v1h-5zM7 4h1v1h-1zM9 4h1v1h-1zM0 5h5v1h-5zM7 5h1v1h-1zM9 5h1v1h-1zM0 6h5v1h-5zM7 6h1v1h-1zM9 6h1v1h-1zM2 7h3v1h-3zM6 7h1v1h-1zM9 7h1v1h-1zM3 8h2v1h-2zM8 8h1v1h-1zM4 9h1v1h-1z",
  "bookmark": "M1 0h8v1h-8zM1 1h8v1h-8zM1 2h8v1h-8zM1 3h8v1h-8zM1 4h8v1h-8zM1 5h8v1h-8zM1 6h3v1h-3zM6 6h3v1h-3zM1 7h2v1h-2zM7 7h2v1h-2zM1 8h1v1h-1zM8 8h1v1h-1z",
  "copy": "M0 0h6v1h-6zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM4 2h6v1h-6zM0 3h1v1h-1zM4 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1zM9 4h1v1h-1zM0 5h5v1h-5zM9 5h1v1h-1zM4 6h1v1h-1zM9 6h1v1h-1zM4 7h1v1h-1zM9 7h1v1h-1zM4 8h6v1h-6z",
  "pin": "M2 0h6v1h-6zM3 1h4v1h-4zM3 2h4v1h-4zM3 3h4v1h-4zM2 4h6v1h-6zM1 5h8v1h-8zM4 6h2v1h-2zM4 7h2v1h-2zM4 8h2v1h-2zM4 9h2v1h-2z",
  "check": "M9 1h1v1h-1zM8 2h2v1h-2zM7 3h2v1h-2zM0 4h1v1h-1zM6 4h2v1h-2zM0 5h2v1h-2zM5 5h2v1h-2zM1 6h2v1h-2zM4 6h2v1h-2zM2 7h3v1h-3zM3 8h1v1h-1z",
  "search": "M1 0h4v1h-4zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM5 3h1v1h-1zM0 4h1v1h-1zM5 4h1v1h-1zM1 5h4v1h-4zM5 6h2v1h-2zM6 7h2v1h-2zM7 8h2v1h-2zM8 9h2v1h-2z",
  "sync": "M2 0h5v1h-5zM1 1h1v1h-1zM7 1h1v1h-1zM9 1h1v1h-1zM0 2h1v1h-1zM8 2h2v1h-2zM0 3h1v1h-1zM7 3h3v1h-3zM0 6h3v1h-3zM9 6h1v1h-1zM0 7h2v1h-2zM9 7h1v1h-1zM0 8h1v1h-1zM2 8h1v1h-1zM8 8h1v1h-1zM3 9h5v1h-5z",
  "star": "M4 0h2v1h-2zM4 1h2v1h-2zM3 2h4v1h-4zM0 3h10v1h-10zM1 4h8v1h-8zM2 5h6v1h-6zM2 6h6v1h-6zM1 7h3v1h-3zM6 7h3v1h-3zM1 8h2v1h-2zM7 8h2v1h-2z",
  "moon": "M3 0h4v1h-4zM1 1h4v1h-4zM0 2h4v1h-4zM0 3h3v1h-3zM0 4h3v1h-3zM0 5h3v1h-3zM0 6h4v1h-4zM1 7h5v1h-5zM9 7h1v1h-1zM2 8h7v1h-7zM3 9h4v1h-4z",
  "sparkle": "M4 0h1v1h-1zM4 1h1v1h-1zM4 2h1v1h-1zM3 3h3v1h-3zM0 4h9v1h-9zM3 5h3v1h-3zM4 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1z",
  "gamepad": "M1 1h8v1h-8zM0 2h2v1h-2zM3 2h4v1h-4zM8 2h2v1h-2zM0 3h1v1h-1zM4 3h2v1h-2zM7 3h1v1h-1zM9 3h1v1h-1zM0 4h2v1h-2zM3 4h4v1h-4zM8 4h2v1h-2zM0 5h10v1h-10zM0 6h3v1h-3zM7 6h3v1h-3zM0 7h2v1h-2zM8 7h2v1h-2z",
  "download": "M4 0h2v1h-2zM4 1h2v1h-2zM4 2h2v1h-2zM2 3h6v1h-6zM3 4h4v1h-4zM4 5h2v1h-2zM0 7h1v1h-1zM9 7h1v1h-1zM0 8h1v1h-1zM9 8h1v1h-1zM0 9h10v1h-10z",
  "upload": "M4 0h2v1h-2zM3 1h4v1h-4zM2 2h6v1h-6zM4 3h2v1h-2zM4 4h2v1h-2zM4 5h2v1h-2zM0 7h1v1h-1zM9 7h1v1h-1zM0 8h1v1h-1zM9 8h1v1h-1zM0 9h10v1h-10z",
  "checkcircle": "M2 0h6v1h-6zM1 1h2v1h-2zM7 1h2v1h-2zM0 2h2v1h-2zM7 2h3v1h-3zM0 3h1v1h-1zM6 3h2v1h-2zM9 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM5 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h4v1h-4zM9 5h1v1h-1zM0 6h1v1h-1zM3 6h2v1h-2zM9 6h1v1h-1zM0 7h2v1h-2zM8 7h2v1h-2zM1 8h2v1h-2zM7 8h2v1h-2zM2 9h6v1h-6z",
  "trash": "M3 0h4v1h-4zM0 1h10v1h-10zM1 3h8v1h-8zM1 4h1v1h-1zM3 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM3 6h1v1h-1zM6 6h1v1h-1zM8 6h1v1h-1zM1 7h1v1h-1zM3 7h1v1h-1zM6 7h1v1h-1zM8 7h1v1h-1zM1 8h8v1h-8z",
  "alertcircle": "M2 0h6v1h-6zM1 1h2v1h-2zM7 1h2v1h-2zM0 2h2v1h-2zM4 2h2v1h-2zM8 2h2v1h-2zM0 3h1v1h-1zM4 3h2v1h-2zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h2v1h-2zM4 7h2v1h-2zM8 7h2v1h-2zM1 8h2v1h-2zM7 8h2v1h-2zM2 9h6v1h-6z",
  "alerttriangle": "M4 0h2v1h-2zM3 1h4v1h-4zM3 2h1v1h-1zM6 2h1v1h-1zM2 3h1v1h-1zM4 3h2v1h-2zM7 3h1v1h-1zM2 4h1v1h-1zM4 4h2v1h-2zM7 4h1v1h-1zM1 5h1v1h-1zM4 5h2v1h-2zM8 5h1v1h-1zM1 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM4 7h2v1h-2zM9 7h1v1h-1zM0 8h1v1h-1zM9 8h1v1h-1zM0 9h10v1h-10z",
  "target": "M2 0h6v1h-6zM1 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM3 2h4v1h-4zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM7 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM4 4h2v1h-2zM7 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h2v1h-2zM7 5h1v1h-1zM9 5h1v1h-1zM0 6h1v1h-1zM2 6h1v1h-1zM7 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM3 7h4v1h-4zM9 7h1v1h-1zM1 8h1v1h-1zM8 8h1v1h-1zM2 9h6v1h-6z",
  "monitor": "M0 0h10v1h-10zM0 1h1v1h-1zM9 1h1v1h-1zM0 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM0 5h10v1h-10zM4 6h2v1h-2zM4 7h2v1h-2zM2 8h6v1h-6z",
  "external": "M0 0h5v1h-5zM7 0h3v1h-3zM0 1h1v1h-1zM8 1h2v1h-2zM0 2h1v1h-1zM7 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM5 4h1v1h-1zM0 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM9 7h1v1h-1zM0 8h1v1h-1zM9 8h1v1h-1zM0 9h10v1h-10z",
  "book": "M1 1h2v1h-2zM7 1h2v1h-2zM0 2h1v1h-1zM3 2h1v1h-1zM6 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM4 3h2v1h-2zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM4 6h2v1h-2zM9 6h1v1h-1zM0 7h2v1h-2zM4 7h2v1h-2zM8 7h2v1h-2zM2 8h2v1h-2zM6 8h2v1h-2z",
  "bot": "M4 0h2v1h-2zM4 1h2v1h-2zM1 2h8v1h-8zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM2 4h2v1h-2zM6 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h2v1h-2zM6 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM3 7h4v1h-4zM9 7h1v1h-1zM1 8h8v1h-8z",
  "lock": "M3 0h4v1h-4zM2 1h1v1h-1zM7 1h1v1h-1zM2 2h1v1h-1zM7 2h1v1h-1zM2 3h1v1h-1zM7 3h1v1h-1zM0 4h10v1h-10zM0 5h10v1h-10zM0 6h4v1h-4zM6 6h4v1h-4zM0 7h4v1h-4zM6 7h4v1h-4zM0 8h10v1h-10zM0 9h10v1h-10z",
  "maximize": "M0 0h4v1h-4zM6 0h4v1h-4zM0 1h1v1h-1zM9 1h1v1h-1zM0 2h1v1h-1zM9 2h1v1h-1zM0 7h1v1h-1zM9 7h1v1h-1zM0 8h1v1h-1zM9 8h1v1h-1zM0 9h4v1h-4zM6 9h4v1h-4z",
  "save": "M0 0h9v1h-9zM0 1h1v1h-1zM2 1h5v1h-5zM8 1h2v1h-2zM0 2h1v1h-1zM2 2h5v1h-5zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h5v1h-5zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h6v1h-6zM9 5h1v1h-1zM0 6h1v1h-1zM2 6h1v1h-1zM7 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM2 7h1v1h-1zM7 7h1v1h-1zM9 7h1v1h-1zM0 8h1v1h-1zM2 8h1v1h-1zM7 8h1v1h-1zM9 8h1v1h-1zM0 9h10v1h-10z",
  "clock": "M2 0h6v1h-6zM1 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM9 4h1v1h-1zM0 5h1v1h-1zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM9 7h1v1h-1zM1 8h1v1h-1zM8 8h1v1h-1zM2 9h6v1h-6z",
  "edit": "M8 0h2v1h-2zM7 1h3v1h-3zM6 2h3v1h-3zM5 3h3v1h-3zM4 4h3v1h-3zM3 5h3v1h-3zM2 6h3v1h-3zM1 7h3v1h-3zM0 8h2v1h-2zM0 9h1v1h-1z",
  "palette": "M2 0h6v1h-6zM1 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM2 2h2v1h-2zM6 2h2v1h-2zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h2v1h-2zM6 3h2v1h-2zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM2 6h2v1h-2zM6 6h4v1h-4zM0 7h1v1h-1zM6 7h1v1h-1zM1 8h1v1h-1zM5 8h1v1h-1zM2 9h3v1h-3z",
  "logout": "M0 0h5v1h-5zM0 1h1v1h-1zM0 2h1v1h-1zM7 2h1v1h-1zM0 3h1v1h-1zM7 3h2v1h-2zM0 4h1v1h-1zM2 4h8v1h-8zM0 5h1v1h-1zM2 5h8v1h-8zM0 6h1v1h-1zM7 6h2v1h-2zM0 7h1v1h-1zM7 7h1v1h-1zM0 8h1v1h-1zM0 9h5v1h-5z",
  "login": "M5 0h5v1h-5zM9 1h1v1h-1zM3 2h1v1h-1zM9 2h1v1h-1zM3 3h2v1h-2zM9 3h1v1h-1zM0 4h8v1h-8zM9 4h1v1h-1zM0 5h8v1h-8zM9 5h1v1h-1zM3 6h2v1h-2zM9 6h1v1h-1zM3 7h1v1h-1zM9 7h1v1h-1zM9 8h1v1h-1zM5 9h5v1h-5z",
  "keyboard": "M0 1h10v1h-10zM0 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM2 7h6v1h-6zM9 7h1v1h-1zM0 8h10v1h-10z",
  "user": "M3 0h4v1h-4zM2 1h6v1h-6zM2 2h6v1h-6zM2 3h6v1h-6zM3 4h4v1h-4zM2 6h6v1h-6zM1 7h8v1h-8zM0 8h10v1h-10zM0 9h10v1h-10z",
  "zap": "M5 0h3v1h-3zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h6v1h-6zM1 4h6v1h-6zM4 5h3v1h-3zM3 6h3v1h-3zM2 7h3v1h-3zM1 8h2v1h-2zM0 9h1v1h-1z",
  "cloud": "M3 1h3v1h-3zM2 2h5v1h-5zM1 3h7v1h-7zM1 4h8v1h-8zM0 5h10v1h-10zM0 6h10v1h-10zM1 7h8v1h-8z",
  "play": "M2 0h1v1h-1zM2 1h2v1h-2zM2 2h3v1h-3zM2 3h4v1h-4zM2 4h5v1h-5zM2 5h5v1h-5zM2 6h4v1h-4zM2 7h3v1h-3zM2 8h2v1h-2zM2 9h1v1h-1z",
  "arrowleft": "M3 1h1v1h-1zM2 2h2v1h-2zM1 3h9v1h-9zM0 4h10v1h-10zM1 5h9v1h-9zM2 6h2v1h-2zM3 7h1v1h-1z",
  "arrowright": "M6 1h1v1h-1zM6 2h2v1h-2zM0 3h9v1h-9zM0 4h10v1h-10zM0 5h9v1h-9zM6 6h2v1h-2zM6 7h1v1h-1z",
  "chevronright": "M2 0h2v1h-2zM3 1h2v1h-2zM4 2h2v1h-2zM5 3h2v1h-2zM6 4h2v1h-2zM6 5h2v1h-2zM5 6h2v1h-2zM4 7h2v1h-2zM3 8h2v1h-2zM2 9h2v1h-2z",
  "chevrondown": "M0 2h2v1h-2zM8 2h2v1h-2zM1 3h2v1h-2zM7 3h2v1h-2zM2 4h2v1h-2zM6 4h2v1h-2zM3 5h4v1h-4zM4 6h2v1h-2z",
  "info": "M2 0h6v1h-6zM1 1h2v1h-2zM7 1h2v1h-2zM0 2h2v1h-2zM4 2h2v1h-2zM8 2h2v1h-2zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM4 6h2v1h-2zM9 6h1v1h-1zM0 7h2v1h-2zM4 7h2v1h-2zM8 7h2v1h-2zM1 8h2v1h-2zM7 8h2v1h-2zM2 9h6v1h-6z",
  "image": "M0 0h10v1h-10zM0 1h1v1h-1zM9 1h1v1h-1zM0 2h1v1h-1zM2 2h2v1h-2zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h2v1h-2zM9 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM3 5h1v1h-1zM6 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM2 6h8v1h-8zM0 7h10v1h-10z",
  "micoff": "M0 0h1v1h-1zM3 0h4v1h-4zM1 1h1v1h-1zM3 1h4v1h-4zM2 2h5v1h-5zM0 3h1v1h-1zM3 3h4v1h-4zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM9 4h1v1h-1zM0 5h2v1h-2zM6 5h1v1h-1zM8 5h2v1h-2zM1 6h6v1h-6zM8 6h1v1h-1zM4 7h2v1h-2zM9 7h1v1h-1zM4 8h2v1h-2zM2 9h6v1h-6z",
  "cpu": "M2 0h1v1h-1zM4 0h2v1h-2zM7 0h1v1h-1zM1 1h8v1h-8zM0 2h2v1h-2zM8 2h2v1h-2zM1 3h1v1h-1zM3 3h4v1h-4zM8 3h1v1h-1zM0 4h2v1h-2zM3 4h4v1h-4zM8 4h2v1h-2zM1 5h1v1h-1zM3 5h4v1h-4zM8 5h1v1h-1zM0 6h2v1h-2zM8 6h2v1h-2zM1 7h8v1h-8zM2 8h1v1h-1zM4 8h2v1h-2zM7 8h1v1h-1z"
};


function makePixelIcon(key: string, Fallback: LucideIcon, name: string): LucideIcon {
  const d = PATHS[key];
  const Comp = forwardRef<SVGSVGElement, LucideProps>((props, ref) => {
    const lofi = useLofi();
    if (!lofi) return <Fallback ref={ref} {...props} />;
    // strokeWidth / absoluteStrokeWidth have no meaning for pixel art; drop them.
    const { size = 24, color = 'currentColor', strokeWidth: _sw, absoluteStrokeWidth: _asw, className, children: _c, ...rest } = props;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        fill={color}
        shapeRendering="crispEdges"
        data-icon={key}
        aria-hidden={rest['aria-label'] ? undefined : true}
        className={className ? `qc-pixel-icon ${className}` : 'qc-pixel-icon'}
        {...rest}
      >
        <path d={d} />
      </svg>
    );
  });
  Comp.displayName = name;
  return Comp as unknown as LucideIcon;
}

export const Settings = makePixelIcon('gear', Lucide.Settings, 'Settings');
export const X = makePixelIcon('close', Lucide.X, 'X');
export const Trophy = makePixelIcon('trophy', Lucide.Trophy, 'Trophy');
export const Award = makePixelIcon('star', Lucide.Award, 'Award');
export const Plus = makePixelIcon('plus', Lucide.Plus, 'Plus');
export const Globe = makePixelIcon('globe', Lucide.Globe, 'Globe');
export const FileText = makePixelIcon('notes', Lucide.FileText, 'FileText');
export const Newspaper = makePixelIcon('notes', Lucide.Newspaper, 'Newspaper');
export const Camera = makePixelIcon('camera', Lucide.Camera, 'Camera');
export const Mic = makePixelIcon('mic', Lucide.Mic, 'Mic');
export const MicOff = makePixelIcon('micoff', Lucide.MicOff, 'MicOff');
export const Send = makePixelIcon('send', Lucide.Send, 'Send');
export const Volume2 = makePixelIcon('speaker', Lucide.Volume2, 'Volume2');
export const BookmarkPlus = makePixelIcon('bookmark', Lucide.BookmarkPlus, 'BookmarkPlus');
export const Bookmark = makePixelIcon('bookmark', Lucide.Bookmark, 'Bookmark');
export const Copy = makePixelIcon('copy', Lucide.Copy, 'Copy');
export const Pin = makePixelIcon('pin', Lucide.Pin, 'Pin');
export const Check = makePixelIcon('check', Lucide.Check, 'Check');
export const CheckCircle2 = makePixelIcon('checkcircle', Lucide.CheckCircle2, 'CheckCircle2');
export const Search = makePixelIcon('search', Lucide.Search, 'Search');
export const RefreshCw = makePixelIcon('sync', Lucide.RefreshCw, 'RefreshCw');
export const RotateCw = makePixelIcon('sync', Lucide.RotateCw, 'RotateCw');
export const Star = makePixelIcon('star', Lucide.Star, 'Star');
export const Moon = makePixelIcon('moon', Lucide.Moon, 'Moon');
export const Sparkles = makePixelIcon('sparkle', Lucide.Sparkles, 'Sparkles');
export const Gamepad2 = makePixelIcon('gamepad', Lucide.Gamepad2, 'Gamepad2');
export const Gamepad = makePixelIcon('gamepad', Lucide.Gamepad, 'Gamepad');
export const Download = makePixelIcon('download', Lucide.Download, 'Download');
export const Upload = makePixelIcon('upload', Lucide.Upload, 'Upload');
export const Trash2 = makePixelIcon('trash', Lucide.Trash2, 'Trash2');
export const AlertCircle = makePixelIcon('alertcircle', Lucide.AlertCircle, 'AlertCircle');
export const AlertTriangle = makePixelIcon('alerttriangle', Lucide.AlertTriangle, 'AlertTriangle');
export const Target = makePixelIcon('target', Lucide.Target, 'Target');
export const Monitor = makePixelIcon('monitor', Lucide.Monitor, 'Monitor');
export const ExternalLink = makePixelIcon('external', Lucide.ExternalLink, 'ExternalLink');
export const BookOpen = makePixelIcon('book', Lucide.BookOpen, 'BookOpen');
export const Bot = makePixelIcon('bot', Lucide.Bot, 'Bot');
export const Lock = makePixelIcon('lock', Lucide.Lock, 'Lock');
export const Maximize2 = makePixelIcon('maximize', Lucide.Maximize2, 'Maximize2');
export const Square = makePixelIcon('square', Lucide.Square, 'Square');
export const Save = makePixelIcon('save', Lucide.Save, 'Save');
export const Clock = makePixelIcon('clock', Lucide.Clock, 'Clock');
export const Edit3 = makePixelIcon('edit', Lucide.Edit3, 'Edit3');
export const Palette = makePixelIcon('palette', Lucide.Palette, 'Palette');
export const LogOut = makePixelIcon('logout', Lucide.LogOut, 'LogOut');
export const LogIn = makePixelIcon('login', Lucide.LogIn, 'LogIn');
export const Keyboard = makePixelIcon('keyboard', Lucide.Keyboard, 'Keyboard');
export const User = makePixelIcon('user', Lucide.User, 'User');
export const Zap = makePixelIcon('zap', Lucide.Zap, 'Zap');
export const Cloud = makePixelIcon('cloud', Lucide.Cloud, 'Cloud');
export const Play = makePixelIcon('play', Lucide.Play, 'Play');
export const ArrowLeft = makePixelIcon('arrowleft', Lucide.ArrowLeft, 'ArrowLeft');
export const ArrowRight = makePixelIcon('arrowright', Lucide.ArrowRight, 'ArrowRight');
export const ChevronRight = makePixelIcon('chevronright', Lucide.ChevronRight, 'ChevronRight');
export const ChevronDown = makePixelIcon('chevrondown', Lucide.ChevronDown, 'ChevronDown');
export const Info = makePixelIcon('info', Lucide.Info, 'Info');
export const Image = makePixelIcon('image', Lucide.Image, 'Image');
export const Cpu = makePixelIcon('cpu', Lucide.Cpu, 'Cpu');

// ---- Pixel medal (gold / silver / bronze) ----------------------------------------------------------------
const MEDAL_PATHS = {"R": "M1 0h2v1h-2zM7 0h2v1h-2zM2 1h2v1h-2zM6 1h2v1h-2zM3 2h4v1h-4z", "D": "M2 3h6v1h-6zM1 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM8 6h1v1h-1zM1 7h1v1h-1zM8 7h1v1h-1zM2 8h1v1h-1zM7 8h1v1h-1zM3 9h4v1h-4z", "C": "M2 4h6v1h-6zM2 5h1v1h-1zM4 5h4v1h-4zM2 6h1v1h-1zM4 6h4v1h-4zM2 7h6v1h-6zM3 8h4v1h-4z", "H": "M3 5h1v1h-1zM3 6h1v1h-1z"};
const TIER_COLORS: Record<'gold' | 'silver' | 'bronze', [string, string, string]> = {
  gold: ['#e8b84a', '#fff1b8', '#7a5a14'],
  silver: ['#c3c7d1', '#ffffff', '#5c6170'],
  bronze: ['#d08a5a', '#ffd2ae', '#6e3f22'],
};

export function PixelMedal({ tier, size = 20 }: { tier: 'gold' | 'silver' | 'bronze'; size?: number }) {
  const [coin, hi, dark] = TIER_COLORS[tier];
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true" className="flex-shrink-0">
      <path d={MEDAL_PATHS.R} fill="var(--accent-color)" />
      <path d={MEDAL_PATHS.D} fill={dark} />
      <path d={MEDAL_PATHS.C} fill={coin} />
      <path d={MEDAL_PATHS.H} fill={hi} />
    </svg>
  );
}

/** Three stepped, blinking pixel dots (the "thinking" indicator). Renders nothing in Classic style. */
export function PixelDots() {
  const lofi = useLofi();
  if (!lofi) return null;
  return (
    <span className="qc-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** A segmented "mana bar". Renders nothing in Classic style. */
export function ManaBar({ value, max, segments = 10, color = 'var(--accent-color)' }: { value: number; max: number; segments?: number; color?: string }) {
  const lofi = useLofi();
  if (!lofi) return null;
  const filled = max > 0 ? Math.max(0, Math.min(segments, Math.ceil((value / max) * segments))) : 0;
  return (
    <span className="qc-mana" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} style={{ background: i < filled ? color : 'rgba(255,255,255,0.12)' }} />
      ))}
    </span>
  );
}


// ---- Pixel trophy (achievements completion card) ---------------------------------------------------------
const TROPHY_PATHS = {"O": "M2 1h12v1h-12zM1 2h1v1h-1zM14 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM13 3h1v1h-1zM15 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM13 4h1v1h-1zM15 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM2 6h2v1h-2zM12 6h2v1h-2zM4 7h1v1h-1zM11 7h1v1h-1zM5 8h1v1h-1zM10 8h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM5 11h1v1h-1zM10 11h1v1h-1zM4 12h8v1h-8zM4 13h1v1h-1zM11 13h1v1h-1zM4 14h8v1h-8z", "G": "M2 2h1v1h-1zM4 2h10v1h-10zM1 3h1v1h-1zM4 3h9v1h-9zM14 3h1v1h-1zM1 4h1v1h-1zM4 4h9v1h-9zM14 4h1v1h-1zM2 5h1v1h-1zM5 5h7v1h-7zM13 5h1v1h-1zM5 6h7v1h-7zM5 7h6v1h-6zM6 8h4v1h-4zM7 9h2v1h-2zM7 10h2v1h-2zM6 11h4v1h-4z", "H": "M3 2h1v1h-1zM3 3h1v1h-1zM3 4h1v1h-1zM4 5h1v1h-1zM4 6h1v1h-1z", "D": "M5 13h6v1h-6z"};

export function PixelTrophy({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" className="flex-shrink-0">
      <path d={TROPHY_PATHS.O} fill="#5a3f10" />
      <path d={TROPHY_PATHS.G} fill="#e8b84a" />
      <path d={TROPHY_PATHS.H} fill="#fff1b8" />
      <path d={TROPHY_PATHS.D} fill="var(--accent-color)" />
    </svg>
  );
}
