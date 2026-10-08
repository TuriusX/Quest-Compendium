/**
 * Per-game compendium. Guides are organised the way games are
 * played (areas, chapters); players search for things (a town, a legendary animal, a boss). The compendium adds
 * focused entity pages next to the guide, with titles and URLs made for search, auto-linked from the guide's text.
 *
 *   npx tsx scripts/guides/compendium.ts --key red-dead-redemption-2 --taxonomy
 *       the game's entity types (from its structure and the Search Console queries for it), with the entities players
 *       search for -> guideCompendium/{key} { taxonomy: [{ id, label, description, examples }], entities: [...] }
 *   npx tsx scripts/guides/compendium.ts --key red-dead-redemption-2 --entity "Thieves' Landing" [--type locations]
 *       one entity page, built with the evidence method (claimCheck.ts): searched evidence (only sentences a source
 *       backs) plus the game's shared research (gameEvidence/{key}), a page written from the evidence only, every claim
 *       checked (unsupported or contradicted ones removed), then the Pro claim review (passes at 90% supported)
 *       -> guideCompendium/{key}/entities/{slug}, with its cost; status "published" when the review passes (the next
 *       site publish puts it live), "held" otherwise
 *   npx tsx scripts/guides/compendium.ts --key elden-ring --people limgrave
 *       "Services and people" as structured data (Merchants, Quest NPCs, Invaders and enemies, Services: name, role,
 *       short location), from the page's evidence pack, each person claim-checked, broken fragments dropped
 *       -> the area page's "people" field (the site shows grouped cards); --people all: every evidence-built page
 *   demandEntities(): the weekly rollout by demand (searchConsole.ts): entity pages for the most-searched queries that
 *       land on a missing or weak page, within config/compendium.monthly (default $10 a month)
 *
 * publish.ts renders published entity pages, links entity mentions in the guide text (with a hover preview), the
 * forgiving guide search over every entity, page, step and entry, and the structured "Services and people".
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson, searchesIn, usageScope } from './common';
import { fuzzyScore } from './siteText';
import {
  supportedSegments, trusted, gameLinesFor, evidenceText, claimCheck, claimReview, cleanEntryText,
  type Evidence, type EvidencePack, type GameEvidence, type ClaimPage, type ClaimVerdict,
} from './claimCheck';

/** The guide being worked on (set by each exported entry point; calls run one at a time). */
let key = arg('key') || '';
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A JSON object reply (the shared parseJson tries arrays first, which picks out a list inside the object). */
const parseObj = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  try {
    const v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return v && typeof v === 'object' ? v : {};
  } catch {
    const v: any = parseJson(t);
    return v && !Array.isArray(v) ? v : {};
  }
};
export const entitySlug = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ref = () => db().collection('guideCompendium').doc(key);

// ---------------- 1. taxonomy ----------------

