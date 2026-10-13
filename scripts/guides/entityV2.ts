/**
 * Compendium pages, intent first (the new method for every entity type, all guides):
 *
 *   1. Intent: what players most want to know about this entity: Search Console queries naming it (for its page and its
 *      guide), questions players asked in the app about it, and the questions the best pages answer (the benchmark's).
 *   2. Research those questions (one searched call, allowed sources only), on top of the stored research and the
 *      benchmark's evidence.
 *   3. Write the page in the order of those questions: a quick answer, then each question answered. The type's fields
 *      stay as a light structure (where to find a character, a place's shops...); fields that don't fit are left out,
 *      and so is any line about what the entity is not or doesn't do.
 *   4. Fill gaps, don't shrink: claims the evidence doesn't back get one targeted search before anything is dropped;
 *      what's still unsupported is dropped and listed.
 *   5. The rejection check (what kind of entity it is, travel filler), and the Pro claim review.
 *   6. Usefulness: the page must cover every core point of the benchmark answer with verified evidence; a page that
 *      misses one is held.
 *   7. Consistency: a page whose fields contradict each other (chapters, places, outcomes) is held.
 *
 *   npx tsx scripts/guides/entityV2.ts --key baldur-s-gate-3 --name Minthara [--draft]
 * --draft (the pilot): the result is saved beside the live page (compendiumDrafts/{key}__{slug}, with the live page
 * as "before") and nothing live changes. Without it, a passing page replaces the live one at the same address; a held
 * one leaves the live page as it is.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope, searchesIn } from './common';
import { supportedSegments, trusted, trustedSites, evidenceText, claimCheck, claimReview, claimSlots, type Evidence, type EvidencePack, type ClaimPage } from './claimCheck';
import { entitySlug, entityKind, entityEvidenceFor, claimPageOf, applyVerdicts, type EntityPage } from './compendium';
import { benchmarkAnswer, coverage, pageText, BENCH_V, type BenchPoint } from './benchmark';
import { lintEntity, fuzzyScore } from './siteText';
import { ProQuotaWait } from './reviewerQuota';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};
type QA = { q: string; a: string };
type Story = { heading: string; text: string };
/** The "Story and background" section's parts, by kind of entity (only what the evidence covers is written). */
const STORY_PARTS: Record<string, string> = {
  person: '"Who they are"; "History with <the main character, by name>" (their past together and how their relationship develops); "Role in the story" (what they do in the main story, chapter by chapter); "Possible fates" (every outcome, with the choices that lead to each)',
  boss: '"Who or what it is" (its lore and origin); "Role in the story" (why it is fought and what defeating it leads to)',
  place: '"History" (its past and lore); "Story events here" (what happens there in the story, by chapter)',
  thing: '"Lore" (its in-game history or description), only if the evidence has any',
};
/** The research ask for the story section. */
const STORY_ASK: Record<string, (game: string, name: string) => string> = {
  person: (g, n) => `In the video game "${g}", the character "${n}": who they are and their background; their history and relationship with the game's main character (by name), including events before the game; their role in the main story chapter by chapter; and every possible fate or ending for them and the player choices that decide each. Full detail, plainly, including deaths and endings.`,
  boss: (g, n) => `In the video game "${g}", "${n}": its lore and origin, why the player fights it in the story, and what defeating it leads to. Full detail, plainly.`,
  place: (g, n) => `In the video game "${g}", "${n}": its history and lore, and the story events that happen there (by chapter). Full detail, plainly.`,
  thing: (g, n) => `In the video game "${g}", "${n}": its in-game lore and history, if any.`,
};

