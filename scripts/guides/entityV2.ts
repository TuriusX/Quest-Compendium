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
import { benchmarkAnswer, coverage, pageText, type BenchPoint } from './benchmark';
import { lintEntity, fuzzyScore } from './siteText';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};
type QA = { q: string; a: string };

/** A searched call whose source-backed sentences (allowed sources only) become evidence lines. */
async function searchedEvidence(prompt: string, prefix: string, topic: string): Promise<{ evidence: Evidence[]; searches: number }> {
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
  `Answer these questions, in this order (skip one only if the evidence says nothing): ${questions.map((q, i) => `${i + 1}. ${q}`).join(' ')}`,
  `"chapters": which of the guide's chapters it features in, only from: ${chapters.join('; ')}.`,
  'Reply with JSON only:',
  '{"overview": "the quick answer: 2-4 short sentences with what players most want to know",',
  ' "qa": [{"q": "the question", "a": "1-4 sentences"}],',
  kind === 'person'
    ? ' "whereToFind": [{"when": "chapter or act, empty if it never changes", "where": "where; for a companion, \\"in camp\\" or \\"travels with you\\" is valid"}], "shops": [{"name": "...", "what": "..."}],'
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
async function contradictions(game: string, name: string, text: string): Promise<string[]> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: `Our page about "${name}" in "${game}":\n${text}\n\nList any statements on this page that contradict each other (different chapters, places, directions, regions, outcomes or numbers for the same thing; two descriptions of where it is that can't both be true). Only real contradictions within the page, not things you think are wrong. Reply with JSON only: {"contradictions": ["A says ..., but B says ..."]}` }] }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  return (objOf(String(res?.text || '')).contradictions || []).map((x: any) => cut(x, 240)).filter(Boolean).slice(0, 5);
}

/** The page's questions as claim steps after the base page's (their sentences are checked like the overview's). */
function claimsWithQA(p: EntityPage & { qa: QA[] }): { page: ClaimPage; base: number } {
  const page = claimPageOf(p);
  const base = page.steps.length;
  page.steps.push(...p.qa.map((x) => ({ title: x.q, text: x.a })));
  return { page, base };
}
function applyAll(p: EntityPage & { qa: QA[] }, base: number, verdicts: any[]): string[] {
  const removed = applyVerdicts(p, verdicts.filter((v) => !(v.kind === 'sentence' && Number(String(v.label).slice(1)) > base)));
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  for (const v of verdicts) {
    if (v.kind !== 'sentence' || !(v.verdict === 'unsupported' || v.verdict === 'contradicted')) continue;
    const i = Number(String(v.label).slice(1)) - 1 - base;
    if (i < 0 || !p.qa[i]) continue;
    p.qa[i].a = sentences(p.qa[i].a).filter((_, j) => j !== Number(v.sentence)).join(' ');
    removed.push(`${v.label} ${v.verdict}: ${cut(v.text, 120)}`);
  }
  p.qa = p.qa.filter((x) => x.a.trim());
  return removed;
}