export async function buildTaxonomy(k: string, demand: string[] = []) {
  key = k;
  return taxonomy(demand);
}
async function taxonomy(demand: string[] = []) {
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const pages = (sc.topPages || []).filter((p: any) => p.key === key).map((p: any) => `${p.slug} (${p.impressions} impressions, top query "${p.topQuery}")`);
  const words = game.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length > 3);
  const queries = [...demand.map((q) => `"${q}"`), ...(sc.topQueries || []).filter((q: any) => words.some((w: string) => q.query.toLowerCase().includes(w))).map((q: any) => `"${q.query}" ${q.impressions}`)];
  const prompt = [
    `Design the compendium for the video game "${game}": the TYPES of things players look up, and the entities of each type.`,
    `The guide's walkthrough is organised as: ${(info.areas || []).map((a: any) => a.name).join('; ')}.`,
    `Pages people found us with (Search Console, 28 days): ${pages.join('; ') || 'none'}. Queries: ${queries.join('; ') || 'none'}.`,
    'Pick 6 to 10 entity types that fit THIS game, each a kind of thing a player looks up one at a time (each collectible kind is its own type, e.g. "Cigarette Cards" and "Dinosaur Bones", never one "Collectibles" type) (for example for an open-world western: locations and towns, legendary animals, cigarette cards, dinosaur bones, gang hideouts, weapons, Stranger missions; for a soulslike: bosses, NPC questlines, weapons, spells). Use the game\'s own terms.',
    'For each type: an id (kebab-case), a label (plural, as players say it), a one-line description, and up to 12 example entities (exact in-game names, with correct apostrophes), the ones players search for most first (use the queries above).',
    'Then "entities": the entities from the queries and pages above (and the best-known places of the game), each {name, type, aliases: [other spellings people search, e.g. without the apostrophe]}.',
    'Reply with JSON only: {"taxonomy": [{"id": "...", "label": "...", "description": "...", "examples": ["..."]}], "entities": [{"name": "...", "type": "...", "aliases": ["..."]}]}',
  ].join('\n');
  const scope = { dollars: 0, searches: 0 };
  const res: any = await usageScope.run(scope, () => gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }));
  const j: any = parseObj(String(res?.text || ''));
  const types = (Array.isArray(j.taxonomy) ? j.taxonomy : []).filter((t: any) => t?.id && t?.label).map((t: any) => ({ id: entitySlug(t.id), label: cut(t.label, 60), description: cut(t.description, 200), examples: (t.examples || []).map((x: any) => cut(x, 80)).filter(Boolean).slice(0, 12) }));
  const ids = new Set(types.map((t: any) => t.id));
  const entities = (Array.isArray(j.entities) ? j.entities : []).filter((e: any) => e?.name).map((e: any) => ({ name: cut(e.name, 80), slug: entitySlug(e.name), type: ids.has(entitySlug(e.type)) ? entitySlug(e.type) : types[0]?.id, aliases: (e.aliases || []).map((x: any) => cut(x, 80)).filter(Boolean).slice(0, 6) }));
  await ref().set({ key, game, taxonomy: types, entities, builtAt: Date.now(), prototype: true, cost: scope }, { merge: true });
  console.log(`${game}: ${types.length} types: ${types.map((t: any) => `${t.label} (${t.examples.slice(0, 4).join(', ')})`).join(' | ')}`);
  console.log(`  entities: ${entities.map((e: any) => `${e.name} [${e.type}]`).join(', ')}`);
  console.log(`  cost $${scope.dollars.toFixed(4)}`);
}

// ---------------- 2. entity pages ----------------

/** The entity's evidence: searched (sources only) plus the game's shared research that names it. */
async function entityEvidence(game: string, name: string, type: string, rebuild: boolean): Promise<EvidencePack> {
  const slug = entitySlug(name);
  const pref = db().collection('evidencePacks').doc(`${key}__entity__${slug}`);
  const have = !rebuild ? ((await pref.get()).data() as EvidencePack | undefined) : undefined;
  let pack: EvidencePack;
  if (have?.evidence?.length) pack = have;
  else {
    const evidence: Evidence[] = [];
    const sites = new Set<string>();
    let searches = 0;
    const asks = [
      { topic: 'what', text: `In the video game "${game}", "${name}" (${type}): what and where it is (region, state or area), how a player gets there (nearest towns, roads, rivers, fast travel), and what is there: shops, merchants and services (with what they sell or do), collectibles, treasures and points of interest.` },
      { topic: 'quests', text: `In the video game "${game}", "${name}": the story missions (with their chapter), side missions, Stranger or side quests, gang hideouts, robberies and events that take place at or start from ${name}, and any characters met there.` },
    ];
    for (const a of asks) {
      const res: any = await gemini().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `${a.text}\nRun a few searches (the game's wikis and guides; at most four). Answer in short factual sentences, one fact per line, only what the sources say.` }] }],
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      searches += searchesIn(res);
      for (const seg of supportedSegments(res)) {
        if (evidence.some((e) => e.text === seg.text)) continue;
        evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: a.topic });
        seg.sites.forEach((s) => sites.add(s));
      }
    }
    pack = { key, slug: `entity__${slug}`, game, area: name, evidence, sites: [...sites], servicesComplete: false, searches, at: Date.now() };
    await pref.set(JSON.parse(JSON.stringify(pack)));
  }
  // The game's shared research (gameEvidence/{key}) where it names this entity: reused, no new searches.
  const g = (await db().collection('gameEvidence').doc(key).get()).data() as GameEvidence | undefined;
  const lines = g ? gameLinesFor(g, name, [name]).filter((e) => !pack.evidence.some((x) => x.text === e.text)) : [];
  return trusted({ ...pack, evidence: [...pack.evidence, ...lines], sites: [...new Set([...pack.sites, ...lines.flatMap((e) => e.sources)])] });
}

