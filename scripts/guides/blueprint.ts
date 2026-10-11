/**
 * Guide blueprints (prototype): an individual plan per game, like an IEP. The shared standards stay the same for every
 * guide (evidence check, review gate, stable URLs, cost caps); what each guide contains is decided per game.
 *
 *   npx tsx scripts/guides/blueprint.ts --assess --key red-dead-redemption-2 [--note "owner's requirements"]
 *   (as a job, for the guide's Search Console queries:
 *    gcloud run jobs execute guide-pipeline --args=tsx,scripts/guides/blueprint.ts,--assess,--key,<key>)
 *
 * 1. Inputs (no AI): our guide (pages, their state, the compendium), the guide's Search Console queries (on Cloud Run),
 *    facts the app had to search for because the guide lacked them (gameFacts), corrections, answer reports and ratings.
 * 2. Assessment (two searched calls, never Fandom): the game's structure (linear / open world / branching / builds /
 *    collectibles / missables), what players search for and ask, which sections and compendium types the top guides
 *    for it have, and how many of each kind of thing there is.
 * 3. Gap analysis: missing sections, thin pages, failed or flagged pages, generic or wrong content.
 * 4. Blueprint: the sections and compendium types this game needs, in priority order, each with a count, a per-game cap
 *    and a cost from our measured rates. Printed (prototype); nothing is built.
 * Stops before a call that could take it past MAX_DOLLARS ($1.80).
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope, searchesIn, sourcesIn } from './common';

const MAX_DOLLARS = 1.8;
/** Measured rates: an evidence-method page, an entity page (first build), a short quest page (links to the walkthrough). */
const RATES = { page: 0.22, entity: 0.12, questShort: 0.07, questFull: 0.14, taxonomy: 0.05 };
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};

async function scQueries(key: string): Promise<{ query: string; page: string; impressions: number; position: number }[]> {
  try {
    const r0 = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=' + encodeURIComponent('https://www.googleapis.com/auth/webmasters.readonly'), { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
    if (!r0.ok) return [];
    const tok = String((await r0.json()).access_token || '');
    const day = (o: number) => new Date(Date.now() - o * 86_400_000).toISOString().slice(0, 10);
    const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent('sc-domain:questcompendium.com')}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: day(30), endDate: day(1), dimensions: ['query', 'page'], rowLimit: 25_000, dataState: 'all', dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: `/guides/${key}/` }] }] }),
    });
    return (((await r.json()).rows || []) as any[]).map((x) => ({ query: x.keys[0], page: x.keys[1], impressions: x.impressions, position: x.position })).sort((a, b) => b.impressions - a.impressions);
  } catch {
    return [];
  }
}

