/**
 * Quest-log steps: the 1 to 4 things from an answer the player should keep in front of them while they play, shown in
 * the objectives tracker's "From your last answer" section (src/utils/trackerPayload.ts). The model adds a <qc-steps>
 * block to every in-game answer; the server pulls it out (extractSteps) before the player sees the answer.
 */

import { WORTH_POINTING_OUT, PRECISE_ACTIONS, isTrivialMarker, isFillerStep, sharpenAction, clipWords } from './answerBar';

export type StepKind = 'step' | 'choice' | 'warning';
/** label: a few words for the quest log ("Ask the commander about Yennefer"); where: one short line, where or how. */
export type QuestStep = { kind: StepKind; text: string; label?: string; where?: string; detail?: string };

/** What the model is asked to add to every in-game answer. */
export const STEPS_RULES = `

[QUEST LOG STEPS]
After your answer, add one line with the 1 to 4 most important things the player should keep in front of them while
they play (it goes on their on-screen quest log), most important first. Only what they should actually do or decide
next, never filler:
<qc-steps>[{"kind": "step", "label": "<a few words>", "where": "<where or how, one short line>", "text": "<what to do>", "detail": "<the sentence from your answer it comes from>"}]</qc-steps>
- "kind": "step" (something to do), "choice" (a decision the player has to make) or "warning" (something they can miss
  for good or that can go badly: a missable, a point of no return, a dangerous fight).
- "label": the objective as the quest log shows it: 2 to 6 words, at most 40 characters, a short imperative, never a
  sentence ("Ask the commander about Yennefer", "Search for the Griffin's tracks", "Pick: spare or kill Duncan"). Choices
  and warnings too ("Don't read the Elder Scroll yet").
- "where": one short line (at most 70 characters) with where it is or how to do it, the part the label leaves out
  ("Nilfgaardian garrison, centre of White Orchard", "burned-out village to the south; use Witcher Senses"). Leave
  it out when the label says it all.
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
          text: clipWords(String(s?.text ?? s?.label ?? ''), 140),
          ...(str(s?.label, 80) ? { label: clipWords(String(s?.label ?? ''), 48) } : {}),
          ...(str(s?.where, 140) ? { where: clipWords(String(s?.where ?? ''), 90) } : {}),
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

/**
 * Ticks from the conversation (owner, Oct 30 2026): the player's current objective on their quest log (the app sends
 * its unticked steps, numbered with their indexes). When the question says some are done already ("I've got both
 * halves"), the answer adds <qc-ticked>[indexes]</qc-ticked> and the app ticks them, with Undo. No extra call: it rides on
 * the answer.
 */
export type ObjectiveForAnswer = { title: string; steps: { i: number; text: string }[] };

/** The objective as the app sent it, cleaned (null when there's nothing usable). */
export function cleanObjective(raw: unknown): ObjectiveForAnswer | null {
  const o: any = raw;
  if (!o || typeof o !== 'object' || !Array.isArray(o.steps)) return null;
  const steps = o.steps
    .filter((s: any) => s && Number.isInteger(s.i) && s.i >= 0 && s.i < 20 && typeof s.text === 'string' && s.text.trim())
    .slice(0, 8)
    .map((s: any) => ({ i: s.i, text: String(s.text).replace(/\s+/g, ' ').trim().slice(0, 140) }));
  return steps.length ? { title: String(o.title || '').replace(/\s+/g, ' ').trim().slice(0, 80), steps } : null;
}

export function objectiveRules(o: ObjectiveForAnswer): string {
  return `

[THE PLAYER'S CURRENT OBJECTIVE]
On their quest log the player is working on "${o.title || 'their objective'}". Steps not ticked yet:
${o.steps.map((s) => `${s.i}: ${s.text}`).join('\n')}
Only when the player's question clearly says they have already done one or more of these (for example "I've got both
halves", "done with the castle, what now?"), add one line with those numbers:
<qc-ticked>[${o.steps[0].i}]</qc-ticked>
Never for steps they're only asking about, about to do, or might have done. Leave the line out otherwise, and never
mention it in your answer text.`;
}

/** Pull the <qc-ticked> line out of an answer (always removed): the indexes, only ones the app sent. */
export function extractTicked(text: string, o: ObjectiveForAnswer | null): { text: string; done: number[] } {
  let done: number[] = [];
  const cleaned = String(text || '').replace(/(?:```[a-z]*\s*)?<qc-ticked>([\s\S]*?)<\/qc-ticked>(?:\s*```)?/gi, (_m, body) => {
    try {
      const raw = JSON.parse(String(body).trim());
      const allowed = new Set((o?.steps || []).map((s) => s.i));
      done = [...new Set((Array.isArray(raw) ? raw : []).filter((n: unknown) => Number.isInteger(n) && allowed.has(n as number)))] as number[];
    } catch {
      /* a broken line is dropped */
    }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trimEnd(), done };
}