export type EntityPage = {
  name: string; slug: string; type: string; typeLabel: string; title: string; description: string; overview: string;
  summary: { region?: string; where?: string; gettingThere?: string; shops: { name: string; what?: string }[]; services: string[]; collectibles: { name: string; where?: string }[]; places: { name: string; what?: string }[]; quests: { name: string; kind?: string; chapter?: string }[]; chapters: string[]; notes: string[] };
  sources: string[];
};

const WRITER = (game: string, name: string, typeLabel: string, ev: EvidencePack, chapters: string[]) => [
  `Write a short, focused compendium page for "${name}" (${typeLabel}) in the video game "${game}", from the EVIDENCE only.`,
  'Every fact must come from an evidence line; leave a field empty rather than guess. Use the game\'s exact names.',
  `"chapters": which of the guide's chapters it features in, only from: ${chapters.join('; ')} (only when the evidence connects it).`,
  'Reply with JSON only:',
  '{"overview": "2-3 sentences: what it is and why players go there",',
  ' "region": "region / state", "where": "where in the region, by landmarks", "gettingThere": "1-2 sentences: route from a nearby town or landmark",',
  ' "shops": [{"name": "shop or merchant", "what": "what they sell or do"}], "services": ["fast travel, hotel, bank, fence, post office... one each"],',
  ' "collectibles": [{"name": "...", "where": "where at this place"}], "places": [{"name": "point of interest (a gang hideout, a dock, a landmark)", "what": "what it is or what happens there"}],',
  ' "quests": [{"name": "mission name", "kind": "story|side|stranger|robbery|event", "chapter": "Chapter N"}], "chapters": ["Chapter 4: Saint Denis"],',
  ' "notes": ["1-3 short sentences players search for, e.g. that no story missions start here, or what differs in the online mode (say so)"]}',
  '',
  'EVIDENCE:',
  evidenceText(ev),
].join('\n');

/** The page as claims for the check: the overview and route as sentences, each listed thing as its own claim. */
function claimPageOf(p: EntityPage): ClaimPage {
  return {
    steps: [
      { title: 'Overview', text: p.overview },
      ...(p.summary.where || p.summary.region ? [{ title: 'Where', text: `${p.name} is ${p.summary.where ? `${p.summary.where}` : ''}${p.summary.region ? ` in ${p.summary.region}` : ''}.` }] : []),
      ...(p.summary.gettingThere ? [{ title: 'Getting there', text: p.summary.gettingThere }] : []),
      ...(p.summary.notes.length ? [{ title: 'Notes', text: p.summary.notes.join(' ') }] : []),
    ],
    entries: [
      ...p.summary.collectibles.map((c, i) => ({ id: `c${i}`, name: c.name, where: `${c.where || `at ${p.name}`}` })),
      ...p.summary.places.map((c, i) => ({ id: `p${i}`, name: c.name, where: `at ${p.name}${c.what ? `: ${c.what}` : ''}` })),
    ],
    choices: [],
    advice: [],
    services: [
      ...p.summary.shops.map((s) => `${s.name} is at ${p.name}${s.what ? `: ${s.what}` : ''}`),
      ...p.summary.services.map((s) => `${p.name} has: ${s}`),
      ...p.summary.quests.map((q) => `The ${q.kind || ''} mission "${q.name}"${q.chapter ? ` (${q.chapter})` : ''} takes place at or starts from ${p.name}`),
      ...p.summary.chapters.map((c) => `${p.name} features in the story chapter "${c}"`),
    ],
    fights: [],
  };
}

