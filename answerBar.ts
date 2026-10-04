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
  Fewer is better: 0 to 3 is normal, and 0 is fine when nothing is worth it. None of this applies to markers in a
  fight: there [COMBAT] asks for every enemy that matters plus the key positions (usually 5 to 8 markers).`;

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

/** On-screen markers per answer: 5 normally; a fight gets every important enemy and the key positions. */
export const MARKER_LIMIT = 5;
export const COMBAT_MARKER_LIMIT = 8;

/**
 * Combat: when the screenshot shows a fight in progress, the answer is a battle plan, markers point at the enemies (in
 * kill order) and the positions or objects that win the fight, and the quest-log steps are the plan. The "easy to
 * miss" bar doesn't apply to combat markers. The model marks a combat answer with <qc-combat/> (extractCombat).
 */
export function combatRules(markers: boolean): string {
  return `

[COMBAT]
If the screenshot shows a fight in progress (turn-order or initiative portraits, an End Turn or similar button, a round
or turn counter, health bars over enemies, a combat log), answer as a battle plan:
- First: whose turn it is now and exactly what they should do this turn (the action, its target, where to stand), using
  the game's own action names and inputs.
- Then: the kill order (which enemy first, and why) and the one or two tactics that win this fight (high ground, a
  choke point, a hazard or explosive to use, an ability or item to save for this).
- Use the guide notes for this area's fights and enemies (their abilities, weaknesses, positions, rewards) when they
  match what's on screen.${markers ? `
- Markers: the "easy to miss" bar does not apply in combat. Mark up to ${COMBAT_MARKER_LIMIT}; a fight with several
  enemies usually needs 5 to ${COMBAT_MARKER_LIMIT}, not just the top targets:
  - every important enemy visible, ranked or not (one marker per enemy that matters; not each identical weakling in a
    big group), category "enemy": "label" is the enemy in 1-2 words, "note" a threat tag of 2-5 words that doesn't
    repeat the label ("Archer" / "shoots the defenders", "Worg" / "bite knocks prone", "Za'Krug" / "heavy axe hits");
  - "rank": 1, 2, 3 on the top 2-3 targets in kill order (1 = kill first); no "rank" on the rest;
  - 1 to 3 key positions and objects that the plan uses, category "action": "label" is the action with its input,
    "note" why ("Jump (Z) here" / "high ground +2", "Explosive barrel" / "throw into the group", "Chokepoint" / "hold
    the gate here"). Every place to stand or object to use that a battle-plan step names gets its own marker on that
    exact spot (a step "keep your archers on the ridge" means a marker on the ridge).
  List the ranked enemies first, then the other enemies, then the positions.` : ''}
- Quest-log steps (<qc-steps>): the battle plan: the priority targets in order ("Kill the goblin archer on the
  palisade first"), then the one or two key tactics. They replace the earlier steps.
- Add this on its own line at the very end (removed before the player sees it), naming the fight and the enemies on
  screen as the game does:
<qc-combat>{"fight": "<a short name for this fight, e.g. Goblin raid on the grove gate>", "enemies": ["<named enemies and enemy types on screen, e.g. Za'Krug, Goblin archer>"]}</qc-combat>
  Leave it out when no fight is happening, and when the fight is over (no turn order, no End Turn button: the
  battle-end screen, looting, walking on): then answer and write steps as usual.`;
}

/**
 * Pull the combat block out of an answer (always removed from the text): <qc-combat>{"fight", "enemies"}</qc-combat>,
 * or the bare <qc-combat/> flag. The fight and enemies name it for the missing-fight check (missingFights.ts).
 */
export function extractCombat(text: string): { text: string; combat: boolean; fight?: string; enemies?: string[] } {
  let combat = false;
  let fight: string | undefined;
  let enemies: string[] | undefined;
  const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const re = /(?:```[a-z]*\s*)?<qc-combat\s*\/>(?:\s*```)?|(?:```[a-z]*\s*)?<qc-combat>([\s\S]*?)<\/qc-combat>(?:\s*```)?|(?:```[a-z]*\s*)?<qc-combat>(?:\s*```)?/gi;
  const cleaned = String(text || '').replace(re, (_m, body) => {
    combat = true;
    if (body && body.trim()) {
      try {
        const j = JSON.parse(String(body).trim());
        fight = str(j?.fight, 120) || undefined;
        enemies = Array.isArray(j?.enemies) ? j.enemies.map((e: unknown) => str(e, 60)).filter(Boolean).slice(0, 8) : undefined;
      } catch {
        /* the flag still counts */
      }
    }
    return '';
  });
  return { text: combat ? cleaned.replace(/\n{3,}/g, '\n\n').trimEnd() : cleaned, combat, ...(fight ? { fight } : {}), ...(enemies?.length ? { enemies } : {}) };
}

/**
 * Cut text for display without breaking a word: at the last space before the limit, with "…". Text within the limit
 * is returned whole (the quest log wraps it).
 */
export function clipWords(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}
