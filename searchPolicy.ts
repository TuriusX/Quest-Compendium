/**
 * When an answer uses Google Search (grounding):
 *   - force: the running game came out after the answering model's knowledge cutoff (Steam's release date, or our
 *     first-release override on guides/{key}.firstReleased; an unreleased or "coming soon" game, or one our guide
 *     pipeline built as a new release, counts as new). Search is always on for it, even past the player's own daily
 *     search allowance (the app-wide caps still apply), and our guide pages for it come along.
 *   - offer: the model gets the search tool for this question: a game we can't date (unfamiliar), a question about
 *     exact data (where something is, a fight, a puzzle) that no checked guide page or saved fact covers, or a
 *     screenshot with a question about specifics ("what items are here", "where is", "how do I": wantsSpecifics),
 *     covered or not (owner, Oct 31 2026: with a screenshot the model rarely asked for a search, and FF6's "hidden
 *     items in the mansion" got "several more chests").
 *   - ask: no search by default. The model is told to reply with only <qc-search/> when it doesn't recognise
 *     something or needs a detail it isn't sure of; then the question runs again with search.
 * Cutoffs per model, in Firestore config/searchRules { cutoffs: { flash: "2025-01-01", pro: "2025-01-01" } }.
 */
import { getFirestore } from 'firebase-admin/firestore';
import type { QuestionType } from './src/utils/questionType';

export type SearchMode = 'force' | 'offer' | 'ask';
export const CUTOFF_DEFAULTS = { flash: process.env.FLASH_CUTOFF || '2025-01-01', pro: process.env.PRO_CUTOFF || '2025-01-01' };

let rulesCache: { at: number; cutoffs: { flash: string; pro: string } } | null = null;
export async function cutoffs(): Promise<{ flash: string; pro: string }> {
  if (rulesCache && Date.now() - rulesCache.at < 300_000) return rulesCache.cutoffs;
  let c = CUTOFF_DEFAULTS;
  try {
    const d: any = (await getFirestore().collection('config').doc('searchRules').get()).data() || {};
    const ok = (v: unknown, def: string) => (Number.isFinite(Date.parse(String(v))) ? String(v) : def);
    c = { flash: ok(d?.cutoffs?.flash, CUTOFF_DEFAULTS.flash), pro: ok(d?.cutoffs?.pro, CUTOFF_DEFAULTS.pro) };
  } catch {
    /* defaults */
  }
  rulesCache = { at: Date.now(), cutoffs: c };
  return c;
}

export type Release = { text: string; time: number | null; source: 'override' | 'steam' | 'unknown'; newRelease?: boolean };
const releases = new Map<string, { at: number; r: Release }>();
const gameKey = (name: string) => name.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A game's release: our override, else Steam's date (by app id, else a store search by name). Cached for a day. */
export async function releaseOf(game: string | undefined, appId?: number): Promise<Release> {
  const name = String(game || '').trim();
  if (!name) return { text: 'unknown', time: null, source: 'unknown' };
  const key = gameKey(name);
  const hit = releases.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.r;
  let r: Release = { text: 'unknown', time: null, source: 'unknown' };
  let guide: any = null;
  try {
    guide = (await getFirestore().collection('guides').doc(key).get()).data() || null;
  } catch {
    /* no guide info */
  }
  const first = Date.parse(String(guide?.firstReleased || ''));
  if (Number.isFinite(first)) r = { text: `${guide.firstReleased} (first release)`, time: first, source: 'override' };
  else {
    try {
      let id = Number(appId) || Number(guide?.appId) || 0;
      if (!id) {
        const s = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=english`, { signal: AbortSignal.timeout(4000) });
        const items: any[] = (await s.json())?.items || [];
        const norm = (x: string) => x.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        id = (items.find((i) => norm(i.name) === norm(name)) || null)?.id || 0;
      }
      if (id) {
        const s = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=release_date&cc=us&l=english`, { signal: AbortSignal.timeout(4000) });
        const d: any = (await s.json())?.[id]?.data?.release_date;
        const t = Date.parse(String(d?.date || ''));
        r = { text: d?.date || 'unknown', time: d?.coming_soon || !Number.isFinite(t) ? null : t, source: 'steam' };
      }
    } catch {
      /* Steam unreachable: unknown */
    }
  }
  if (guide?.pipeline?.newRelease === true) r.newRelease = true;
  releases.set(key, { at: Date.now(), r });
  return r;
}

