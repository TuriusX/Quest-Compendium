/**
 * Fact database step 2 (roadmap 29): the facts a page's prose holds that its records don't yet, pulled out once per
 * page with Flash (no searches). For each page (an area or a compendium page) it reads the page's records and their
 * prose (the walkthrough text, overview, tips, advice, a compendium page's answers and story) and asks for:
 *   shorts  a one-line version of each step and tip, for tables and the overlay (no new facts)
 *   fills   a missing field of an existing record that the prose states (a missable's lockout, its final step)
 *   adds    a fact the prose states that has no record (a point of no return, a warning, an item met on the way)
 * Every fill and add must quote the prose word for word; anything whose quote isn't in the page's prose is dropped. So
 * nothing comes from the model's own knowledge: what goes in is what the page already says (and its check covered).
 *
 * Saved in gameRecords/{key}/extracted/{slug} with the prose's signature; recordsImport.ts lays it over the page's
 * records on every import while the prose is unchanged (a changed page is extracted again). Added records come in
 * as tier B (recheck from stored evidence), filled fields are named in the record's `extracted` list.
 *
 *   npx tsx scripts/guides/recordsExtract.ts --only KEY[,KEY] [--max-dollars 2] [--dry-run] [--redo]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledger, ledgerDollars } from './common';
import { RECORDS } from './recordsImport';
import { proseOf, type GameRecord } from './records';

export type Extracted = {
  sig: string;
  shorts: { id: string; short: string }[];
  fills: { id: string; field: string; value: string; quote: string }[];
  adds: { type: string; name: string; fields: Record<string, string>; missable?: boolean; step?: string; quote: string }[];
  dropped: number;
  dollars: number;
  at: number;
};

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^a-z0-9'"%+-]+/g, ' ').trim();
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const FILL_FIELDS = ['where', 'how', 'lockout', 'weakness', 'weaknesses', 'rewards', 'sells', 'giver', 'startsAt'];
const ADD_TYPES = ['item', 'noreturn', 'warning', 'npc', 'boss', 'tip', 'other'];

const compact = (r: GameRecord) => {
  const f = Object.fromEntries(Object.entries(r.fields || {}).filter(([k]) => !['tip', 'warn', 'note', 'notes', 'icon'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => cut(x, 160)) : cut(v, 200)]));
  return { id: r.id, type: r.type, name: cut(r.name, 120), ...(r.missable ? { missable: true } : {}), ...(r.gaps?.length ? { gaps: r.gaps } : {}), fields: f };
};

function prompt(game: string, place: string, recs: GameRecord[], prose: string): string {
  const shortIds = recs.filter((r) => (r.type === 'step' || r.type === 'tip' || r.type === 'advice') && r.prose?.text).map((r) => r.id);
  return [
    `These are the records (facts) of the page "${place}" in a guide to the video game "${game}", and the page's TEXT (its prose).`,
    'Use ONLY the TEXT. Never add anything from your own knowledge, never guess, never reword a fact into something the TEXT does not say.',
    '',
    'Reply with JSON only:',
    '{"shorts": [{"id": "record id", "short": "the record\'s text as ONE plain line of at most 110 characters: the action and the place, no new facts"}],',
    ' "fills": [{"id": "record id", "field": "where|how|lockout|weakness|rewards|sells|giver|startsAt", "value": "the missing value, short", "quote": "the exact words from the TEXT that state it (copy them character for character, 5-40 words)"}],',
    ' "adds": [{"type": "item|noreturn|warning|npc|boss|tip|other", "name": "short name", "fields": {"where": "", "how": "", "lockout": "", "text": "one sentence"}, "missable": true|false, "step": "the step record id it belongs to, or empty", "quote": "the exact words from the TEXT (5-40 words)"}]}',
    '',
    `shorts: one for each of these ids: ${shortIds.join(', ') || '(none)'}.`,
    'fills: only where a record has an empty field (or a gap) and the TEXT clearly states it, especially a missable\'s lockout ("what locks it out") and its final step ("how").',
    'adds: only facts a player needs that no record covers: points of no return (what you lose when you go past), warnings ("don\'t do X or Y happens"), items or NPCs the TEXT names with where to find them. At most 12. Not story summary, not general advice.',
    '',
    'RECORDS:',
    JSON.stringify(recs.map(compact)),
    '',
    'TEXT:',
    prose,
  ].join('\n');
}

async function extractPage(game: string, place: string, recs: GameRecord[]): Promise<Extracted | null> {
  const { text, sig } = proseOf(recs);
  if (!text.trim()) return null;
  const before = ledgerDollars();
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt(game, place, recs, text) }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let j: any = {};
  try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { j = {}; }
  const hay = norm(text);
  const quoted = (q: string) => { const n = norm(q); return n.split(' ').length >= 4 && hay.includes(n); };
  const ids = new Set(recs.map((r) => r.id));
  let dropped = 0;
  const shorts = (Array.isArray(j.shorts) ? j.shorts : []).filter((s: any) => ids.has(String(s?.id)) && cut(s?.short, 200).length >= 8).map((s: any) => ({ id: String(s.id), short: cut(s.short, 140) }));
  const fills = (Array.isArray(j.fills) ? j.fills : []).filter((f: any) => {
    const ok = ids.has(String(f?.id)) && FILL_FIELDS.includes(String(f?.field)) && cut(f?.value, 400) && quoted(String(f?.quote || ''));
    if (!ok) dropped++;
    return ok;
  }).map((f: any) => ({ id: String(f.id), field: String(f.field), value: cut(f.value, 300), quote: cut(f.quote, 400) }));
  const adds = (Array.isArray(j.adds) ? j.adds : []).slice(0, 12).filter((a: any) => {
    const ok = ADD_TYPES.includes(String(a?.type)) && cut(a?.name, 160) && quoted(String(a?.quote || ''));
    if (!ok) dropped++;
    return ok;
  }).map((a: any) => ({
    type: String(a.type), name: cut(a.name, 160), missable: !!a.missable, step: ids.has(String(a.step)) ? String(a.step) : '', quote: cut(a.quote, 400),
    fields: Object.fromEntries(['where', 'how', 'lockout', 'text'].map((k) => [k, cut(a.fields?.[k], 300)]).filter(([, v]) => v)),
  }));
  return { sig, shorts, fills, adds, dropped, dollars: Math.round((ledgerDollars() - before) * 10000) / 10000, at: Date.now() };
}

async function main() {
  const keys = String(arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) throw new Error('--only KEY[,KEY] is required (the pilot runs per game)');
  const max = Number(arg('max-dollars', '2')) || 2;
  const dry = process.argv.includes('--dry-run');
  const redo = process.argv.includes('--redo');
  const t = { pages: 0, skipped: 0, shorts: 0, fills: 0, adds: 0, dropped: 0 };
  outer: for (const key of keys) {
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
    const all = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord).filter((r) => r.place && r.origin?.from !== 'gameFacts');
    const byPlace = new Map<string, GameRecord[]>();
    for (const r of all) if (r.origin.from !== 'achievements') byPlace.set(r.place!, [...(byPlace.get(r.place!) || []), r]);
    // Most-visited pages first, so a stop at the cap leaves the least-wanted ones for later.
    const places = [...byPlace.entries()].sort((a, b) => (b[1][0].impressions || 0) - (a[1][0].impressions || 0));
    const todo: [string, GameRecord[]][] = [];
    for (const [slug, recs] of places) {
      const { text, sig } = proseOf(recs);
      // Too little prose to hold anything the records don't (a one-line overview): nothing to pull out.
      if (text.length < 250) continue;
      const have: any = (await RECORDS().doc(key).collection('extracted').doc(slug).get()).data();
      if (!redo && have?.sig === sig) { t.skipped++; continue; }
      todo.push([slug, recs]);
    }
    // Four pages at a time; the cap is checked before each group (a group costs a few cents at most).
    for (let i = 0; i < todo.length; i += 4) {
      if (ledgerDollars() >= max - 0.1) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break outer; }
      const group = todo.slice(i, i + 4);
      if (dry) { group.forEach(([slug]) => console.log(`would extract ${key}/${slug}`)); t.pages += group.length; continue; }
      let capped = false;
      await Promise.all(group.map(async ([slug, recs]) => {
        try {
          const x = await extractPage(game, recs[0].placeName || slug, recs);
          if (!x) return;
          await RECORDS().doc(key).collection('extracted').doc(slug).set(x);
          t.pages++; t.shorts += x.shorts.length; t.fills += x.fills.length; t.adds += x.adds.length; t.dropped += x.dropped;
          console.log(`${key}/${slug}: ${x.shorts.length} shorts, ${x.fills.length} fills, ${x.adds.length} adds, ${x.dropped} dropped (quote not in the text), $${x.dollars.toFixed(4)}`);
        } catch (e: any) {
          console.warn(`${key}/${slug} skipped: ${e?.message}`);
          if (/spending cap/.test(String(e?.message))) capped = true;
        }
      }));
      if (capped) break outer;
    }
  }
  console.log(`Extracted ${t.pages} page(s) (${t.skipped} unchanged): ${t.shorts} shorts, ${t.fills} fills, ${t.adds} new facts, ${t.dropped} dropped; $${ledgerDollars().toFixed(4)} in ${ledger.calls} call(s), $${(t.pages ? ledgerDollars() / t.pages : 0).toFixed(4)} a page.`);
  setTimeout(() => process.exit(0), 300);
}
if (/recordsExtract\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('recordsExtract failed:', e?.message || e); process.exit(1); });
