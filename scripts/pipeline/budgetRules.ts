/**
 * The pipeline's spending rules (owner, Nov 1 2026), pure so tests can replay them.
 *
 * The daily cap is hard: nothing starts when its worst case could go over what's left. A page attempt that has used
 * PAGE_FAIL_STOP and is failing stops there, keeping the old content. Part of each day's room is kept for the walkthrough
 * pages, which run after the repairs (Nov 1 2026: the rebuilds used it all, and none were built).
 */
export const PAGE_FAIL_STOP = 0.75;
/** Kept from the day's room until the November work has run. */
export const WALK_RESERVE = 3;
/** The translation backfill's share of a day. */
export const TRANSLATE_SHARE = 0.5;
/** A step's own limit sits this far under what's left: its last call can run past the limit before it's refused. */
export const STEP_MARGIN = 0.15;
/** A whole rebuild isn't started with less (they measure $1.40-2.80; one cut off by the limit is wasted). */
export const BIG_STEP_MIN = 2.5;
/** Retried this long after a failed try. */
export const RETRY_DAYS = 7;
export const MAX_TRIES = 2;

/** The most one piece of November work should cost: a full re-verification measured $1.15, a lean page about $0.22. */
export const WORST_COST: Record<string, number> = { reverify: 1.25, walkthrough: 0.8, place: 0.6, mission: 0.6, epilogue: 0.6, stepPlaces: 0.3, conflicts: 0.3, glossary: 0.15 };
export const worstCost = (kind: string) => WORST_COST[kind] ?? 0.6;

export const stopPage = (used: number) => used >= PAGE_FAIL_STOP;

/** A failed try: comes back after RETRY_DAYS, until the second failure stops it. */
export function afterFailedTry<T extends { tries?: number; [k: string]: any }>(item: T, now = Date.now()): { stopped: boolean; item: T & { tries: number; retryAfter: number } } {
  const tries = (item.tries || 0) + 1;
  return { stopped: tries >= MAX_TRIES, item: { ...item, tries, retryAfter: now + RETRY_DAYS * 86_400_000 } };
}
