/**
 * Answers grow the game knowledge base (owner, Nov 22 2026: "Start it all"; roadmap 31 step 3). The knowledge base
 * (searchGuard.ts, gameFacts/{game}/facts) is what later answers get as facts found earlier, so they need not search
 * again. Until now it only grew when the answering model chose to add a <qc-facts> line, which Gemini 4 Hydrogen
 * hardly ever does (1-7 facts a day across every game, Nov 2026), so the same thing got searched again and again.
 *
 * Now, after an answer that searched and reported no facts of its own: one cheap call (Flash, no search, about 0.2
 * cents) reads ONLY the parts of the answer that Google's grounding data says a search result backs up, and lists the
 * exact, reusable facts in them. They're saved like the model's own reports (searchGuard.saveGameFacts: sources kept, a
 * repeat adds a confirmation, a different value replaces the old one and keeps it as `previous`), and the nightly
 * records import takes them in for the fact checks.
 *
 * Rules: facts only, never the question, the player or the answer itself; only what a search backed; only about the
 * game asked about (a fact about another game is dropped, not filed under this one).
 */
import { ThinkingLevel } from '@google/genai';
import { logUsage } from './usage';
import { FACT_KINDS, type FactReport } from './searchGuard';

type Gen = { models: { generateContent: (r: any) => Promise<any> } };
export const LEARN_MODEL = process.env.LEARN_MODEL || 'gemini-3.8-flash';
/** At most this many facts from one answer. */
export const LEARN_MAX = 6;

const parse = (t: string): any => {
  const s = String(t || '').replace(/```json|```/g, '');
  const a = s.indexOf('['), z = s.lastIndexOf(']');
  try { return a >= 0 && z > a ? JSON.parse(s.slice(a, z + 1)) : null; } catch { return null; }
};

/** The search-backed parts of an answer, de-duplicated and kept to a sensible size. */
export function backedText(grounded: string[], max = 4000): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of grounded) {
    const t = String(g || '').replace(/\s+/g, ' ').trim();
    if (t.length < 12 || seen.has(t)) continue;
    seen.add(t);
    out.push(`- ${t}`);
  }
  return out.join('\n').slice(0, max);
}

/** Whether an answer is worth the look: it searched, a search backed some of it, and it reported no facts itself. */
export function shouldLearn(o: { searched: number; grounded: string[]; reported: FactReport[] }): boolean {
  return o.searched > 0 && backedText(o.grounded).length >= 40 && !o.reported.some((r) => r.status !== 'disputed' && r.fact);
}

/** The facts in an answer's search-backed parts, as knowledge-base reports (empty when none). */
export async function learnFromAnswer(ai: Gen, o: { game: string; grounded: string[] }): Promise<FactReport[]> {
  const backed = backedText(o.grounded);
  if (!o.game || backed.length < 40) return [];
  const prompt =
    `These sentences come from an answer about the video game "${o.game}". Each one was backed by a Google Search result.\n` +
    `${backed}\n\n` +
    'List the exact game facts in them that another player of this game could reuse: where an item, NPC or secret is, what ' +
    'something drops or costs, an enemy or boss weakness, a requirement, a reward, what is missable and when. Rules:\n' +
    '- Only what these sentences state. Never add anything from memory.\n' +
    `- Only facts about "${o.game}" itself. Leave out anything about another game, a remake or another version.\n` +
    '- Leave out advice, opinions, strategy, anything about the player or their situation, and anything vague.\n' +
    '- "subject": the thing\'s in-game name, short. "fact": one short exact sentence (under 200 characters).\n' +
    `- "kind": one of ${FACT_KINDS.join(', ')}.\n` +
    `- At most ${LEARN_MAX}. None is a fine answer.\n` +
    'Reply with a JSON array only: [{"subject": "...", "kind": "...", "fact": "..."}] or [].';
  const res = await ai.models.generateContent({
    model: LEARN_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0, maxOutputTokens: 2500, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  logUsage('learn-facts', LEARN_MODEL, res);
  const arr = parse(res?.text || '');
  if (!Array.isArray(arr)) return [];
  const hay = backed.toLowerCase();
  const out: FactReport[] = [];
  for (const f of arr.slice(0, LEARN_MAX)) {
    const subject = String(f?.subject || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const fact = String(f?.fact || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    // The subject must be in a backed sentence (the same test the model's own reports pass: factsBackedBySearch).
    if (subject.length < 3 || fact.length < 8 || !hay.includes(subject.toLowerCase())) continue;
    const kind = (FACT_KINDS as readonly string[]).includes(String(f?.kind)) ? String(f.kind) : 'other';
    // Two facts about the same thing are one knowledge-base entry (the second would replace the first): joined.
    const same = out.find((x) => x.subject!.toLowerCase() === subject.toLowerCase() && x.kind === kind);
    if (same) { if ((same.fact!.length + fact.length + 1) <= 200) same.fact = `${same.fact} ${fact}`; continue; }
    out.push({ subject, fact, kind, status: 'verified' });
  }
  return out;
}
