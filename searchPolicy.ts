/**
 * When an answer uses Google Search (grounding):
 *   - force: the running game came out after the answering model's knowledge cutoff (Steam's release date, or our
 *     first-release override on guides/{key}.firstReleased; an unreleased or "coming soon" game, or one our guide
 *     pipeline built as a new release, counts as new). Search is always on for it, even past the player's own daily
 *     search allowance (the app-wide caps still apply), and our guide pages for it come along.
 *   - offer: the model gets the search tool for this question: a game we can't date (unfamiliar), or a question about
 *     exact data (where something is, a fight, a puzzle) that no checked guide page or saved fact covers.
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

/** How this question uses search (see the top of the file). */
export function searchMode(o: { newRelease: boolean; dated: boolean; type: QuestionType; covered: boolean }): SearchMode {
  if (o.newRelease) return 'force';
  if (!o.dated) return 'offer';
  if ((o.type === 'location' || o.type === 'fight' || o.type === 'puzzle' || o.type === 'missable') && !o.covered) return 'offer';
  return 'ask';
}

/** True when the model's first reply only asks for a search. */
export const asksForSearch = (text: string) => /^\s*<qc-search\s*\/?>\s*(<\/qc-search>)?\s*$/i.test(String(text || ''));

/** Always in the prompt: never deny something exists; search instead, then ask the player for more. */
export const EXISTENCE_RULES = `[UNFAMILIAR GAMES, PLACES, ITEMS AND CHARACTERS]
Never say that a game, place, item, character or event doesn't exist, isn't real or isn't released. Games and updates
come out after your training, and players see things you haven't heard of. If something is unfamiliar, look it up
with Google Search when you have it. If you can't find it, say there isn't enough information about it yet and ask the
player for a screenshot or a detail (what's on screen, the chapter, where they are).`;

export const ASK_RULES = `[GOOGLE SEARCH]
Answer from the guide notes, the verified facts above and what you know. If you don't recognise the game, a place, an
item or a character in the question, or you need a specific detail you aren't sure of (where something is, an enemy's
weakness, exact numbers), reply with only this line and nothing else: <qc-search/>
You'll then be able to search before answering. Don't use it for things you already know well.`;

export const FORCE_RULES = (game: string, when: string) => `[NEW RELEASE: ${game} (released ${when})]
This game came out after your training: what you remember is from older games in the series, previews or rumours,
and is often wrong for this one. Always run at least one Google Search about the player's question before you answer
(for example "${game} <the topic>"), even if you think you know. Base the answer on what the search finds and on our
guide notes (when given).`;

/** Added when a new-release answer came back without a search: the same question once more, with this note. */
export const FORCE_AGAIN = `[SEARCH FIRST]
Your previous attempt didn't search. Run a Google Search about this question now, before you answer.`;
