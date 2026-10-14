/**
 * Quest pages (compendium type "Quests"; prototype on Red Dead Redemption 2). Same method as entity pages: searched
 * evidence (blocked and low-trust sites never count), a page written from the evidence only, every claim checked, the
 * Pro claim review; failed pages are held (never shown, never "coming soon").
 *
 *   story missions: short pages (giver, chapter, rewards, missables, choice outcomes, gold medal goals) that link to the
 *     walkthrough for the step-by-step (no walkthrough text repeated)
 *   Stranger strands and side quests: full pages (every part with where it starts, steps, rewards, missables, choices)
 *
 *   npx tsx scripts/guides/quests.ts --key red-dead-redemption-2 --story "Who Is Not Without Sin" [--story ...]
 *   npx tsx scripts/guides/quests.ts --key red-dead-redemption-2 --stranger "The Noblest of Men, and a Woman"
 *   npx tsx scripts/guides/quests.ts --key red-dead-redemption-2 --rewrite-steps [--max-dollars 1]
 *     rewrites the published quest pages' steps as actions the player takes (the quest log loads them as objectives),
 *     from the stored evidence only (no searches), checked like a new page; a page whose new steps don't pass keeps
 *     its old ones. Step ids stay the same, so players' ticks still apply.
 * -> guideCompendium/{key}/entities/{slug} { kind: 'quest', type: 'story-missions' | 'stranger-missions', quest: {...} }
 * Stored as structured data (giver, chapter, parts and steps with ids, rewards, missables, choices, walkthrough link)
 * so the app's quest log can use it later.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, usageScope, searchesIn } from './common';
import { supportedSegments, trusted, evidenceText, claimCheck, claimReview, claimSlots, type Evidence, type EvidencePack, type ClaimPage, type ClaimVerdict } from './claimCheck';
import { entitySlug } from './compendium';
import { entitySegments, lintEntity, chapterPage } from './siteText';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};

export type QuestKind = 'story' | 'stranger';
export type Quest = {
  giver?: string; chapter?: string; where?: string;
  rewards: string[]; missables: string[]; goldMedal: string[];
  choices: { choice: string; outcome: string }[];
  parts: { id: string; name: string; chapter?: string; where?: string; steps: { id: string; text: string }[] }[];
  walkthrough?: { slug: string; name: string; anchor?: string };
};

async function questEvidence(key: string, game: string, name: string, kind: QuestKind): Promise<EvidencePack> {
  const slug = entitySlug(name);
  const pref = db().collection('evidencePacks').doc(`${key}__quest__${slug}`);
  const have = (await pref.get()).data() as EvidencePack | undefined;
  if (have?.evidence?.length) return trusted(have);
  const asks = kind === 'story'
    ? [
        { topic: 'what', text: `In the video game "${game}", the story mission "${name}": who gives it (the quest giver), which chapter it is in, where it starts, its rewards (money, items, unlocks), anything missable in it, any choices and their outcomes, and the gold medal requirements.` },
      ]
    : [
        { topic: 'what', text: `In the video game "${game}", the Stranger mission strand "${name}": who gives it, how it unlocks, every part of it (each part's name, chapter and where it starts), and the rewards.` },
        { topic: 'steps', text: `In the video game "${game}", "${name}": what the player does in each part, step by step, anything missable, and any choices with their outcomes.` },
      ];
  const evidence: Evidence[] = [];
  const sites = new Set<string>();
  let searches = 0;
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
  const pack: EvidencePack = { key, slug: `quest__${slug}`, game, area: name, evidence, sites: [...sites], servicesComplete: false, searches, at: Date.now() };
  await pref.set(JSON.parse(JSON.stringify(pack)));
  return trusted(pack);
}

/**
 * Steps are what the player does, in order, written to them: the quest log shows them as objectives. Not what happens
 * ("Gill sends an invitation") or what the game does ("Small fish are stored in the satchel").
 */
const STEP_RULE = 'Write each step as an action the player takes, in order, addressed to the player in the imperative and at most 120 characters: "Store small fish in your satchel and large ones on your horse", "Mail each fish to Jeremy Gill from a post office", "Read Gill\'s invitation at a post office". Never describe what happens or what the game does ("Gill sends an invitation", "Small fish are stored in the satchel"); turn it into what the player does about it, or leave it out.';

