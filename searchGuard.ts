/**
 * Keeps Google Search grounding costs in check, and remembers facts the AI already looked up.
 *
 * Search grounding on Gemini 3 is billed per search query the model runs (one question can run several): 5,000 free a
 * month across the project, then $14 per 1,000. Three guards, all tunable with environment variables:
 *   - per player per day: FREE_DAILY_SEARCHES (default 3), PREMIUM_DAILY_SEARCHES (default 10); counted on the player's
 *     user document (searchesToday / searchDay). Guests share the free allowance, counted in memory per guest id.
 *   - whole app per month: MONTHLY_SEARCH_CAP (default 5000, the free allowance), counted in Firestore at
 *     system/searchBudget { month: 'YYYY-MM', count }. Chat and the Steam Deck web search both count toward it.
 *   - a warning in the logs at 80% of the monthly cap, and when it's reached.
 * When a guard says no, the question is answered without search (never an error for the player), and the AI is told to
 * mark exact game data as unconfirmed.
 *
 * Remembered facts: when the AI confirms exact data with a search (a weakness, an HP value), it reports it in a
 * <qc-facts> block; it's stored per game at gameFacts/{game}, shared by every player of that game, and given to the AI
 * on later questions, so the same fact doesn't need another search and answers stay consistent. Facts never expire;
 * wrong ones are corrected (see below).
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const FREE_DAILY = () => num(process.env.FREE_DAILY_SEARCHES, 3);
const PREMIUM_DAILY = () => num(process.env.PREMIUM_DAILY_SEARCHES, 10);
const MONTHLY_CAP = () => num(process.env.MONTHLY_SEARCH_CAP, 5000);

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Number of Google searches a Gemini response ran. */
export function countSearches(response: any): number {
  const q = response?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  return Array.isArray(q) ? q.length : 0;
}

// ---- whole-app monthly budget (cached for a minute, so it isn't read on every question) ----
let monthly = { month: '', count: 0, readAt: 0 };
let warned80 = '';
let warnedCap = '';

async function monthlyCount(): Promise<number> {
  const m = thisMonth();
  if (monthly.month === m && Date.now() - monthly.readAt < 60_000) return monthly.count;
  try {
    const snap = await getFirestore().collection('system').doc('searchBudget').get();
    const d = snap.exists ? snap.data() : null;
    monthly = { month: m, count: d && d.month === m ? Number(d.count) || 0 : 0, readAt: Date.now() };
  } catch {
    monthly = { month: m, count: monthly.month === m ? monthly.count : 0, readAt: Date.now() };
  }
  return monthly.count;
}

export async function monthlyBudgetOk(): Promise<boolean> {
  const cap = MONTHLY_CAP();
  const used = await monthlyCount();
  if (used >= cap) {
    if (warnedCap !== thisMonth()) {
      warnedCap = thisMonth();
      console.warn(`[search] Monthly search cap reached (${used}/${cap}). Answers run without Google Search until next month. Raise MONTHLY_SEARCH_CAP to allow more.`);
    }
    return false;
  }
  return true;
}

/** Add searches to the monthly count (fire-and-forget). */
export function recordMonthly(n: number): void {
  if (!n) return;
  const m = thisMonth();
  if (monthly.month !== m) monthly = { month: m, count: 0, readAt: 0 };
  monthly.count += n;
  const cap = MONTHLY_CAP();
  if (monthly.count >= cap * 0.8 && warned80 !== m) {
    warned80 = m;
    console.warn(`[search] ${monthly.count} of ${cap} monthly searches used (80%).`);
  }
  let db: ReturnType<typeof getFirestore>;
  try {
    db = getFirestore();
  } catch {
    return; // no database access (e.g. local dev without credentials): the in-memory count still applies
  }
  const ref = db.collection('system').doc('searchBudget');
  db
    .runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : null;
      const count = d && d.month === m ? Number(d.count) || 0 : 0;
      tx.set(ref, { month: m, count: count + n, updatedAt: Date.now() });
    })
    .catch((e) => console.warn('[search] could not update the monthly count:', e?.message));
}

