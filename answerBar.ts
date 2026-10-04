/**
 * What's worth pointing out: the bar an answer's on-screen markers (<qc-points>) and quest-log steps (<qc-steps>) must
 * clear. Players act on both, and a marker or step for something obvious is noise that buries what matters.
 *
 * The prompt asks for it (WORTH_POINTING_OUT); the server also drops the obvious misses the model still makes
 * (isTrivialMarker, isFillerStep), so a corpse in plain view with minor supplies and gold never becomes a marker.
 */

/** The bar, as the model is told it (shared by the markers' and the steps' instructions). */
export const WORTH_POINTING_OUT = `Only point out something the player could easily miss or that really matters:
  - hidden or easy to overlook (a switch in the shadows, a chest behind the waterfall),
  - missable (gone for good once they move on, a one-time event),
  - required for a quest, a puzzle or a choice,
  - notably valuable (rare or unique gear, a big reward).
  Never point out obvious things in plain view with trivial contents (for example a corpse right in front of the
  player holding minor supplies and gold), routine loot, or things the game already highlights for them.
  Fewer is better: 0 to 3 is normal, and 0 is fine when nothing is worth it.`;

const BODY_OR_CONTAINER = /\b(corpse|body|bodies|remains|dead|cadaver|skeleton|crate|barrel|sack|bag|pouch|pot|urn|chest|box|basket|loot)\b/i;
const LOW_VALUE = /\b(minor|some|a few|small amount|bit of|gold|coins?|supplies|random loot|junk|common|basic|mundane|trash|consumables?|camp supplies|miscellaneous|misc|odds and ends|trinkets?)\b/i;
const HIGH_VALUE = /\b(rare|very rare|unique|legendary|epic|key|quest|missable|hidden|secret|required|needed|important|valuable|best|powerful|story|letter|note|map|journal|diary)\b/i;
const MATTERS = new Set(['key', 'quest', 'secret', 'danger', 'enemy', 'character', 'action', 'place']);

/**
 * An obvious, low-value marker: a body or container whose contents are routine (minor supplies, some gold, random
 * loot), not missable, and nothing about it that matters. Kept conservative: anything rare, required, hidden or
 * otherwise important stays.
 */
export function isTrivialMarker(p: { label?: string; note?: string; detail?: string; category?: string; missable?: boolean }): boolean {
  if (p.missable) return false;
  if (p.category && MATTERS.has(p.category)) return false;
  const text = [p.label, p.note, p.detail].filter(Boolean).join(' ');
  if (!text || HIGH_VALUE.test(text)) return false;
  return BODY_OR_CONTAINER.test(text) && LOW_VALUE.test(text);
}

const FILLER = /^(explore|look around|search (the|this) area|check (the|your) surroundings|be careful|stay alert|keep exploring|have fun|loot everything|grab everything|take your time|look for loot|loot the area|search everything)\b/i;

/** A quest-log step that says nothing specific ("Explore the area", "Be careful"): left off the quest log. */
export function isFillerStep(text: string): boolean {
  const t = String(text || '').trim();
  return FILLER.test(t) && t.split(/\s+/).length <= 6;
}

/**
 * Precision: the exact action, input and spot. Players follow these to the letter, so "climb the cliff" (when the game
 * means Jump) or "go over there" leaves them stuck.
 */
export const PRECISE_ACTIONS = `Be exact about the action and the spot:
  - Name the game's own action and its input when it has one (Jump (Z), Shove, Throw, Dip, Sneak, a named spell or
    item), never a generic verb like "climb", "go" or "get past".
  - Place the spot by the landmarks the player can see ("the rock ledge right of the burning wreck"), not "over there".
  - If the screenshot shows the game refusing a move ("Can't reach destination", a greyed-out path), say what to do
    instead (usually Jump, or another route).`;

/** A vague verb at the start of a step or marker label, where the game's own action would be exact. */
const CLIMB_LIKE = /^(climb|clamber|scale|go up|get up|head up|make your way up)\b(\s+up\b)?/i;

/**
 * Sharpen a step or marker label the model wrote vaguely: when the answer itself says to jump, a leading "Climb…" (or
 * "Scale…", "Go up…") becomes "Jump up…". Returns the text unchanged otherwise, and whether it changed (the server logs it).
 */
export function sharpenAction(text: string, answerText: string): { text: string; changed: boolean } {
  const t = String(text || '');
  if (!/\bjump/i.test(String(answerText || '')) || !CLIMB_LIKE.test(t)) return { text: t, changed: false };
  return { text: t.replace(CLIMB_LIKE, 'Jump up'), changed: true };
}
