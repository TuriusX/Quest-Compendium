import { useEffect, useState } from 'react';

/**
 * Small game pictures, sharp and instant (owner, Oct 27 2026): the box art on the compact card, the running game's
 * picture, search results. Each asks for the largest size its source has (IGDB's cover_big_2x / 720p, Steam's
 * library portrait or header, never a thumbnail) and the browser scales it down, so it stays crisp at 150% and above.
 * The first copy is kept on this computer (IndexedDB, which also works for the desktop app's file:// page), so the
 * next time it shows at once. A picture that doesn't exist is remembered for a day and the next one is tried; with
 * none, the caller shows its own fallback (initials, an icon).
 */

const IGDB = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+(\/[^/]+)$/i;

/** An IGDB picture at its largest useful size: covers at cover_big_2x (528 × 704), the rest at 720p (1280 × 720). */
export function sharpIgdb(url: string | undefined | null, kind: 'cover' | 'wide'): string {
  const m = String(url || '').match(IGDB);
  if (!m) return url || '';
  return `${m[1]}t_${kind === 'cover' ? 'cover_big_2x' : '720p'}${m[2]}`;
}

const steamBase = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`;
/** Steam's portrait library art (600 × 900) and its header (460 × 215). */
export const steamCover = (appId?: number) => (appId ? `${steamBase(appId)}/library_600x900.jpg` : '');
export const steamHeader = (appId?: number) => (appId ? `${steamBase(appId)}/header.jpg` : '');

/** A Steam store picture's app id (search results come with Steam's 120 px capsule). */
export const steamAppIdOf = (url?: string | null): number => Number(String(url || '').match(/\/apps\/(\d+)\//)?.[1]) || 0;

// ---- The local copy ------------------------------------------------------------------------------------------------

const DB = 'qc-art';
const STORE = 'img';
const MAX = 300;
const MISSING_KEY = 'qc-art-missing';
const DAY = 86_400_000;
const memory = new Map<string, string>(); // url → object URL, this session
const pending = new Map<string, Promise<string | null>>();

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbp;
}
const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> =>
  db().then((d) => new Promise<T | null>((resolve) => {
    if (!d) return resolve(null);
    try {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));

const readMissing = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(MISSING_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const isMissing = (url: string) => (readMissing()[url] || 0) > Date.now() - DAY;
function markMissing(url: string) {
  try {
    const m = readMissing();
    m[url] = Date.now();
    const keep = Object.entries(m).filter(([, t]) => t > Date.now() - DAY).slice(-200);
    localStorage.setItem(MISSING_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {}
}

/** Keeps the newest MAX pictures. */
async function trim() {
  const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[] | null;
  if (!keys || keys.length <= MAX) return;
  const rows = await Promise.all(keys.map(async (k) => ({ k, at: ((await tx('readonly', (s) => s.get(k))) as any)?.at || 0 })));
  for (const { k } of rows.sort((a, b) => a.at - b.at).slice(0, keys.length - MAX)) await tx('readwrite', (s) => s.delete(k));
}

/** The picture as a local object URL (from this computer's copy, else downloaded and kept), or null if it can't load. */
export function loadArt(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const have = memory.get(url);
  if (have) return Promise.resolve(have);
  if (isMissing(url)) return Promise.resolve(null);
  const busy = pending.get(url);
  if (busy) return busy;
  const p = (async () => {
    const kept = (await tx('readonly', (s) => s.get(url))) as { blob: Blob; at: number } | null;
    let blob = kept?.blob || null;
    if (!blob) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) markMissing(url);
          return null;
        }
        blob = await res.blob();
        if (!/^image\//.test(blob.type) || blob.size < 200) { markMissing(url); return null; }
        void tx('readwrite', (s) => s.put({ blob, at: Date.now() }, url)).then(trim);
      } catch {
        return null; // offline: tried again next time
      }
    }
    const obj = URL.createObjectURL(blob);
    memory.set(url, obj);
    return obj;
  })().finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

/**
 * The first of these pictures that loads, as a local object URL ('' while loading, null when none does). Already
 * kept pictures show on the first render.
 */
export function useArt(candidates: (string | undefined | null)[]): string | null {
  const list = candidates.filter(Boolean) as string[];
  const key = list.join('|');
  const [src, setSrc] = useState<string | null>(() => list.map((u) => memory.get(u)).find(Boolean) || '');
  useEffect(() => {
    let live = true;
    // A picture already here shows meanwhile; the best one that loads (first in the list) replaces it.
    const ready = list.map((u) => memory.get(u)).find(Boolean);
    setSrc(ready || '');
    (async () => {
      for (const u of list) {
        const got = await loadArt(u);
        if (!live) return;
        if (got) { setSrc(got); return; }
      }
      if (live) setSrc(null);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return src;
}