/** Removes what the check couldn't support (by label), keeping the rest. */
function applyVerdicts(p: EntityPage, verdicts: ClaimVerdict[]): string[] {
  const bad = verdicts.filter((v) => v.verdict === 'unsupported' || v.verdict === 'contradicted');
  const removed: string[] = [];
  const nShops = p.summary.shops.length, nServ = p.summary.services.length, nQuests = p.summary.quests.length, nColl = p.summary.collectibles.length;
  const dropP = new Set<number>(), dropE = new Set<number>();
  const dropSentences: Record<string, Set<number>> = {};
  for (const v of bad) {
    removed.push(`${v.label} ${v.verdict}: ${cut(v.text, 120)}${v.fix ? ` (evidence says: ${cut(v.fix, 100)})` : ''}`);
    if (v.kind === 'merchant') dropP.add(Number(v.label.slice(1)) - 1);
    else if (v.kind === 'location' || v.kind === 'how') dropE.add(Number(v.label.slice(1)) - 1);
    else if (v.kind === 'sentence') (dropSentences[v.label] ||= new Set()).add(Number(v.sentence));
  }
  p.summary.shops = p.summary.shops.filter((_, i) => !dropP.has(i));
  p.summary.services = p.summary.services.filter((_, i) => !dropP.has(nShops + i));
  p.summary.quests = p.summary.quests.filter((_, i) => !dropP.has(nShops + nServ + i));
  p.summary.chapters = p.summary.chapters.filter((_, i) => !dropP.has(nShops + nServ + nQuests + i));
  p.summary.collectibles = p.summary.collectibles.filter((_, i) => !dropE.has(i));
  p.summary.places = p.summary.places.filter((_, i) => !dropE.has(nColl + i));
  // Steps: S1 overview, then Where, Getting there and Notes (in that order when present).
  const stepFields: ('overview' | 'where' | 'gettingThere' | 'notes')[] = ['overview', ...(p.summary.where || p.summary.region ? (['where'] as const) : []), ...(p.summary.gettingThere ? (['gettingThere'] as const) : []), ...(p.summary.notes.length ? (['notes'] as const) : [])];
  stepFields.forEach((f, i) => {
    const drop = dropSentences[`S${i + 1}`];
    if (!drop) return;
    if (f === 'overview') p.overview = p.overview.split(/(?<=[.!?])\s+/).filter((_, j) => !drop.has(j)).join(' ');
    else if (f === 'where') { p.summary.where = ''; p.summary.region = ''; }
    else if (f === 'notes') p.summary.notes = p.summary.notes.join(' ').split(/(?<=[.!?])\s+/).filter((_, j) => !drop.has(j));
    else p.summary.gettingThere = p.summary.gettingThere!.split(/(?<=[.!?])\s+/).filter((_, j) => !drop.has(j)).join(' ');
  });
  return removed;
}