const WRITER = (game: string, name: string, kind: QuestKind, ev: EvidencePack, chapters: string[]) => [
  `Write a compendium page for the ${kind === 'story' ? 'story mission' : 'Stranger mission strand'} "${name}" in the video game "${game}", from the EVIDENCE only.`,
  'Every fact must come from an evidence line; leave a field empty rather than guess. Use the game\'s exact names. Never write generic advice.',
  '"chapter": as the evidence words it (e.g. "Chapter 2", "Epilogue Part 1"), only when it says.',
  'Reply with JSON only:',
  '{"overview": "1-2 sentences: what the mission is about and how it ends", "giver": "who gives it", "chapter": "...", "where": "where it starts",',
  ' "rewards": ["each reward"], "missables": ["anything missable, only if the evidence says so"], "choices": [{"choice": "...", "outcome": "..."}],',
  kind === 'story'
    ? ' "goldMedal": ["each gold medal requirement"]}'
    : ' "parts": [{"name": "part name (e.g. Mission – I)", "chapter": "...", "where": "where it starts", "steps": ["one action the player takes, one step each"]}]}',
  kind === 'story' ? 'No step-by-step: the guide\'s walkthrough has it.' : 'List every part of the strand the evidence names, in order.',
  kind === 'story' ? '' : STEP_RULE,
  '',
  'EVIDENCE:',
  evidenceText(ev),
].join('\n');

/** The page as claims: the overview as sentences, each fact (and each step) as its own claim. */
function claimsOf(name: string, overview: string, q: Quest): { page: ClaimPage; map: ((ok: boolean) => void)[] } {
  const services: string[] = [];
  const map: ((ok: boolean) => void)[] = [];
  const keep = <T,>(list: T[], i: number) => (ok: boolean) => { if (!ok) (list as any)[i] = null; };
  if (q.giver) { services.push(`"${name}" is given by ${q.giver}`); map.push((ok) => { if (!ok) q.giver = ''; }); }
  if (q.chapter) { services.push(`"${name}" takes place in ${q.chapter}`); map.push((ok) => { if (!ok) q.chapter = ''; }); }
  if (q.where) { services.push(`"${name}" starts ${q.where}`); map.push((ok) => { if (!ok) q.where = ''; }); }
  q.rewards.forEach((r, i) => { services.push(`Completing "${name}" rewards: ${r}`); map.push(keep(q.rewards, i)); });
  q.missables.forEach((r, i) => { services.push(`In "${name}", this can be permanently missed: ${r}`); map.push(keep(q.missables, i)); });
  q.goldMedal.forEach((r, i) => { services.push(`A gold medal requirement for "${name}": ${r}`); map.push(keep(q.goldMedal, i)); });
  q.choices.forEach((c, i) => { services.push(`In "${name}", choosing "${c.choice}" leads to: ${c.outcome}`); map.push(keep(q.choices, i)); });
  q.parts.forEach((p, i) => {
    // The part, its chapter and where it starts as separate claims: an unsupported chapter drops the chapter, not the part.
    services.push(`"${p.name}" is a part of "${name}"`);
    map.push(keep(q.parts, i));
    if (p.chapter) { services.push(`"${p.name}" takes place in ${p.chapter}`); map.push((ok) => { if (!ok && q.parts[i]) q.parts[i].chapter = ''; }); }
    if (p.where) { services.push(`"${p.name}" starts ${p.where}`); map.push((ok) => { if (!ok && q.parts[i]) q.parts[i].where = ''; }); }
  });
  const steps = [{ title: 'Overview', text: overview }, ...q.parts.flatMap((p) => p.steps.map((s) => ({ title: p.name, text: s.text })))];
  return { page: { steps, entries: [], choices: [], advice: [], services, fights: [] }, map };
}

