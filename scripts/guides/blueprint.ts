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
 *    and a cost from our measured rates -> guideBlueprints/{key} { status: 'proposed', version, ... } and a short summary
 *    in Discord (#guides-pipeline). The owner approves or edits it on /admin/reviews (Blueprints tab); an unapproved
 *    blueprint builds nothing.
 * Stops before a call that could take it past MAX_DOLLARS ($1.80).
 *
 *   --post <key>   post a stored blueprint's summary to Discord again
 *   --monthly      the monthly report per guide with a blueprint: Search Console impressions and position by section,
 *                  grounding misses (blueprints.ts), corrections, and proposed updates (one cheap call, no search),
 *                  saved on the blueprint (reports.{YYYY-MM}) and posted to Discord. The pipeline runs it once a month.
 */
import { postDiscord } from '../pipeline/summary';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope, searchesIn, sourcesIn } from './common';
import { BLOCKED } from './claimCheck';

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
          contents: [{ role: 'user', parts: [{ text: `${attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : ''}${prompt}\nRun a few Google searches (the best walkthrough sites and wikis for this game; never fandom.com or fextralife.com; forums and videos only for what players ask). Answer in short factual lines, one fact per line, only what the sources say.` }] }],
          config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 12000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        const n = searchesIn(res);
        console.log(`  research call: ${n} searches`);
        if (!n) continue;
        const sources = sourcesIn(res).filter((s) => !BLOCKED.test(s));
        return { text: cut(res?.text, 9000), searches: n, sources };
      }
      throw new Error('the research call ran no searches twice; not using a memory answer');
    };
    const a1 = await searched([
      `For a player's guide to the video game "${game}": how is the game structured (linear, open world, hub-based or branching; how the story is divided; how much player choices matter and where; how much character builds matter; the main collectible kinds; how many missables and of what kind)?`,
      'What do players search for and ask about most for this game?',
      'Which sections and compendium types do the 3 to 5 best-known guides for this game have (name each site; not Fandom or Fextralife)?',
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
    if (arg('save') === 'true') {
      const ref = db().collection('guideBlueprints').doc(key);
      const prev: any = (await ref.get()).data();
      await ref.set(JSON.parse(JSON.stringify({ ...out, version: (Number(prev?.version) || 0) + 1, updatedAt: Date.now() })));
      await postBlueprint(key);
    }
    return out;
  });
}

const ADMIN_URL = `${process.env.QC_SERVER_URL || 'https://quest-compendium-890629309063.us-east1.run.app'}/admin/reviews`;

/** A blueprint's short summary in Discord: the sections in order with their cost, and where to approve it. */
export async function postBlueprint(key: string): Promise<boolean> {
  const b: any = (await db().collection('guideBlueprints').doc(key).get()).data();
  if (!b) { console.log(`No blueprint for ${key}.`); return false; }
  const secs = (b.sections || []).slice().sort((x: any, y: any) => (x.priority || 99) - (y.priority || 99));
  const text = [
    `📐 **Guide blueprint ${b.status || 'proposed'}: ${b.game}** (v${b.version || 1}): build ≈ $${Number(b.buildCost || 0).toFixed(2)}${b.assessmentCost ? `, assessment $${Number(b.assessmentCost.dollars || 0).toFixed(2)}` : ''}.`,
    b.summary ? cut(b.summary, 400) : '',
    ...secs.slice(0, 14).map((x: any) => `${x.priority}. ${x.title || x.id}: ${x.units} ${x.unit}${x.cap != null ? ` (cap ${x.cap})` : ''}, $${Number(x.cost || 0).toFixed(2)}`),
    b.notes ? `Notes: ${cut(b.notes, 300)}` : '',
    `Approve or edit: ${ADMIN_URL} (Blueprints tab). Nothing is built until it's approved.`,
  ].filter(Boolean).join('\n');
  if (!process.env.DISCORD_WEBHOOK_URL) { console.log(`(No DISCORD_WEBHOOK_URL: not posted)\n${text}`); return false; }
  const ok = await postDiscord(process.env.DISCORD_WEBHOOK_URL, text);
  console.log(ok ? `Posted ${b.game}'s blueprint to Discord.` : 'Posting to Discord failed.');
  return ok;
}

/** Which blueprint section a guide URL belongs to: walkthrough pages, or the compendium type of an entity page. */
function sectionOf(b: any, slug: string, entityType: string | null, walkthroughSlugs: Set<string>): string {
  if (walkthroughSlugs.has(slug)) return 'walkthrough pages';
  if (entityType) {
    const hit = (b.sections || []).find((x: any) => x.kind === 'compendium' && String(x.id).includes(String(entityType).split('-')[0]));
    return hit ? String(hit.title || hit.id) : `compendium: ${entityType}`;
  }
  return slug === 'achievements' ? 'achievements' : 'other pages';
}

/**
 * The monthly report per guide with a blueprint: last month's Search Console impressions and position by section,
 * grounding misses, corrections, and proposed blueprint updates (Flash, no search, about a cent a guide).
 */
