/**
 * The save right now (owner, Nov 21 2026): after every answer, its own small call (POST /api/save-state) updates the
 * playthrough's picture of the player's save (src/utils/playthrough.ts SaveState) from the question, the answer, the
 * screenshot, where they are, what's done and the guide's steps for this place. It never touches the answer itself.
 * Flash, no searches, a few hundred tokens out: well under $0.001 a question.
 */

export const SAVE_STATE_PROMPT = `You keep a short, exact record of one player's save in a video game: who they are, their party, where they are in the story, and what is still open. You get the record as it was, the player's latest question, the answer they got, where they are, what's done, and sometimes a screenshot and the guide's steps for this place. Return the updated record.

Rules:
- Only what is certain from the question, the answer, the screenshot (party portraits, the HUD, characters in the party) or the story point. What the player says about their own game ("I got Shadowheart", "I'm playing the Dark Urge", "I killed Gale") is certain. Never guess, never invent.
- Infer what every player has at this point of the game from where they are and the story point (after Baldur's Gate 3's Nautiloid crash every player wakes alone on the beach; the first companions are found nearby). Don't list companions or party members the player can't have met yet.
- "who": the player's character in a few words (origin, class, race, level, name) and the run's difficulty or mode when known (Honour Mode, Tactician, Death March, NG+, permadeath…), e.g. "The Dark Urge, sorcerer, Honour Mode". Empty if unknown.
- "party": who travels with them now, and briefly who waits at camp, was turned away, left or died, e.g. "Shadowheart (in party). Not yet met: Astarion, Gale, Lae'zel". For a game without a party, empty.
- "story": the story so far in one line (act or chapter, the last big beat), e.g. "Act 1: survived the Nautiloid crash, looking for a healer for the tadpole".
- "open": up to 6 threads still open and worth knowing at this point, short (a quest-log line each): quests started but not finished, and things close by not done yet that a player would want before moving on (companions to recruit, key items). From the guide's steps when given (a ticked step is done). Drop anything finished, left behind for good or no longer relevant (an item from an area the player has left). Most important first.
- Keep everything from the old record that is still true. Lines the player edited themselves stay as they wrote them unless the game has clearly moved on.
- Write in the same language as the old record, or as the player's question if there's no record yet.
- Each line at most 200 characters; plain text, no markdown.

Reply with only this JSON: {"who": "", "party": "", "story": "", "open": []}`;

export type SaveStateInput = {
  game: string;
  question: string;
  answer: string;
  old?: { who?: string; party?: string; story?: string; open?: string[]; edited?: boolean } | null;
  place?: string;
  story?: string;
  done?: string[];
  choices?: string[];
  found?: string[];
  steps?: { title: string; done: boolean }[];
};

const one = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The call's text: everything it reads, labelled. */
export function saveStateInput(x: SaveStateInput): string {
  const old = x.old ? JSON.stringify({ who: one(x.old.who, 160), party: one(x.old.party, 200), story: one(x.old.story, 200), open: (x.old.open || []).map((o) => one(o, 120)).slice(0, 6) }) : '(none yet)';
  const list = (a?: string[], n = 20) => (a || []).map((s) => one(s, 130)).filter(Boolean).slice(0, n);
  return [
    `Game: ${one(x.game, 120)}`,
    `Old record${x.old?.edited ? ' (the player edited it)' : ''}: ${old}`,
    x.place ? `Where they are: ${one(x.place, 100)}` : '',
    x.story ? `Story point: ${one(x.story, 120)}` : '',
    list(x.done).length ? `Already done (most recent first): ${list(x.done).join(' | ')}` : '',
    list(x.choices).length ? `Choices made: ${list(x.choices).join(' | ')}` : '',
    list(x.found).length ? `Key items: ${list(x.found).join(' | ')}` : '',
    x.steps?.length ? `The guide's steps for this place, in order: ${x.steps.slice(0, 12).map((s) => `${s.done ? '[ticked] ' : ''}${one(s.title, 100)}`).join(' | ')}` : '',
    `The player's question: ${one(x.question, 600)}`,
    `The answer they got: ${String(x.answer || '').slice(0, 6000)}`,
  ].filter(Boolean).join('\n');
}

/** The model's reply as a record, or null when it isn't one. */
export function parseSaveState(text: string): { who: string; party: string; story: string; open: string[] } | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!j || typeof j !== 'object') return null;
    const open = (Array.isArray(j.open) ? j.open : []).map((o: unknown) => one(o, 120)).filter((o: string) => o.length >= 3).slice(0, 6);
    const r = { who: one(j.who, 160), party: one(j.party, 200), story: one(j.story, 200), open };
    return r.who || r.party || r.story || r.open.length ? r : null;
  } catch {
    return null;
  }
}
