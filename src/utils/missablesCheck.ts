/**
 * Does a guide area's missable list look thin? (owner, Oct 31 2026: the quest log never presents the guide's list as
 * complete, and an area where it looks thin is flagged for the nightly improver to check against sources:
 * scripts/guides/autoImprove.ts missables().)
 *
 * Missables are the area's items marked missable, its missable checklist sections' lines ("Don't miss") and its
 * walkthrough's warnings. The area's size is what there is to find and do there: items, secrets, fights and
 * walkthrough steps. Thin: none in an area with 5+ things, at most one in 10+, or under 12% of them in 20+ (Elden
 * Ring's Volcano Manor had 0 for 11; Baldur's Gate 3's thinnest, The Waning Moon, 2 for 13, isn't flagged).
 * Used by the app (which areas players are in) and the server (which checks it again before flagging).
 */
type Entry = { missable?: boolean } | null | undefined;
export type MissablesPage = {
  items?: Entry[];
  secrets?: unknown[];
  fights?: unknown[];
  sections?: { title?: string; check?: boolean; entries?: unknown[] }[];
  walkthrough?: { warn?: string }[];
};

export function missableCount(page: MissablesPage | null | undefined): number {
  if (!page) return 0;
  const items = (page.items || []).filter((e) => !!e?.missable).length;
  const lines = (page.sections || []).filter((x) => x?.check && /miss/i.test(String(x.title || ''))).reduce((n, x) => n + (x.entries?.length || 0), 0);
  const warns = (page.walkthrough || []).filter((w) => !!w?.warn).length;
  return items + lines + warns;
}

export function areaSize(page: MissablesPage | null | undefined): number {
  if (!page) return 0;
  return (page.items?.length || 0) + (page.secrets?.length || 0) + (page.fights?.length || 0) + (page.walkthrough?.length || 0);
}

export function missablesThin(page: MissablesPage | null | undefined): boolean {
  const size = areaSize(page);
  const n = missableCount(page);
  return (size >= 5 && n === 0) || (size >= 10 && n <= 1) || (size >= 20 && n / size < 0.12);
}
