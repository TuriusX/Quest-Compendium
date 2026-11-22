/**
 * Pop-up summaries (owner, Nov 19 2026: "they are meant to give the player information quickly so they can move on
 * quickly with completing the task that led to their question"). A question asked while a game runs pops up over the
 * game for about half a minute (electron/answerCard.cjs); the card shows a short summary of what to do, read aloud,
 * instead of the start of the answer. The full answer stays in the panel.
 *
 * The summary is its own small call (POST /api/card-summary), made from the finished answer. The answer's own call is
 * never told about it (owner, Nov 19 2026: summaries must not change the main answer, e.g. by nudging it shorter).
 */

/**
 * The summarizer's instructions (owner, Nov 22 2026: blind test of 38 real answers, this on Gemini 4 Hydrogen low was
 * picked most, 14 of 35, against 12 for the old instructions on GPT-6 Luna and 9 for these on Luna): the answer to
 * what they asked first, then the action, in the answer's own voice.
 */
export const CARD_SUMMARY_PROMPT = `You write the pop-up summary for a video game helper app. The player asked a question while playing; the answer
below pops up over the game for about half a minute, and your summary is shown there and read aloud, so the player
gets what they need in a few seconds and goes back to playing. Say it the way the answer's author would say it out
loud to a friend sitting next to them.

- First, the answer to what they asked, in one plain sentence: the pick when they asked which or what to choose
  ("Take Counterspell."), yes or no when they asked whether, the place when they asked where, who or what it is when
  they asked who or what, the next step when they asked what to do next.
- Then, only if the answer gives one, the action to take right now and the one thing to watch for. At most 45 words in all.
- If the answer names something worth getting right now that is easy to miss or gone for good after this moment, keep
  it in one more short sentence, even past 45 words (at most 60 in all).
- If the player reacted to something (a death, a win, a mistake), you may open with a few words for it, as the answer does.
- Only what the answer says: never add facts, names, numbers or places. When the answer isn't sure, neither are you.
- Spoken, not written: no lists, headings, markdown, links, citations or tags; no "the answer says". The same language as the answer.
- Reply with the summary only. When the answer has nothing to say or do (an error, a refusal, only a question back), reply with nothing.`;
/** The summarizer: Hydrogen low, as the answers (its thinking needs room: 400 tokens came back blank). */
export const CARD_SUMMARY_MODEL = 'gemini-4-hydrogen';
export const CARD_SUMMARY_MAX_TOKENS = 3000;

/**
 * Immersive mode (owner, Nov 20 2026, idea #8): the answer is spoken by a narrator from the game's world, and the
 * pop-up keeps that voice. The action itself stays plain and exact; only the turn of phrase is in character.
 */
export const CARD_SUMMARY_IMMERSIVE = `

This player uses immersive mode: the answer is told by a narrator who lives in the game's world. Write the summary in
that same narrator's voice (their manner and a turn of phrase or two, as they'd say it at the player's side), while the
action, places, names and numbers stay exactly as plain and correct as the rules above require. Still within the same word limits.`;

/** The summarizer's input: the question and the finished answer. */
export function summaryInput(question: string, answer: string, hint = false): string {
  return `${hint ? 'This answer is a hint: the player asked not to be told the solution.\n\n' : ''}Question:\n${String(question || '').slice(0, 500)}\n\nAnswer:\n${String(answer || '').slice(0, 12000)}`;
}

/** Plain spoken text: no markdown, links, citations or our tags; at most 380 characters (room for a must-get item), cut at a sentence. */
export function cleanSummary(v: unknown): string {
  let s = String(v ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\s*(?:g\d+|\d+(?:\.\d+)*)(?:\s*[,;]\s*(?:g\d+|\d+(?:\.\d+)*))*\s*\]/g, '')
    .replace(/\[cite:[^\]]*\]/gi, '')
    .replace(/[*_`#]+/g, '')
    .replace(/^\s*(?:summary|resumen|resumo)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
  if (s.length > 380) {
    const cut = s.slice(0, 380);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return s;
}