/** A searched call whose source-backed sentences (allowed sources only) become evidence lines. */
export async function searchedEvidence(prompt: string, prefix: string, topic: string): Promise<{ evidence: Evidence[]; searches: number }> {
  let res: any = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const r: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `${attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : ''}${prompt}\nRun a few searches (the game's wikis and guides; never fandom.com or fextralife.com; at most four). Answer in short factual sentences, one fact per line, only what the sources say.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    if (searchesIn(r)) res = r;
  }
  if (!res) return { evidence: [], searches: 0 };
  const evidence: Evidence[] = [];
  for (const seg of supportedSegments(res)) {
    const src = trustedSites(seg.sites);
    if (!src.length || evidence.some((x) => x.text === seg.text)) continue;
    evidence.push({ id: `${prefix}${evidence.length + 1}`, text: cut(seg.text, 400), sources: src.slice(0, 4), topic });
  }
  return { evidence, searches: searchesIn(res) };
}

/** 1. What players most want to know: Search Console queries, in-app questions, the benchmark's questions. */
async function intents(key: string, game: string, name: string, slug: string, benchQuestions: string[]): Promise<{ questions: string[]; from: string[] }> {
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const near = (t: string) => fuzzyScore(name, t) > 0 || String(t).toLowerCase().includes(name.toLowerCase().split(' ')[0]);
  const queries = [
    ...(sc.topQueries || []).filter((q: any) => near(q.query)).map((q: any) => `"${q.query}" (${q.impressions} impressions)`),
    ...(sc.topPages || []).filter((p: any) => p.key === key && p.slug === slug && p.topQuery).map((p: any) => `"${p.topQuery}" (this page's top query)`),
  ];
  const asked: string[] = [];
  for (const [col, at] of [['answerFeedback', 'at'], ['answerReports', 'createdAt']]) {
    for (const d of (await db().collection(col).orderBy(at, 'desc').limit(1000).get().catch(() => ({ docs: [] as any[] }))).docs) {
      const x: any = d.data();
      if (x.question && near(String(x.question)) && (!x.game || fuzzyScore(game, String(x.game)) > 0 || String(x.game).toLowerCase().includes(game.toLowerCase().split(':')[0]))) asked.push(`"${cut(x.question, 160)}" (asked in the app)`);
    }
  }
  const from = [...queries, ...asked.slice(0, 10), ...benchQuestions.map((q) => `"${q}" (top pages answer it)`)];
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `What do players of the video game "${game}" most want to know about "${name}"? From the signals below, list the 4 to 8 questions a page about it should answer, most wanted first (merge duplicates; Search Console queries and in-app questions count most).`,
      ...from.map((x) => `- ${x}`),
      'Reply with JSON only: {"questions": ["..."]}',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const qs = (objOf(String(res?.text || '')).questions || []).map((q: any) => cut(q, 160)).filter(Boolean).slice(0, 8);
  return { questions: qs.length ? qs : benchQuestions.slice(0, 6), from };
}

const WRITER = (game: string, name: string, typeLabel: string, kind: string, questions: string[], ev: EvidencePack, chapters: string[], must: string[], current: string) => [
  `Write the compendium page for "${name}" (${typeLabel}) in the video game "${game}", from the EVIDENCE only, in the order players want it.`,
  'Every fact must come from an evidence line; leave a question unanswered rather than guess. Use the game\'s exact names.',
  ...(must.length ? [`KEY FACTS: a player expects any good page to say each of these (the evidence backs them); state every one, in the overview or the answer it belongs to: ${must.map((m, i) => `(${i + 1}) ${m}`).join(' ')}`] : []),
  'Never write what it is not or what it does not do (e.g. "X is not a location", "X does not sell items"). No generic advice.',
  'State everything plainly: story events, deaths, betrayals, twists and endings included. No spoiler warnings, no hints in place of facts, no softened wording.',
  `"story" is the page's "Story and background" section, after the quick answer: ${STORY_PARTS[kind]}. Give full detail (3-8 sentences a part), in the order of the story; leave out a part the evidence says nothing about.`,
  `Answer these questions, in this order (skip one only if the evidence says nothing): ${questions.map((q, i) => `${i + 1}. ${q}`).join(' ')}`,
  `"chapters": which of the guide's chapters it features in, only from: ${chapters.join('; ')}.`,
  'Reply with JSON only:',
  '{"overview": "the quick answer: 2-4 short sentences with what players most want to know",',
  ' "story": [{"heading": "...", "text": "3-8 sentences"}],',
  ' "qa": [{"q": "the question", "a": "1-4 sentences"}],',
  kind === 'person'
    ? ' "whereToFind": [{"when": "chapter or act, empty if it never changes", "where": "where; for a companion, \\"in camp\\" or \\"travels with you\\" is valid"}], "shops": [{"name": "...", "what": "..."}],' + ' (a character has no region, places or collectibles fields)'
    : kind === 'place'
    ? ' "region": "...", "where": "...", "gettingThere": "route from a nearby town", "shops": [{"name": "...", "what": "..."}], "services": ["..."], "places": [{"name": "...", "what": "..."}], "collectibles": [{"name": "...", "where": "..."}],'
    : ' "where": "where it is found or fought",',
  ' "quests": [{"name": "every mission tied to it, each numbered part separately", "kind": "story|side|stranger|event", "chapter": "..."}], "chapters": ["..."], "notes": ["0-2 extra facts players search for"]}',
  'Each answer adds detail beyond the overview; never repeat an overview sentence. Each field says one thing: "where" is one location description, not two.',
  ...(current ? ['', 'THE CURRENT PAGE (its facts were checked against this evidence before): keep every fact of it the evidence backs, in the section it belongs to (a merchant’s stock under "shops", items and rewards under "notes" or the answer they belong to). Leave out its lines about what the entity is not or does not do.', current] : []),
  '',
  'EVIDENCE:',
  evidenceText(ev),
].join('\n');

