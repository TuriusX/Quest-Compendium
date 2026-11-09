/**
 * Fact database: locations a player can actually follow (owner, Nov 9 2026). An item whose location only names the
 * spot ("Inside an Ornate Chest concealed underneath the Scuffed Rock") gets one that starts from something on the map
 * (coordinates if the game shows them, a waypoint, a named NPC, a major landmark) and ends at the object.
 *
 *   default   from the page's own text, with Flash and no searches: only for items the text has directions for. Every
 *             location must quote another fact on the page word for word, and any number in it must be in that text.
 *   --search  from the web: one searched call per page, missables on the most-searched pages first. A location is kept
 *             only if a trusted source backs it and the claim check on the page's evidence supports it.
 *
 * Saved in gameRecords/{key}/located/{slug}; recordsImport.ts lays it over the records while the text it replaces is
 * unchanged, so an owner's edit or a rebuild always wins. What wasn't found is tried again after 30 days.
 *
 *   npx tsx scripts/guides/recordsLocate.ts [--search] --only KEY[,KEY] [--max-dollars N] [--dry-run] [--redo]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledger, ledgerDollars, searchesIn } from './common';
import { claimCheck, claimSlots, supportedSegments, trusted, trustedSites, type Evidence, type EvidencePack, type ClaimPage } from './claimCheck';
import { RECORDS } from './recordsImport';
import { vagueWhere, type GameRecord, type LocatedEntry } from './records';

const RETRY_MS = 30 * 86_400_000;
const MAX_TARGETS = 15;
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^a-z0-9'"%+-]+/g, ' ').trim();
const f = (r: GameRecord, k: string) => { const v = r.fields?.[k]; return Array.isArray(v) ? v.join('; ') : String(v || ''); };
/** Everything a record says that could place something: its prose and its text fields. */
const textOf = (r: GameRecord) => [...Object.values(r.prose || {}), ...['where', 'how', 'text', 'tip', 'warn', 'note', 'notes', 'fact'].map((k) => f(r, k))].filter(Boolean).join(' ');
const numbersIn = (s: string): string[] => [...(s.match(/-?\d+/g) || [])];
/** The name-like words of a text (capitalized, not opening a sentence): the places and people it mentions. */
const namesIn = (s: string): string[] => [...s.matchAll(/(?<![.!?:;]\s|^)\b[A-Z][a-z'’]{3,}\b/g)].map((m) => m[0]);

type Page = { key: string; game: string; slug: string; place: string; recs: GameRecord[]; targets: GameRecord[]; stepOf: Map<string, GameRecord>; impressions: number; have: any };
type Result = { results: Record<string, LocatedEntry>; tried: string[]; dollars: number };

const entryId = (r: GameRecord) => String(r.origin?.entry ?? '');

/** Page mode: the items the page's text says something about (their walkthrough step, or their name in another fact). */
function textKnows(p: Page, r: GameRecord): boolean {
  if (p.stepOf.has(r.id)) return true;
  const name = norm(r.name);
  return name.length >= 4 && p.recs.some((o) => o.id !== r.id && norm(textOf(o)).includes(name));
}

function pagePrompt(p: Page, targets: GameRecord[], text: string): string {
  return [
    `These items are on the page "${p.place}" of a guide to the video game "${p.game}". Their locations only name the spot, so a player can't find them. Rewrite each location from the page's TEXT.`,
    'Use ONLY the TEXT. Never add anything from your own knowledge, never guess.',
    '',
    'Reply with JSON only: {"located": [{"id": "item id", "where": "the location", "quote": "the exact words from the TEXT that give the position (copy character for character, 5-40 words)"}]}',
    '',
    'A "where" starts from something the player can find on the map (map coordinates if the TEXT gives them, otherwise a waypoint, a named NPC or a major landmark), says which way to go, and ends at the exact container or object. At most 200 characters.',
    'Things listed in the same container share one location. "step" names the walkthrough step that collects the item.',
    'Use the TEXT\'s own place names and words: never call something a waypoint or a landmark unless the TEXT does.',
    'Leave an item out if the TEXT does not say where it or its container is.',
    '',
    'ITEMS:',
    JSON.stringify(targets.map((r) => ({ id: r.id, name: cut(r.name, 120), where: f(r, 'where'), how: f(r, 'how'), ...(p.stepOf.has(r.id) ? { step: p.stepOf.get(r.id)!.id } : {}) }))),
    '',
    'TEXT:',
    text,
  ].join('\n');
}

async function fromPage(p: Page): Promise<Result> {
  const before = ledgerDollars();
  const targets = p.targets.filter((r) => textKnows(p, r)).slice(0, 40);
  const results: Record<string, LocatedEntry> = {};
  if (!targets.length) return { results, tried: [], dollars: 0 };
  const others = p.recs.filter((r) => textOf(r));
  const text = others.map((r) => `[${r.id}${r.type === 'item' ? ` ${r.name}` : ''}] ${textOf(r)}`).join('\n').slice(0, 60000);
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: pagePrompt(p, targets, text) }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let j: any = {};
  try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { j = {}; }
  const byId = new Map(targets.map((r) => [r.id, r]));
  for (const x of Array.isArray(j.located) ? j.located : []) {
    const r = byId.get(String(x?.id));
    const where = cut(x?.where, 260);
    const quote = cut(x?.quote, 400);
    if (!r || where.length < 20 || vagueWhere(where) || where === f(r, 'where')) continue;
    const q = norm(quote);
    // The position has to be stated by another fact on the page, not the item's own vague line.
    const source = q.split(' ').length >= 4 ? others.filter((o) => o.id !== r.id && norm(textOf(o)).includes(q)) : [];
    if (!source.length) continue;
    const hay = source.map(textOf).join(' ');
    if (!numbersIn(where).every((n) => numbersIn(hay).includes(n))) continue;
    // The text has to be about this item: the step that collects it, or it names the item or a place its old location named.
    const own = norm(`${r.name} ${f(r, 'where')} ${f(r, 'how')}`);
    const about = norm(hay);
    const step = p.stepOf.get(r.id);
    if (!(step && source.includes(step)) && !about.includes(norm(r.name)) && !namesIn(f(r, 'where')).some((w) => about.includes(norm(w)))) continue;
    // Nothing the text doesn't say: no invented fast-travel point, no place or person from elsewhere.
    if (/waypoint|fast travel/i.test(where) && !/waypoint|fast travel/i.test(hay)) continue;
    if (!namesIn(where).every((w) => about.includes(norm(w)) || own.includes(norm(w)))) continue;
    results[r.id] = { was: f(r, 'where'), where, from: 'page', quote, ...(source.some((o) => o.status === 'checked') ? {} : { unconfirmedSource: true }) };
  }
  return { results, tried: targets.map((r) => r.id), dollars: ledgerDollars() - before };
}

/** Search mode: one searched call about these items, added to the page's evidence pack (kept for later checks). */
async function fromSearch(p: Page): Promise<Result> {
  const before = ledgerDollars();
  const targets = [...p.targets].sort((a, b) => Number(!!b.missable) - Number(!!a.missable)).slice(0, MAX_TARGETS);
  const ref = db().collection('evidencePacks').doc(`${p.key}__${p.slug}`);
  const have = ((await ref.get()).data() as EvidencePack | undefined) || { key: p.key, slug: p.slug, game: p.game, area: p.place, evidence: [], sites: [], servicesComplete: false, searches: 0, at: 0 };
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `In the video game "${p.game}", the place "${p.place}": for each item below, find exactly where a player has to go to get it. Run a few searches (at most four).`,
      'Answer with one line per item, starting with the item\'s exact name and a colon. The line starts from something the player can find on the map (map coordinates if the game shows them and a source gives them, otherwise a fast-travel point, a named NPC or a major landmark), says which way to go, and ends at the exact container or object. For example: "Iguana Egg: from the Penthouse waypoint, go through the entrance hall to the terrarium on the left."',
      'Only what the sources say. If the sources don\'t place an item, leave it out.',
      '',
      ...targets.map((r) => `- ${cut(r.name, 120)}${f(r, 'where') ? ` (so far we only know: ${cut(f(r, 'where'), 120)})` : ''}`),
    ].join('\n') }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  // Our own site can turn up in the results: it can't be the source for what it already says.
  const segs = supportedSegments(res).map((x) => ({ ...x, sites: x.sites.filter((site) => !/questcompendium/i.test(site)) })).filter((x) => x.sites.length);
  const evidence: Evidence[] = [...(have.evidence || [])];
  const sites = new Set<string>(have.sites || []);
  for (const seg of segs) {
    if (evidence.some((e) => e.text === seg.text)) continue;
    evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: 'locations' });
    seg.sites.forEach((s) => sites.add(s));
  }
  const pack: EvidencePack = { ...have, key: p.key, slug: p.slug, game: p.game, area: have.area || p.place, evidence, sites: [...sites], searches: (have.searches || 0) + searchesIn(res), at: Date.now() };
  await ref.set(JSON.parse(JSON.stringify(pack)));

  // Each item's proposed location: the sourced line that starts with its name.
  const proposals: { r: GameRecord; where: string; sources: string[] }[] = [];
  for (const r of targets) {
    const name = norm(r.name);
    const seg = segs.find((s) => { const i = s.text.indexOf(':'); return i > 0 && norm(s.text.slice(0, i)) === name && trustedSites(s.sites).length; });
    if (!seg) continue;
    const where = cut(seg.text.slice(seg.text.indexOf(':') + 1), 2000);
    // Too long to be one clear location (and never cut off mid-sentence).
    if (where.length >= 20 && where.length <= 320 && !vagueWhere(where)) proposals.push({ r, where, sources: trustedSites(seg.sites).slice(0, 4) });
  }
  const results: Record<string, LocatedEntry> = {};
  if (proposals.length) {
    const page: ClaimPage = { steps: [], entries: proposals.map(({ r, where }) => ({ id: r.id, name: r.name, where, how: f(r, 'how'), lockout: f(r, 'lockout') })), choices: [], advice: [], services: [], fights: [] };
    const verdicts = await claimCheck(p.game, p.place, claimSlots(page), trusted(pack));
    proposals.forEach(({ r, where, sources }, i) => {
      const mine = verdicts.filter((v) => v.label === `E${i + 1}` && v.verdict !== 'general');
      if (mine.find((v) => v.kind === 'location')?.verdict !== 'supported') return;
      // The whole record counts as checked only if its other claims (how, what locks it out) held up too.
      results[r.id] = { was: f(r, 'where'), where, from: 'search', sources, ...(mine.every((v) => v.verdict === 'supported') ? { checked: true } : r.status === 'checked' ? { unconfirmedSource: true } : {}) };
    });
  }
  return { results, tried: targets.map((r) => r.id), dollars: ledgerDollars() - before };
}

