/**
 * List pages and reference pages (blueprint sections, scripts/guides/blueprintBuild.ts). Same method as entity pages:
 * searched evidence (blocked and low-trust sites never count), written from the evidence only, every claim checked,
 * the Pro claim review; failed pages are held (never shown).
 *
 *   list page: one page per collectible type, every one with where it is ("Dinosaur Bones": all 30 with locations)
 *   reference page: one topic in sections, facts only (a class's features by level, a settlement's shops and
 *     businesses, a challenge category's tiers, a point of no return), optionally with a list of items
 * -> guideCompendium/{key}/entities/{slug} { kind: 'list' | 'reference', type: <section id>, typeLabel: <section title>,
 *    ref: { sections: [{ heading, text }], items: [{ name, where, notes }] } }
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, usageScope, searchesIn } from './common';
import { supportedSegments, trusted, evidenceText, claimCheck, claimReview, claimSlots, type Evidence, type EvidencePack, type ClaimPage, type ClaimVerdict } from './claimCheck';
import { entitySlug } from './compendium';
import { lintEntity } from './siteText';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const objOf = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
};
export type RefKind = 'list' | 'reference';
type Ref = { sections: { heading: string; text: string }[]; items: { name: string; where?: string; notes?: string }[] };

async function refEvidence(key: string, game: string, title: string, kind: RefKind, brief: string): Promise<EvidencePack> {
  const slug = entitySlug(title);
  const pref = db().collection('evidencePacks').doc(`${key}__ref__${slug}`);
  const have = (await pref.get()).data() as EvidencePack | undefined;
  if (have?.evidence?.length) return trusted(have);
  const asks = kind === 'list'
    ? [
        { topic: 'list', text: `In the video game "${game}": every one of the ${title}, each with exactly where it is (region and landmark) and anything needed to get it. ${brief}` },
        { topic: 'notes', text: `In the video game "${game}", ${title}: how many there are, what collecting all of them rewards, and anything missable.` },
      ]
    : [
        { topic: 'facts', text: `In the video game "${game}", "${title}": the facts a player needs (${brief}). Facts only, no recommendations or opinions.` },
        { topic: 'details', text: `In the video game "${game}", "${title}": the specific names, numbers, levels, locations and conditions involved.` },
      ];
  const evidence: Evidence[] = [];
  const sites = new Set<string>();
  let searches = 0;
  for (const a of asks) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `${a.text}\nRun a few searches (the game's wikis and guides; at most four). Answer in short factual sentences, one fact per line, only what the sources say.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    searches += searchesIn(res);
    for (const seg of supportedSegments(res)) {
      if (evidence.some((e) => e.text === seg.text)) continue;
      evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: a.topic });
      seg.sites.forEach((s) => sites.add(s));
    }
  }
  const pack: EvidencePack = { key, slug: `ref__${slug}`, game, area: title, evidence, sites: [...sites], servicesComplete: false, searches, at: Date.now() };
  await pref.set(JSON.parse(JSON.stringify(pack)));
  return trusted(pack);
}

const WRITER = (game: string, title: string, kind: RefKind, brief: string, ev: EvidencePack) => [
  `Write the ${kind === 'list' ? 'list page' : 'reference page'} "${title}" for the video game "${game}" (${brief}), from the EVIDENCE only.`,
  'Every fact must come from an evidence line; leave something out rather than guess. Use the game\'s exact names. Facts only: no recommendations, opinions or generic advice.',
  'Reply with JSON only:',
  kind === 'list'
    ? '{"overview": "1-2 sentences: what these are, how many, and what collecting them gives", "items": [{"name": "...", "where": "exactly where", "notes": "what is needed, or empty"}] (every one the evidence names), "sections": [{"heading": "...", "text": "rewards, missables or tips the evidence gives"}]}'
    : '{"overview": "1-2 sentences", "sections": [{"heading": "...", "text": "2-5 factual sentences"}], "items": [{"name": "...", "where": "level, place or condition", "notes": "..."}] (when the topic is a list of things; else [])}',
  '',
  'EVIDENCE:',
  evidenceText(ev),
].join('\n');

function claimsOf(title: string, overview: string, r: Ref): { page: ClaimPage; map: ((ok: boolean) => void)[] } {
  const map: ((ok: boolean) => void)[] = [];
  const steps = [{ title: 'Overview', text: overview }, ...r.sections.map((s) => ({ title: s.heading, text: s.text }))];
  const entries = r.items.map((it, i) => ({ id: `i${i}`, name: it.name, where: `${it.where || `(${title})`}${it.notes ? `; ${it.notes}` : ''}` }));
  r.items.forEach((_, i) => map.push((ok) => { if (!ok) (r.items as any)[i] = null; }));
  return { page: { steps, entries, choices: [], advice: [], services: [], fights: [] }, map };
}

function applyVerdicts(overview: string, r: Ref, map: ((ok: boolean) => void)[], verdicts: ClaimVerdict[]) {
  const bad = verdicts.filter((v) => v.verdict === 'unsupported' || v.verdict === 'contradicted');
  const removed = bad.map((v) => `${v.label} ${v.verdict}: ${cut(v.text, 120)}`);
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  const drop = new Map<number, Set<number>>();
  for (const v of bad) if (v.kind === 'sentence') { const s = Number(v.label.slice(1)) - 1; (drop.get(s) || drop.set(s, new Set()).get(s)!).add(Number(v.sentence)); }
  if (drop.has(0)) overview = sentences(overview).filter((_, j) => !drop.get(0)!.has(j)).join(' ');
  r.sections.forEach((s, i) => { const d = drop.get(i + 1); if (d) s.text = sentences(s.text).filter((_, j) => !d.has(j)).join(' '); });
  for (const v of bad) if (v.kind === 'location' || v.kind === 'how') map[Number(v.label.slice(1)) - 1]?.(false);
  r.items = r.items.filter(Boolean);
  r.sections = r.sections.filter((s) => s.text);
  return { overview, removed };
}

/** One list or reference page; returns its status and real cost. The slug never takes an existing page's address. */
export async function buildReference(key: string, title: string, kind: RefKind, section: { id: string; title: string; what?: string }) {
  const scope = { dollars: 0, searches: 0 };
  let slug = entitySlug(title);
  const taken = async (s: string) => (await db().collection('guides').doc(key).collection('areas').doc(s).get()).exists;
  if (await taken(slug)) slug = `${slug}-${kind === 'list' ? 'list' : 'guide'}`;
  const out = await usageScope.run(scope, async () => {
    const info: any = (await db().collection('guides').doc(key).get()).data() || {};
    const game = String(info.game || key);
    const brief = cut(section.what || '', 300);
    const ev = await refEvidence(key, game, title, kind, brief);
    const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: WRITER(game, title, kind, brief, ev) }] }], config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 12000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const j = objOf(String(res?.text || ''));
    const r: Ref = {
      sections: (Array.isArray(j.sections) ? j.sections : []).map((s: any) => ({ heading: cut(s?.heading, 80), text: cut(s?.text, 900) })).filter((s: any) => s.heading && s.text).slice(0, 12),
      items: (Array.isArray(j.items) ? j.items : []).map((x: any) => ({ name: cut(x?.name, 100), where: cut(x?.where, 300), notes: cut(x?.notes, 200) })).filter((x: any) => x.name).slice(0, 200),
    };
    let overview = cut(j.overview, 500);
    const c1 = claimsOf(title, overview, r);
    const a1 = applyVerdicts(overview, r, c1.map, await claimCheck(game, title, claimSlots(c1.page), ev));
    const c2 = claimsOf(title, a1.overview, r);
    const review = await claimReview(game, title, c2.page, ev);
    const a2 = applyVerdicts(a1.overview, r, c2.map, review.claims);
    overview = lintEntity({ overview: a2.overview, summary: {} }, false).overview;
    return { game, overview, r, review, removed: [...a1.removed, ...a2.removed], ev };
  });
  const passed = out.review.status === 'passed' && (kind === 'reference' ? out.r.sections.length > 0 : out.r.items.length > 0);
  const doc = {
    name: title, slug, kind, type: section.id, typeLabel: section.title, overview: out.overview,
    title: `${title} – ${out.game}${kind === 'list' ? `: all ${out.r.items.length} with locations` : ''}`,
    description: cut(`${title} in ${out.game}: ${out.overview}`, 158),
    summary: { quests: [], shops: [], services: [], collectibles: [], places: [], chapters: [], notes: [] },
    ref: out.r, sources: out.ev.sites.slice(0, 12), status: passed ? 'published' : 'held',
    review: { score: out.review.score, status: out.review.status, supported: out.review.supported, total: out.review.total, ...(out.review.reason ? { reason: out.review.reason } : {}) },
    removed: out.removed, cost: { dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches }, builtAt: Date.now(),
  };
  await db().collection('guideCompendium').doc(key).collection('entities').doc(slug).set(JSON.parse(JSON.stringify(doc)));
  console.log(`${title} [${kind}]: review ${out.review.status} ${out.review.score} (${out.review.supported}/${out.review.total}), ${out.r.items.length} item(s), ${out.r.sections.length} section(s), $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
  return { name: title, slug, status: doc.status, dollars: scope.dollars };
}