/** 7. Do any of the page's statements contradict each other? (no search) */
/** A yes/no judgement per item, settled: judged twice, and a third judgement decides where the two disagree. */
async function settled(judge: () => Promise<boolean[]>): Promise<boolean[]> {
  const [a, b] = await Promise.all([judge(), judge()]);
  if (a.every((v, i) => v === b[i])) return a;
  const c = await judge();
  return a.map((v, i) => (v === b[i] ? v : c[i]));
}

/** Which statements the evidence backs, settled (for the benchmark's key points). */
const backed = (game: string, name: string, texts: string[], ev: EvidencePack) => settled(async () => {
  const v = await claimCheck(game, name, texts.map((t, i) => ({ id: `K${i + 1}`, label: `B${i + 1}`, kind: 'sentence' as const, sentence: 0, text: t })), ev);
  return texts.map((_, i) => v.find((x) => x.id === `K${i + 1}`)?.verdict === 'supported');
});

/** Whether the sources disagree with each other about each statement (settled; no search). */
const disputedIn = (game: string, name: string, texts: string[], ev: EvidencePack) => settled(async () => {
  const r: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [`Evidence about "${name}" in the video game "${game}" (sentences from sources):`, evidenceText(ev), '', 'For each statement below: do the evidence lines disagree with each other about it (some say one thing, others something different, e.g. two different colours, places or numbers for the same thing)? "agree" if they all say the same or only one says anything.', ...texts.map((t, i) => `S${i + 1}: ${t}`), 'Reply with JSON only: {"verdicts": ["disputed" | "agree", ...]} (one per statement, in order).'].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const v = objOf(String(r?.text || '')).verdicts;
  return texts.map((_, i) => Array.isArray(v) && String(v[i]).toLowerCase() === 'disputed');
});

/**
 * 7. Statements on the page that can't both be true (no search): candidates first, then each confirmed (settled): two
 * statements that can both be true (one after the other in the story, different parts of one place, one more specific
 * than the other, a different colour name for the same thing in another context) are not a contradiction.
 */
async function contradictions(game: string, name: string, text: string): Promise<string[]> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: `Our page about "${name}" in "${game}":
${text}

List pairs of statements on this page that cannot both be true (different chapters, places, directions, regions, outcomes or numbers for the same thing). Only contradictions within the page, not things you think are wrong. Reply with JSON only: {"contradictions": ["A says ..., but B says ..."]}` }] }],
    config: { responseMimeType: 'application/json', temperature: 0, seed: 7, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const cands: string[] = (objOf(String(res?.text || '')).contradictions || []).map((x: any) => cut(x, 240)).filter(Boolean).slice(0, 5);
  if (!cands.length) return [];
  const real = await settled(async () => {
    const r: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [`Our page about "${name}" in "${game}":`, text, '', 'For each possible contradiction below: can both statements be true at once? They can when one happens after the other in the story, they describe different parts of one place, one is just more specific than the other, or they are worded differently. Answer "contradiction" only when both cannot be true.', ...cands.map((c, i) => `C${i + 1}: ${c}`), 'Reply with JSON only: {"verdicts": ["contradiction" | "compatible", ...]} (one per item, in order).'].join('\n') }] }],
      config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const v = objOf(String(r?.text || '')).verdicts;
    return cands.map((_, i) => Array.isArray(v) && String(v[i]).toLowerCase() === 'contradiction');
  });
  return cands.filter((_, i) => real[i]);
}