export async function buildEntity(k: string, name: string, opts: { type?: string; rebuild?: boolean } = {}) {
  key = k;
  return entity(name, opts);
}
async function entity(name: string, opts: { type?: string; rebuild?: boolean } = {}) {
  const comp: any = (await ref().get()).data() || {};
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const known = (comp.entities || []).find((e: any) => entitySlug(e.name) === entitySlug(name));
  const typeId = opts.type || arg('type') || known?.type || comp.taxonomy?.[0]?.id || 'locations';
  const typeLabel = (comp.taxonomy || []).find((t: any) => t.id === typeId)?.label || typeId;
  const chapters = (info.areas || []).map((a: any) => a.name);
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => {
    const ev = await entityEvidence(game, name, typeLabel, opts.rebuild || arg('rebuild') === 'true');
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, name, typeLabel, ev, chapters) }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const j: any = parseObj(String(res?.text || ''));
    const clean = (v: unknown, n = 300) => cleanEntryText(cut(v, n));
    const page: EntityPage = {
      name, slug: entitySlug(name), type: typeId, typeLabel,
      title: '', description: '',
      overview: clean(j.overview, 700),
      summary: {
        region: clean(j.region, 80), where: clean(j.where, 240), gettingThere: clean(j.gettingThere, 400),
        shops: (j.shops || []).map((s: any) => ({ name: cut(s?.name, 80), what: clean(s?.what, 160) })).filter((s: any) => s.name),
        services: (j.services || []).map((s: any) => cut(s, 120)).filter((s: string) => s.length > 2),
        collectibles: (j.collectibles || []).map((c: any) => ({ name: cut(c?.name, 80), where: clean(c?.where, 200) })).filter((c: any) => c.name),
        places: (j.places || []).map((c: any) => ({ name: cut(c?.name, 80), what: clean(c?.what, 200) })).filter((c: any) => c.name),
        notes: (j.notes || []).map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3),
        quests: (j.quests || []).map((q: any) => ({ name: cut(q?.name, 80), kind: cut(q?.kind, 20), chapter: cut(q?.chapter, 40) })).filter((q: any) => q.name),
        chapters: (j.chapters || []).map((c: any) => cut(c, 80)).filter((c: string) => chapters.includes(c)),
      },
      sources: ev.sites.slice(0, 12),
    };
    // Claim check (the cheap model): unsupported and contradicted claims come out.
    const verdicts = await claimCheck(game, name, (await import('./claimCheck')).claimSlots(claimPageOf(page)), ev);
    const removed = applyVerdicts(page, verdicts);
    // The Pro claim review on what's left.
    const review = await claimReview(game, name, claimPageOf(page), ev);
    const removed2 = applyVerdicts(page, review.claims);
    // Titles for search: "Thieves' Landing – Red Dead Redemption 2: location, missions, shops".
    const parts = [page.summary.where || page.summary.region ? 'location' : '', page.summary.quests.length ? 'missions' : '', page.summary.shops.length ? 'shops' : '', page.summary.collectibles.length ? 'collectibles' : '', page.summary.places.length ? 'what\'s there' : ''].filter(Boolean).slice(0, 3);
    page.title = `${name} – ${game}${parts.length ? `: ${parts.join(', ')}` : ''}`;
    page.description = cut(`${name} in ${game}: ${[page.summary.region && `in ${page.summary.region}`, page.summary.shops.length && `${page.summary.shops.length} shop(s) and services`, page.summary.quests.length && `${page.summary.quests.length} mission(s)`, page.summary.collectibles.length && 'collectibles'].filter(Boolean).join(', ')}. ${page.overview.split(/(?<=[.!?])\s/)[0] || ''}`, 158);
    return { page, ev, removed: [...removed, ...removed2], review };
  });
  // Passed: published (the next site publish puts it live). Failed: held, never shown.
  const doc = { ...out.page, status: out.review.status === 'passed' ? 'published' : 'held', review: { score: out.review.score, status: out.review.status, supported: out.review.supported, total: out.review.total, ...(out.review.reason ? { reason: out.review.reason } : {}) }, removed: out.removed, evidence: { lines: out.ev.evidence.length, sites: out.ev.sites.length, searches: out.ev.searches }, cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches }, builtAt: Date.now() };
  await ref().collection('entities').doc(out.page.slug).set(JSON.parse(JSON.stringify(doc)));
  console.log(`${name} [${typeLabel}]: review ${out.review.status} ${out.review.score} (${out.review.supported}/${out.review.total}), ${out.removed.length} claim(s) removed, evidence ${out.ev.evidence.length} lines from ${out.ev.sites.length} sites, cost $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
  console.log(`  ${out.page.title}`);
  console.log(`  shops ${out.page.summary.shops.length}, services ${out.page.summary.services.length}, collectibles ${out.page.summary.collectibles.length}, places ${out.page.summary.places.length}, quests ${out.page.summary.quests.length}, notes ${out.page.summary.notes.length}, chapters ${out.page.summary.chapters.join('; ') || '-'}`);
  return { name, slug: out.page.slug, status: doc.status, score: out.review.score, dollars: scope.dollars, searches: scope.searches };
}

// ---------------- 4. Services and people, structured ----------------

export const PEOPLE_GROUPS = ['Merchants', 'Quest NPCs', 'Invaders and enemies', 'Services'] as const;

/**
 * "Services and people" for one area as grouped data, from its evidence only: Merchants, Quest NPCs, Invaders and
 * enemies, Services; each person {name, role, where}, checked against the evidence (unsupported ones come out), never a
 * fragment. Used by the evidence method (flagship.ts) and the backfill below.
 */
export async function structuredPeople(game: string, area: string, listed: string[], pack: EvidencePack): Promise<{ groups: PeopleGroup[]; removed: string[] }> {
  const prompt = [
    `"Services and people" for the area "${area}" in the video game "${game}", as structured data, from the EVIDENCE only.`,
    `The page's current free-text list (may have truncated fragments; use it only as a hint of who to look for): ${listed.join(' | ') || 'none'}`,
    `Groups: ${PEOPLE_GROUPS.join(', ')}. Merchants: anyone who sells or trades. Quest NPCs: characters with a questline or story role here. Invaders and enemies: NPC invaders, hostile named NPCs. Services: sites of grace or save points, blacksmiths, spirit or level-up services, fast travel and the like.`,
    'Each person or service: {"name": exact in-game name, "role": a few words (what they do for the player), "where": a short location by landmark}. Only what the evidence says; never a fragment or a half sentence.',
    'Reply with JSON only: {"groups": [{"group": "Merchants", "people": [{"name": "...", "role": "...", "where": "..."}]}]}',
    '',
    'EVIDENCE:',
    evidenceText(pack),
  ].join('\n');
  const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
  const j: any = parseObj(String(res?.text || ''));
  const groups = (Array.isArray(j.groups) ? j.groups : []).filter((x: any) => (PEOPLE_GROUPS as readonly string[]).includes(x?.group)).map((x: any) => ({
    group: x.group,
    people: (x.people || []).map((p: any) => ({ name: cut(p?.name, 60), role: cleanEntryText(cut(p?.role, 120)) || cut(p?.role, 60), where: cleanEntryText(cut(p?.where, 160)) })).filter((p: any) => p.name && p.role && p.role.length > 2),
  }));
  // Each person checked against the evidence: "<name> (<role>) is in <area>, <where>"; unsupported ones come out.
  const flat = groups.flatMap((x: any) => x.people.map((p: any) => ({ g: x.group, p })));
  if (!flat.length) return { groups: [], removed: [] };
  const verdicts = await claimCheck(game, area, flat.map((f: any, i: number) => ({ id: `K${i + 1}`, label: `P${i + 1}`, kind: 'merchant' as const, text: `${f.p.name} (${f.p.role}) is in ${area}${f.p.where ? `, ${f.p.where}` : ''}` })), pack);
  const keep = new Set(verdicts.map((v, i) => (v.verdict === 'supported' ? i : -1)).filter((i) => i >= 0));
  const removed = flat.filter((_: any, i: number) => !keep.has(i)).map((f: any) => `${f.p.name} (${f.g})`);
  const out = PEOPLE_GROUPS.map((name) => ({ group: name, people: flat.filter((f: any, i: number) => keep.has(i) && f.g === name).map((f: any) => f.p) })).filter((x) => x.people.length);
  return { groups: out, removed };
}
export type PeopleGroup = { group: string; people: { name: string; role: string; where?: string }[] };

