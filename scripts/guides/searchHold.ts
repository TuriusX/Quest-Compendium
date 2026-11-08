/**
 * Weak pages kept out of Google until they're verified (owner, Nov 7 2026, roadmap item 27). A live area page is held
 * (served with "noindex, follow" and left out of the sitemap; still on the site, in its guide's lists, search and the
 * apps) while all of these hold:
 *
 *   - it is unchecked: written without sources (verified === false);
 *   - it had fewer than HOLD_IMPRESSIONS (10) Search Console impressions in the last 28-day window
 *     (system/searchConsolePages, all languages of the page together);
 *   - it was live for that whole window (first seen no later than HOLD_WINDOW_SLACK days after the window starts);
 *   - it has been live at least HOLD_MIN_DAYS (42): a new guide (a remake, a launch-day guide) is never held.
 *
 * It comes back into the sitemap and the index as soon as a rebuild verifies it. Unchecked pages that do get
 * impressions are never held: they go to the front of the re-verification queue instead (novemberWork.ts
 * --front-traffic). The rule is worked out at every publish from the latest weekly Search Console pull; when that pull
 * is missing nothing is held.
 *
 * When each page was first live: system/searchHold.firstSeen ("key/slug" -> ms). Seeded Nov 7 2026 from the site's git
 * history (pages committed from Sep 29 to Oct 6) and the seeding day for the rest; publish.ts adds new pages the
 * first night they are live. publish.ts also saves the night's count (system/searchHold.held) for Monday's summary.
 */
import { db } from './common';
import { loadPageStats } from './pageStats';

export const HOLD_IMPRESSIONS = 10;
export const HOLD_MIN_DAYS = 42;
export const HOLD_WINDOW_SLACK = 3;
const DAY = 86_400_000;
export const HOLD_DOC = () => db().collection('system').doc('searchHold');

export type HoldState = { firstSeen: Record<string, number>; windowStart: number; stats: Record<string, [number, number, number]> };

/** What the rule needs: when pages were first live, and the latest Search Console window and numbers. */
export async function loadHoldState(): Promise<HoldState> {
  const [h, sc] = await Promise.all([HOLD_DOC().get(), db().collection('system').doc('searchConsolePages').get()]);
  const range: any = (sc.data() as any)?.range || {};
  const windowStart = range.start ? Date.parse(`${range.start}T00:00:00Z`) : 0;
  return { firstSeen: ((h.data() as any)?.firstSeen || {}) as Record<string, number>, windowStart, stats: windowStart ? await loadPageStats() : {} };
}

/** Is this live area page held out of the index tonight? */
export function isHeld(s: HoldState, key: string, slug: string, verified: unknown, now = Date.now()): boolean {
  if (verified !== false || !s.windowStart) return false;
  const first = Number(s.firstSeen[`${key}/${slug}`] || 0);
  if (!first || first > s.windowStart + HOLD_WINDOW_SLACK * DAY || now - first < HOLD_MIN_DAYS * DAY) return false;
  return (Number(s.stats[`${key}/${slug}`]?.[0]) || 0) < HOLD_IMPRESSIONS;
}