/** The page's questions as claim steps after the base page's (their sentences are checked like the overview's). */
/** The page's questions and story parts as claim steps after the base page's (their sentences are checked like the overview's). */
function claimsWithQA(p: EntityPage & { qa: QA[]; story: Story[] }): { page: ClaimPage; base: number } {
  const page = claimPageOf(p);
  const base = page.steps.length;
  page.steps.push(...p.qa.map((x) => ({ title: x.q, text: x.a })), ...p.story.map((x) => ({ title: x.heading, text: x.text })));
  return { page, base };
}
function applyAll(p: EntityPage & { qa: QA[]; story: Story[] }, base: number, verdicts: any[]): string[] {
  const removed = applyVerdicts(p, verdicts.filter((v) => !(v.kind === 'sentence' && Number(String(v.label).slice(1)) > base)));
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  for (const v of verdicts) {
    if (v.kind !== 'sentence' || !(v.verdict === 'unsupported' || v.verdict === 'contradicted')) continue;
    const i = Number(String(v.label).slice(1)) - 1 - base;
    if (i < 0) continue;
    if (p.qa[i]) p.qa[i].a = sentences(p.qa[i].a).filter((_, j) => j !== Number(v.sentence)).join(' ');
    else if (p.story[i - p.qa.length]) { const st = p.story[i - p.qa.length]; st.text = sentences(st.text).filter((_, j) => j !== Number(v.sentence)).join(' '); }
    else continue;
    removed.push(`${v.label} ${v.verdict}: ${cut(v.text, 120)}`);
  }
  p.qa = p.qa.filter((x) => x.a.trim());
  p.story = p.story.filter((x) => x.text.trim());
  return removed;
}

