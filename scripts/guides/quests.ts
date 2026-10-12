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
 * -> guideCompendium/{key}/entities/{slug} { kind: 'quest', type: 'story-missions' | 'stranger-missions', quest: {...} }
 * Stored as structured data (giver, chapter, parts and steps with ids, rewards, missables, choices, walkthrough link)
 * so the app's quest log can use it later.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, usageScope, searchesIn } from './common';
import { supportedSegments, trusted, evidenceText, claimCheck, claimReview, claimSlots, type Evidence, type EvidencePack, type ClaimPage, type ClaimVerdict } from './claimCheck';
import { entitySlug } from './compendium';
import { entitySegments, lintEntity } from './siteText';

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

const WRITER = (game: string, name: string, kind: QuestKind, ev: EvidencePack, chapters: string[]) => [
  `Write a compendium page for the ${kind === 'story' ? 'story mission' : 'Stranger mission strand'} "${name}" in the video game "${game}", from the EVIDENCE only.`,
  'Every fact must come from an evidence line; leave a field empty rather than guess. Use the game\'s exact names. Never write generic advice.',
  `"chapter": one of: ${chapters.join('; ')} when the evidence says which.`,
  'Reply with JSON only:',
  '{"overview": "1-2 sentences: what the mission is about (no spoilers beyond its setup)", "giver": "who gives it", "chapter": "...", "where": "where it starts",',
  ' "rewards": ["each reward"], "missables": ["anything missable, only if the evidence says so"], "choices": [{"choice": "...", "outcome": "..."}],',
  kind === 'story'
    ? ' "goldMedal": ["each gold medal requirement"]}'
    : ' "parts": [{"name": "part name (e.g. Mission – I)", "chapter": "...", "where": "where it starts", "steps": ["what the player does, one step each"]}]}',
  kind === 'story' ? 'No step-by-step: the guide\'s walkthrough has it.' : 'List every part of the strand the evidence names, in order.',
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
    services.push(`"${p.name}" is a part of "${name}"${p.chapter ? ` (${p.chapter})` : ''}${p.where ? `, starting ${p.where}` : ''}`);
    map.push(keep(q.parts, i));
  });
  const steps = [{ title: 'Overview', text: overview }, ...q.parts.flatMap((p) => p.steps.map((s) => ({ title: p.name, text: s.text })))];
  return { page: { steps, entries: [], choices: [], advice: [], services, fights: [] }, map };
}

function applyQuestVerdicts(overview: string, q: Quest, map: ((ok: boolean) => void)[], verdicts: ClaimVerdict[]) {
  const bad = verdicts.filter((v) => v.verdict === 'unsupported' || v.verdict === 'contradicted');
  const removed = bad.map((v) => `${v.label} ${v.verdict}: ${cut(v.text, 120)}`);
  const dropSent = new Map<number, Set<number>>();
  for (const v of bad) {
    if (v.kind === 'merchant') map[Number(v.label.slice(1)) - 1]?.(false);
    else if (v.kind === 'sentence') { const s = Number(v.label.slice(1)) - 1; (dropSent.get(s) || dropSent.set(s, new Set()).get(s)!).add(Number(v.sentence)); }
  }
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  if (dropSent.has(0)) overview = sentences(overview).filter((_, j) => !dropSent.get(0)!.has(j)).join(' ');
  let k = 1;
  for (const p of q.parts) for (const st of p.steps) { const d = dropSent.get(k++); if (d) st.text = sentences(st.text).filter((_, j) => !d.has(j)).join(' '); }
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
  const ch = (info.areas || []).find((a: any) => chapter && entitySegments(a.name, [{ name: chapter.replace(/:.*$/, ''), slug: 'x' }]).some((s) => s.slug));
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

async function main() {
  const key = (() => { const i = process.argv.indexOf('--key'); return i > 0 ? process.argv[i + 1] : ''; })();
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