function applyQuestVerdicts(overview: string, q: Quest, map: ((ok: boolean) => void)[], verdicts: ClaimVerdict[]) {
  const bad = verdicts.filter((v) => v.verdict === 'unsupported' || v.verdict === 'contradicted');
  const removed = bad.map((v) => `${v.label} ${v.verdict}: ${cut(v.text, 120)}`);
  const dropSent = new Map<number, Set<number>>();
  for (const v of bad) if (v.kind === 'sentence') { const s = Number(v.label.slice(1)) - 1; (dropSent.get(s) || dropSent.set(s, new Set()).get(s)!).add(Number(v.sentence)); }
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  if (dropSent.has(0)) overview = sentences(overview).filter((_, j) => !dropSent.get(0)!.has(j)).join(' ');
  // Step sentences first (numbered over every part, as the claims were), then the facts and parts that failed.
  let k = 1;
  for (const p of q.parts) for (const st of p.steps) { const d = dropSent.get(k++); if (d) st.text = sentences(st.text).filter((_, j) => !d.has(j)).join(' '); }
  for (const v of bad) if (v.kind === 'merchant') map[Number(v.label.slice(1)) - 1]?.(false);
  q.rewards = q.rewards.filter(Boolean); q.missables = q.missables.filter(Boolean); q.goldMedal = q.goldMedal.filter(Boolean);
  q.choices = q.choices.filter(Boolean);
  q.parts = q.parts.filter(Boolean).map((p) => ({ ...p, steps: p.steps.filter((s) => s.text) }));
  return { overview, removed };
}

/** The walkthrough page for the step-by-step: a step titled after the mission, else its chapter's page. */
async function walkthroughFor(key: string, name: string, chapter: string) {
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const pages = (await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) }));
  for (const p of pages) for (const st of p.walkthrough || []) if (st.id && entitySegments(String(st.title || ''), [{ name, slug: 'x' }]).some((s) => s.slug)) return { slug: p.slug, name: p.name, anchor: String(st.id) };
  const slug = chapter ? chapterPage(chapter, (info.areas || []).filter((a: any) => pages.some((p) => p.slug === a.slug))) : undefined;
  const ch = slug ? (info.areas || []).find((a: any) => a.slug === slug) : null;
  return ch ? { slug: ch.slug, name: ch.name } : undefined;
}

export async function buildQuest(key: string, name: string, kind: QuestKind) {
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => {
    const info: any = (await db().collection('guides').doc(key).get()).data() || {};
    const game = String(info.game || key);
    const chapters = (info.areas || []).map((a: any) => a.name);
    const ev = await questEvidence(key, game, name, kind);
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, name, kind, ev, chapters) }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const j = objOf(String(res?.text || ''));
    const list = (v: any, n = 200) => (Array.isArray(v) ? v.map((x) => cut(x, n)).filter(Boolean) : []);
    const slug = entitySlug(name);
    const q: Quest = {
      giver: cut(j.giver, 80), chapter: cut(j.chapter, 60), where: cut(j.where, 200),
      rewards: list(j.rewards), missables: list(j.missables), goldMedal: list(j.goldMedal),
      choices: (Array.isArray(j.choices) ? j.choices : []).map((c: any) => ({ choice: cut(c?.choice, 160), outcome: cut(c?.outcome, 240) })).filter((c: any) => c.choice && c.outcome),
      parts: kind === 'stranger' ? (Array.isArray(j.parts) ? j.parts : []).map((p: any, i: number) => ({
        id: `${slug}-p${i + 1}`, name: cut(p?.name, 80), chapter: cut(p?.chapter, 60), where: cut(p?.where, 200),
        steps: list(p?.steps, 300).map((t, s) => ({ id: `${slug}-p${i + 1}-s${s + 1}`, text: t })),
      })).filter((p: any) => p.name) : [],
    };
    let overview = cut(j.overview, 400);
    const c1 = claimsOf(name, overview, q);
    const v1 = await claimCheck(game, name, claimSlots(c1.page), ev);
    const a1 = applyQuestVerdicts(overview, q, c1.map, v1);
    overview = a1.overview;
    const c2 = claimsOf(name, overview, q);
    const review = await claimReview(game, name, c2.page, ev);
    const a2 = applyQuestVerdicts(overview, q, c2.map, review.claims);
    overview = lintEntity({ overview: a2.overview, summary: {} }, false).overview;
    q.walkthrough = await walkthroughFor(key, name, q.chapter || '');
    return { slug, game, overview, q, review, removed: [...a1.removed, ...a2.removed], ev };
  });
  const type = kind === 'story' ? 'story-missions' : 'stranger-missions';
  const typeLabel = kind === 'story' ? 'Story Missions' : 'Stranger Missions';
  const passed = out.review.status === 'passed';
  const doc = {
    name, slug: out.slug, kind: 'quest', type, typeLabel, overview: out.overview,
    title: `${name} – ${out.game}: ${kind === 'story' ? 'giver, rewards, gold medal' : 'every part, rewards, missables'}`,
    description: cut(`${name} in ${out.game}${out.q.chapter ? ` (${out.q.chapter})` : ''}: ${out.overview}`, 158),
    summary: { region: '', quests: [], shops: [], services: [], collectibles: [], places: [], chapters: out.q.chapter ? [out.q.chapter] : [], notes: [] },
    quest: out.q, sources: out.ev.sites.slice(0, 12),
    status: passed ? 'published' : 'held',
    review: { score: out.review.score, status: out.review.status, supported: out.review.supported, total: out.review.total, ...(out.review.reason ? { reason: out.review.reason } : {}) },
    removed: out.removed, cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches }, builtAt: Date.now(),
  };
  await db().collection('guideCompendium').doc(key).collection('entities').doc(out.slug).set(JSON.parse(JSON.stringify(doc)));
  console.log(`${name} [${typeLabel}]: review ${out.review.status} ${out.review.score} (${out.review.supported}/${out.review.total}), ${out.removed.length} claim(s) removed, $${scope.dollars.toFixed(3)} (${scope.searches} searches); parts ${out.q.parts.length}, rewards ${out.q.rewards.length}, missables ${out.q.missables.length}, choices ${out.q.choices.length}; walkthrough ${out.q.walkthrough ? `${out.q.walkthrough.slug}${out.q.walkthrough.anchor ? `#${out.q.walkthrough.anchor}` : ''}` : '-'}`);
  return { name, status: doc.status, score: out.review.score, dollars: scope.dollars, searches: scope.searches };
}