// ---- per-player daily allowance ----
const guestUse = new Map<string, { day: string; n: number }>();

/** May this player's question use search? `userData` is the player's user document (already loaded). */
export async function searchAllowed(opts: { uid: string; isGuest: boolean; fullAccess: boolean; userData: any }): Promise<boolean> {
  const limit = opts.fullAccess && !opts.isGuest ? PREMIUM_DAILY() : FREE_DAILY();
  let used = 0;
  if (opts.isGuest) {
    const g = guestUse.get(opts.uid);
    used = g && g.day === today() ? g.n : 0;
  } else {
    used = opts.userData?.searchDay === today() ? Number(opts.userData?.searchesToday) || 0 : 0;
  }
  if (used >= limit) return false;
  return monthlyBudgetOk();
}

/** Count the searches a question used, for the player and for the month. */
export function recordSearches(opts: { uid: string; isGuest: boolean; userData: any }, n: number): void {
  if (!n) return;
  recordMonthly(n);
  const day = today();
  if (opts.isGuest) {
    const g = guestUse.get(opts.uid);
    guestUse.set(opts.uid, { day, n: (g && g.day === day ? g.n : 0) + n });
    if (guestUse.size > 5000) guestUse.clear();
    return;
  }
  const sameDay = opts.userData?.searchDay === day;
  if (opts.userData) {
    opts.userData.searchDay = day;
    opts.userData.searchesToday = (sameDay ? Number(opts.userData.searchesToday) || 0 : 0) + n;
  }
  let db: ReturnType<typeof getFirestore>;
  try {
    db = getFirestore();
  } catch {
    return;
  }
  db
    .collection('users')
    .doc(opts.uid)
    .set(sameDay ? { searchDay: day, searchesToday: FieldValue.increment(n) } : { searchDay: day, searchesToday: n }, { merge: true })
    .catch((e) => console.warn('[search] could not update the player count:', e?.message));
}

// ---- remembered facts per game ----
// Facts never expire: the goal is a growing database of proven facts per game. Mistakes are fixed by correction:
//   - a later search that finds a different value replaces the fact (the old value is kept as `previous`)
//   - a player saying a fact is wrong marks it `disputed`, so the AI re-checks it with a search next time it can
//   - you can edit or delete any fact by hand in Firebase (gameFacts/{game} -> facts)
// Only facts the AI found in its own searches are saved, never something a player asserted.
type Fact = { subject: string; fact: string; at: number; place?: string; sources?: string[]; disputed?: boolean; previous?: string };
export type FactReport = { subject: string; fact?: string; status?: 'verified' | 'disputed' };
const factCache = new Map<string, { facts: Fact[]; readAt: number }>();

const gameKey = (game: string) =>
  game
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
const factId = (subject: string) => subject.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export async function getGameFacts(game: string | undefined): Promise<Fact[]> {
  if (!game) return [];
  const key = gameKey(game);
  if (!key) return [];
  const hit = factCache.get(key);
  if (hit && Date.now() - hit.readAt < 5 * 60_000) return hit.facts;
  try {
    const snap = await getFirestore().collection('gameFacts').doc(key).get();
    const map = (snap.exists ? snap.data()?.facts : null) || {};
    const facts = (Object.values(map) as Fact[]).filter((f) => f && f.subject && f.fact).sort((a, b) => b.at - a.at);
    factCache.set(key, { facts, readAt: Date.now() });
    return facts;
  } catch {
    return hit?.facts || [];
  }
}

/**
 * The facts to give the AI, most relevant first: facts about things named in the question or recent conversation,
 * then facts learned at the player's current place, then the newest. Kept to a sensible size.
 */