/** Released after the cutoff (an unreleased, "coming soon" or pipeline-flagged new game counts as after). */
export function isNewRelease(r: Release, cutoff: string): boolean {
  if (r.time !== null) return r.time >= Date.parse(cutoff);
  return r.source !== 'unknown' || r.newRelease === true ? true : false;
}

/** A question about specifics: what items or loot there are, where something is, how to do or get something. */
const SPECIFICS = /\b(?:items?|loot|treasures?|chests?|hidden|secrets?|collectibles?|rewards?|drops?|where(?:'s| is| are| can| do| does)?|find|locat(?:e|ion|ed)|how (?:do|can|to|should) (?:i |you |we )?(?:get|find|reach|open|unlock|beat|solve|do|make|use|obtain|craft)|how to)\b|objet|tesoro|cofre|escondid|d[oó]nde|c[oó]mo (?:consigo|llego|abro|consigo)|ba[uú]|onde|como (?:pego|chego|abro)|gegenst|truhe|versteck|\bwo\b|wie (?:komme|bekomme|finde)|coffre|tr[ée]sor|cach[ée]|o[uù] (?:est|sont|trouver)|comment (?:obtenir|trouver|ouvrir)|предмет|сундук|тайн|где|как (?:получить|найти|открыть)|アイテム|宝箱|隠し|どこ|どうやって|아이템|상자|숨겨진|어디|어떻게|物品|宝箱|隐藏|哪里|在哪|怎么/i;
export const wantsSpecifics = (text: string) => SPECIFICS.test(String(text || ''));

/** How this question uses search (see the top of the file). */
export function searchMode(o: { newRelease: boolean; dated: boolean; type: QuestionType; covered: boolean; screenshot?: boolean; specifics?: boolean }): SearchMode {
  if (o.newRelease) return 'force';
  if (!o.dated) return 'offer';
  if (o.screenshot && o.specifics) return 'offer';
  if ((o.type === 'location' || o.type === 'fight' || o.type === 'puzzle' || o.type === 'missable') && !o.covered) return 'offer';
  return 'ask';
}

/**
 * Nothing the player could read (not one letter or digit; a short "Yes." is an answer): empty, or only our tags (<qc-search/>, <qc-title>, …) once they're taken out. Gemini
 * returns no text when it tries to call a search tool it wasn't given (finishReason MALFORMED_FUNCTION_CALL).
 */
export const isBlankAnswer = (text: string) =>
  String(text || '').replace(/(?:```[a-z]*\s*)?<qc-[a-z-]+(?:\s[^>]*)?>[\s\S]*?<\/qc-[a-z-]+>(?:\s*```)?/gi, '').replace(/<qc-[a-z-]+[^>]*\/?>/gi, '').replace(/```[a-z]*/gi, '').search(/[\p{L}\p{N}]/u) < 0;

/** Added to the retry after a blank answer. */
export const NOT_BLANK = `[ANSWER NOW]
Your previous attempt returned nothing. Answer the player's question now, in plain text.`;

/** True when the model's first reply asks for a search: it opens with the line (sometimes followed by its own working aloud). */
export const asksForSearch = (text: string) => /^\s*<qc-search\s*\/?>/i.test(String(text || ''));
/** A search line left anywhere else in an answer: never shown. */
export const stripSearchAsk = (text: string) => String(text || '').replace(/[ \t]*<qc-search\s*\/?>(?:\s*<\/qc-search>)?/gi, '');

/** Always in the prompt: never deny something exists; search instead, then ask the player for more. */
export const EXISTENCE_RULES = `[UNFAMILIAR GAMES, PLACES, ITEMS AND CHARACTERS]
Never say that a game, place, item, character or event doesn't exist, isn't real or isn't released. Games and updates
come out after your training, and players see things you haven't heard of. If something is unfamiliar, look it up
with Google Search when you have it. If you can't find it, say there isn't enough information about it yet and ask the
player for a screenshot or a detail (what's on screen, the chapter, where they are).`;

export const ASK_RULES = `[GOOGLE SEARCH]
Answer from what you know, with the guide notes and the verified facts above as reference. If you don't recognise the
game, a place, an item or a character in the question, you need a specific detail you aren't sure of (where something
is, an enemy's weakness, exact numbers), or the guide notes and what you know disagree and you aren't sure which is
right, reply with only this line and nothing else: <qc-search/>
You'll then be able to search before answering. Don't use it for things you already know well.`;

export const FORCE_RULES = (game: string, when: string) => `[NEW RELEASE: ${game} (released ${when})]
This game came out after your training: what you remember is from older games in the series, previews or rumours,
and is often wrong for this one. Always run at least one Google Search about the player's question before you answer
(for example "${game} <the topic>"), even if you think you know. Base the answer on what the search finds and on our
guide notes (when given).`;

/** Added when a new-release answer came back without a search: the same question once more, with this note. */
export const FORCE_AGAIN = `[SEARCH FIRST]
Your previous attempt didn't search. Run a Google Search about this question now, before you answer.`;

/** Where the Pro rules go first: right after this line of the answer prompt (server.ts). */
export const PROMPT_PERSONA_END = 'Provide clear, direct answers without adopting any specific character, persona, or AI identity.';

/**
 * Immersive mode (owner, Nov 6 2026): the facts of a Standard answer, told by a narrator from the game's world. The old persona
 * ended up as a plain shorter answer once the answer rules came after it (8 test questions on Fast: 7 wrong claims against
 * Standard's 5, about 20% shorter, no character left); this one kept the character, was as complete and had 2.
 */
// narrator (owner, Nov 20 2026): this game's own narrator (narrator.ts), the same character the read-aloud voice is.
export const ROLEPLAY_PERSONA = (game: string, narrator?: string) => `You are a companion from the world of ${game}, talking with the player as someone who belongs there. ${narrator ? `You are ${narrator}. Always speak as this same person (not one of the game's named main characters).` : `Pick one narrator who fits this world (a kind of person who lives in it, such as a veteran, a scholar, a guide or a rogue native to it; not one of the game's named main characters) and speak as them. If earlier answers in this conversation already had a narrator, stay the same one.`}

[IMMERSIVE: THE FACTS FIRST, THE CHARACTER IS THE VOICE]
- Say everything a plain expert guide would: every step, name, place, number, requirement, warning, missable and outcome, with exact in-game names. The character never drops, blurs or replaces a fact, and never hides a mechanic behind in-world vagueness: name the button, the stat, the number.
- Never invent lore, places, items or people to fit the character. If it isn't true in the game, it isn't said.
- Keep a guide's shape so the player can scan it and act: a direct answer first, headings, bullets, numbered steps.
- Make it fun: open with one short in-character line that reacts to what the player is doing; give headings an in-world flavour; let the narrator's personality show in a wry aside or two (at most one per section, never in the middle of a step); end with a short in-character send-off. Use the world's own words, slang and humour.
- Never call yourself an AI, an assistant, a language model, a book, a compendium or a guide app.`;
/** The roleplay persona's last line: the answer rules go right after it, as after Standard's. */
export const ROLEPLAY_PERSONA_END = "- Never call yourself an AI, an assistant, a language model, a book, a compendium or a guide app.";

/**
 * Pro's own rules (owner, Nov 5 2026: a Pro answer should beat asking Gemini Pro yourself). 12 test questions, fact-checked:
 * 3 wrong claims against 7 for plain Gemini Pro and 7 for the app's Pro before this. Without search, the rule to check is left out.
 */
export const PRO_RULES = (canSearch: boolean, screenshot = false, pro = true) => `${pro ? '[PRO ANSWER: THE BEST ANSWER THIS PLAYER CAN GET]\nThe player chose Pro because they want' : '[ANSWER: THE BEST ANSWER THIS PLAYER CAN GET]\nThe player wants'} a better answer than a general assistant would give. Accuracy and completeness come first.
${screenshot ? "- Look closely at the screenshot first and use what's actually in it: characters, creatures, what the player is holding or doing, text on screen, landmarks. If the same view could be more than one place, say so and cover each. If you can't be sure of the place, give your best guess, say it's a guess, and answer for it rather than giving a general answer.\n" : ''}${canSearch ? "- Always run Google Search before you answer, at least twice when the answer depends on more than one fact, for the specifics it depends on (names, locations, requirements, numbers, rewards, what a choice leads to), on the game's wikis and guides. Don't state from memory what you can check. Search for the exact version of the game the player is on.\n" : ''}- Answer the whole question: every step, requirement and consequence the player needs, with exact names and places, and what they can miss for good. Cover all of what was asked about: every phase of a fight (including any after a cutscene or in another place), every outcome of a choice, every way to get an item, even when the player's area or the guide notes only cover part of it. Then anything closely related they would otherwise have to ask next. Never leave a part of the question unanswered.
- Lead with the direct answer, then go into full detail, like the best dedicated guide for this game would: don't shorten or summarize to save space, and don't stop at the first thing that answers it. When the player has a decision, lay out each option's consequences, then say what you'd do and why.
- Never invent a place, item, character or detail to round out the answer: if you can't confirm it, leave it out.
- If sources disagree, go with the best source and say what's uncertain, in a few words.`;

/**
 * Pro's story rule, in place of [STORY TIMING]: that one says to leave out what comes later, and Ketheric's answer stopped at the rooftop while plain
 * Gemini Pro covered all three phases of the fight (owner, Nov 5 2026).
 */
export const PRO_STORY_TIMING = `[STORY TIMING]
Work out where the player is in the story from the screenshot and the conversation: their location, who is in the party, and which world or chapter they're in (for example Final Fantasy VI's World of Balance vs World of Ruin).
- Put what's useful at that point first, and say when something only becomes available later rather than leaving it out.
- Still answer in full what the player asked about, including its later phases, steps and outcomes.`;

/**
 * Pro's rule when no screenshot came with the question, in place of [NO SCREENSHOT WITH THIS QUESTION]: that one made a vague question ("what should I
 * do next?") little more than a request for a screenshot, where plain Gemini Pro gives useful general help and asks where they are.
 */
export const PRO_NO_SCREENSHOT = `[NO SCREENSHOT WITH THIS QUESTION]
No screenshot or image is attached to this question. Never describe, refer to or assume anything on the player's screen: not "on your screen", "your map", "your minimap", "your inventory", "you're on the desktop", "I can see", or where they are on a map. When the question depends on where they are ("here", "next"), still give the most useful answer you can from the question alone: general guidance for this game, or the full list across its regions. Then ask in one short sentence where they are or what just happened. Don't tell them how to attach a screenshot.`;

/** In place of the vision rule that had answers open with "I don't see a screenshot", even on questions that don't need one. */
export const PRO_MISSING_IMAGE = "3. MISSING IMAGE HANDLING: Only if the player directly asks about what's on their screen and no image came with the question, say in one sentence that you don't see a screenshot. Otherwise don't mention screenshots.";

/**
 * "What next" in full (owner OK, Nov 21 2026). Added at the very end of every app answer's prompt. In the Nov 21 blind
 * test (12 "what should I do next" questions, 2 checkers each) it lifted gpt-6.2-sol from 6.7 to 7.4-8.1 out of 10 at
 * the same time and cost, matching every two-model mix that fits in 45 s. It did nothing for gpt-6-luna.
 */
export const WHAT_NEXT_IN_FULL_V1 = `[WHAT NEXT, IN FULL]
When the player asks what to do next or where to go, cover the whole stretch ahead, not just the next step:
1. Everything worth doing nearby right now, judged from their save and where they are: companions or allies to recruit, side quests that open here, merchants, and gear or items that are easy to miss on the way.
2. The fights, traps or dangers between them and the next objective, and how to handle or avoid them.
3. The main objective and where it is.
Treat their save as fact. Keep it tight: short groups or numbered steps, one or two lines each.`;

/**
 * Version 2 (Nov 21 2026, from the blind checkers' notes on version 1: skipped nearby recruits, finished missions
 * recommended again, "where are you now?" endings, a wrong earlier answer left standing, no word when leaving closes
 * something nearby). Under test against version 1 before it replaces it.
 */
export const WHAT_NEXT_IN_FULL_V2 = `[WHAT NEXT, IN FULL]
When the player asks what to do next or where to go, cover the whole stretch ahead, not just the next step:
1. Everything worth doing nearby right now, judged from their save and where they are: each companion or ally they can still recruit here (by name), side quests that open here, merchants, and gear or items that are easy to miss on the way.
2. The fights, traps or dangers between them and the next objective, and how to handle or avoid them.
3. The main objective and where it is.
Treat their save and story point as fact: anything that has to be done to reach this point is already done, so don't send them back to it, and don't ask where they are. If moving on closes off something nearby, say so once, briefly. If an earlier answer in this conversation got something wrong that matters now, correct it in one line. Keep it tight: short groups or numbered steps, one or two lines each, and end on the next step rather than a question.`;

/**
 * Version 3 (Nov 21 2026, owner: it must work for every game, not just RPGs): version 2 plus guards so it never forces
 * a route where a game has none (roguelikes, life sims, sandboxes, linear games), names recruits only in games that
 * have them, and asks where the player is only when the app doesn't know.
 */
export const WHAT_NEXT_IN_FULL_V3 = `[WHAT NEXT, IN FULL]
When the player asks what to do next or where to go, cover the whole stretch ahead, not just the next step. Use only the parts that fit this game and question; skip the rest:
1. Everything worth doing nearby right now, judged from their save and where they are: companions or allies they can still recruit here, by name (only in games that have them), side quests that open here, merchants, and gear or items that are easy to miss on the way.
2. The fights, traps or dangers between them and the next objective, and how to handle or avoid them.
3. The main objective and where it is.
In a game without a story route (a roguelike, a life sim, a sandbox, a multiplayer game), give their best next priorities from where they are instead.
Treat their save and story point as fact: anything that has to be done to reach this point is already done, so don't send them back to it, and don't ask where they are when their save or place already says. If moving on closes off something nearby, say so once, briefly. If an earlier answer in this conversation got something wrong that matters now, correct it in one line. Keep it tight: short groups or numbered steps, one or two lines each, and end on the next step rather than a question.`;

/**
 * The live rule: version 3 (Nov 21 2026 blind test, 2 checkers per answer: "what next" 7.35 vs 6.58 for version 1,
 * 7.50 vs 6.31 on games it wasn't written around, 7.63 vs 7.00 on roguelike / life sim / sandbox / linear games).
 * Added only to "what next" questions (asksWhatNext, src/utils/whatNext.ts): on other questions it scored a little
 * lower than no rule (7.65 vs 7.79 on 40 mixed questions).
 */
export const WHAT_NEXT_IN_FULL = WHAT_NEXT_IN_FULL_V3;

/**
 * "Why, for this run" (owner, Nov 21 2026: a correct Gale level-up listed Shield and Magic Missile with what they do, but
 * nothing about his Dark Urge Honour Mode run or what's ahead; "as long as it makes sense to add, not fluff"). Under test.
 */
export const WHY_FOR_THIS_RUN = `[WHY, FOR THIS RUN]
When you recommend choices (spells, feats, skills, stats, gear, builds, companions, party, dialogue or story choices), say why they fit THIS player: open with one short sentence placing the choice in their run (where they are and what's coming up), then give each pick a reason tied to their character and class, the difficulty or mode they play on (e.g. Honour Mode, Death March), their party's roles, and the fights or choices ahead. What a pick does is not a reason on its own; why it matters for this run is. Only add a reason that tells them something useful: no generic praise, no filler, and keep each reason to one line.`;

/**
 * Version 2, "closer to Gemini" (owner, Nov 21 2026): the brevity rules no longer cut the explanation on recommendation
 * questions; what the party already covers and real trade-offs count. Under test (setups B and C).
 */
export const WHY_FOR_THIS_RUN_V2 = `[WHY, FOR THIS RUN]
This question asks you to recommend choices (spells, feats, skills, stats, gear, builds, companions, party, dialogue or story choices). Here the reasons are part of the answer, so "keep it tight" must not cut them:
- Open with one or two sentences that place the choice in their run: who they play, the difficulty or mode, where they are in the story and what's coming up next.
- Give each pick a reason tied to this run: their character and class, the difficulty or mode (e.g. Honour Mode, Death March), what their party already covers (don't double up on what another member brings), and the fights or choices ahead, by name.
- Where two good options compete (two schools, two builds, two companions), say which fits this run and why, in a line or two.
- What a pick does is not a reason on its own; why it matters for this run is. No generic praise, no filler, nothing the player doesn't need: one or two lines per pick.`;

/**
 * Version 3 (owner, Nov 21 2026: Gemini "talks to you like a person, like it knows you"; more enjoyable than dry
 * answers): version 2 plus a voice line. Under test at normal thinking (setup B2).
 */
export const WHY_FOR_THIS_RUN_V3 = `${WHY_FOR_THIS_RUN_V2}
- Write like a friend who knows this run and has played the game: talk to them directly, refer to their character, party and recent choices by name where it helps, and sound like a person, not a reference page. The warmth comes from knowing their run, never from praise, exclamations or chit-chat.`;

/**
 * The voice (owner, Nov 21 2026): drawn from his own Gemini Dark Urge chat (466 questions). What made it feel like it
 * knew him: one firm pick first, reasons through his party and earlier choices by name, a few words reacting to what
 * just happened, one-line mistake owning, ending on the next action. His complaints were forgotten state, wrong facts
 * and hedged picks, never tone; Gemini's flattery, hype words, profile repeats, spoilers and length are left out.
 * Under test.
 */
export const VOICE_RULE = `[TALK LIKE YOU KNOW THEIR RUN]
You know this player's run from their save, this conversation and their choices. Write like a sharp friend who has played the game:
- If their message reacts to something that just happened (a death, a win, a surprise, a mistake), meet it in a few words first.
- Then the verdict in one plain sentence. When they ask you to choose, choose one: no "X or Y" and no menu of alternatives unless they ask; add one line on when another option would be better only if it really might be.
- Give the reasons in terms of their run, by name: their character, what each party member already does, their mode or difficulty, and choices or gear from their save or earlier in this conversation.
- End with what to pick, click or do now. Ask a question only when the answer truly depends on something you don't know.
- If an earlier answer of yours was wrong, say so in one line and give the fix.
Never: praise ("great question", "brilliant"), hype words ("massive", "absolutely", "insane"), restating their goals or profile when it doesn't change the advice, spoilers past where they are, or side topics they didn't ask about.
Example of the voice (not facts to reuse). Player: "Hearts or stamina next?" Answer: "Stamina. You're heading up to Rito Village and the sky above it next, and running dry halfway up a cliff or mid-glide will cost you far more than one extra heart would save. Hearts can wait until the Wind Temple's boss is in sight. Trade your next four Lights of Blessing at a Goddess Statue for the stamina wheel."`;

/** The "coming up" note (setup C): fights ahead from checked guide pages, a hint, never a source of truth. */
export const comingUpNote = (lines: string) => `[COMING UP (from our checked guide pages, in the guide's area order; it can include optional areas or skip ones that come first)]
${lines}
Use only what fits where this player really is and is heading. Ignore anything that conflicts with what you know about this game or their save, and never mention this note.`;

/** Added to a simple lookup's prompt (simpleLookup.ts), as in the Nov 21 2026 blind test. */
export const QUICK_LOOKUP_RULE = `[QUICK LOOKUP]
This is a simple factual lookup. Give the answer first, in one or two sentences, then at most two short details that help (where exactly, a requirement, a cost). No route, no next steps, no headings. If you are not sure of the exact fact, search once rather than guess.`;

/** Fast in the app uses the same rules on Flash since Nov 5 2026 (`pro` false: the same words, without saying the player chose Pro). */
/** The prompt with Pro's rules near the start and again at the very end, after the rules about the quest log and the place. */
export function withProRules(prompt: string, canSearch: boolean, screenshot = false, pro = true, perQuestion?: (s: string) => string): string {
  const rules = PRO_RULES(canSearch, screenshot, pro);
  // (The lookaheads allow a per-question mark, \u0002, before the next section: see splitPerQuestion.)
  const system = prompt.replace(/\[STORY TIMING\][\s\S]*?(?=\u0002?\n\n\[)/, () => PRO_STORY_TIMING).replace(/\[NO SCREENSHOT WITH THIS QUESTION\][\s\S]*?(?=\u0002?\n\n\[)/, () => PRO_NO_SCREENSHOT).replace(/3\. MISSING IMAGE HANDLING:[^\n]*/, () => PRO_MISSING_IMAGE);
  const end = system.includes(PROMPT_PERSONA_END) ? PROMPT_PERSONA_END : ROLEPLAY_PERSONA_END;
  const at = system.indexOf(end);
  // Split prompt: the copy near the start is the same for every question (no search or screenshot lines, which depend on
  // the question), so the system prompt repeats exactly; the full rules for this question go at the end, per question.
  const head = perQuestion ? PRO_RULES(false, false, pro) : rules;
  const start = at < 0 ? system : `${system.slice(0, at + end.length)}\n\n${head}${system.slice(at + end.length)}`;
  return perQuestion ? `${start}${perQuestion(`\n\n${rules}`)}` : `${start}\n\n${rules}`;
}

/**
 * The prompt split (owner, Nov 21 2026): text marked \u0001…\u0002 (server.ts perQ) is what changes from question to
 * question. On: it leaves the system prompt, in order, to go at the end of the player's message. Off: the marks are
 * dropped and the prompt is exactly as before.
 */
export function splitPerQuestion(text: string, on: boolean): { system: string; perQuestion: string } {
  if (!on) return { system: text.replace(/[\u0001\u0002]/g, ''), perQuestion: '' };
  const parts: string[] = [];
  const system = text.replace(/\u0001([\s\S]*?)\u0002/g, (_m, s: string) => { parts.push(s.trim()); return ''; }).replace(/[\u0001\u0002]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { system, perQuestion: parts.filter(Boolean).join('\n\n') };
}