/**
 * A published quest page's steps rewritten as actions the player takes, from its stored evidence (no searches): the
 * same ids, checked against the evidence and reviewed like a new page. A rewrite that doesn't pass changes nothing.
 */
export async function rewriteSteps(key: string, slug: string): Promise<{ name: string; changed: boolean; dollars: number; note: string }> {
  const ref = db().collection('guideCompendium').doc(key).collection('entities').doc(slug);
  const doc: any = (await ref.get()).data();
  const scope = { dollars: 0, searches: 0 };
  if (!doc?.quest?.parts?.some((p: any) => p.steps?.length)) return { name: doc?.name || slug, changed: false, dollars: 0, note: 'no steps' };
  const have = (await db().collection('evidencePacks').doc(`${key}__quest__${slug}`).get()).data() as EvidencePack | undefined;
  if (!have?.evidence?.length) return { name: doc.name, changed: false, dollars: 0, note: 'no stored evidence (not searching)' };
  const ev = trusted(have);
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const res = await usageScope.run(scope, async () => {
    const parts = doc.quest.parts.map((p: any) => ({ id: p.id, name: p.name, steps: p.steps.map((st: any) => ({ id: st.id, text: st.text })) }));
    const r: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [
        `These are the steps of the Stranger mission strand "${doc.name}" in "${game}", per part. Rewrite each step from the EVIDENCE.`,
        STEP_RULE,
        'Keep every step\'s id and its order; one rewritten text per id. A step with no action in it (only what happens next) becomes the action that leads to it, or "" when there is none. Only facts from the evidence.',
        'Reply with JSON only: {"steps": [{"id": "...", "text": "..."}]}',
        '', 'STEPS:', JSON.stringify(parts), '', 'EVIDENCE:', evidenceText(ev),
      ].join('\n') }] }],
      config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const j = objOf(String(r?.text || ''));
    const byId = new Map<string, string>((Array.isArray(j.steps) ? j.steps : []).map((x: any) => [String(x?.id || ''), cut(x?.text, 160)]));
    const q: Quest = JSON.parse(JSON.stringify(doc.quest));
    for (const p of q.parts) for (const st of p.steps) if (byId.has(st.id)) st.text = byId.get(st.id) || '';
    q.parts = q.parts.map((p) => ({ ...p, steps: p.steps.filter((st) => st.text) }));
    // Checked and reviewed like a new page (the steps are what changed; the page's other facts are as published).
    const c1 = claimsOf(doc.name, doc.overview || '', q);
    const v1 = await claimCheck(game, doc.name, claimSlots(c1.page), ev);
    applyQuestVerdicts(doc.overview || '', q, c1.map, v1);
    const c2 = claimsOf(doc.name, doc.overview || '', q);
    const review = await claimReview(game, doc.name, c2.page, ev);
    applyQuestVerdicts(doc.overview || '', q, c2.map, review.claims);
    return { q, review };
  });
  const steps = (q: Quest) => q.parts.reduce((n, p) => n + p.steps.length, 0);
  const before = steps(doc.quest), after = steps(res.q);
  // Kept only when it passes and keeps most of the steps (a rewrite that loses steps is worse than the old wording).
  if (res.review.status !== 'passed' || after < Math.ceil(before * 0.8)) {
    return { name: doc.name, changed: false, dollars: scope.dollars, note: `kept the old steps (review ${res.review.status} ${res.review.score}, ${after}/${before} steps)` };
  }
  await ref.set({ quest: { ...doc.quest, parts: res.q.parts }, stepsRewrittenAt: Date.now(), cost: { ...(doc.cost || {}), stepsRewrite: Math.round(scope.dollars * 10000) / 10000 } }, { merge: true });
  return { name: doc.name, changed: true, dollars: scope.dollars, note: `review ${res.review.score}, ${after}/${before} steps` };
}