export async function buildEntityV2(key: string, name: string, opts: { draft?: boolean; type?: string } = {}) {
  const slug = entitySlug(name);
  const ref = db().collection('guideCompendium').doc(key).collection('entities').doc(slug);
  const found: any = (await ref.get()).data();
  // A page that doesn't exist yet (or was never published) starts empty, typed from the guide's taxonomy.
  const isNew = !found || found.status !== 'published';
  let live: any = found;
  if (!found || (isNew && !found.overview)) {
    const tax = (((await db().collection('guideCompendium').doc(key).get()).data() || {}).taxonomy || []) as any[];
    const type = opts.type || found?.type || tax[0]?.id || 'people';
    live = { name, slug, type, typeLabel: tax.find((t) => t.id === type)?.label || found?.typeLabel || type, title: '', description: '', overview: '', summary: {}, ...(found || {}) };
  }
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const typeLabel = String(live.typeLabel || live.type);
  const kind = entityKind(typeLabel);
  const chapters = (info.areas || []).map((a: any) => a.name);
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => {
    // The benchmark (reused when the measurement already ran it).
    const bench = live.benchmark?.points?.length && Number(live.benchmark.v || 1) >= BENCH_V ? live.benchmark : { ...(await benchmarkAnswer(game, name, typeLabel)), at: Date.now(), v: BENCH_V };
    const core: BenchPoint[] = (bench.points || []).filter((p: BenchPoint) => p.core);
    // The live page against the same points (for the before/after).
    const beforeCov = await coverage(game, name, pageText(live), core);
    // 1-2. Intent, then research those questions on top of what's stored.
    const intent = await intents(key, game, name, slug, bench.questions || []);
    const stored = await entityEvidenceFor(key, game, name, typeLabel);
    // Approved player suggestions (contributions.ts): owner-approved evidence the page must state.
    const { contributionEvidence } = await import('./contribEvidence');
    const pc = await contributionEvidence(key, slug);
    const asked = await searchedEvidence(`In the video game "${game}", about "${name}" (${typeLabel}), answer: ${intent.questions.join(' ')}`, 'q', 'intent');
    // The story and background (who they are, history with the main character, role in the story, fates), in full.
    const story = kind === 'thing' ? { evidence: [] as Evidence[], searches: 0 } : await searchedEvidence(STORY_ASK[kind](game, name), 's', 'story');
    asked.evidence.push(...story.evidence);
    let ev: EvidencePack = trusted({ ...stored, evidence: [...stored.evidence, ...(bench.evidence || []), ...asked.evidence, ...pc], sites: [...new Set([...stored.sites, ...(bench.sites || []), ...asked.evidence.flatMap((e) => e.sources)])] });
    // The benchmark's core points are a model's answer: each is checked against the evidence (a targeted search for the
    // ones it doesn't back). Only verified points are required of the page; the rest are reported, not required.
    let ok = await backed(game, name, core.map((p) => p.point), ev);
    const unbacked = core.filter((_, i) => !ok[i]);
    if (unbacked.length) {
      const more = await searchedEvidence(`In the video game "${game}", about "${name}": check each statement against the game's wikis and guides and state what the sources say: ${unbacked.map((p) => `"${p.point}"`).join('; ')}`, 'v', 'benchmark check');
      if (more.evidence.length) {
        ev = trusted({ ...ev, evidence: [...ev.evidence, ...more.evidence], sites: [...new Set([...ev.sites, ...more.evidence.flatMap((e) => e.sources)])] });
        ok = await backed(game, name, core.map((p) => p.point), ev);
      }
    }
    const verified = core.map((_, i) => ok[i]);
    const disputed = new Set<number>();
    // 3-7, with one automatic retry: a held draft is written again with the reasons it was held, before the page is
    // held for good.
    const build = async (retryFor: string[]) => {
    // 3. Write in the order of the questions, stating every verified key fact.
    const fix = retryFor.length ? `\n\nA FIRST DRAFT OF THIS PAGE WAS HELD BECAUSE: ${retryFor.join(' | ')}\nFix that: state every missing key fact plainly, in the overview or the answer it belongs to; where the draft contradicted itself, keep only what the evidence says and describe each thing once.` : '';
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, name, typeLabel, kind, intent.questions, ev, chapters, [...core.filter((_, i) => verified[i]).map((p) => p.point), ...pc.map((x) => x.text)], pageText(live)) + fix }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 7000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const j = objOf(String(res?.text || ''));
    const clean = (v: unknown, n = 300) => cut(v, n);
    // Whole sentences up to n characters (never cut mid-sentence).
    const whole = (v: unknown, n: number) => cut(v, 4000).split(/(?<=[.!?])\s+/).reduce((a, x) => (a.length + x.length + 1 <= n || !a ? `${a} ${x}`.trim() : a), '');
    const named = (xs: any, f: string) => (Array.isArray(xs) ? xs : []).map((x: any) => ({ name: cut(x?.name, 80), [f]: clean(x?.[f], 220) })).filter((x: any) => x.name);
    const page: EntityPage & { qa: QA[]; story: Story[] } = {
      name: live.name, slug, type: live.type, typeLabel, title: live.title, description: live.description,
      overview: whole(j.overview, 700),
      qa: (Array.isArray(j.qa) ? j.qa : []).map((x: any) => ({ q: cut(x?.q, 160), a: whole(x?.a, 900) })).filter((x: QA) => x.q && x.a).slice(0, 8),
      story: (Array.isArray(j.story) ? j.story : []).map((x: any) => ({ heading: cut(x?.heading, 80), text: whole(x?.text, 1800) })).filter((x: Story) => x.heading && x.text).slice(0, 6),
      summary: {
        ...(kind === 'place' ? { region: clean(j.region, 80), where: clean(j.where, 240), gettingThere: clean(j.gettingThere, 400) } : kind === 'person' ? {} : { where: clean(j.where, 240) }),
        ...(kind === 'person' ? { whereToFind: (Array.isArray(j.whereToFind) ? j.whereToFind : []).map((w: any) => ({ when: clean(w?.when, 60), where: clean(w?.where, 240) })).filter((w: any) => w.where).slice(0, 8) } : {}),
        shops: named(j.shops, 'what') as any, services: kind === 'person' ? [] : (Array.isArray(j.services) ? j.services : []).map((x: any) => cut(x, 120)).filter(Boolean),
        // A character's page has no location fields (what's there, collectibles): those belong to places.
        collectibles: kind === 'person' ? [] : named(j.collectibles, 'where') as any, places: kind === 'person' ? [] : named(j.places, 'what') as any,
        quests: (Array.isArray(j.quests) ? j.quests : []).map((q: any) => ({ name: cut(q?.name, 80), kind: cut(q?.kind, 20), chapter: cut(q?.chapter, 40) })).filter((q: any) => q.name),
        chapters: (Array.isArray(j.chapters) ? j.chapters : []).map((c: any) => cut(c, 80)).filter((c: string) => chapters.includes(c)),
        notes: (Array.isArray(j.notes) ? j.notes : []).map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 2),
      },
      sources: [],
    };
    // 4. Claim check; unsupported claims get one targeted search before anything is dropped.
    const c1 = claimsWithQA(page);
    let verdicts = await claimCheck(game, name, claimSlots(c1.page), ev);
    const failed = verdicts.filter((v) => v.verdict === 'unsupported');
    let filled = 0;
    if (failed.length) {
      const more = await searchedEvidence(`In the video game "${game}", about "${name}": check each statement against the game's wikis and guides and state what the sources say: ${failed.slice(0, 10).map((v) => `"${cut(v.text, 200)}"`).join('; ')}`, 'g', 'gap');
      if (more.evidence.length) {
        ev = trusted({ ...ev, evidence: [...ev.evidence, ...more.evidence], sites: [...new Set([...ev.sites, ...more.evidence.flatMap((e) => e.sources)])] });
        verdicts = await claimCheck(game, name, claimSlots(c1.page), ev);
        filled = failed.filter((f) => verdicts.find((v) => v.id === f.id)?.verdict === 'supported').length;
      }
    }
    const dropped = applyAll(page, c1.base, verdicts);
    // 5. The rejection check, then the Pro review.
    const lint = lintEntity(page, kind === 'person');
    page.overview = lint.overview; page.summary = lint.summary as any;
    page.qa = page.qa.map((x) => ({ ...x, a: lintEntity({ overview: x.a, summary: {} }, kind === 'person').overview })).filter((x) => x.a);
    const c2 = claimsWithQA(page);
    const review = await claimReview(game, name, c2.page, ev);
    if ((review as any).status === 'waiting') throw new ProQuotaWait();
    dropped.push(...applyAll(page, c2.base, review.claims));
    page.sources = ev.sites.slice(0, 12);
    // 6. Usefulness: every core point of the benchmark covered.
    const text = pageText(page);
    const cov = await coverage(game, name, text, core);
    let missing = core.filter((_, i) => verified[i] && !cov[i]);
    if (missing.length) {
      // The page's own checks may have dropped the sentence that stated it: the point is checked once more (settled);
      // one the evidence doesn't back after all is unverified, not required.
      const still = await backed(game, name, missing.map((p) => p.point), ev);
      missing.forEach((p, i) => { if (!still[i]) verified[core.indexOf(p)] = false; });
      missing = missing.filter((_, i) => still[i]);
    }
    if (missing.length) {
      // A point the sources disagree about (one says brown, another yellow) is disputed: reported, not required, and
      // the page leaves the disputed detail out.
      const split = await disputedIn(game, name, missing.map((p) => p.point), ev);
      missing.forEach((p, i) => { if (split[i]) { verified[core.indexOf(p)] = false; disputed.add(core.indexOf(p)); } });
      missing = missing.filter((_, i) => !split[i]);
    }
    // 7. Consistency.
    const contra = await contradictions(game, name, text);
    const reasons = [
      review.status !== 'passed' ? `review ${review.score}: ${review.reason || 'failed'}` : '',
      lint.left.length ? 'still explains what kind of entity it is' : '',
      missing.length ? `misses ${missing.length} verified core point(s): ${missing.map((p) => p.point).join('; ')}` : '',
      contra.length ? `contradicts itself: ${contra.join('; ')}` : '',
    ].filter(Boolean);
    return { page, cov, review, dropped, filled, contra, reasons };
    };
    let built = await build([]);
    const attempts = built.reasons.length ? 2 : 1;
    if (built.reasons.length) {
      console.log(`  ${name}: first draft held (${cut(built.reasons.join(' | '), 200)}); retrying once.`);
      const second = await build(built.reasons);
      built = { ...second, dropped: [...built.dropped.map((x) => `(first draft) ${x}`), ...second.dropped], filled: built.filled + second.filled };
    }
    return { ...built, bench, core, beforeCov, verified, disputed, intent, attempts };
  });
  const passed = !out.reasons.length;
  // The answers to players' questions worked into the page's sections (no search, word for word); only what fits no
  // section stays, under "Also asked" (qaArrange.ts).
  {
    const { arrangeQA, restOfPage } = await import('./qaArrange');
    const r = await usageScope.run(scope, () => arrangeQA(game, name, out.page as any, restOfPage(out.page), kind));
    (out.page as any).story = r.story; (out.page as any).gameplay = r.gameplay; (out.page as any).alsoAsked = r.alsoAsked;
    out.page.summary.notes = r.notes;
    (out.page as any).qaArrangedAt = Date.now();
  }
  // Titles for search: kept for a page that has one (stable for the address), made for a new page.
  if (!live.title || (kind === 'person' && /collectible|what's there|location/i.test(String(live.title)))) {
    const sm: any = out.page.summary;
    const parts = [(out.page as any).story?.length && kind !== 'thing' ? 'story' : '', kind === 'person' && (sm.whereToFind || []).length ? 'where to find' : sm.where || sm.region ? 'location' : '', sm.quests.length ? 'missions' : '', sm.shops.length ? 'shops' : '', out.page.qa.length ? 'questions' : ''].filter(Boolean).slice(0, 3);
    out.page.title = `${name} – ${game}${parts.length ? `: ${parts.join(', ')}` : ''}`;
    out.page.description = cut(`${name} in ${game}. ${out.page.overview.split(/(?<=[.!?])\s/)[0] || ''}`, 158);
  }
  const doc = {
    ...out.page, method: 'intent', status: passed ? 'published' : 'held', ...(live.demand ? { demand: live.demand } : {}),
    // The character's common name (Ciri, Dijkstra): kept from the page, or found for a new one (commonNames.ts).
    ...(kind === 'person' && !live.noDisplayName ? await (async () => {
      if (live.displayName) return { displayName: live.displayName };
      const { commonNames } = await import('./commonNames');
      const c = (await usageScope.run(scope, () => commonNames(game, [name])))[name];
      return c ? { displayName: c } : {};
    })() : {}),
    ...(live.noDisplayName ? { noDisplayName: true } : {}),
    intent: { questions: out.intent.questions, from: out.intent.from.slice(0, 20) },
    benchmark: { ...out.bench, points: out.core.map((p, i) => ({ ...p, verified: out.verified[i], ...(out.disputed.has(i) ? { disputed: true } : {}), covered: out.cov[i], coveredBefore: out.beforeCov[i] })) },
    review: { score: out.review.score, status: out.review.status, supported: out.review.supported, total: out.review.total, ...(out.review.reason ? { reason: out.review.reason } : {}) },
    dropped: out.dropped.map((x) => cut(x, 200)), gapsFilled: out.filled, attempts: out.attempts, ...(out.contra.length ? { contradictions: out.contra } : {}),
    ...(out.reasons.length ? { heldBecause: out.reasons } : {}),
    cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches }, builtAt: Date.now(),
  };
  if (opts.draft) await db().collection('compendiumDrafts').doc(`${key}__${slug}`).set(JSON.parse(JSON.stringify({ before: live, after: doc, at: Date.now() })));
  else if (passed || isNew) await ref.set(JSON.parse(JSON.stringify(doc))); // a new page that's held is kept, not shown
  else await ref.set({ v2Held: JSON.parse(JSON.stringify({ at: Date.now(), reasons: out.reasons, cost: doc.cost })) }, { merge: true }); // the live page stays
  console.log(`${key} / ${name}: ${passed ? 'passes' : `held (${out.reasons.join(' | ').slice(0, 300)})`}; verified core points ${out.beforeCov.filter((c, i) => c && out.verified[i]).length} -> ${out.cov.filter((c, i) => c && out.verified[i]).length} of ${out.verified.filter(Boolean).length} (${out.core.length - out.verified.filter(Boolean).length} unverified${out.disputed.size ? `, ${out.disputed.size} disputed by the sources` : ''}), ${out.page.qa.length} question(s) answered, ${out.attempts} attempt(s), ${out.filled} claim(s) saved by the gap search, ${out.dropped.length} dropped, $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
  // "kept": an existing page that was held keeps its live version.
  return { name, slug, status: passed ? 'published' : isNew ? 'held' : 'kept', reasons: out.reasons, dollars: scope.dollars, searches: scope.searches, score: out.review.score, coreCovered: out.cov.filter(Boolean).length, core: out.core.length, whereToFind: ((out.page.summary as any).whereToFind || []).length };
}

async function main() {
  const key = String(arg('key') || '');
  const names = process.argv.flatMap((a, i) => (a === '--name' ? [process.argv[i + 1]] : []));
  for (const n of names) await buildEntityV2(key, n, { draft: arg('draft') === 'true' });
  setTimeout(() => process.exit(0), 300);
}
if (/entityV2\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('entityV2 failed:', e?.message || e); process.exit(1); });
