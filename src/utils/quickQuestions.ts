/**
 * The quick questions: chips the player taps instead of typing. The chip's label (translated, i18n `quick.{id}`) is
 * what shows in the conversation; the app also sends the id, and the server adds the instruction below to the AI's
 * prompt, so a two-word chip gets a well-aimed answer (in the player's language, like any other).
 */
export type QuickId = 'next' | 'stuck' | 'missable' | 'fight' | 'gear' | 'choice' | 'leave' | 'keep' | 'after' | 'where';

/** Every question a player can start with (the controller's list, and the chips' "More"), in this order. */
export const QUICK_MAIN: QuickId[] = ['next', 'missable', 'fight', 'gear', 'stuck'];
export const QUICK_MORE: QuickId[] = ['choice', 'leave', 'keep'];

/** The label's i18n key: quick.{id}, except where the wording changed after it was translated. */
const LABEL_KEYS: Partial<Record<QuickId, string>> = { missable: 'quick.canMiss', fight: 'quick.beat' };
export const quickLabelKey = (id: QuickId): string => LABEL_KEYS[id] ?? `quick.${id}`;

/**
 * The chips that fit where the player is: before the first question three starters ("How do I beat this?" in a
 * fight, else "Best gear for where I am"); after an answer two follow-ups (in a fight: beat this, then what's after;
 * else what's after, then "Show me where on screen" when it can, else anything missable). The rest are behind "More".
 * (No hint questions since Nov 20 2026, owner: answers go straight to the full answer.)
 */
export function quickChips(o: { asked: boolean; combat?: boolean; canShowWhere?: boolean }): { shown: QuickId[]; extra: QuickId[] } {
  const shown: QuickId[] = !o.asked
    ? ['next', 'missable', o.combat ? 'fight' : 'gear']
    : o.combat
      ? ['fight', 'after']
      : ['after', o.canShowWhere ? 'where' : 'missable'];
  const extra = [...QUICK_MAIN, ...QUICK_MORE].filter((id) => !shown.includes(id));
  return { shown, extra };
}

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
  gear:
    'The player asks for the best gear for where they are now. From the screenshot and where they are in the game and ' +
    'the story, recommend the best weapons, armor, accessories or upgrades they can realistically get now or nearby, ' +
    'with where and how to get each, then what to aim for next. Stay at their stage of the game: nothing they cannot ' +
    'reach yet, and no story spoilers beyond where they are.',
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
  after:
    'The player asks what comes after your last answer. Continue from it: the next step or objective once they have ' +
    'done what you said, in the same concrete style. Do not repeat what you already told them.',
  where:
    'The player asks you to show them on screen. Using this screenshot, place markers on the exact things your last ' +
    'answer was about (where to go, what to use, what to pick up, which enemy to target). Keep the text short: one ' +
    'line per marker saying what it is. If something from your last answer is not visible in this screenshot, say ' +
    'which and where to look for it.',
};

export const isQuickId = (v: unknown): v is QuickId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUICK_PROMPTS, v);

/**
 * The controller's quick questions list (the quick menu's "Quick questions", over the game and in the panel), fitted
 * to the moment (owner, Nov 17 2026): help with the quest log's Now goal first when there is one, then the chips in the
 * order they'd show (in a fight, beating it first; after an answer, what comes next), then the rest. "Show me where on
 * screen" needs the last screenshot, so it isn't in the list.
 */
export function padQuestionList(o: { goal?: string; combat?: boolean; asked?: boolean }): ('goal' | QuickId)[] {
  const { shown, extra } = quickChips({ asked: !!o.asked, combat: !!o.combat, canShowWhere: false });
  const ids = [...shown, ...extra].filter((id) => id !== 'where');
  return [...(o.goal && o.goal.trim() ? (['goal'] as const) : []), ...ids];
}