/** One area page's "Services and people" from its evidence pack, saved on the page (its "people" field). */
async function people(slug: string, quiet = false): Promise<number> {
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const pref = db().collection('guides').doc(key).collection('areas').doc(slug);
  const page: any = (await pref.get()).data() || {};
  const ev = (await db().collection('evidencePacks').doc(`${key}__${slug}`).get()).data() as EvidencePack | undefined;
  if (!ev?.evidence?.length) throw new Error(`no evidence pack for ${key}/${slug} (build the page with the evidence method first)`);
  const g = (await db().collection('gameEvidence').doc(key).get()).data() as GameEvidence | undefined;
  const pack = trusted(g ? { ...ev, evidence: [...ev.evidence, ...gameLinesFor(g, page.name || slug, [])] } : ev);
  const listed = [...(page.info?.services || []), ...(page.shops || []).map((s: any) => `${s.name}${s.sells ? `: ${s.sells}` : ''}`)].map((x: any) => cut(x, 200));
  const scope = { dollars: 0, searches: 0 };
  const result = await usageScope.run(scope, () => structuredPeople(game, page.name || slug, listed, pack));
  if (result.groups.length) await pref.set({ people: { groups: result.groups, at: Date.now() } }, { merge: true });
  if (!quiet) {
    console.log(`${page.name}: ${result.groups.map((x) => `${x.group} ${x.people.length}`).join(', ') || 'nobody the evidence supports'}; removed ${result.removed.length}; cost $${scope.dollars.toFixed(4)}`);
    for (const x of result.groups) console.log(`  ${x.group}: ${x.people.map((p) => `${p.name} (${p.role}; ${p.where})`).join(' | ')}`);
  }
  return scope.dollars;
}

