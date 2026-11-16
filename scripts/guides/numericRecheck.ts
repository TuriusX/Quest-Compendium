/**
 * Numbers re-check (owner-approved Nov 16 2026, from the improvement fund, $8 hard stop): checked facts with numbers
 * (damage dice, AC, bonuses, %, DC, HP, levels, prices, durations) compared with the thing's own article on the game's
 * best wiki: its community wiki first (bg3.wiki for BG3), then Fextralife, then Fandom. Flash reads the article (no
 * search, about 0.1-0.2 cents a fact); for facts no article covers, the most-asked games get one searched check.
 * Results: gameRecords/{key}/numbers/{place} (laid over records by the import: records.ts applyNumbers), and the live
 * records are updated at once. Corrected text keeps the old text in numCheck.was (undo).
 * Order: games players ask about in the app (answerGames), then the rest by numeric facts. One article fetch at a time
 * per run, a short pause between them.
 *
 *   npx tsx scripts/guides/numericRecheck.ts [--only KEY] [--max-dollars 8] [--search-games 4] [--prior DOLLARS] [--dry-run]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars } from './common';
import { RECORDS } from './recordsImport';
import { contentSig, finish, type GameRecord, type NumberResult } from './records';
import { wikiFor } from './itemCards';

const UA = 'QuestCompendium/1.0 (+https://questcompendium.com)';
export const NUMERIC = /\b\d+d\d+\b|\b\d+\s*(AC|armou?r class|HP|hit points|damage|gold|DC)\b|\bDC\s*\d+|[+−-]\d+\b|\b\d+\s?%|\blevel\s*\d+|\b\d+\s*(turns|rounds|seconds|metres|meters|feet|ft)\b/i;
const SKIP_FIELDS = new Set(['where', 'how', 'rank', 'kind', 'reason', 'tickable', 'group']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statText = (r: GameRecord) => [r.short, ...Object.entries(r.fields || {}).filter(([k]) => !SKIP_FIELDS.has(k)).map(([, v]) => v)].filter(Boolean).join(' ');

/** The readable text of a wiki article (its main content), or ''. */
function textOf(html: string): string {
  const start = Math.max(0, html.search(/class="mw-parser-output"|id="wiki-content-block"|<main|<article/i));
  return html.slice(start).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
const get = async (url: string) => { const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10000) }).catch(() => null); return r?.status === 200 ? { url: r.url || url, html: await r.text().catch(() => '') } : null; };

/** The thing's article on the game's best wiki: community wiki, then Fextralife, then Fandom. */
async function articleFor(w: Awaited<ReturnType<typeof wikiFor>>, name: string): Promise<{ url: string; site: string; text: string } | null> {
  if (!w) return null;
  const underscore = encodeURIComponent(name.trim().replace(/ /g, '_')).replace(/%27/g, "'");
  const tries: { url: string; site: string }[] = [
    ...(w.more || []).map((m) => ({ url: `${m.page}${underscore}`, site: m.site })),
    ...(w.fextralife ? [{ url: `https://${w.fextralife}/${encodeURIComponent(name.trim().replace(/ /g, '+')).replace(/%2B/g, '+').replace(/%2C/g, ',').replace(/%27/g, "'")}`, site: 'Fextralife' }] : []),
    ...(w.fandom ? [{ url: `https://${w.fandom}/wiki/${underscore}`, site: 'Fandom' }] : []),
  ];
  for (const t of tries) {
    await sleep(800);
    const p = await get(t.url);
    if (!p) continue;
    const text = textOf(p.html);
    // The article must be about this thing (its name in the text) and say something numeric.
    if (text.length < 200 || !text.toLowerCase().includes(name.toLowerCase().slice(0, 40)) || !NUMERIC.test(text)) continue;
    // Around the name and the numbers: the start of the article, where the stats are, is enough.
    return { url: p.url, site: t.site, text: text.slice(0, 9000) };
  }
  return null;
}

type Verdict = { verdict: 'confirmed' | 'corrected' | 'not_covered'; fixes?: Record<string, string>; quote?: string; site?: string };
const ASK = (game: string, r: GameRecord, fields: Record<string, string>) =>
  `A checked fact about "${r.name}" (${r.type}) in the video game "${game}":\n${JSON.stringify({ short: r.short || '', ...fields })}\n\n`;
