/**
 * Answers read checked facts (owner, Nov 16 2026; roadmap 31 step 1, the database plan's step 3): the checked records
 * (gameRecords/{key}/records, status "checked", never disputed or unconfirmed) that a question names are given to the
 * answer as reference, and the answer's first try runs without the web search ("ask" mode: the model asks for a search
 * when the facts don't cover what was asked, and the question runs again with it). That's the cost lever: a search
 * avoided is about 1.4 cents.
 *
 * Rules (database-answer-quality): reference, never a limit; only checked facts; a new release always searches;
 * config/answerFacts.on switches it on (off by default) and its gate is the Nov 5 twenty-question test.
 * Any game with records, guide or not (gameRecords keys are guide keys, else baseGameKey).
 */
import { getFirestore } from 'firebase-admin/firestore';

type Rec = { id: string; type: string; name: string; place?: string; placeName?: string; fields?: Record<string, string>; status?: string; missable?: boolean; short?: string };

const norm = (s: string) => ` ${String(s || '').toLowerCase().normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/^the\s+/, '').replace(/[^a-z0-9']+/g, ' ').trim()} `;
const TTL = 30 * 60 * 1000;
const cache = new Map<string, { at: number; recs: Rec[] }>();
let cfg: { at: number; on: boolean } = { at: 0, on: false };

/** config/answerFacts.on (read at most once a minute). QC_ANSWER_FACTS=1 turns it on for a local test. */
export async function answerFactsOn(): Promise<boolean> {
  if (process.env.QC_ANSWER_FACTS === '1') return true;
  if (process.env.QC_ANSWER_FACTS === '0') return false;
  if (Date.now() - cfg.at < 60_000) return cfg.on;
  const on = ((await getFirestore().collection('config').doc('answerFacts').get().catch(() => null))?.data() as any)?.on === true;
  cfg = { at: Date.now(), on };
  return on;
}

/**
 * One answer that had checked facts: counted by UTC day in system/answerFacts.days (answers; searched: the facts didn't
 * cover it and it searched after all). Searches saved = answers − searched. For /stats.
 */
export async function tallyFacts(searched: boolean): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const { FieldValue } = await import('firebase-admin/firestore');
  await getFirestore().collection('system').doc('answerFacts').set({ days: { [day]: { answers: FieldValue.increment(1), searched: FieldValue.increment(searched ? 1 : 0) } } }, { merge: true });
}

/**
 * Step 2 (owner, Nov 16 2026): a 👎 on a Pro answer sends the checked facts it used to the front of the nightly
 * re-checks. Which facts: the same lookup again from the question (deterministic), so nothing links an answer or a
 * player to facts. Queued in gameRecords/{key}/recheck/{id} { votes, reasons, at }; counted in system/answerFacts.
 */
export async function flagFactsFromVote(key: string, question: string, reason: string | null): Promise<number> {
  if (!key || !String(question || '').trim()) return 0;
  const f = await factsForQuestion(key, question);
  if (!f.ids.length) return 0;
  const { FieldValue } = await import('firebase-admin/firestore');
  const batch = getFirestore().batch();
  for (const id of f.ids) batch.set(getFirestore().collection('gameRecords').doc(key).collection('recheck').doc(id), { votes: FieldValue.increment(1), ...(reason ? { reasons: FieldValue.arrayUnion(reason) } : {}), at: Date.now() }, { merge: true });
  const day = new Date().toISOString().slice(0, 10);
  batch.set(getFirestore().collection('system').doc('answerFacts'), { days: { [day]: { flagged: FieldValue.increment(f.ids.length) } } }, { merge: true });
  await batch.commit();
  return f.ids.length;
}

/** The last `n` UTC days' counts, oldest first. */
export async function factsDays(n = 7): Promise<{ day: string; answers: number; searched: number; flagged: number; confirmed: number; corrected: number; disputed: number }[]> {
  const d: any = (await getFirestore().collection('system').doc('answerFacts').get()).data() || {};
  const n0 = (x: any) => Number(x) || 0;
  return Object.keys(d.days || {}).sort().slice(-n).map((k) => ({ day: k, answers: n0(d.days[k].answers), searched: n0(d.days[k].searched), flagged: n0(d.days[k].flagged), confirmed: n0(d.days[k].confirmed), corrected: n0(d.days[k].corrected), disputed: n0(d.days[k].disputed) }));
}

/** A game's checked records with a usable name (cached 30 minutes). */
async function checkedRecords(key: string): Promise<Rec[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.recs;
  const snap = await getFirestore().collection('gameRecords').doc(key).collection('records').where('status', '==', 'checked').get();
  const recs = snap.docs.map((d) => d.data() as Rec).filter((r) => {
    const n = norm(r.name).trim();
    // A name a question can name: a few letters at least, not a sentence.
    return n.length >= 4 && n.split(' ').length <= 8 && !['step', 'advice', 'place', 'achievement'].includes(r.type);
  });
  cache.set(key, { at: Date.now(), recs });
  return recs;
}

const SKIP = new Set(['rank', 'kind', 'reason', 'tickable', 'group']);
const line = (r: Rec) => {
  const f = Object.entries(r.fields || {}).filter(([k, v]) => v && !SKIP.has(k)).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 220)}`);
  return `- ${r.name} (${r.type}${r.placeName || r.place ? `, ${r.placeName || r.place}` : ''}${r.missable ? ', missable' : ''}): ${[r.short, ...f].filter(Boolean).join('; ').slice(0, 600)}`;
};

/**
 * The checked facts a question names (whole words, longest names first, the player's area first), at most `max`.
 * `text` is the prompt block, empty when none.
 */
export async function factsForQuestion(key: string, question: string, placeSlug = '', max = 8): Promise<{ text: string; count: number; ids: string[] }> {
  const q = norm(question);
  if (!key || q.trim().length < 4) return { text: '', count: 0, ids: [] };
  const recs = await checkedRecords(key);
  const named = recs.filter((r) => q.includes(norm(r.name)))
    // A name inside a longer named one ("Mask" in "Mask Shard") is dropped when the longer one matched.
    .sort((a, b) => norm(b.name).length - norm(a.name).length);
  const kept: Rec[] = [];
  for (const r of named) if (!kept.some((k) => norm(k.name).includes(norm(r.name)) && k.name !== r.name)) kept.push(r);
  const ordered = kept.sort((a, b) => Number(b.place === placeSlug) - Number(a.place === placeSlug)).slice(0, max);
  if (!ordered.length) return { text: '', count: 0, ids: [] };
  return {
    count: ordered.length,
    ids: ordered.map((r) => r.id),
    text: `[CHECKED FACTS FROM THE QUEST COMPENDIUM DATABASE]\nThese facts about what the player named were checked against sources. Use them as reference: they are reliable for what they say. If they cover what the player asked, answer from them without searching; if the player asks for something they don't cover, ask for a search as instructed.\n${ordered.map(line).join('\n')}`,
  };
}