/** Every published page built with the evidence method (it has an evidence pack) that has no "people" yet. */
async function peopleAll(dry: boolean) {
  const packs = (await db().collection('evidencePacks').get()).docs.map((d) => d.id).filter((id) => !id.includes('__entity__'));
  let n = 0, dollars = 0;
  for (const id of packs) {
    const [k, slug] = id.split('__');
    const page: any = (await db().collection('guides').doc(k).collection('areas').doc(slug).get()).data();
    if (!page || page.status !== 'published' || page.people) continue;
    n++;
    if (dry) continue;
    key = k;
    try {
      dollars += await people(slug, true);
    } catch (e: any) {
      console.log(`  ${k}/${slug}: ${e?.message || e}`);
    }
  }
  console.log(`${dry ? 'Would build' : 'Built'} "Services and people" for ${n} evidence-built page(s)${dry ? '' : `, $${dollars.toFixed(3)}`}.`);
}

// ---------------- 3. entity pages by demand (weekly) ----------------

/** Words that aren't the thing searched for: the game's name and nicknames, and question words. */
const FILLER = new Set(['rdr2', 'rdr', 'red', 'dead', 'redemption', '2', 'tw3', 'w3', 'witcher', 'the', 'wild', 'hunt', 'elden', 'ring', 'er', 'bg3', 'baldurs', 'gate', 'where', 'is', 'how', 'to', 'get', 'find', 'in', 'location', 'locations', 'guide', 'map', 'walkthrough', 'what', 'a', 'of', 'game', 'skyrim', 'ff', 'final', 'fantasy']);
/** The thing a query is about, without the game's name and question words ("rdr2 thieves landing" -> "thieves landing"). */
export function queryEntity(query: string, game: string): string {
  const gameWords = new Set(game.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean));
  return query.toLowerCase().split(/\s+/).filter((w) => w && !FILLER.has(w) && !gameWords.has(w.replace(/[^a-z0-9]/g, ''))).join(' ').trim();
}

export const COMPENDIUM_MONTHLY_DEFAULT = 10;
const ENTITY_ESTIMATE = 0.2; // dollars a page (measured $0.15-0.19 on RDR2)

/**
 * The weekly rollout: Search Console queries (query, guide key, page slug, impressions) that land on a missing or weak
 * page, i.e. no page or entity page of that guide is about the thing searched for, grouped by guide and thing, most
 * impressions first. The guide's taxonomy is built (or refreshed with these queries) only when it has such queries; a
 * candidate must match one of its entities, which gives the exact in-game name. Pages are built with the evidence method
 * and the Pro review, published when they pass, within config/compendium.monthly (default $10 a month, counted in
 * system/compendium; separate from the flagship programme).
 */
