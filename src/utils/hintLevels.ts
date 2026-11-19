/**
 * Hint levels (session companion step 2, owner Nov 18 2026): a hint question ("Just a hint", hint mode on) is answered
 * with three levels from one AI call. The answer itself is the nudge; a <qc-hints> line carries the rule or mechanic
 * the player is missing, and the full answer. The server pulls the line out (extractHints) and sends both levels with
 * the answer; the app shows them one at a time, only when asked ("More of a hint", then "Show the answer"). Only apps
 * that can show the levels ask for them (req.body.hintLevels); older ones get the one-level hint as before.
 */

export type HintLevels = { rule?: string; answer?: string };

/** Added to a hint question's prompt when the app can show the levels (replaces the plain hint's closing line). */
export const HINT_LEVELS_RULES = `

[HINT LEVELS]
Your answer text is the first, smallest hint. After it, add one line with two bigger levels, which stay hidden until
the player asks for them one at a time:
<qc-hints>{"rule": "<the second hint>", "answer": "<the full answer>"}</qc-hints>
- "rule": the rule, mechanic or idea the player is missing, said plainly ("the doors open to the symbols painted on
  the walls nearby", "this boss is weak to fire while its shield is down"), still without the exact solution, steps
  or locations. One or two sentences, at most 300 characters.
- "answer": the full answer: exactly what to do, in order, concretely (where, which one, the solution). At most five
  short sentences, at most 700 characters.
- Your answer text stays the gentle nudge. It must not say what "rule" or "answer" say, and it does not offer more
  help at the end: the app offers the bigger hint and the answer itself.
- Leave "answer" out when you don't know the solution for sure; never guess one. Never mention the line.`;

const clip = (v: unknown, n: number): string => {
  const s = String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > n * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Pull the <qc-hints> line out of an answer (always removed from the text). A level the nudge already says is dropped. */
export function extractHints(text: string): { text: string; hints: HintLevels | null } {
  let hints: HintLevels | null = null;
  const cleaned = String(text || '').replace(/(?:```[a-z]*\s*)?<qc-hints>([\s\S]*?)<\/qc-hints>(?:\s*```)?/gi, (_m, body) => {
    try {
      const raw = JSON.parse(String(body).trim());
      const rule = clip(raw?.rule, 400);
      const answer = clip(raw?.answer, 900);
      if (rule || answer) hints = { ...(rule ? { rule } : {}), ...(answer ? { answer } : {}) };
    } catch {
      /* a broken line is dropped */
    }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trimEnd();
  if (hints) {
    const nudge = norm(cleaned);
    const h: HintLevels = hints;
    // A level that's only the nudge again (or the rule again) adds nothing: it isn't offered.
    if (h.rule && nudge.includes(norm(h.rule))) delete h.rule;
    if (h.answer && (nudge.includes(norm(h.answer)) || (h.rule && norm(h.rule) === norm(h.answer)))) delete h.answer;
    if (!h.rule && !h.answer) hints = null;
  }
  return { text: cleaned, hints };
}

/** Which level shows next: 2 (the rule) or 3 (the answer), or 0 when everything is showing. shown: the levels open now (1-3). */
export function nextHintLevel(hints: HintLevels | undefined | null, shown: number): 0 | 2 | 3 {
  if (!hints) return 0;
  if (shown < 2 && hints.rule) return 2;
  if (shown < 3 && hints.answer) return 3;
  return 0;
}

/**
 * The answer's text with the levels opened so far, for places that show one block of text (the pop-up card): the
 * newest level first, so it's what the card shows without scrolling, then the earlier ones.
 */
export function textWithHints(text: string, hints: HintLevels | undefined | null, shown: number, labels: { rule: string; answer: string }): string {
  if (!hints) return text;
  const parts = [text];
  if (shown >= 2 && hints.rule) parts.unshift(`${labels.rule}: ${hints.rule}`);
  if (shown >= 3 && hints.answer) parts.unshift(`${labels.answer}: ${hints.answer}`);
  return parts.join('\n\n');
}
