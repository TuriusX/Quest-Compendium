/**
 * Guide builder: researches a game online and writes guide pages area by area. No playing needed.
 *
 *   npx tsx scripts/guides/build.ts --game "Final Fantasy VI" --part "the opening chapter" --areas 10 --max-searches 150
 *   options: --auto-publish   publish pages that pass the checks straight away (instead of saving them as drafts)
 *            --redo           rebuild areas that already exist
 *
 * For each area: research with Google Search (a step that runs no searches is retried once, then fails, so nothing
 * comes from the model's memory) -> keep only details that at least two different websites back, judged from Google's
 * own grounding data rather than anything the model says about its sources -> a separate fact-check, which must also
 * search, drops anything it can't confirm -> save the page (draft, published or held back) -> save the details that
 * passed both checks to the game knowledge base under that area's name. A search cap stops the run before it
 * spends more than you allow; it's separate from players' search budget.
 */
import { db, gemini, MODEL, slug, gameKey, arg, searchesIn, type GuideArea, type GuideEntry } from './common';
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

/**
 * A research call with Google Search. Searching is optional for the model, so it can quietly answer from memory:
 * when a step must be backed by searches, a reply that ran none is retried once with a firmer instruction, and if it
 * still ran none, the step fails (nothing from memory gets through).
 */
async function grounded(prompt: string, label: string, requireSearch = true): Promise<{ text: string; response: any }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budgetLeft() <= 0) throw new Error('search cap reached');
    const res: any = await ai.models.generateContent({
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt }],
      }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
    const n = searchesIn(res);
    searches += n;
    recordMonthly(n); // guide runs count toward the app's monthly search total too
    console.log(`  [${label}] ${n} searches (run total ${searches}/${maxSearches})`);
    if (n > 0 || !requireSearch) return { text: res?.text || '', response: res };
  }
  throw new Error(`no-search: ${label} ran no searches`);
}

/**
 * Which websites actually back each line of a reply, from Google's own grounding data (the pages the search really
 * returned and the parts of the answer each one supports), not from anything the model writes about its sources.
 */
function realSourcesByLine(text: string, response: any): Set<string>[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }
  const lineAt = (idx: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= idx) k++;
    return k;
  };
  const gm = response?.candidates?.[0]?.groundingMetadata || {};
  const chunks: any[] = gm.groundingChunks || [];
  const site = (i: number) => {
    const w = chunks[i]?.web || {};
    const t = String(w.title || w.domain || '').toLowerCase().trim();
    return t;
  };
  const out = lines.map(() => new Set<string>());
  for (const sup of gm.groundingSupports || []) {
    const seg = String(sup?.segment?.text || '').trim();
    if (!seg) continue;
    const at = text.indexOf(seg);
    if (at < 0) continue;
    const first = lineAt(at);
    const last = lineAt(at + seg.length - 1);
    for (const ci of sup.groundingChunkIndices || []) {
      const s = site(ci);
      if (!s) continue;
      for (let k = first; k <= last; k++) out[k].add(s);
    }
  }
  return out;
}

const RULES =
  'Search the web for this; don\'t answer from memory. Write everything in your own words, never copying sentences ' +
  'from websites. Only include details you found in your searches. Use the names the game itself uses.';

async function outline(): Promise<{ name: string; story: string }[]> {
  const { text } = await grounded(
    `List the areas a player visits in ${part} of the video game "${game}", in story order, up to ${maxAreas} areas. ` +
      'An area is a place with its own map: a town, dungeon, castle, cave, building, or field region worth its own guide page. ' +
      `${RULES} Reply with one line per area, exactly: AREA: name as the game calls it | a few words on when in the story this visit happens`,
    'outline',
  );
  return text
    .split('\n')
    .map((l) => l.match(/^\s*[-*]?\s*AREA:\s*(.+?)\s*\|\s*(.*)$/i))
    .filter(Boolean)
    .map((m) => ({ name: m![1].trim().slice(0, 80), story: m![2].trim().slice(0, 120) }))
    .filter((a) => a.name)
    .slice(0, maxAreas);
}

type Parsed = { overview: GuideEntry | null; items: GuideEntry[]; secrets: GuideEntry[]; enemies: GuideEntry[]; shops: GuideEntry[]; tips: GuideEntry[] };

