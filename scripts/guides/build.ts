/**
 * Guide builder: researches a game online and writes guide pages area by area. No playing needed.
 *
 *   npx tsx scripts/guides/build.ts --game "Final Fantasy VI" --part "the opening chapter" --areas 10 --max-searches 150
 *   options: --auto-publish   publish pages that pass the checks straight away (instead of saving them as drafts)
 *            --redo           rebuild areas that already exist
 *
 * For each area: research and write (with Google Search) -> keep only details at least two sources agree on -> a
 * separate fact-check pass drops anything the sources don't support -> save the page (draft, published or held back)
 * -> save every checked fact to the game knowledge base under that area's name. A search cap stops the run before it
 * spends more than you allow; it's separate from players' search budget.
 */
import { db, gemini, MODEL, slug, gameKey, arg, parseJson, searchesIn, sourcesIn, type GuideArea, type GuideEntry } from './common';
import { getGameFacts, saveGameFacts, recordMonthly } from '../../searchGuard';

const game = arg('game');
const part = arg('part', 'the beginning of the game');
const maxAreas = Math.max(1, Math.min(40, Number(arg('areas', '10'))));
const maxSearches = Math.max(10, Number(arg('max-searches', '150')));
const autoPublish = arg('auto-publish') === 'true';
const redo = arg('redo') === 'true';
if (!game) {
  console.log('Usage: npx tsx scripts/guides/build.ts --game "Game title" [--part "the opening chapter"] [--areas 10] [--max-searches 150] [--auto-publish] [--redo]');
  process.exit(1);
}

const ai = gemini();
let searches = 0;
const budgetLeft = () => maxSearches - searches;

async function grounded(prompt: string, label: string): Promise<{ text: string; sources: string[] }> {
  if (budgetLeft() <= 0) throw new Error('search cap reached');
  const res: any = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
  });
  const n = searchesIn(res);
  searches += n;
  recordMonthly(n); // guide runs count toward the app's monthly search total too
  console.log(`  [${label}] ${n} searches (run total ${searches}/${maxSearches})`);
  return { text: res?.text || '', sources: sourcesIn(res) };
}

const RULES =
  'Write everything in your own words; never copy sentences from websites. Only include details you found in your ' +
  'searches, and for each one list the websites that support it. Use the names the game itself uses.';

async function outline(): Promise<{ name: string; story: string }[]> {
  const { text } = await grounded(
    `List the areas a player visits in ${part} of the video game "${game}", in story order, up to ${maxAreas} areas. ` +
      'An area is a place with its own map: a town, dungeon, castle, cave, building, or field region worth its own guide page. ' +
      'Reply with JSON only: [{"name": "Area name as the game calls it", "story": "a few words on when in the story this visit happens"}].',
    'outline',
  );
  const list = parseJson<any[]>(text) || [];
  return list
    .map((a) => ({ name: String(a?.name || '').trim().slice(0, 80), story: String(a?.story || '').trim().slice(0, 120) }))
    .filter((a) => a.name)
    .slice(0, maxAreas);
}

async function research(area: { name: string; story: string }) {
  const { text, sources } = await grounded(
    `Research the area "${area.name}" in the video game "${game}" (${area.story}). ${RULES}\n` +
      'Reply with JSON only, in this shape (leave a list empty rather than guessing):\n' +
      '{"overview": "2 to 3 sentences on what happens here and what to do",\n' +
      ' "items": [{"id": "i1", "name": "item", "where": "exactly where in this area", "missable": false, "sources": ["site", "site"]}],\n' +
      ' "secrets": [{"id": "s1", "text": "hidden thing and how to find it", "sources": []}],\n' +
      ' "enemies": [{"id": "e1", "name": "enemy", "weakness": "", "steal": "", "notes": "", "sources": []}],\n' +
      ' "shops": [{"id": "h1", "name": "shop or NPC", "sells": "what they sell or offer", "sources": []}],\n' +
      ' "tips": ["short practical tip"]}',
    `research ${area.name}`,
  );
  return { data: parseJson<any>(text) || {}, sources };
}

type Claim = { id: string; text: string };

function claimsFor(areaName: string, d: any): Claim[] {
  const out: Claim[] = [];
  for (const it of d.items || []) out.push({ id: it.id, text: `In ${areaName}, the item ${it.name} can be found ${it.where}.${it.missable ? ' It can be missed.' : ''}` });
  for (const s of d.secrets || []) out.push({ id: s.id, text: `In ${areaName}: ${s.text}` });
  for (const e of d.enemies || [])
    out.push({ id: e.id, text: `The enemy ${e.name} appears in ${areaName}.${e.weakness ? ` It is weak to ${e.weakness}.` : ''}${e.steal ? ` It can be stolen from: ${e.steal}.` : ''}` });
  for (const h of d.shops || []) out.push({ id: h.id, text: `In ${areaName}, ${h.name} sells or offers: ${h.sells}.` });
  (d.tips || []).forEach((t: string, i: number) => out.push({ id: `t${i}`, text: `${areaName} tip: ${t}` }));
  if (d.overview) out.push({ id: 'overview', text: String(d.overview) });
  return out.filter((c) => c.id && c.text);
}