async function main() {
  const key = (() => { const i = process.argv.indexOf('--key'); return i > 0 ? process.argv[i + 1] : ''; })();
  if (process.argv.includes('--rewrite-steps')) {
    const i = process.argv.indexOf('--max-dollars');
    const max = i > 0 ? Number(process.argv[i + 1]) || 1 : 1;
    const only = (() => { const k = process.argv.indexOf('--only'); return k > 0 ? process.argv[k + 1] : ''; })();
    const snap = await db().collection('guideCompendium').doc(key).collection('entities').where('kind', '==', 'quest').get();
    const pages = snap.docs.map((d) => d.data() as any).filter((e) => e.status === 'published' && e.quest?.parts?.some((p: any) => p.steps?.length) && (!only || e.slug === only));
    let total = 0, changed = 0, dearest = 0;
    for (const e of pages) {
      // Stops before going over the cap: the next page is assumed to cost what the dearest one so far did.
      if (dearest > 0 && total + dearest > max) { console.log(`Stopping: $${total.toFixed(3)} spent of $${max}.`); break; }
      const r = await rewriteSteps(key, e.slug);
      total += r.dollars; dearest = Math.max(dearest, r.dollars); if (r.changed) changed++;
      console.log(`${r.name}: ${r.changed ? 'rewritten' : 'unchanged'} (${r.note}), $${r.dollars.toFixed(3)}`);
    }
    console.log(`\nSteps rewritten on ${changed} of ${pages.length} page(s), $${total.toFixed(3)}.`);
    setTimeout(() => process.exit(0), 300);
    return;
  }
  const want: { name: string; kind: QuestKind }[] = [];
  process.argv.forEach((a, i) => { if (a === '--story' || a === '--stranger') want.push({ name: process.argv[i + 1], kind: a === '--story' ? 'story' : 'stranger' }); });
  let total = 0, passed = 0;
  for (const w of want) {
    if (total > 1.5) { console.log('Stopping: $1.50 spent.'); break; }
    const r = await buildQuest(key, w.name, w.kind);
    total += r.dollars; if (r.status === 'published') passed++;
  }
  console.log(`\nQuest pages: ${want.length}, ${passed} passed, $${total.toFixed(3)} in all ($${want.length ? (total / want.length).toFixed(3) : 0} a page).`);
  setTimeout(() => process.exit(0), 300);
}
if (/quests\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('quests failed:', e?.message || e); process.exit(1); });