const RULES = 'Compare only the NUMBERS in the fact (damage dice, AC, bonuses, percentages, DCs, HP, levels, prices, durations) ' +
  'with what the source says about this same thing. "confirmed": the source states the same numbers. "corrected": the source clearly states different numbers for this same thing (not another edition, version, difficulty or a similar item); give in "fixes" each field whose numbers change, with the field\'s FULL text and only the numbers corrected. ' +
  '"not_covered": the source doesn\'t state these numbers, or it\'s unclear. Reply with JSON only: {"verdict": "confirmed" | "corrected" | "not_covered", "fixes": {"<field>": "<full corrected text>"}, "quote": "<the source\'s words for the numbers, short>", "site": "<the source site>"}';

async function judge(game: string, r: GameRecord, fields: Record<string, string>, article: { site: string; text: string } | null): Promise<Verdict | null> {
  const prompt = article
    ? `${ASK(game, r, fields)}SOURCE: the article on ${article.site}:\n"""${article.text}"""\n\n${RULES}`
    : `${ASK(game, r, fields)}Use Google Search to look these numbers up on the game's wikis (two searches at most). ${RULES}`;
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0, maxOutputTokens: 3000, ...(article ? { responseMimeType: 'application/json' } : { tools: [{ googleSearch: {} }] }), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } as any,
  });
  try { return JSON.parse(String(res?.text || '').match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch { return null; }
}

async function main() {
  const only = String(arg('only') || ''), max = Number(arg('max-dollars', '8')) || 8, searchGames = Number(arg('search-games', '4')) || 0;
  const dry = process.argv.includes('--dry-run');
  // --prior: spent by an earlier interrupted run of this re-check (never logged): counted toward the stop and logged now.
  const prior = Number(arg('prior', '0')) || 0;
  const asked = new Map<string, number>();
  for (const d of (await db().collection('answerGames').get()).docs) for (const [k, g] of Object.entries(d.data() as any)) asked.set(k, (asked.get(k) || 0) + (Number((g as any)?.q) || 0));
  const keys = only ? [only] : (await RECORDS().listDocuments()).map((d) => d.id);
  const games: { key: string; recs: GameRecord[] }[] = [];
  for (const key of keys) {
    // Done = a saved result for the record as it is now (the overlay), not the live record's numCheck alone.
    const done = new Map<string, string>();
    for (const d of (await RECORDS().doc(key).collection('numbers').get()).docs) for (const [id, x] of Object.entries(((d.data() as any).results || {}) as Record<string, NumberResult>)) done.set(id, x.sig);
    const recs = (await RECORDS().doc(key).collection('records').where('status', '==', 'checked').get()).docs.map((d) => d.data() as GameRecord)
      .filter((r) => NUMERIC.test(statText(r)) && !done.has(r.id));
    if (recs.length) games.push({ key, recs });
  }
  games.sort((a, b) => (asked.get(b.key) || 0) - (asked.get(a.key) || 0) || b.recs.length - a.recs.length);
  const searchOk = new Set(games.filter((g) => (asked.get(g.key) || 0) > 0).slice(0, searchGames).map((g) => g.key));
  console.log(`${games.reduce((n, g) => n + g.recs.length, 0)} numeric facts in ${games.length} games; searched checks for ${[...searchOk].join(', ') || 'none'}; stop at $${max.toFixed(2)}${dry ? ' (dry run)' : ''}.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);
  const t = { confirmed: 0, corrected: 0, not_covered: 0, articles: 0, searched: 0, failed: 0 };
  stop: for (const g of games) {
    const game = String(((await db().collection('guides').doc(g.key).get()).data() as any)?.game || ((await RECORDS().doc(g.key).get()).data() as any)?.game || g.key);
    const w = await wikiFor(g.key, game).catch(() => null);
    const byPlace = new Map<string, Record<string, NumberResult>>();
    for (const live of g.recs) {
      // A record an interrupted run already changed: back to its imported text first (numCheck.was), so the overlay's
      // sig matches what the import rebuilds.
      const was = (live as any).numCheck?.was as Record<string, string> | undefined;
      const r: GameRecord = was ? { ...live, fields: { ...live.fields, ...was } } : live;
      if (ledgerDollars() + prior + 0.04 >= max) { console.log(`Stopped before the $${max.toFixed(2)} stop.`); break stop; }
      const fields = Object.fromEntries(Object.entries(r.fields || {}).filter(([k, v]) => v && !SKIP_FIELDS.has(k))) as Record<string, string>;
      const article = await articleFor(w, r.name).catch(() => null);
      if (article) t.articles++;
      let v: Verdict | null = null;
      try {
        // The article first (no search); a searched check only for the most-asked games, when no article covers it.
        if (article) v = await judge(game, r, fields, article);
        if ((!v || v.verdict === 'not_covered') && searchOk.has(g.key)) { t.searched++; v = await judge(game, r, fields, null); }
      } catch (e: any) { t.failed++; console.warn(`${g.key} ${r.name}: ${String(e?.message || e).slice(0, 100)}`); if (/search day limit/i.test(String(e?.message))) searchOk.delete(g.key); continue; }
      const verdict = v?.verdict || 'not_covered';
      t[verdict]++;
      if (verdict === 'not_covered') continue;
      const fixes = verdict === 'corrected' ? Object.fromEntries(Object.entries(v!.fixes || {}).filter(([k, val]) => k in fields && typeof val === 'string' && val.trim() && val !== fields[k])) : undefined;
      if (verdict === 'corrected' && !Object.keys(fixes || {}).length) { t.corrected--; t.confirmed++; }
      const res: NumberResult = {
        sig: contentSig(r), status: verdict === 'corrected' && Object.keys(fixes || {}).length ? 'corrected' : 'confirmed',
        ...(fixes && Object.keys(fixes).length ? { fixes, was: Object.fromEntries(Object.keys(fixes).map((k) => [k, fields[k]])) } : {}),
        source: article?.url || String(v?.site || 'web search'), ...(v?.quote ? { quote: String(v.quote).slice(0, 300) } : {}), at: Date.now(),
      };
      const place = r.place || '_';
      byPlace.set(place, { ...(byPlace.get(place) || {}), [r.id]: res });
      // The overlay first, then the live record: an interrupted run never leaves a change the next import would undo.
      await RECORDS().doc(g.key).collection('numbers').doc(place).set({ results: { [r.id]: res }, at: Date.now() }, { merge: true });
      if (res.status === 'corrected') console.log(`  corrected ${g.key} / ${r.name}: ${JSON.stringify(res.was).slice(0, 160)} -> ${JSON.stringify(res.fixes).slice(0, 160)}`);
      // The live record at once (the import keeps it through the overlay below).
      const { hash: _h, ...rest } = r as any;
      await RECORDS().doc(g.key).collection('records').doc(r.id).set(finish({ ...rest, fields: res.status === 'corrected' ? { ...r.fields, ...res.fixes } : r.fields, numCheck: { status: res.status, source: res.source, ...(res.quote ? { quote: res.quote } : {}), at: res.at, ...(res.was ? { was: res.was } : {}) } } as any));
    }
    console.log(`${g.key}: ${g.recs.length} numeric facts | so far: ${t.confirmed} confirmed, ${t.corrected} corrected, ${t.not_covered} not covered | $${ledgerDollars().toFixed(3)}`);
  }
  // The improvement fund (system/improveFund): this run's spend and a line.
  const dollars = ledgerDollars() + prior;
  const ref = db().collection('system').doc('improveFund');
  const f: any = (await ref.get()).data() || {};
  await ref.set({ spent: Number(f.spent || 0) + dollars, log: [...(f.log || []), { at: Date.now(), kind: 'numbers', dollars, line: `numbers re-check: ${t.confirmed} confirmed, ${t.corrected} corrected, ${t.not_covered} not covered (${t.articles} from wiki articles, ${t.searched} searched)` }] }, { merge: true });
  console.log(`Done: ${t.confirmed} confirmed, ${t.corrected} corrected, ${t.not_covered} not covered, ${t.failed} failed; ${t.articles} wiki articles, ${t.searched} searched; $${dollars.toFixed(3)}. Fund ${(Number(f.spent || 0) + dollars).toFixed(2)} of ${f.budget}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/numericRecheck\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('numericRecheck failed:', e?.message || e); process.exit(1); });
