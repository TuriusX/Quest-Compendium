/**
 * The pipeline's spending rules (owner, Nov 1 2026), pure so tests can replay them.
 *
 * The daily cap is hard: nothing starts when its worst case could go over what's left. A page attempt that has used
 * PAGE_FAIL_STOP and is failing stops there, keeping the old content.
 *
 * The cap rolls (owner, Nov 1 2026): each day gets what's left of the month divided by the days left, so unused days carry
 * over and the month never runs out early. Within a day: upkeep first (up to UPKEEP_SHARE), then the walkthrough pages, then
 * translations, then rebuilds and repairs with whatever is left.
 */
export const PAGE_FAIL_STOP = 0.75;
/** The same for a walkthrough page, which researches lean (owner, Nov 3 2026; the first night's failing page stopped by itself at $0.45). */
export const WALK_FAIL_STOP = 0.65;
/** Upkeep's share of the budget: player corrections, suggestions, improvements and re-verification together. */
export const UPKEEP_SHARE = 0.2;
/** The translation backfill's share of a day. */
export const TRANSLATE_SHARE = 0.5;
/** A step's own limit sits this far under what's left: its last call can run past the limit before it's refused. */
export const STEP_MARGIN = 0.15;
/** A whole rebuild's worst case: it isn't started with less (they measure $1.40-2.79; one cut off by the limit is wasted). */
export const BIG_STEP_MIN = 3;
/** Retried this long after a failed try. */
export const RETRY_DAYS = 7;
export const MAX_TRIES = 2;

/** The most one piece of November work should cost: a full re-verification measured $1.15; a walkthrough page $0.08-0.16 live and $0.45 failing (Nov 3 2026). */
export const WORST_COST: Record<string, number> = { reverify: 1.25, walkthrough: 0.7, place: 0.6, mission: 0.6, epilogue: 0.6, stepPlaces: 0.3, conflicts: 0.3, glossary: 0.15 };
export const worstCost = (kind: string) => WORST_COST[kind] ?? 0.6;
/**
 * A walkthrough page starts with this much left of its lane (owner, Nov 3 2026, from the first night's real costs: the
 * dearest live page was $0.16; as many pages as the cap allows). The lane
 * keeps translations' share back, so a page's worst case still fits the day's cap; a dear page takes from that night's
 * translations, never from the cap.
 */
export const WALK_START = Math.round((WORST_COST.walkthrough - TRANSLATE_SHARE) * 100) / 100;
export const startNeed = (kind: string) => (kind === 'walkthrough' ? WALK_START : worstCost(kind));

export const stopPage = (used: number, lean = false) => used >= (lean ? WALK_FAIL_STOP : PAGE_FAIL_STOP);

/** Today's cap: what's left of the month over the days left, today included. */
export function rollingDayCap(monthCap: number, spentBeforeToday: number, daysLeft: number) {
  return Math.max(0, monthCap - Math.max(0, spentBeforeToday)) / Math.max(1, daysLeft);
}

/**
 * What upkeep may still spend today: its share of today's cap, or its share of the month so far when that's more. One
 * re-verification costs more than a day's share, so what upkeep doesn't use builds up until one fits.
 */
export function upkeepRoom(u: { dayCap: number; monthCap: number; spentMonth: number; spentToday: number; dayOfMonth: number; daysInMonth: number }) {
  return Math.max(u.dayCap * UPKEEP_SHARE - u.spentToday, (u.monthCap * UPKEEP_SHARE * u.dayOfMonth) / u.daysInMonth - u.spentMonth);
}

/**
 * A guide's walkthrough pages since its last check: fewer than 7 of 10 live pauses that guide. Four not live already settles
 * it, so the rest aren't paid for. A page that errored before spending anything (a daily limit) doesn't count.
 */
export function guideWalkCheck<T extends { status: string; dollars?: number; at: number }>(rows: T[]): { verdict: 'wait' | 'ok' | 'pause'; live: number; tried: number; through: number } {
  const ten = rows.filter((x) => x.status !== 'error' || Number(x.dollars || 0) > 0).slice(0, 10);
  const live = ten.filter((x) => x.status === 'live').length;
  const verdict = ten.length - live >= 4 ? 'pause' : ten.length === 10 ? 'ok' : 'wait';
  return { verdict, live, tried: ten.length, through: ten[ten.length - 1]?.at || 0 };
}

/** A failed try: comes back after RETRY_DAYS, until the second failure stops it. */
export function afterFailedTry<T extends { tries?: number; [k: string]: any }>(item: T, now = Date.now()): { stopped: boolean; item: T & { tries: number; retryAfter: number } } {
  const tries = (item.tries || 0) + 1;
  return { stopped: tries >= MAX_TRIES, item: { ...item, tries, retryAfter: now + RETRY_DAYS * 86_400_000 } };
}