export async function buildEntityV2(key: string, name: string, opts: { draft?: boolean } = {}) {
  const slug = entitySlug(name);
  const ref = db().collection('guideCompendium').doc(key).collection('entities').doc(slug);
  const live: any = (await ref.get()).data();
  if (!live) throw new Error(`no page ${key}/${slug}`);
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const typeLabel = String(live.typeLabel || live.type);
  const kind = entityKind(typeLabel);
  const chapters = (info.areas || []).map((a: any) => a.name);
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => {
    // The benchmark (reused when the measurement already ran it).
    const bench = live.benchmark?.points?.length ? live.benchmark : { ...(await benchmarkAnswer(game, name, typeLabel)), at: Date.now() };
    const core: BenchPoint[] = (bench.points || []).filter((p: BenchPoint) => p.core);
    // The live page against the same points (for the before/after).
    const beforeCov = core.every((p) => typeof p.covered === 'boolean') ? core.map((p) => !!p.covered) : await coverage(game, name, pageText(live), core);
    // 1-2. Intent, then research those questions on top of what's stored.
    const intent = await intents(key, game, name, slug, bench.questions || []);
    const stored = await entityEvidenceFor(key, game, name, typeLabel);
    const asked = await searchedEvidence(`In the video game "${game}", about "${name}" (${typeLabel}), answer: ${intent.questions.join(' ')}`, 'q', 'intent');
    let ev: EvidencePack = trusted({ ...stored, evidence: [...stored.evidence, ...(bench.evidence || []), ...asked.evidence], sites: [...new Set([...stored.sites, ...(bench.sites || []), ...asked.evidence.flatMap((e) => e.sources)])] });
    // The benchmark's core points are a model's answer: each is checked against the evidence (a targeted search for the
    // ones it doesn't back). Only verified points are required of the page; the rest are reported, not required.
    const pointSlots = (ps: BenchPoint[]) => ps.map((p, i) => ({ id: `K${i + 1}`, label: `B${i + 1}`, kind: 'sentence' as const, sentence: 0, text: p.point }));
    let pv = await claimCheck(game, name, pointSlots(core), ev);
    const okPoint = (i: number) => pv.find((v) => v.id === `K${i + 1}`)?.verdict === 'supported';
    const unbacked = core.filter((_, i) => !okPoint(i));
    if (unbacked.length) {
      const more = await searchedEvidence(`In the video game "${game}", about "${name}": check each statement against the game's wikis and guides and state what the sources say: ${unbacked.map((p) => `"${p.point}"`).join('; ')}`, 'v', 'benchmark check');
      if (more.evidence.length) {
        ev = trusted({ ...ev, evidence: [...ev.evidence, ...more.evidence], sites: [...new Set([...ev.sites, ...more.evidence.flatMap((e) => e.sources)])] });
        pv = await claimCheck(game, name, pointSlots(core), ev);
      }
    }
    const verified = core.map((_, i) => okPoint(i));
    // 3. Write in the order of the questions, stating every verified key fact.
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, name, typeLabel, kind, intent.questions, ev, chapters, core.filter((_, i) => verified[i]).map((p) => p.point), pageText(live)) }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 7000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const j = objOf(String(res?.text || ''));
    const clean = (v: unknown, n = 300) => cut(v, n);
    // Whole sentences up to n characters (never cut mid-sentence).
    const whole = (v: unknown, n: number) => cut(v, 4000).split(/(?<=[.!?])\s+/).reduce((a, x) => (a.length + x.length + 1 <= n || !a ? `${a} ${x}`.trim() : a), '');
    const named = (xs: any, f: string) => (Array.isArray(xs) ? xs : []).map((x: any) => ({ name: cut(x?.name, 80), [f]: clean(x?.[f], 220) })).filter((x: any) => x.name);
    const page: EntityPage & { qa: QA[] } = {
      name: live.name, slug, type: live.type, typeLabel, title: live.title, description: live.description,
      overview: whole(j.overview, 700),
      qa: (Array.isArray(j.qa) ? j.qa : []).map((x: any) => ({ q: cut(x?.q, 160), a: whole(x?.a, 900) })).filter((x: QA) => x.q && x.a).slice(0, 8),
      summary: {
        ...(kind === 'place' ? { region: clean(j.region, 80), where: clean(j.where, 240), gettingThere: clean(j.gettingThere, 400) } : kind === 'person' ? {} : { where: clean(j.where, 240) }),
        ...(kind === 'person' ? { whereToFind: (Array.isArray(j.whereToFind) ? j.whereToFind : []).map((w: any) => ({ when: clean(w?.when, 60), where: clean(w?.where, 240) })).filter((w: any) => w.where).slice(0, 8) } : {}),
        shops: named(j.shops, 'what') as any, services: (Array.isArray(j.services) ? j.services : []).map((x: any) => cut(x, 120)).filter(Boolean),
        collectibles: named(j.collectibles, 'where') as any, places: named(j.places, 'what') as any,
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
    dropped.push(...applyAll(page, c2.base, review.claims));
    page.sources = ev.sites.slice(0, 12);
    // 6. Usefulness: every core point of the benchmark covered.
    const text = pageText(page);
    const cov = await coverage(game, name, text, core);
    const missing = core.filter((_, i) => verified[i] && !cov[i]);
    // 7. Consistency.
    const contra = await contradictions(game, name, text);
    const reasons = [
      review.status !== 'passed' ? `review ${review.score}: ${review.reason || 'failed'}` : '',
      lint.left.length ? 'still explains what kind of entity it is' : '',
      missing.length ? `misses ${missing.length} verified core point(s): ${missing.map((p) => p.point).join('; ')}` : '',
      contra.length ? `contradicts itself: ${contra.join('; ')}` : '',
    ].filter(Boolean);
    return { page, bench, core, cov, beforeCov, verified, intent, review, dropped, filled, contra, reasons };
  });
  const passed = !out.reasons.length;
  const doc = {
    ...out.page, method: 'intent', status: passed ? 'published' : 'held',
    intent: { questions: out.intent.questions, from: out.intent.from.slice(0, 20) },
    benchmark: { ...out.bench, points: out.core.map((p, i) => ({ ...p, verified: out.verified[i], covered: out.cov[i], coveredBefore: out.beforeCov[i] })) },
    review: { score: out.review.score, status: out.review.status, supported: out.review.supported, total: out.review.total, ...(out.review.reason ? { reason: out.review.reason } : {}) },
    dropped: out.dropped.map((x) => cut(x, 200)), gapsFilled: out.filled, ...(out.contra.length ? { contradictions: out.contra } : {}),
    ...(out.reasons.length ? { heldBecause: out.reasons } : {}),
    cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches }, builtAt: Date.now(),
  };
  if (opts.draft) await db().collection('compendiumDrafts').doc(`${key}__${slug}`).set(JSON.parse(JSON.stringify({ before: live, after: doc, at: Date.now() })));
  else if (passed) await ref.set(JSON.parse(JSON.stringify(doc)));
  else await ref.set({ v2Held: JSON.parse(JSON.stringify({ at: Date.now(), reasons: out.reasons, cost: doc.cost })) }, { merge: true });
  console.log(`${key} / ${name}: ${passed ? 'passes' : `held (${out.reasons.join(' | ').slice(0, 300)})`}; verified core points ${out.beforeCov.filter((c, i) => c && out.verified[i]).length} -> ${out.cov.filter((c, i) => c && out.verified[i]).length} of ${out.verified.filter(Boolean).length} (${out.core.length - out.verified.filter(Boolean).length} unverified), ${out.page.qa.length} question(s) answered, ${out.filled} claim(s) saved by the gap search, ${out.dropped.length} dropped, $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
  return { status: doc.status, dollars: scope.dollars, coreCovered: out.cov.filter(Boolean).length, core: out.core.length };
}

async function main() {
  const key = String(arg('key') || '');
  const names = process.argv.flatMap((a, i) => (a === '--name' ? [process.argv[i + 1]] : []));
  for (const n of names) await buildEntityV2(key, n, { draft: arg('draft') === 'true' });
  setTimeout(() => process.exit(0), 300);
}
if (/entityV2\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('entityV2 failed:', e?.message || e); process.exit(1); });
