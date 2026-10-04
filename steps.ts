/**
 * Quest-log steps: the 1 to 4 things from an answer the player should keep in front of them while they play, shown in
 * the objectives tracker's "From your last answer" section (src/utils/trackerPayload.ts). The model adds a <qc-steps>
 * block to every in-game answer; the server pulls it out (extractSteps) before the player sees the answer.
 */

import { WORTH_POINTING_OUT, PRECISE_ACTIONS, isTrivialMarker, isFillerStep, sharpenAction, clipWords } from './answerBar';

export type StepKind = 'step' | 'choice' | 'warning';
export type QuestStep = { kind: StepKind; text: string; detail?: string };

/** What the model is asked to add to every in-game answer. */
export const STEPS_RULES = `

[QUEST LOG STEPS]
After your answer, add one line with the 1 to 4 most important things the player should keep in front of them while
they play (it goes on their on-screen quest log), most important first. Only what they should actually do or decide
next, never filler:
<qc-steps>[{"kind": "step", "text": "<what to do>", "detail": "<the sentence from your answer it comes from>"}]</qc-steps>
- "kind": "step" (something to do), "choice" (a decision the player has to make) or "warning" (something they can miss
  for good or that can go badly: a missable, a point of no return, a dangerous fight).
- "text": at most 90 characters, imperative and specific, in the player's language ("Search the chest left of the
  crashed pod", not "Explore the area"). A choice lists the options in one line ("Fight the Intellect Devourers or
  climb the rock wall to avoid them").
- "detail": the sentence (or two) of your answer that the item comes from, copied as written, so the player can read
  it again from the quest log. At most 300 characters.
- The same bar as markers. ${WORTH_POINTING_OUT}
- ${PRECISE_ACTIONS}
  For example "Jump (Z) up the rock ledge right of the burning wreck to skip the Intellect Devourers", not "Climb the
  cliff path on the right".
- In a fight, the steps are the battle plan instead (see [COMBAT]): the priority targets in order, then the key tactics.
- Only what your answer actually says. Leave the line out for questions that aren't about playing (settings, lore
  chat, a game's release date). Never mention the line in your answer text.`;

const KINDS: StepKind[] = ['step', 'choice', 'warning'];

/** Pull the <qc-steps> line out of an answer (always removed from the text): at most 4 steps, cleaned. */
export function extractSteps(text: string, opts: { combat?: boolean } = {}): { text: string; steps: QuestStep[] } {
  let steps: QuestStep[] = [];
  const cleaned = String(text || '').replace(/(?:```[a-z]*\s*)?<qc-steps>([\s\S]*?)<\/qc-steps>(?:\s*```)?/gi, (_m, body) => {
    try {
      const raw = JSON.parse(String(body).trim());
      const list = Array.isArray(raw) ? raw : [];
      const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      steps = list
        .map((s: any) => ({
          kind: (KINDS.includes(s?.kind) ? s.kind : 'step') as StepKind,
          text: clipWords(String(s?.text ?? ''), 140),
          ...(str(s?.detail, 400) ? { detail: clipWords(String(s?.detail ?? ''), 400) } : {}),
        }))
        .filter((s: QuestStep) => s.text)
        // Filler ("Explore the area") and routine loot ("Search the corpse" for minor supplies) stay off the quest log;
        // choices and warnings always count.
        // (A battle plan is never trimmed as low-value: its targets and tactics all count.)
        .filter((s: QuestStep) => !isFillerStep(s.text) && (opts.combat || !(s.kind === 'step' && isTrivialMarker({ label: s.text, detail: s.detail }))))
        .slice(0, 4);
    } catch {
      /* a broken line is dropped */
    }
    return '';
  });
  // A vague verb where the answer says exactly what to do ("Climb…" when it says to Jump) is made exact.
  steps = steps.map((s) => {
    const sharp = sharpenAction(s.text, cleaned);
    if (sharp.changed) console.log(`[steps] sharpened "${s.text.slice(0, 50)}" to "${sharp.text.slice(0, 50)}"`);
    return sharp.changed ? { ...s, text: clipWords(sharp.text, 140) } : s;
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trimEnd(), steps };
}