export async function assess(key: string, note = '') {
  const scope = { dollars: 0, searches: 0 };
  return usageScope.run(scope, async () => {
    const gref = db().collection('guides').doc(key);
    const info: any = (await gref.get()).data() || {};
    const game = String(info.game || key);
    // ---- 1. inputs ----
    const pages = (await gref.collection('areas').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) })).filter((a) => a.status === 'published');
    const order: { slug: string; name: string }[] = info.areas || [];
    const comp: any = (await db().collection('guideCompendium').doc(key).get()).data() || {};
    const ents = (await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.map((d) => d.data() as any);
    const queries = await scQueries(key);
    const facts = (await db().collection('gameFacts').doc(key).collection('facts').limit(80).get()).docs.map((d) => cut((d.data() as any).text || (d.data() as any).fact, 160)).filter(Boolean);
    const corrections = (await db().collection('correctionGroups').where('gameKey', '==', key).get()).docs.map((d) => cut(`${(d.data() as any).entryName}: ${(d.data() as any).claim || ''}`, 160));
    const inventory = order.map((o) => {
      const a = pages.find((p) => p.slug === o.slug);
      if (!a) return null;
      const n = (a.items || []).length + (a.secrets || []).length + (a.walkthrough || []).length;
      return `${a.name} [${a.flagship?.mode === 'evidence' && a.verified ? 'flagship' : a.flagship ? 'flagship (older method)' : a.verified ? 'checked' : 'quick'}${a.reverify ? ', failed review' : ''}, ${n} entries]`;
    }).filter(Boolean);
    console.log(`${game}: ${pages.length} live pages, ${ents.length} entity pages, ${queries.length} Search Console query rows, ${facts.length} searched facts, ${corrections.length} correction groups.`);

    // ---- 2. assessment: two searched calls ----
    // A searched call: asked again, firmly, if the reply ran no searches; refused if it still didn't (no memory answers).
    const searched = async (prompt: string) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (scope.dollars > MAX_DOLLARS - 0.4) throw new Error(`cost guard: $${scope.dollars.toFixed(2)} spent, next call could pass $${MAX_DOLLARS}`);
        const res: any = await gemini().models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: `${attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : ''}${prompt}\nRun a few Google searches (the best walkthrough sites and wikis for this game; never fandom.com). Answer in short factual lines, one fact per line, only what the sources say.` }] }],
          config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 12000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        const n = searchesIn(res);
        console.log(`  research call: ${n} searches`);
        if (!n) continue;
        const sources = sourcesIn(res).filter((s) => !/fandom\.com/i.test(s));
        return { text: cut(res?.text, 9000), searches: n, sources };
      }
      throw new Error('the research call ran no searches twice; not using a memory answer');
    };
    const a1 = await searched([
      `For a player's guide to the video game "${game}": how is the game structured (linear, open world, hub-based or branching; how the story is divided; how much player choices matter and where; how much character builds matter; the main collectible kinds; how many missables and of what kind)?`,
      'What do players search for and ask about most for this game?',
      'Which sections and compendium types do the 3 to 5 best-known guides for this game have (name each site; not Fandom)?',
    ].join('\n'));
    const a2 = await searched([
      `For the video game "${game}", how many of each kind of thing does a complete guide cover? For example story missions, side quests, Stranger missions, companions, bosses, merchants, legendary animals, and each collectible kind. Use the game's own terms and give 10 to 16 kinds, each with its number as the sources give it.`,
    ].join('\n'));

    // ---- 3 + 4. gaps and blueprint (no search) ----
    if (scope.dollars > MAX_DOLLARS - 0.15) throw new Error(`cost guard before the blueprint ($${scope.dollars.toFixed(2)})`);
    const failed = pages.filter((p) => p.reverify).map((p) => p.name);
    const thin = pages.filter((p) => (p.items || []).length + (p.secrets || []).length + (p.walkthrough || []).length < 6).map((p) => p.name);
    const generic = ents.filter((e) => /\brather than (?:a|an) |\bnot (?:a|an) (?:geographical )?location\b/i.test(`${e.overview} ${(e.summary?.notes || []).join(' ')}`) || (/charact|npc|compan|merchant/i.test(e.type) && e.summary?.gettingThere)).map((e) => e.name);
    const topQ = queries.slice(0, 60).map((q) => `"${q.query}" ${q.impressions} (pos ${q.position.toFixed(0)}, ${q.page.replace(/^https:\/\/questcompendium\.com/, '')})`);
    const prompt = [
      `Write the guide blueprint for "${game}": what OUR guide should contain, decided for this game. The shared standards (evidence check, review, stable URLs, cost caps) are fixed; you decide the content.`,
      `ASSESSMENT (searched research): ${a1.text}`,
      `COUNTS (searched research): ${a2.text}`,
      `OUR GUIDE: walkthrough pages in order: ${inventory.join('; ')}.`,
      `Compendium types: ${(comp.taxonomy || []).map((t: any) => `${t.label}${t.tier ? ` (${t.tier})` : ''}`).join(', ') || 'none'}; entity pages: ${ents.length} (${ents.filter((e) => e.status === 'published').length} published).`,
      `GAPS WE KNOW: failed review: ${failed.join(', ') || 'none'}; thin pages (<6 entries): ${thin.join(', ') || 'none'}; entity pages with generic or wrong content: ${generic.length} (${generic.slice(0, 12).join(', ')}).`,
      `SEARCH CONSOLE (our pages, 30 days): ${topQ.join('; ') || 'no data'}.`,
      `THINGS THE APP HAD TO SEARCH FOR (the guide lacked them): ${facts.slice(0, 50).join(' | ') || 'none'}.`,
      `CORRECTIONS: ${corrections.join(' | ') || 'none'}.`,
      ...(note ? [`OWNER'S REQUIREMENTS FOR THIS GAME: ${note}`] : []),
      'Return JSON: {"assessment": {"structure": "type, how the story is divided", "choices": "...", "builds": "...", "collectibles": "...", "missables": "...", "players_look_for": ["most common first"], "top_guides": [{"site": "...", "sections": ["..."]}]},',
      ' "counts": [{"kind": "...", "count": number, "note": "as the research gives it"}] (from the research only),',
      ' "summary": "2-3 sentences", "gaps": {"missing_sections": ["..."], "thin_or_weak": ["..."], "wrong_or_generic": ["..."]},',
      ' "sections": [{"id": "kebab-case", "title": "...", "kind": "walkthrough|compendium|reference", "what": "one line", "why": "evidence from the inputs",',
      '   "units": number of pages or entity pages, "unit": "page|entity|quest-short|quest-full", "cap": per-game cap for this type (entity kinds only), "priority": 1 is first}],',
      ' "keep": ["what of ours already fits and stays as is"], "drop_or_merge": ["sections not worth building for this game"]}',
      'Prioritise by what players search for and ask (Search Console, the app) and what the top guides have. Count units from COUNTS; existing good pages are not re-counted (only what is left to build or rebuild).',
    ].join('\n');
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 12000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const bp = objOf(String(res?.text || ''));
    const rate = (u: string) => (u === 'page' ? RATES.page : u === 'quest-short' ? RATES.questShort : u === 'quest-full' ? RATES.questFull : RATES.entity);
    const sections = (bp.sections || []).map((s: any) => ({ ...s, units: Number(s.units) || 0, cost: Math.round((Number(s.units) || 0) * rate(String(s.unit)) * 100) / 100 })).sort((x: any, y: any) => (x.priority || 99) - (y.priority || 99));
    const out = {
      key, game, at: Date.now(), status: 'proposed',
      inputs: { pages: pages.length, entities: ents.length, scQueries: queries.length, facts: facts.length, corrections: corrections.length },
      assessment: bp.assessment || a1.text, counts: bp.counts || [], research: { structure: a1.text, counts: a2.text }, sources: [...new Set([...a1.sources, ...a2.sources])].slice(0, 30),
      gaps: { ...(bp.gaps || {}), failedPages: failed, thinPages: thin, genericEntities: generic.length },
      summary: bp.summary, sections, keep: bp.keep || [], dropOrMerge: bp.drop_or_merge || [],
      buildCost: Math.round(sections.reduce((n: number, s: any) => n + s.cost, 0) * 100) / 100,
      assessmentCost: { dollars: Math.round(scope.dollars * 1000) / 1000, searches: scope.searches },
    };
    console.log(`\n=== BLUEPRINT ${game} ===`);
    // Prefixed so Cloud Logging keeps it as text (a bare JSON line becomes structured data).
    console.log(`BLUEPRINT_JSON ${JSON.stringify(out)}`);
    console.log(`\n${game}: assessment cost $${scope.dollars.toFixed(3)} (${scope.searches} searches); blueprint build estimate $${out.buildCost.toFixed(2)}.`);
    return out;
  });
}

/** The owner's requirements per game, part of its blueprint. */
const NOTES: Record<string, string> = {
  'red-dead-redemption-2': 'Include a "Quests" compendium type: story missions as short pages (giver, chapter, rewards, missables, choice outcomes) that link to the walkthrough section for the step-by-step, never duplicating walkthrough text (unit quest-short); side quests and Stranger missions as full pages with steps, rewards and missables (unit quest-full). Same evidence check and review gate as other entity pages.',
};

async function main() {
  const key = String(arg('key') || '');
  if (arg('assess') === 'true' && key) await assess(key, arg('note') && arg('note') !== 'true' ? String(arg('note')) : NOTES[key] || '');
  setTimeout(() => process.exit(0), 300);
}
if (/blueprint\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('blueprint failed:', e?.message || e); process.exit(1); });
