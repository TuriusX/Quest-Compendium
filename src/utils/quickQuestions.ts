/**
 * The quick questions: chips the player taps instead of typing. The chip's label (translated, i18n `quick.{id}`) is
 * what shows in the conversation; the app also sends the id, and the server adds the instruction below to the AI's
 * prompt, so a two-word chip gets a well-aimed answer (in the player's language, like any other).
 */
export type QuickId = 'next' | 'stuck' | 'missable' | 'fight' | 'choice' | 'leave' | 'keep' | 'hint' | 'after' | 'where' | 'hintInstead';

/** Always visible. */
export const QUICK_MAIN: QuickId[] = ['next', 'stuck', 'missable', 'fight'];
/** Behind the "More" chip. */
export const QUICK_MORE: QuickId[] = ['choice', 'leave', 'keep', 'hint'];
/** Under the latest answer ('where' only when on-screen markers are on and the answer is about a screenshot). */
export const QUICK_FOLLOW: QuickId[] = ['after', 'where', 'hintInstead'];

/** A gentle nudge, never the solution: shared by the two hint questions. */
const HINT_RULES =
  'Give only a hint: a gentle nudge in the right direction, never the solution. Point the player at what to pay ' +
  'attention to (a place worth a closer look, an object, a mechanic they may have overlooked, something a character ' +
  'said) instead of telling them what to do. Do not give step-by-step instructions, exact locations, the answer to a ' +
  'puzzle, enemy weak points or story spoilers, and place no on-screen markers. Keep it to one to three short ' +
  'sentences. If you list quest-log steps, keep them as vague as the hint (or leave them out). End by offering a ' +
  'bigger hint or the full answer if they are still stuck.';

/** What each quick question asks the AI to do (English; the answer follows the player's language setting). */
export const QUICK_PROMPTS: Record<QuickId, string> = {
  next:
    'The player asks what to do next. From the screenshot and what you know about where they are, give the single ' +
    'most useful thing to do next to move the game forward, concretely (where to go and what to do there), then at ' +
    'most two optional things worth doing nearby first. Never send them back to something they have already done.',
  stuck:
    'The player is stuck here. From the screenshot, work out what is blocking them (a puzzle, a locked door or path, ' +
    'a fight they keep losing, a missing item, key or ability) and say so in one line, then give the steps to get ' +
    'past it in order. If it needs something they may not have yet, say what it is and where to get it.',
  missable:
    'The player wants to know if anything here can be missed for good. Check where they are now for permanently ' +
    'missable items, quests, companions, achievements and choices that lock content out. For each one, say exactly ' +
    'where it is, the last step to get it, and what would lock it out. If nothing here is missable, say so plainly ' +
    'in one line instead of inventing something.',
  fight:
    'The player wants help with this fight. Name the enemy or boss, its dangerous attacks and its weaknesses, and ' +
    'give a clear plan: what to do right now (this turn, or this phase), what to avoid, and which skills, gear or ' +
    'items to use. If the screenshot does not show a fight, help them prepare for the next tough fight in this area.',
  choice:
    'The player is facing a choice (dialogue, quest decision, reward or path). Say briefly what each option leads ' +
    'to (rewards, companions, later consequences), then which one you would pick and why. Warn clearly about any ' +
    'option that locks content out. Avoid major story spoilers beyond what the choice needs.',
  leave:
    'The player is thinking about leaving this area. Say whether anything here becomes unreachable or missable once ' +
    'they leave (items, quests, companions, story moments, merchants). List what to do first, with where, or tell ' +
    'them plainly that it is safe to go and nothing is lost.',
  keep:
    'The player asks whether the item, gear or resource on screen (or the one they mean) is worth keeping or using. ' +
    'Say what it is good for, whether it is needed later (quests, crafting, upgrades, gifts), and your recommendation ' +
    'now: keep, use, equip, sell or upgrade, in one clear line, then a short reason.',
  hint: `The player asks for just a hint about what they are doing now, with no spoilers. ${HINT_RULES}`,
  after:
    'The player asks what comes after your last answer. Continue from it: the next step or objective once they have ' +
    'done what you said, in the same concrete style. Do not repeat what you already told them.',
  where:
    'The player asks you to show them on screen. Using this screenshot, place markers on the exact things your last ' +
    'answer was about (where to go, what to use, what to pick up, which enemy to target). Keep the text short: one ' +
    'line per marker saying what it is. If something from your last answer is not visible in this screenshot, say ' +
    'which and where to look for it.',
  hintInstead: `The player wants just a hint instead of the full answer to what they asked last. ${HINT_RULES}`,
};

export const isQuickId = (v: unknown): v is QuickId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUICK_PROMPTS, v);