export function factsForPrompt(facts: Fact[], context: { text?: string; place?: string } = {}): string {
  if (!facts.length) return '';
  const text = (context.text || '').toLowerCase();
  const place = (context.place || '').toLowerCase();
  const score = (f: Fact) =>
    (text && text.includes(f.subject.toLowerCase()) ? 2 : 0) + (place && f.place && f.place.toLowerCase() === place ? 1 : 0);
  const picked = [...facts].sort((a, b) => score(b) - score(a) || b.at - a.at).slice(0, 40);
  const lines = picked.map((f) => `- ${f.subject}: ${f.fact}${f.disputed ? ' (a player said this may be wrong: re-check it with a search before relying on it)' : ''}`);
  return `[VERIFIED FACTS FOR THIS GAME (found with Google Search earlier; use these instead of searching again)]\n${lines.join('\n')}`;
}

/** Save what the AI reported. `searched` = this answer ran a search (required for new or changed facts). */
export function saveGameFacts(game: string | undefined, reports: FactReport[], opts: { searched: boolean; place?: string; sources?: string[] }): void {
  if (!game || !reports.length) return;
  const key = gameKey(game);
  if (!key) return;
  const now = Date.now();
  const cached = factCache.get(key);
  const known = new Map((cached?.facts || []).map((f) => [factId(f.subject), f]));
  const factsMap: Record<string, Partial<Fact>> = {};
  for (const r of reports.slice(0, 10)) {
    const subject = String(r.subject || '').trim().slice(0, 60);
    const id = factId(subject);
    if (!id) continue;
    const old = known.get(id);
    if (r.status === 'disputed') {
      // A player says it's wrong but it couldn't be re-checked yet: flag it, keep the value.
      if (old) factsMap[id] = { disputed: true };
      continue;
    }
    const fact = String(r.fact || '').trim().slice(0, 200);
    if (!fact || !opts.searched) continue; // new or changed facts need a search behind them
    const changed = old && old.fact.toLowerCase() !== fact.toLowerCase();
    factsMap[id] = {
      subject,
      fact,
      at: now,
      disputed: false,
      ...(opts.place ? { place: opts.place.slice(0, 80) } : {}),
      ...(opts.sources?.length ? { sources: opts.sources.slice(0, 3) } : {}),
      ...(changed ? { previous: old!.fact } : {}),
    };
    if (changed) console.log(`[facts] corrected ${game} / ${subject}: "${old!.fact}" -> "${fact}"`);
  }
  if (!Object.keys(factsMap).length) return;
  if (cached) {
    for (const [id, f] of Object.entries(factsMap)) {
      const i = cached.facts.findIndex((x) => factId(x.subject) === id);
      if (i >= 0) cached.facts[i] = { ...cached.facts[i], ...f } as Fact;
      else if (f.subject) cached.facts.unshift(f as Fact);
    }
  }
  let db: ReturnType<typeof getFirestore>;
  try {
    db = getFirestore();
  } catch {
    return;
  }
  db
    .collection('gameFacts')
    .doc(key)
    .set({ game: game.slice(0, 120), updatedAt: now, facts: factsMap }, { merge: true })
    .catch((e) => console.warn('[facts] could not save:', e?.message));
}

/** Web pages a response's searches used (domains), to note where a fact came from. */
export function searchSources(response: any): string[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const out: string[] = [];
  for (const c of chunks) {
    const t = String(c?.web?.title || c?.web?.domain || '').trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

/** Pull the <qc-facts> block out of an answer. */
export function extractFacts(text: string): { text: string; facts: FactReport[] } {
  const facts: FactReport[] = [];
  const cleaned = text.replace(/<qc-facts>([\s\S]*?)<\/qc-facts>/gi, (_m, body) => {
    try {
      const arr = JSON.parse(String(body).trim());
      if (Array.isArray(arr))
        for (const f of arr)
          if (f && f.subject)
            facts.push({
              subject: String(f.subject),
              fact: f.fact ? String(f.fact) : undefined,
              status: f.status === 'disputed' ? 'disputed' : 'verified',
            });
    } catch {
      /* dropped */
    }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), facts };
}
