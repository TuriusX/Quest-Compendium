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
 * The game knowledge base: when the AI confirms something with a search (a weakness, where an item is), it reports it
 * in a <qc-facts> block, and it's stored per game with what, where, when and how sure (see below). Every player of that
 * game benefits: later questions get the facts for free, and answers stay consistent. Facts never expire; wrong ones
 * are corrected.
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

// ---- the game knowledge base ----
// One document per fact at gameFacts/{game}/facts/{id}, shared by every player of that game, never expiring. Each fact
// knows what it's about (kind), where it applies (place) and when (story point), where it came from (sources) and how
// often searches have backed it up (confirmations). The same facts feed the AI's answers today and the "known here"
// panel and guide pages later.
//   - Enemies and bosses are the same everywhere, so their id is just the name. Items, secrets, missables, NPCs and
//     places belong to a place, so "Potion" in one house and "Potion" in another are separate facts.
//   - Corrections: a search that finds a different value replaces the fact (old value kept as `previous`, confirmations
//     restart); the same value again adds a confirmation; a player saying it's wrong marks it `disputed` until re-checked.
//   - Only facts the AI found in its own searches are saved, never something a player asserted.
//   - Edit or delete any fact by hand in Firebase: gameFacts -> {game} -> facts.
export const FACT_KINDS = ['enemy', 'boss', 'item', 'secret', 'missable', 'npc', 'place', 'other'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
type Fact = {
  subject: string;
  fact: string;
  kind: FactKind;
  place?: string;
  story?: string;
  sources?: string[];
  confirmations: number;
  firstAt: number;
  at: number;
  disputed?: boolean;
  previous?: string;
};
export type FactReport = { subject: string; fact?: string; kind?: string; status?: 'verified' | 'disputed' };
const factCache = new Map<string, { facts: Map<string, Fact>; readAt: number }>();

const slug = (x: string, max = 80) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
const gameKey = (game: string) => slug(game, 80);
// NPCs belong to a place too (a shopkeeper, a quest giver): "the Relic Merchant sells Sprint Shoes" is a fact about the shop.
const PLACE_BOUND = new Set<FactKind>(['item', 'secret', 'missable', 'place', 'npc']);
const asKind = (k: unknown): FactKind => (FACT_KINDS as readonly string[]).includes(String(k)) ? (String(k) as FactKind) : 'other';
const factId = (subject: string, kind: FactKind, place?: string) =>
  (PLACE_BOUND.has(kind) && place ? `${slug(subject, 60)}@${slug(place, 60)}` : slug(subject, 60)) || '';

function db(): ReturnType<typeof getFirestore> | null {
  try {
    return getFirestore();
  } catch {
    return null; // no database access (e.g. local dev without credentials)
  }
}

export async function getGameFacts(game: string | undefined): Promise<Fact[]> {
  if (!game) return [];
  const key = gameKey(game);
  if (!key) return [];
  const hit = factCache.get(key);
  if (hit && Date.now() - hit.readAt < 5 * 60_000) return [...hit.facts.values()];
  const d = db();
  if (!d) return hit ? [...hit.facts.values()] : [];
  try {
    const facts = new Map<string, Fact>();
    // Facts saved before the knowledge base had its own documents lived in one map on the game document.
    const legacy = await d.collection('gameFacts').doc(key).get();
    const old = (legacy.exists ? legacy.data()?.facts : null) || {};
    for (const f of Object.values(old) as any[]) {
      if (!f?.subject || !f?.fact) continue;
      const kind = asKind(f.kind);
      facts.set(factId(f.subject, kind, f.place), { confirmations: 1, firstAt: f.at || 0, kind, ...f });
    }
    const snap = await d.collection('gameFacts').doc(key).collection('facts').orderBy('at', 'desc').limit(3000).get();
    snap.forEach((doc) => {
      const f = doc.data() as Fact;
      if (f?.subject && f?.fact) facts.set(doc.id, f);
    });
    factCache.set(key, { facts, readAt: Date.now() });
    return [...facts.values()];
  } catch (e: any) {
    console.warn('[facts] could not read:', e?.message);
    return hit ? [...hit.facts.values()] : [];
  }
}

/**
 * The facts to give the AI, most relevant first: things named in the question or recent conversation, then facts for
 * the player's current place, then the best-confirmed and newest. Kept to a sensible size.
 */
export function factsForPrompt(facts: Fact[], context: { text?: string; place?: string } = {}): string {
  if (!facts.length) return '';
  const text = (context.text || '').toLowerCase();
  const place = (context.place || '').toLowerCase();
  const score = (f: Fact) =>
    (text && text.includes(f.subject.toLowerCase()) ? 4 : 0) +
    (place && f.place && f.place.toLowerCase() === place ? 2 : 0) +
    Math.min(1, (f.confirmations || 1) / 3);
  const picked = [...facts].sort((a, b) => score(b) - score(a) || b.at - a.at).slice(0, 40);
  const lines = picked.map((f) => {
    const tags = [f.kind !== 'other' ? f.kind : '', f.place || '', f.story || ''].filter(Boolean).join(', ');
    return `- ${f.subject}${tags ? ` (${tags})` : ''}: ${f.fact}${f.disputed ? ' [a player said this may be wrong: re-check it with a search before relying on it]' : ''}`;
  });
  return `[VERIFIED FACTS FOR THIS GAME (found with Google Search earlier; use these instead of searching again)]\n${lines.join('\n')}`;
}

/**
 * Save what the AI reported. `searched` = this answer ran a search (required for new or changed facts). `place` and
 * `story` are only passed when known (confirmed by the player, or something on screen settled it).
 */
export function saveGameFacts(
  game: string | undefined,
  reports: FactReport[],
  opts: { searched: boolean; place?: string; story?: string; sources?: string[] },
): number {
  if (!game || !reports.length) return 0;
  const key = gameKey(game);
  if (!key) return 0;
  const now = Date.now();
  let cached = factCache.get(key);
  if (!cached) {
    cached = { facts: new Map(), readAt: 0 }; // unknown yet: writes still merge safely in the database
    factCache.set(key, cached);
  }
  const writes: { id: string; data: Partial<Fact> }[] = [];
  for (const r of reports.slice(0, 10)) {
    const subject = String(r.subject || '').trim().slice(0, 60);
    const kind = asKind(r.kind);
    const place = PLACE_BOUND.has(kind) ? opts.place?.slice(0, 80) : undefined;
    const id = factId(subject, kind, place);
    if (!id) continue;
    const old = cached.facts.get(id);
    if (r.status === 'disputed') {
      if (old) writes.push({ id, data: { disputed: true } }); // keep the value, flag it for a re-check
      continue;
    }
    const fact = String(r.fact || '').trim().slice(0, 200);
    if (!fact || !opts.searched) continue; // new or changed facts need a search behind them
    const same = old && old.fact.toLowerCase() === fact.toLowerCase();
    const data: Fact = {
      subject,
      fact,
      kind,
      ...(place ? { place } : {}),
      ...(place && opts.story ? { story: opts.story.slice(0, 120) } : old?.story ? { story: old.story } : {}),
      sources: [...new Set([...(same ? old?.sources || [] : []), ...(opts.sources || [])])].slice(0, 5),
      confirmations: same ? (old!.confirmations || 1) + 1 : 1,
      firstAt: same ? old!.firstAt || now : now,
      at: now,
      disputed: false,
      ...(old && !same ? { previous: old.fact } : old?.previous ? { previous: old.previous } : {}),
    };
    if (old && !same) console.log(`[facts] corrected ${game} / ${subject}: "${old.fact}" -> "${fact}"`);
    writes.push({ id, data });
  }
  if (!writes.length) return 0;
  for (const w of writes) cached.facts.set(w.id, { ...(cached.facts.get(w.id) || {}), ...w.data } as Fact);
  const saved = writes.filter((w) => w.data.fact).length; // learned or re-confirmed (not just flagged as disputed)
  const d = db();
  if (!d) return saved;
  const batch = d.batch();
  const gameRef = d.collection('gameFacts').doc(key);
  batch.set(gameRef, { game: game.slice(0, 120), updatedAt: now }, { merge: true });
  for (const w of writes) batch.set(gameRef.collection('facts').doc(w.id), w.data, { merge: true });
  batch.commit().catch((e) => console.warn('[facts] could not save:', e?.message));
  return saved;
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
              kind: f.kind ? String(f.kind).toLowerCase() : undefined,
              status: f.status === 'disputed' ? 'disputed' : 'verified',
            });
    } catch {
      /* dropped */
    }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), facts };
}