async function factCheck(areaName: string, claims: Claim[]): Promise<Set<string>> {
  if (!claims.length) return new Set();
  const { text } = await grounded(
    `Fact-check these statements about "${areaName}" in the video game "${game}". Search to verify each one. ` +
      'Reply with JSON only: [{"id": "...", "verdict": "supported" | "unsupported" | "unsure"}]. Mark "supported" only ' +
      'if a reliable source confirms it.\n' + claims.map((c) => `${c.id}: ${c.text}`).join('\n'),
    `fact-check ${areaName}`,
  );
  const rows = parseJson<any[]>(text) || [];
  return new Set(rows.filter((r) => r?.verdict === 'supported').map((r) => String(r.id)));
}

const twoSources = (e: GuideEntry) => new Set((e.sources || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean)).size >= 2;

async function main() {
  console.log(`Building guide: ${game} (${part}), up to ${maxAreas} areas, search cap ${maxSearches}${autoPublish ? ', auto-publish' : ', as drafts'}`);
  const key = gameKey(game!);
  const guideRef = db().collection('guides').doc(key);
  await getGameFacts(game); // load what the knowledge base already knows, so new facts add confirmations
  const areas = await outline();
  if (!areas.length) throw new Error('could not work out the list of areas');
  console.log(`Areas: ${areas.map((a) => a.name).join(' | ')}`);
  const existing = (await guideRef.get()).data()?.areas || [];
  const order: { slug: string; name: string; story: string }[] = [...existing];
  let built = 0, held = 0;

  for (const [i, area] of areas.entries()) {
    const s = slug(area.name);
    if (!order.some((o) => o.slug === s)) order.push({ slug: s, name: area.name, story: area.story });
    const ref = guideRef.collection('areas').doc(s);
    if (!redo && (await ref.get()).exists) {
      console.log(`- ${area.name}: already built (use --redo to rebuild)`);
      continue;
    }
    if (budgetLeft() < 8) {
      console.log(`Stopping: search cap nearly reached (${searches}/${maxSearches}). Run again later to continue.`);
      break;
    }
    console.log(`- ${area.name}`);
    try {
      const { data, sources } = await research(area);
      const claims = claimsFor(area.name, data);
      const supported = await factCheck(area.name, claims);
      const keep = (e: GuideEntry) => twoSources(e) && supported.has(e.id);
      const pick = (list: any[]) => (Array.isArray(list) ? list : []).filter(keep);
      const items = pick(data.items), secrets = pick(data.secrets), enemies = pick(data.enemies), shops = pick(data.shops);
      const tips = (data.tips || []).filter((_: string, k: number) => supported.has(`t${k}`)).slice(0, 6);
      const kept = items.length + secrets.length + enemies.length + shops.length;
      const singleSource = [...(data.items || []), ...(data.secrets || []), ...(data.enemies || []), ...(data.shops || [])].filter((e: GuideEntry) => !twoSources(e)).length;
      const rejected = claims.length - supported.size;
      const heldReason = kept < 3 ? 'too few confirmed details' : claims.length && rejected / claims.length > 0.4 ? 'too many details failed the fact-check' : '';
      const page: GuideArea = {
        name: area.name,
        slug: s,
        order: order.findIndex((o) => o.slug === s),
        story: area.story,
        overview: supported.has('overview') ? String(data.overview || '') : '',
        items, secrets, enemies, shops, tips,
        sources: sources.slice(0, 8),
        status: heldReason ? 'held' : autoPublish ? 'published' : 'draft',
        checks: { claims: claims.length, supported: supported.size, rejected, singleSource },
        ...(heldReason ? { heldReason } : {}),
        updatedAt: Date.now(),
      };
      await ref.set(page);
      if (heldReason) held++;
      else built++;
      console.log(`  ${page.status}: ${kept} details kept, ${rejected} failed the fact-check, ${singleSource} had only one source${heldReason ? ` (${heldReason})` : ''}`);
      // Every checked detail also goes into the game knowledge base, filed under this area.
      const facts = [
        ...items.map((e: GuideEntry) => ({ subject: e.name!, kind: e.missable ? 'missable' : 'item', fact: e.where! })),
        ...secrets.map((e: GuideEntry) => ({ subject: (e.text || '').split(/[.:]/)[0].slice(0, 60), kind: 'secret', fact: e.text! })),
        ...enemies.map((e: GuideEntry) => ({ subject: e.name!, kind: 'enemy', fact: [e.weakness && `Weak to ${e.weakness}`, e.steal && `Steal: ${e.steal}`, e.notes].filter(Boolean).join('; ') })),
        ...shops.map((e: GuideEntry) => ({ subject: e.name!, kind: 'npc', fact: `Sells: ${e.sells}` })),
      ].filter((f) => f.subject && f.fact);
      if (facts.length) saveGameFacts(game, facts, { searched: true, place: area.name, story: area.story, sources: sources.slice(0, 3) });
    } catch (e: any) {
      if (String(e?.message).includes('search cap')) {
        console.log('Stopping: search cap reached. Run again later to continue.');
        break;
      }
      console.warn(`  failed: ${e?.message}`);
    }
  }
  await guideRef.set({ game, title: `${game} guide`, areas: order, updatedAt: Date.now() }, { merge: true });
  console.log(`Done: ${built} page(s) ${autoPublish ? 'published' : 'saved as drafts'}, ${held} held back, ${searches} searches used.`);
  console.log('Next: npx tsx scripts/guides/publish.ts --drafts   (builds the pages into Marketing_Website_Files so you can look them over)');
  setTimeout(() => process.exit(0), 4000); // let the last database writes finish
}

main().catch((e) => {
  console.error('Guide build failed:', e?.message || e);
  process.exit(1);
});