export async function monthly() {
  const month = arg('month') && arg('month') !== 'true' ? String(arg('month')) : (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).toISOString().slice(0, 7); })(); // the month that ended (or --month)
  const bps = (await db().collection('guideBlueprints').get()).docs;
  const misses: any = (await db().collection('groundingMisses').doc(month).get()).data() || {};
  const lines: string[] = [`📈 **Monthly guide report, ${month}**`];
  for (const d of bps) {
    const b: any = d.data();
    const key = d.id;
    const rows = await scPages(key, month);
    const pages = (await db().collection('guides').doc(key).collection('areas').get()).docs;
    const walk = new Set(pages.map((x) => x.id));
    const ents = new Map((await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.map((x) => [x.id, String((x.data() as any).type || '')]));
    const bySec = new Map<string, { impressions: number; clicks: number; posSum: number }>();
    for (const r of rows) {
      const m = r.page.match(/\/guides\/[^/]+\/([^/]+)\//);
      const slug = m ? m[1] : '';
      const sec = sectionOf(b, slug, ents.get(slug) || null, walk);
      const a = bySec.get(sec) || { impressions: 0, clicks: 0, posSum: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.posSum += r.position * r.impressions;
      bySec.set(sec, a);
    }
    const sections = [...bySec].sort((x, y) => y[1].impressions - x[1].impressions).map(([sec, a]) => ({ section: sec, impressions: a.impressions, clicks: a.clicks, position: a.impressions ? Math.round((a.posSum / a.impressions) * 10) / 10 : null }));
    const miss = misses[key] || {};
    const missRows = Object.entries(miss).flatMap(([page, v]: any) => Object.entries(v || {}).map(([k, n]) => ({ page, kind: k, n: Number(n) || 0 }))).sort((x, y) => y.n - x.n);
    const corrections = (await db().collection('correctionGroups').where('gameKey', '==', key).get()).docs.filter((x) => Number((x.data() as any).updatedAt || 0) > Date.now() - 35 * 86_400_000).length;
    // Proposed updates from the data (no search).
    const scope = { dollars: 0, searches: 0 };
    const res: any = await usageScope.run(scope, () => gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [
        `The guide blueprint for "${b.game}" (status ${b.status}): ${JSON.stringify((b.sections || []).map((x: any) => ({ id: x.id, title: x.title, units: x.units, priority: x.priority })))}.`,
        `Last month on Google, by section: ${JSON.stringify(sections)}.`,
        `Questions our guide could not ground (page | question type:reason | count): ${missRows.slice(0, 30).map((x) => `${x.page} | ${x.kind} | ${x.n}`).join('; ') || 'none'}.`,
        `Corrections reported: ${corrections}.`,
        'Propose 0 to 4 blueprint updates the data supports (raise or lower a section\'s priority, add a section, deepen a page), each one line with the evidence. Reply with JSON only: {"updates": ["..."]}',
      ].join('\n') }] }],
      config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    }));
    const updates: string[] = (objOf(String(res?.text || '')).updates || []).map((x: any) => cut(x, 240)).filter(Boolean).slice(0, 4);
    await d.ref.set({ reports: { [month]: { at: Date.now(), sections, misses: missRows.slice(0, 50), corrections, updates, cost: scope.dollars } } }, { merge: true });
    lines.push(`**${b.game}** (${b.status}): ${sections.slice(0, 5).map((x) => `${x.section} ${x.impressions} impr${x.position != null ? ` @${x.position}` : ''}`).join(' · ') || 'no Search Console data'}; ungrounded questions ${missRows.reduce((n, x) => n + x.n, 0)}${missRows[0] ? ` (most: ${missRows[0].page} ${missRows[0].kind})` : ''}; corrections ${corrections}.${updates.length ? ` Proposed: ${updates.join(' | ')}` : ''}`);
  }
  console.log(lines.join('\n'));
  if (process.env.DISCORD_WEBHOOK_URL && bps.length) await postDiscord(process.env.DISCORD_WEBHOOK_URL, lines.join('\n'));
}

async function scPages(key: string, month: string): Promise<{ page: string; impressions: number; clicks: number; position: number }[]> {
  try {
    const r0 = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=' + encodeURIComponent('https://www.googleapis.com/auth/webmasters.readonly'), { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
    if (!r0.ok) return [];
    const tok = String((await r0.json()).access_token || '');
    const start = `${month}-01`;
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent('sc-domain:questcompendium.com')}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['page'], rowLimit: 25_000, dataState: 'all', dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: `/guides/${key}/` }] }] }),
    });
    return (((await r.json()).rows || []) as any[]).map((x) => ({ page: x.keys[0], impressions: x.impressions, clicks: x.clicks, position: x.position }));
  } catch {
    return [];
  }
}

/** The owner's requirements per game, part of its blueprint. */
const NOTES: Record<string, string> = {
  'red-dead-redemption-2': 'Include a "Quests" compendium type: story missions as short pages (giver, chapter, rewards, missables, choice outcomes) that link to the walkthrough section for the step-by-step, never duplicating walkthrough text (unit quest-short); side quests and Stranger missions as full pages with steps, rewards and missables (unit quest-full). Same evidence check and review gate as other entity pages.',
};

async function main() {
  const key = String(arg('key') || '');
  if (arg('assess') === 'true' && key) await assess(key, arg('note') && arg('note') !== 'true' ? String(arg('note')) : NOTES[key] || '');
  else if (arg('post') && arg('post') !== 'true') await postBlueprint(String(arg('post')));
  else if (arg('monthly') === 'true') await monthly();
  setTimeout(() => process.exit(0), 300);
}
if (/blueprint\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('blueprint failed:', e?.message || e); process.exit(1); });