/** Research an area. The reply is one detail per line, so Google's grounding data can be matched to each detail. */
async function research(area: { name: string; story: string }): Promise<Parsed> {
  const { text, response } = await grounded(
    `Research the area "${area.name}" in the video game "${game}" (${area.story}). ${RULES}\n` +
      'Reply with one detail per line, using exactly these formats (leave out anything you didn\'t find):\n' +
      'OVERVIEW: 2 to 3 sentences on what happens here and what to do\n' +
      'ITEM: item name | exactly where in this area | missable: yes or no\n' +
      'SECRET: hidden thing and how to find it\n' +
      'ENEMY: enemy name | weakness | what can be stolen | short note\n' +
      'SHOP: shop or NPC name | what they sell or offer\n' +
      'TIP: short practical tip',
    `research ${area.name}`,
  );
  const real = realSourcesByLine(text, response);
  const out: Parsed = { overview: null, items: [], secrets: [], enemies: [], shops: [], tips: [] };
  let n = 0;
  text.split('\n').forEach((line, k) => {
    const m = line.match(/^\s*[-*]?\s*(OVERVIEW|ITEM|SECRET|ENEMY|SHOP|TIP):\s*(.+)$/i);
    if (!m) return;
    const f = m[2].split('|').map((x) => x.trim());
    const sources = [...real[k]];
    const id = `x${n++}`;
    switch (m[1].toUpperCase()) {
      case 'OVERVIEW': out.overview = { id, text: m[2].trim(), sources }; break;
      case 'ITEM': out.items.push({ id, name: f[0], where: f[1] || '', missable: /yes/i.test(f[2] || ''), sources }); break;
      case 'SECRET': out.secrets.push({ id, text: m[2].trim(), sources }); break;
      case 'ENEMY': out.enemies.push({ id, name: f[0], weakness: f[1] || '', steal: f[2] || '', notes: f[3] || '', sources }); break;
      case 'SHOP': out.shops.push({ id, name: f[0], sells: f[1] || '', sources }); break;
      case 'TIP': out.tips.push({ id, text: m[2].trim(), sources }); break;
    }
  });
  return out;
}

type Claim = { id: string; text: string };

function claimsFor(areaName: string, d: Parsed): Claim[] {
  const out: Claim[] = [];
  for (const it of d.items) out.push({ id: it.id, text: `In ${areaName}, the item ${it.name} can be found ${it.where}.${it.missable ? ' It can be missed.' : ''}` });
  for (const s of d.secrets) out.push({ id: s.id, text: `In ${areaName}: ${s.text}` });
  for (const e of d.enemies)
    out.push({ id: e.id, text: `The enemy ${e.name} appears in ${areaName}.${e.weakness ? ` It is weak to ${e.weakness}.` : ''}${e.steal ? ` It can be stolen from: ${e.steal}.` : ''}` });
  for (const h of d.shops) out.push({ id: h.id, text: `In ${areaName}, ${h.name} sells or offers: ${h.sells}.` });
  for (const t of d.tips) out.push({ id: t.id, text: `${areaName} tip: ${t.text}` });
  if (d.overview) out.push({ id: d.overview.id, text: d.overview.text || '' });
  return out.filter((c) => c.id && c.text);
}

/** A separate check that must itself search; only claims it marks supported survive. */
async function factCheck(areaName: string, claims: Claim[]): Promise<Set<string>> {
  if (!claims.length) return new Set();
  const { text } = await grounded(
    `Fact-check these statements about "${areaName}" in the video game "${game}". Search to verify each one; don't ` +
      'rely on memory. Reply with one line per statement, exactly: ID: SUPPORTED, ID: UNSUPPORTED or ID: UNSURE. ' +
      'Use SUPPORTED only if a source you found confirms it.\n' + claims.map((c) => `${c.id}: ${c.text}`).join('\n'),
    `fact-check ${areaName}`,
  );
  const ok = new Set<string>();
  for (const l of text.split('\n')) {
    const m = l.match(/(x\d+)\s*:\s*SUPPORTED\b/i);
    if (m) ok.add(m[1]);
  }
  return ok;
}

