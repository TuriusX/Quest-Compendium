/**
 * Pop-up summaries (owner, Nov 19 2026: "they are meant to give the player information quickly so they can move on
 * quickly with completing the task that led to their question"). A question asked while a game runs pops up over the
 * game for about half a minute (electron/answerCard.cjs); the card shows a short summary of what to do, read aloud,
 * instead of the start of the answer. The full answer stays in the panel.
 *
 * The summary is its own small call (POST /api/card-summary), made from the finished answer. The answer's own call is
 * never told about it (owner, Nov 19 2026: summaries must not change the main answer, e.g. by nudging it shorter).
 */

/** The summarizer's instructions. */
export const CARD_SUMMARY_PROMPT = `You write the pop-up summary for a video game helper app. The player asked a question while playing; the
answer below pops up over the game for about half a minute, and your summary is shown there and read aloud so the
player can get straight back to what they were doing.

Write what the player should do now:
- The action, where (or with what), and the one thing to watch for if there is one. One or two short sentences that
  sound natural spoken aloud, at most 40 words.
- Only what the answer says: never add facts, names, numbers or places it doesn't have. When the answer isn't sure,
  the summary isn't either. When the answer is a hint, the summary is that hint, never the solution.
- No background, lore, lists, markdown, links, citations or tags. The same language as the answer.
- Reply with the summary only. When the answer has nothing to do (an error, a refusal, a question back to the player),
  reply with nothing.`;

/** The summarizer's input: the question and the finished answer. */
export function summaryInput(question: string, answer: string, hint = false): string {
  return `${hint ? 'This answer is a hint: the player asked not to be told the solution.\n\n' : ''}Question:\n${String(question || '').slice(0, 500)}\n\nAnswer:\n${String(answer || '').slice(0, 12000)}`;
}

/** Plain spoken text: no markdown, links, citations or our tags; at most 300 characters, cut at a sentence. */
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
  if (s.length > 300) {
    const cut = s.slice(0, 300);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return s;
}