async function main() {
  const keys = String(arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) throw new Error('--only KEY[,KEY] is required');
  const search = process.argv.includes('--search');
  const dry = process.argv.includes('--dry-run');
  const redo = process.argv.includes('--redo');
  const max = Number(arg('max-dollars', search ? '1.5' : '1.25')) || 1;
  const triedField = search ? 'triedSearch' : 'triedPage';
  const pages: Page[] = [];
  for (const key of keys) {
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
    const recs = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord).filter((r) => r.place && r.origin?.from !== 'gameFacts' && r.origin?.from !== 'achievements');
    if (!recs.some((r) => r.gaps?.includes('vague where'))) continue;
    const areas = new Map<string, any>((await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => [d.id, d.data()]));
    const located = new Map<string, any>((await RECORDS().doc(key).collection('located').get()).docs.map((d) => [d.id, d.data()]));
    const byPlace = new Map<string, GameRecord[]>();
    recs.forEach((r) => byPlace.set(r.place!, [...(byPlace.get(r.place!) || []), r]));
    for (const [slug, rs] of byPlace) {
      const area = areas.get(slug);
      if (!area) continue;
      const have = located.get(slug) || {};
      const fresh = (r: GameRecord) => { const at = Number(have[triedField]?.[r.id]?.at || 0); return !at || redo || (search && Date.now() - at > RETRY_MS); };
      const targets = rs.filter((r) => r.type === 'item' && r.origin?.from === 'area' && r.status !== 'disputed' && r.gaps?.includes('vague where') && fresh(r));
      if (!targets.length) continue;
      const stepRecs = new Map(rs.filter((r) => r.type === 'step').map((r) => [entryId(r), r]));
      const stepOf = new Map<string, GameRecord>();
      for (const s of area.walkthrough || []) for (const id of s.entries || []) { const item = targets.find((r) => entryId(r) === String(id)); const st = stepRecs.get(String(s.id)); if (item && st && !stepOf.has(item.id)) stepOf.set(item.id, st); }
      const page: Page = { key, game, slug, place: rs[0].placeName || slug, recs: rs, targets, stepOf, impressions: rs[0].impressions || 0, have };
      if (search || targets.some((r) => textKnows(page, r))) pages.push(page);
    }
  }
  // Missables on the most-searched pages first, so a stop at the cap leaves the least-wanted ones.
  pages.sort((a, b) => Number(b.targets.some((r) => r.missable)) - Number(a.targets.some((r) => r.missable)) || b.impressions - a.impressions);
  const t = { pages: 0, items: 0, located: 0, checked: 0 };
  console.log(`${pages.length} page(s) to work on${search ? ' (search)' : ' (from their own text)'}.`);
  for (let i = 0; i < pages.length; i += 4) {
    if (ledgerDollars() >= max - (search ? 0.15 : 0.03)) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    const group = pages.slice(i, i + 4);
    if (dry) { group.forEach((p) => console.log(`would locate ${p.key}/${p.slug}: ${p.targets.length} item(s), ${p.impressions} impressions`)); t.pages += group.length; continue; }
    let capped = false;
    await Promise.all(group.map(async (p) => {
      try {
        const out = await (search ? fromSearch(p) : fromPage(p));
        const at = Date.now();
        const tried = { ...(p.have[triedField] || {}), ...Object.fromEntries(out.tried.map((id) => [id, { at }])) };
        const kept = Object.fromEntries(Object.entries(p.have.results || {}).filter(([id]) => !out.tried.includes(id)));
        await RECORDS().doc(p.key).collection('located').doc(p.slug).set({ ...p.have, at, results: { ...kept, ...out.results }, [triedField]: tried });
        const n = Object.keys(out.results).length;
        t.pages++; t.items += out.tried.length; t.located += n; t.checked += Object.values(out.results).filter((x) => x.checked).length;
        console.log(`${p.key}/${p.slug}: ${n} of ${out.tried.length} located`);
      } catch (e: any) {
        console.warn(`${p.key}/${p.slug} skipped: ${e?.message}`);
        if (/spending cap/.test(String(e?.message))) capped = true;
      }
    }));
    if (capped) break;
  }
  console.log(`Located ${t.located} of ${t.items} item(s) on ${t.pages} page(s)${search ? `, ${t.checked} fully checked` : ''}; $${ledgerDollars().toFixed(4)} in ${ledger.calls} call(s) (${ledger.searches} searches).`);
  setTimeout(() => process.exit(0), 300);
}
if (/recordsLocate\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('recordsLocate failed:', e?.message || e); process.exit(1); });
