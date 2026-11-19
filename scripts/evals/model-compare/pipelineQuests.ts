// The pipeline on OpenAI vs Gemini (Nov 19 2026): Stranger mission pages built from scratch both ways, in memory only
// (nothing written): the same research asks (searched evidence), writer and claim check + review as quests.ts.
//   STOP_DOLLARS=3 npx tsx scripts/evals/model-compare/pipelineQuests.ts "Name 1" "Name 2" ...
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, usageScope, searchesIn, ledgerDollars } from '../../guides/common';
import { supportedSegments, trusted, claimCheck, claimReview, claimSlots, type Evidence, type EvidencePack } from '../../guides/claimCheck';
import { WRITER, claimsOf, applyQuestVerdicts, type Quest } from '../../guides/quests';
import { entitySlug } from '../../guides/compendium';

const KEY = 'red-dead-redemption-2';
const STOP = Number(process.env.STOP_DOLLARS || 3);
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (t: string): any => { t = String(t || '').replace(/```json|```/g, ''); try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; } };

async function build(game: string, name: string) {
  const asks = [
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
  const ev = trusted({ key: KEY, slug: `quest__${entitySlug(name)}`, game, area: name, evidence, sites: [...sites], servicesComplete: false, searches, at: Date.now() } as EvidencePack);
  const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, name, 'stranger', ev, []) }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
  const j = objOf(String(res?.text || ''));
  const list = (v: any, n = 200) => (Array.isArray(v) ? v.map((x) => cut(x, n)).filter(Boolean) : []);
  const q: Quest = {
    giver: cut(j.giver, 80), chapter: cut(j.chapter, 60), where: cut(j.where, 200), rewards: list(j.rewards), missables: list(j.missables), goldMedal: [],
    choices: (Array.isArray(j.choices) ? j.choices : []).map((c: any) => ({ choice: cut(c?.choice, 160), outcome: cut(c?.outcome, 240) })).filter((c: any) => c.choice && c.outcome),
    parts: (Array.isArray(j.parts) ? j.parts : []).map((p: any, i: number) => ({ id: `p${i + 1}`, name: cut(p?.name, 80), chapter: cut(p?.chapter, 60), where: cut(p?.where, 200), steps: list(p?.steps, 300).map((t, s) => ({ id: `p${i + 1}-s${s + 1}`, text: t })) })).filter((p: any) => p.name),
  } as any;
  let overview = cut(j.overview, 400);
  const c1 = claimsOf(name, overview, q);
  const v1 = await claimCheck(game, name, claimSlots(c1.page), ev);
  overview = applyQuestVerdicts(overview, q, c1.map, v1).overview;
  const c2 = claimsOf(name, overview, q);
  const review = await claimReview(game, name, c2.page, ev);
  return { evidence: ev.evidence.length, sites: ev.sites.length, searches, review: `${review.status} ${review.score} (${review.supported}/${review.total})`, passed: review.status === 'passed', parts: q.parts.length, steps: q.parts.reduce((n, p) => n + p.steps.length, 0), rewards: q.rewards, giver: q.giver, overview, siteList: ev.sites.slice(0, 8) };
}

const info: any = (await db().collection('guides').doc(KEY).get()).data() || {};
const game = String(info.game || KEY);
const names = process.argv.slice(2);
const rows: any[] = [];
for (const name of names) {
  for (const side of ['gemini', 'openai']) {
    if (ledgerDollars() > STOP) { console.log(`hard stop: $${ledgerDollars().toFixed(3)}`); break; }
    process.env.PIPELINE_OPENAI = side === 'openai' ? '1' : '';
    const scope = { dollars: 0, searches: 0 };
    const t0 = Date.now();
    try {
      const r = await usageScope.run(scope, () => build(game, name));
      rows.push({ name, side, ms: Date.now() - t0, dollars: scope.dollars, ...r });
      console.log(`${name} | ${side.padEnd(6)} | ${((Date.now() - t0) / 1000).toFixed(0)} s | $${scope.dollars.toFixed(3)} | ${r.searches} searches, ${r.evidence} evidence lines from ${r.sites} sites | review ${r.review} | ${r.parts} parts, ${r.steps} steps, ${r.rewards.length} rewards`);
    } catch (e: any) {
      console.log(`${name} | ${side} | ERROR ${String(e?.message || e).slice(0, 200)}`);
    }
    fs.writeFileSync('scratchpad/model-compare/pipeline-quests.json', JSON.stringify(rows, null, 1));
  }
}
console.log(`spent $${ledgerDollars().toFixed(3)}`);
process.exit(0);