/** Two-source rule on real search data: at least two different websites back this detail. */
const twoSources = (e: GuideEntry) => (e.sources || []).length >= 2;

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
      const data = await research(area);
      const claims = claimsFor(area.name, data);
      const supported = await factCheck(area.name, claims);
      const keep = (e: GuideEntry) => twoSources(e) && supported.has(e.id);
      const items = data.items.filter(keep), secrets = data.secrets.filter(keep), enemies = data.enemies.filter(keep), shops = data.shops.filter(keep);
      // Overview and tips are general advice: one real source plus the fact-check is enough.
      const tips = data.tips.filter((t) => (t.sources || []).length >= 1 && supported.has(t.id)).map((t) => t.text!).slice(0, 6);
      const overviewOk = data.overview && (data.overview.sources || []).length >= 1 && supported.has(data.overview.id);
      const kept = items.length + secrets.length + enemies.length + shops.length;
      const all = [...data.items, ...data.secrets, ...data.enemies, ...data.shops];
      const singleSource = all.filter((e) => !twoSources(e)).length;
      const rejected = claims.length - supported.size;
      const heldReason = kept < 3 ? 'too few details confirmed by two real sources' : claims.length && rejected / claims.length > 0.4 ? 'too many details failed the fact-check' : '';
      const usedSources = [...new Set([...items, ...secrets, ...enemies, ...shops].flatMap((e) => e.sources || []))];
      const page: GuideArea = {
        name: area.name,
        slug: s,
        order: order.findIndex((o) => o.slug === s),
        story: area.story,
        overview: overviewOk ? String(data.overview!.text || '') : '',
        items, secrets, enemies, shops, tips,
        sources: usedSources.slice(0, 8),
        status: heldReason ? 'held' : autoPublish ? 'published' : 'draft',
        checks: { claims: claims.length, supported: supported.size, rejected, singleSource },
        ...(heldReason ? { heldReason } : {}),
        updatedAt: Date.now(),
      };
      await ref.set(page);
      if (heldReason) held++;
      else built++;
      console.log(`  ${page.status}: ${kept} details kept (two real sources + fact-check), ${singleSource} dropped for fewer than two real sources, ${rejected} failed the fact-check${heldReason ? ` (${heldReason})` : ''}`);
      // Only details that passed both checks go into the game knowledge base, filed under this area.
      if (!heldReason) {
        const facts = [
          ...items.map((e) => ({ subject: e.name!, kind: e.missable ? 'missable' : 'item', fact: e.where! })),
          ...secrets.map((e) => ({ subject: (e.text || '').split(/[.:]/)[0].slice(0, 60), kind: 'secret', fact: e.text! })),
          ...enemies.map((e) => ({ subject: e.name!, kind: 'enemy', fact: [e.weakness && `Weak to ${e.weakness}`, e.steal && `Steal: ${e.steal}`, e.notes].filter(Boolean).join('; ') })),
          ...shops.map((e) => ({ subject: e.name!, kind: 'npc', fact: `Sells: ${e.sells}` })),
        ].filter((f) => f.subject && f.fact);
        // Two details with the same name in one area (two Phoenix Downs) would overwrite each other in the knowledge
        // base, which files facts by name and place: give repeats a short "where" so each is kept.
        const seen = new Map<string, number>();
        for (const f of facts) seen.set(f.subject.toLowerCase(), (seen.get(f.subject.toLowerCase()) || 0) + 1);
        for (const f of facts) {
          if ((seen.get(f.subject.toLowerCase()) || 0) > 1) f.subject = `${f.subject} (${f.fact.split(/[,.;]/)[0].trim().slice(0, 30)})`.slice(0, 60);
        }
        if (facts.length) saveGameFacts(game, facts, { searched: true, place: area.name, story: area.story, sources: usedSources.slice(0, 3) });
      }
    } catch (e: any) {
      if (String(e?.message).includes('search cap')) {
        console.log('Stopping: search cap reached. Run again later to continue.');
        break;
      }
      if (String(e?.message).startsWith('no-search')) {
        // The model wouldn't search: nothing from memory is allowed through, so the page is held back.
        await ref.set({ name: area.name, slug: s, order: order.findIndex((o) => o.slug === s), story: area.story, overview: '', items: [], secrets: [], enemies: [], shops: [], tips: [], sources: [], status: 'held', heldReason: 'research ran no searches', checks: { claims: 0, supported: 0, rejected: 0, singleSource: 0 }, updatedAt: Date.now() });
        held++;
        console.log('  held: the research ran no searches, so nothing could be verified');
        continue;
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
