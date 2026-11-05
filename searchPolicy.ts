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
 * Pro's own rules (owner, Nov 5 2026: a Pro answer should beat asking Gemini Pro yourself). 12 test questions, fact-checked:
 * 3 wrong claims against 7 for plain Gemini Pro and 7 for the app's Pro before this. Without search, the rule to check is left out.
 */
export const PRO_RULES = (canSearch: boolean, screenshot = false) => `[PRO ANSWER: THE BEST ANSWER THIS PLAYER CAN GET]
The player chose Pro because they want a better answer than a general assistant would give. Accuracy and completeness come first.
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

/** The prompt with Pro's rules near the start and again at the very end, after the rules about the quest log and the place. */
export function withProRules(prompt: string, canSearch: boolean, screenshot = false): string {
  const rules = PRO_RULES(canSearch, screenshot);
  const system = prompt.replace(/\[STORY TIMING\][\s\S]*?(?=\n\n\[)/, () => PRO_STORY_TIMING).replace(/\[NO SCREENSHOT WITH THIS QUESTION\][\s\S]*?(?=\n\n\[)/, () => PRO_NO_SCREENSHOT).replace(/3\. MISSING IMAGE HANDLING:[^\n]*/, () => PRO_MISSING_IMAGE);
  const at = system.indexOf(PROMPT_PERSONA_END);
  const start = at < 0 ? system : `${system.slice(0, at + PROMPT_PERSONA_END.length)}\n\n${rules}${system.slice(at + PROMPT_PERSONA_END.length)}`;
  return `${start}\n\n${rules}`;
}