export async function demandEntities(rows: { query: string; key: string; slug?: string; impressions: number }[], opts: { dry?: boolean; minImpressions?: number } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  const cfg: any = (await db().collection('config').doc('compendium').get()).data() || {};
  const monthly = Number.isFinite(Number(cfg.monthly)) ? Number(cfg.monthly) : COMPENDIUM_MONTHLY_DEFAULT;
  const sref = db().collection('system').doc('compendium');
  const st: any = (await sref.get()).data() || {};
  let spent = st.month === month ? Number(st.spent || 0) : 0;
  const built: { key: string; name: string; status: string; dollars: number }[] = [];
  const skipped: string[] = [];
  const byKey = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.key || r.impressions < (opts.minImpressions ?? 2)) continue;
    const m = byKey.get(r.key) || new Map<string, number>();
    m.set(r.query, (m.get(r.query) || 0) + r.impressions);
    byKey.set(r.key, m);
  }
  type Cand = { key: string; game: string; name: string; type: string; impressions: number };
  const cands: Cand[] = [];
  for (const [k, queries] of byKey) {
    const info: any = (await db().collection('guides').doc(k).get()).data();
    if (!info) continue;
    const game = String(info.game || k);
    // What the guide already has a page about: its live pages and its published entity pages.
    const live = (await db().collection('guides').doc(k).collection('areas').where('status', '==', 'published').get()).docs.map((d) => String(d.data().name || d.id));
    const cref = db().collection('guideCompendium').doc(k);
    const ents = (await cref.collection('entities').get()).docs.map((d) => d.data() as any);
    const covered = (thing: string) => [...live, ...ents.map((e) => e.name)].some((n) => fuzzyScore(thing, n) > 0 && fuzzyScore(n, thing) > 0);
    const wanted = new Map<string, number>();
    for (const [q, imp] of queries) {
      const thing = queryEntity(q, game);
      if (thing.length < 3 || covered(thing)) continue;
      wanted.set(thing, (wanted.get(thing) || 0) + imp);
    }
    if (!wanted.size) continue;
    // The taxonomy: built only for guides with such queries, refreshed when a wanted thing isn't one of its entities.
    let comp: any = (await cref.get()).data();
    const matchIn = (c: any, thing: string) => (c?.entities || []).find((e: any) => fuzzyScore(thing, e.name) > 0 && fuzzyScore(e.name, thing) > 0);
    if (!opts.dry && (!comp?.taxonomy || [...wanted.keys()].some((t) => !matchIn(comp, t)))) {
      const sc0 = { dollars: 0, searches: 0 };
      await usageScope.run(sc0, () => buildTaxonomy(k, [...wanted.keys()]));
      spent += sc0.dollars;
      comp = (await cref.get()).data();
    }
    for (const [thing, imp] of wanted) {
      const e = matchIn(comp, thing);
      if (!e) { skipped.push(`${game}: "${thing}" (not a ${game} entity)`); continue; }
      if (ents.some((x) => x.slug === e.slug)) continue; // built before (held after a failed review)
      cands.push({ key: k, game, name: e.name, type: e.type, impressions: imp });
    }
  }
  cands.sort((a, b) => b.impressions - a.impressions);
  for (const c of cands) {
    if (spent + ENTITY_ESTIMATE > monthly) { skipped.push(`${c.game}: ${c.name} (this month's $${monthly} is used up)`); continue; }
    if (opts.dry) { built.push({ key: c.key, name: c.name, status: 'planned', dollars: ENTITY_ESTIMATE }); spent += ENTITY_ESTIMATE; continue; }
    try {
      const r = await buildEntity(c.key, c.name, { type: c.type });
      spent += r.dollars;
      built.push({ key: c.key, name: c.name, status: r.status, dollars: r.dollars });
    } catch (e: any) {
      skipped.push(`${c.game}: ${c.name} (${cut(e?.message || e, 80)})`);
    }
  }
  if (!opts.dry) await sref.set({ month, spent: Math.round(spent * 10000) / 10000, lastRun: Date.now(), lastBuilt: built, monthly }, { merge: true });
  return { built, skipped, spent, monthly, candidates: cands.length };
}

async function main() {
  if (arg('people') === 'all') return void (await peopleAll(arg('dry') === 'true'), process.exit(0));
  if (!key) throw new Error('--key is required');
  if (arg('taxonomy') === 'true') await taxonomy();
  if (arg('entity')) await entity(String(arg('entity')));
  if (arg('people')) await people(String(arg('people')));
  process.exit(0);
}
if (process.argv[1] && /compendium\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
