/**
 * Search Console numbers for every guide page (not only the top 50 the summary keeps): impressions, clicks and average
 * position over the last 28 days, saved weekly by scripts/pipeline/searchConsole.ts in system/searchConsolePages.
 *
 * Read by the rebuild protections (rebuildGuard.ts): a page people find in Google is never replaced or retired by a
 * rebuild without a check. Kept apart from system/searchConsole so the summary doc stays small, and compact
 * ("key/slug": [impressions, clicks, position], only pages with impressions) so it stays well under Firestore's 1 MB.
 */
import { db, liveKey } from './common';

export const PAGE_STATS_DOC = 'searchConsolePages';
/** Room for the map inside Firestore's 1 MiB document limit, with the doc's other fields and overhead to spare. */
const MAX_BYTES = 900_000;

export type PageStat = { impressions: number; clicks: number; position: number };
export type PageStatMap = Record<string, [number, number, number]>;

const pageId = (key: string, slug: string) => `${liveKey(key)}/${slug}`;

/**
 * Every page with impressions as "key/slug" → [impressions, clicks, position], most impressions first. If the map ever
 * grew past the size limit, the pages with the fewest impressions are the ones left out.
 */
export function compactPageStats(pages: { key: string; slug: string; impressions: number; clicks: number; position: number }[], maxBytes = MAX_BYTES): PageStatMap {
  const out: PageStatMap = {};
  let bytes = 0;
  for (const p of [...pages].filter((p) => p.impressions > 0).sort((a, b) => b.impressions - a.impressions)) {
    const id = pageId(p.key, p.slug);
    const v: [number, number, number] = [p.impressions, p.clicks, Math.round(p.position * 10) / 10];
    // Firestore counts a map field's name plus its value; a number is 8 bytes, the array a little more.
    const size = id.length + 1 + 3 * 8 + 8;
    if (bytes + size > maxBytes) break;
    out[id] = v;
    bytes += size;
  }
  return out;
}

/** One page's numbers from the map (null when it had no impressions in the window, or the map is missing). */
export function statOf(map: PageStatMap | null | undefined, key: string, slug: string): PageStat | null {
  const v = map?.[pageId(key, slug)];
  return Array.isArray(v) ? { impressions: Number(v[0]) || 0, clicks: Number(v[1]) || 0, position: Number(v[2]) || 0 } : null;
}

let cache: Promise<PageStatMap> | null = null;
/** The stored map (read once per run). An unreadable or missing doc is an empty map: no page counts as found. */
export function loadPageStats(): Promise<PageStatMap> {
  cache ||= db().collection('system').doc(PAGE_STATS_DOC).get().then((d) => (d.data()?.pages || {}) as PageStatMap).catch(() => ({}));
  return cache;
}

/** A page's impressions in the last Search Console window (0 when none were recorded). */
export async function pageImpressions(key: string, slug: string): Promise<number> {
  return statOf(await loadPageStats(), key, slug)?.impressions || 0;
}
