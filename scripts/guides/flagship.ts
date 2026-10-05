/**
 * Flagship pages (prototype): an area page rebuilt to read like a guide from an experienced player, searched and
 * sourced like careful builds, written to staging only (guidePrototypes/{key}__{slug}), never to the live guide.
 *
 *   npx tsx scripts/guides/flagship.ts --key baldur-s-gate-3 --pages ravaged-beach,emerald-grove
 *   then: npx tsx scripts/guides/publish.ts --preview scratchpad/flagship-site --only baldur-s-gate-3
 *
 * Each page gets, with Google Search (nothing from a reply that ran no searches or names no sources):
 *   - the summary box and directions, and key fights, if the page has none yet (areaInfo.ts, fights.ts)
 *   - a walkthrough: the area in the order a player experiences it, as connected steps, with the page's items, secrets,
 *     missables and fights placed where you meet them (by id, so they stay tickable), plus entries the page lacks
 *   - the short version: what matters, what to skip, common mistakes
 *   - the important choices: options and what each leads to (shown as spoilers)
 *   - a fact-check of all of that against sources, which corrects or drops what it can't back up
 * Prints each page's searches and real cost (the API's usage data: tokens with thinking, and searches).
 *
 * The flagship program (system/flagship), run daily by the guide-flagship job:
 *   npx tsx scripts/guides/flagship.ts --program              build the next pages of the programme's guides, in order
 *   npx tsx scripts/guides/flagship.ts --program --estimate   what's left and what it would cost (nothing built)
 * Each guide in turn: an outline rebuild into staging first when the programme says so (guides/{key}.outline: layout and
 * note; repair.ts --action outline --stage-only), then every page built to the flagship standard. A page goes live
 * only when the Pro reviewer's verdict is a pass: straight into the live page for a guide keeping its outline, or into
 * the staged copy for a rebuilt one, which is promoted when all its pages are reviewed (failed pages held back). Its
 * own budget (budget.total, budget.daily; separate from the pipeline's caps): a page starts only with room for it, and
 * the programme stops when the estimate to finish passes budget.stopAt. Its searches don't count toward the app's
 * monthly search total (SEARCH_BUDGET_EXEMPT=1 on the job).
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ThinkingLevel } from '@google/genai';
import {
  db, gemini, MODEL, arg, searchesIn, sourcesIn, parseItem, ledger, ledgerDollars, MISSABLE_STANDARD, stageKey, addChildUsage,
  type GuideEntry, type GuideStep, type GuideChoice, type GuideAdvice, type GuideFight, type GuideInfo,
} from './common';
import { recordMonthly } from '../../searchGuard';
import { infoForPage } from './areaInfo';
import { fightsForPage } from './fights';
import { call, reviewerFor } from './review';
import { ProQuotaWait } from './reviewerQuota';
import { promote, stageCopy } from './promote';
import { deployToNetlify } from '../pipeline/netlify';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const none = (v: string | undefined) => !v || /^(none|n\/a|-+|no|nothing)\.?$/i.test(v.trim());

/**
 * A searched call: asked again, firmly, if the reply ran no searches; null if it never did or named no sources.
 * fromNotes: the prompt carries sourced research notes, so a reply that needed no further search is accepted.
 */
async function grounded(prompt: string, label: string, fromNotes = false): Promise<{ text: string; sources: string[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.3, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = searchesIn(res);
    if (n) recordMonthly(n);
    console.log(`  [${label}] ${n} searches`);
    // Writing from sourced research notes: a reply that didn't need to search more is fine (the notes' sources stand).
    if (!n && fromNotes) return { text: String(res?.text || ''), sources: [] };
    if (!n) continue;
    const sources = sourcesIn(res);
    return sources.length ? { text: String(res?.text || ''), sources } : null;
  }
  return null;
}

/** The page's tickable entries, as the writer sees them (id, kind, name, where). */
function entryList(p: any): { id: string; line: string }[] {
  return [
    ...(p.items || []).map((e: GuideEntry) => ({ id: e.id, line: `${e.id} item: ${e.name}${e.where ? ` (${cut(e.where, 160)})` : ''}${e.missable ? ' [missable]' : ''}` })),
    ...(p.secrets || []).map((e: GuideEntry) => ({ id: e.id, line: `${e.id} secret: ${cut(e.text, 200)}` })),
    ...(p.sections || []).filter((s: any) => s.check).flatMap((s: any) => s.entries.map((e: any) => ({ id: e.id, line: `${e.id} ${s.title}: ${cut(e.text, 160)}` }))),
  ];
}

const STEP_FORMAT = 'STEP: short title | 2-5 connected sentences in the second person ("When you arrive...", "Then...", "Before leaving...") | entry ids met in this step, separated by commas, or - | key fight ids in this step, or - | one tip, or - | one warning (something you can lose or get wrong here), or -';
const NEW_FORMAT = 'NEW: item or secret | name | where: from a findable anchor to the exact spot | how: the exact final step, or - | missable because, or - | the number of the step it belongs to';
const CHOICE_FORMAT = 'CHOICE: short title | when it comes up | option => what it leads to ;; option => what it leads to (2-4 options) | the option most players should pick, or - | one note (a timer, a point of no return, an approval change), or -';

type Draft = {
  steps: GuideStep[]; news: { entry: GuideEntry; kind: 'item' | 'secret'; step: number }[]; choices: GuideChoice[]; advice: GuideAdvice;
  /** The page's own items and secrets: checked like the rest (a wrong one corrected, an invented one dropped). */
  old: { entry: GuideEntry; kind: 'item' | 'secret' }[];
};

function researchPrompt(game: string, p: any, neighbours: string[]) {
  return [
    `Research one area of the video game "${game}" for a guide: "${p.name}"${p.story ? ` (${p.story})` : ''}. Neighbouring areas: ${neighbours.join(', ') || 'unknown'}.`,
    'Run several searches: the area\'s page on the game\'s wiki, its walkthrough, the quests that happen here, and the choices made here. Then write notes, only from what the sources say:',
    '- what a player meets here, in order: arrivals, characters, events, fights, puzzles, where each is (landmarks, waypoints)',
    '- items and secrets here, where exactly, and how to get them; which are missable and why',
    '- the choices made here, each option and what it leads to (who joins, leaves or dies; rewards; what changes later)',
    '- what happens in the NEIGHBOURING areas instead (so the guide does not put it here)',
    'Be concrete (names, checks with their DCs, rewards). Say when sources disagree.',
  ].join('\n');
}

function walkPrompt(game: string, p: any, entries: { line: string }[], fights: GuideFight[], neighbours: string[], notes: string) {
  return [
    `You are writing the walkthrough of one area of a guide for the video game "${game}", as an experienced player would: the area "${p.name}"${p.story ? ` (${p.story})` : ''}.`,
    'Write from the research notes below; search guides and wikis for anything they do not settle. Only what happens IN this area: leave out what the notes place in a neighbouring area. Never contradict yourself between steps.',
    '',
    'Research notes:',
    notes.slice(0, 9000),
    '',
    `Nearby areas, in guide order: ${neighbours.join(', ') || 'unknown'}.`,
    '',
    'Write the area in the order a player experiences it, as 5 to 10 steps, one line each:',
    STEP_FORMAT,
    'Place every entry below in the step where a player meets it (by its id), and every key fight too. Say exactly where things are, using names a player sees.',
    '',
    'Then any important items or secrets here that the list lacks (at most 8), one line each:',
    NEW_FORMAT,
    MISSABLE_STANDARD,
    '',
    'Then the short version, one line each: 2-4 lines "MATTERS: ..." (what is worth your time here), 0-3 lines "SKIP: ..." (what you can safely ignore), 2-4 lines "MISTAKE: ..." (what players commonly get wrong here, and how to avoid it).',
    '',
    'The page\'s entries:',
    ...entries.map((e) => `- ${e.line}`),
    ...(fights.length ? ['Key fights:', ...fights.map((f) => `- ${f.id}: ${f.name}${f.enemies ? ` (${cut(f.enemies, 100)})` : ''}`)] : []),
    ...(p.overview ? [`Overview: ${p.overview}`] : []),
  ].join('\n');
}

function choicePrompt(game: string, p: any, notes: string) {
  return [
    `For the video game "${game}", the area "${p.name}"${p.story ? ` (${p.story})` : ''}: the important choices a player makes here (quests, dialogue, who to side with, who to save).`,
    'Research notes on the area:',
    notes.slice(0, 6000),
    'Search guides and wikis to confirm each choice and its outcomes, and write only what the sources say. Only choices made IN this area. Only choices that change something that matters: a companion, a quest outcome, a reward, who lives. At most 6, in the order they come up, one line each:',
    CHOICE_FORMAT,
    'Say concretely what each option leads to (who joins or leaves, what you get or lose, what changes later). If there are no important choices here, reply NONE.',
  ].join('\n');
}

function draftLines(d: Draft, part: 'walk' | 'choices' | 'all') {
  const advice = [...d.advice.matters, ...d.advice.skip, ...d.advice.mistakes];
  return [
    ...(part !== 'choices' ? d.steps.map((s, i) => `S${i + 1}: ${s.title} | ${s.text}${s.tip ? ` | tip: ${s.tip}` : ''}${s.warn ? ` | warning: ${s.warn}` : ''}`) : []),
    ...(part !== 'choices' ? d.news.map((n, i) => `N${i + 1}: ${n.kind} | ${n.entry.name || n.entry.text} | ${n.entry.where || ''}${n.entry.how ? ` | how: ${n.entry.how}` : ''}${n.entry.lockout ? ` | missable because: ${n.entry.lockout}` : ''}`) : []),
    ...(part !== 'choices' ? d.old.slice(0, 30).map((o, i) => `E${i + 1}: ${o.kind} | ${o.kind === 'item' ? `${o.entry.name} | ${o.entry.where || ''}${o.entry.how ? ` | how: ${o.entry.how}` : ''}${o.entry.lockout ? ` | missable because: ${o.entry.lockout}` : ''}` : o.entry.text}`) : []),
    ...(part !== 'walk' ? d.choices.map((c, i) => `C${i + 1}: ${c.title} | ${c.when || '-'} | ${c.options.map((o) => `${o.label} => ${o.outcome}`).join(' ;; ')} | ${c.recommended || '-'} | ${c.note || '-'}`) : []),
    ...(part !== 'walk' ? advice.map((a, i) => `A${i + 1}: ${a}`) : []),
  ];
}

const FIX_RULES = [
  'For each line that is wrong (a wrong place, order, name, check, reward, outcome or lockout), reply with one line:',
  'FIX: the label (e.g. S3, N2, E4, C1, A2) | the corrected line, in the same format as the original (S: title | text; N and E items: name | where | how | missable because; E secrets: the text; C: title | when | options | recommended | note; A: the line)',
  'For a line the sources do not support at all (invented), or that belongs to a different area, reply: DROP: the label | why',
  'Lines that are right need no reply. If everything is right, reply OK.',
];

function checkPrompt(game: string, p: any, d: Draft, part: 'walk' | 'choices') {
  return [
    `Fact-check this draft for the area "${p.name}" of a guide to the video game "${game}". Search guides and wikis to verify EACH line (several searches), and compare.`,
    ...FIX_RULES,
    '',
    ...draftLines(d, part),
  ].join('\n');
}

function consistencyPrompt(game: string, p: any, neighbours: string[], d: Draft) {
  return [
    `You are the final reviewer of a guide page for the video game "${game}": the area "${p.name}"${p.story ? ` (${p.story})` : ''}. Neighbouring areas: ${neighbours.join(', ') || 'unknown'}.`,
    'Check it as an expert on this game: lines that contradict each other, events or characters that are really in a neighbouring area, a wrong order, wrong facts you are sure of. Do not rewrite style.',
    ...FIX_RULES,
    'Finish with one line: "VERDICT: pass" if, with your fixes applied, the page is accurate, consistent and useful to a player; or "VERDICT: fail | the main reason" if too much is wrong or doubtful to fix line by line.',
    '',
    ...draftLines(d, 'all'),
  ].join('\n');
}

/** Apply FIX and DROP lines to the draft (labels S, N, C, A refer to the draft as it was sent). */
function applyFixes(text: string, d: Draft): { fixed: number; dropped: number } {
  let fixed = 0, dropped = 0;
  const adv = [...d.advice.matters.map((x) => ['matters', x]), ...d.advice.skip.map((x) => ['skip', x]), ...d.advice.mistakes.map((x) => ['mistakes', x])] as [keyof GuideAdvice, string][];
  const drop = new Set<string>();
  for (const line of String(text || '').split('\n')) {
    const fx = fields(line, 'FIX'), dr = fields(line, 'DROP');
    const label = String((fx || dr || [])[0] || '').toUpperCase().replace(/[^SNCAE0-9]/g, '');
    const m = label.match(/^([SNCAE])(\d+)$/);
    if (!m) continue;
    const n = Number(m[2]) - 1;
    if (dr) { drop.add(label); dropped++; continue; }
    const rest = fx!.slice(1);
    const body = rest.join(' | ');
    if (m[1] === 'S' && d.steps[n]) {
      const parts = rest.length >= 2 ? rest : [d.steps[n].title, body];
      d.steps[n] = { ...d.steps[n], title: cut(parts[0], 80) || d.steps[n].title, text: cut(parts[1], 900) || d.steps[n].text }; fixed++;
    } else if (m[1] === 'C' && d.choices[n]) {
      const again = parseChoices(`CHOICE: ${body}`)[0];
      if (again) { d.choices[n] = { ...again, id: d.choices[n].id }; fixed++; }
    } else if (m[1] === 'N' && d.news[n]) {
      const body2 = /^(item|secret)\s*\|/i.test(body) ? body.replace(/^(item|secret)\s*\|\s*/i, '') : body;
      const again = parseNew(`NEW: ${d.news[n].kind} | ${body2} | ${d.news[n].step}`, d.news[n].entry.sources || [])[0];
      if (again) { d.news[n] = { ...again, entry: { ...again.entry, id: d.news[n].entry.id } }; fixed++; }
    } else if (m[1] === 'E' && d.old[n]) {
      const o = d.old[n];
      const body2 = body.replace(/^(item|secret)\s*\|\s*/i, '');
      if (o.kind === 'secret') { d.old[n] = { ...o, entry: { ...o.entry, text: cut(body2, 600) } }; fixed++; }
      else {
        const f = body2.split('|').map((x) => x.trim());
        const e = parseItem([f[0] || String(o.entry.name), f[1] || String(o.entry.where || ''), f[2] || '', f[3] || ''], o.entry.id, o.entry.sources || []);
        d.old[n] = { ...o, entry: { ...o.entry, name: e.name || o.entry.name, where: e.where || o.entry.where, how: e.how, lockout: e.lockout, missable: e.missable || !!o.entry.missable, ...({ updatedFrom: 'flagship check' } as any) } }; fixed++;
      }
    } else if (m[1] === 'A' && adv[n]) { adv[n] = [adv[n][0], cut(body, 300)]; fixed++; }
  }
  // A dropped entry of the page's own leaves its list and its step.
  const goneIds = new Set(d.old.filter((_o, i) => drop.has(`E${i + 1}`)).map((o) => o.entry.id));
  d.old = d.old.filter((o) => !goneIds.has(o.entry.id));
  if (goneIds.size) d.steps = d.steps.map((st) => ({ ...st, entries: (st.entries || []).filter((x) => !goneIds.has(x)) }));
  d.steps = d.steps.filter((_s, i) => !drop.has(`S${i + 1}`));
  d.news = d.news.filter((_e, i) => !drop.has(`N${i + 1}`));
  d.choices = d.choices.filter((_c, i) => !drop.has(`C${i + 1}`));
  const keep = adv.filter((_a, i) => !drop.has(`A${i + 1}`));
  d.advice = { matters: keep.filter((a) => a[0] === 'matters').map((a) => a[1]), skip: keep.filter((a) => a[0] === 'skip').map((a) => a[1]), mistakes: keep.filter((a) => a[0] === 'mistakes').map((a) => a[1]) };
  return { fixed, dropped };
}

const fields = (line: string, tag: string) => {
  const m = line.match(new RegExp(`^\\s*[-*]?\\s*\\**${tag}\\**\\s*:\\s*(.+)$`, 'i'));
  return m ? m[1].replace(/\[\d+(?:,\s*\d+)*\]/g, '').split('|').map((x) => x.replace(/\*\*/g, '').trim()) : null;
};

function parseSteps(text: string, ids: Set<string>, fightIds: Set<string>): GuideStep[] {
  const out: GuideStep[] = [];
  for (const line of text.split('\n')) {
    const f = fields(line, 'STEP');
    if (!f || f.length < 2 || none(f[1])) continue;
    const list = (v: string | undefined, ok: Set<string>) => (none(v) ? [] : String(v).split(/[,;\s]+/).map((x) => x.trim()).filter((x) => ok.has(x)));
    out.push({
      id: `w${out.length + 1}`, title: cut(f[0], 80), text: cut(f[1], 900),
      ...(list(f[2], ids).length ? { entries: list(f[2], ids) } : {}), ...(list(f[3], fightIds).length ? { fights: list(f[3], fightIds) } : {}),
      ...(!none(f[4]) ? { tip: cut(f[4], 300) } : {}), ...(!none(f[5]) ? { warn: cut(f[5], 300) } : {}),
    });
  }
  return out.slice(0, 12);
}

function parseNew(text: string, sources: string[]): { entry: GuideEntry; kind: 'item' | 'secret'; step: number }[] {
  const out: { entry: GuideEntry; kind: 'item' | 'secret'; step: number }[] = [];
  for (const line of text.split('\n')) {
    const f = fields(line, 'NEW');
    if (!f || f.length < 3 || none(f[1])) continue;
    const kind = /secret/i.test(f[0]) ? 'secret' : 'item';
    const id = `fl${out.length + 1}`;
    const step = Math.max(1, Number(f[5]) || 1);
    if (kind === 'secret') out.push({ kind, step, entry: { id, text: cut(`${f[1]}: ${f[2].replace(/^where\s*:\s*/i, '')}`, 400), sources: sources.slice(0, 5) } });
    else out.push({ kind, step, entry: { ...parseItem([f[1], f[2], f[3] || '', f[4] || ''], id, sources.slice(0, 5)), name: cut(f[1], 100) } });
  }
  return out.slice(0, 8);
}

function parseAdvice(text: string): GuideAdvice {
  const take = (tag: string, n: number) => text.split('\n').map((l) => fields(l, tag)).filter(Boolean).map((f) => cut(f!.join(' | '), 300)).filter((x) => !none(x)).slice(0, n);
  return { matters: take('MATTERS', 4), skip: take('SKIP', 3), mistakes: take('MISTAKE', 4) };
}

function parseChoices(text: string): GuideChoice[] {
  const out: GuideChoice[] = [];
  for (const line of text.split('\n')) {
    const f = fields(line, 'CHOICE');
    if (!f || f.length < 3) continue;
    const options = f[2].split(';;').map((o) => o.split('=>').map((x) => x.trim())).filter((o) => o.length >= 2 && o[0] && o[1]).map(([label, outcome]) => ({ label: cut(label, 120), outcome: cut(outcome, 400) }));
    if (options.length < 2) continue;
    out.push({ id: `c${out.length + 1}`, title: cut(f[0], 120), ...(!none(f[1]) ? { when: cut(f[1], 200) } : {}), options: options.slice(0, 4), ...(!none(f[3]) ? { recommended: cut(f[3], 120) } : {}), ...(!none(f[4]) ? { note: cut(f[4], 300) } : {}) });
  }
  return out.slice(0, 6);
}

/**
 * Labels the writer or the checkers leaked into the text ("A6: ...", "C2: ..."), "missable because" prefixes, and a
 * lockout that's only a number (a step number in the wrong field) are cleaned up before saving.
 */
export function tidyProto(pr: any) {
  const unlabel = (v: unknown) => String(v ?? '').replace(/^\s*[SNCA]\d+\s*:\s*/, '').trim();
  const entry = (e: any) => {
    const lockout = String(e.lockout || '').replace(/^\s*missable(\s+because)?\s*:?\s*/i, '').trim();
    const how = String(e.how || '').replace(/^\s*how\s*:?\s*/i, '').trim();
    const out: any = { ...e, ...(e.name ? { name: unlabel(e.name) } : {}), ...(e.text ? { text: unlabel(e.text) } : {}) };
    delete out.lockout; delete out.how;
    if (how && !/^-?$/.test(how)) out.how = how;
    if (lockout && !/^\d+$/.test(lockout)) out.lockout = lockout;
    if ('missable' in e) out.missable = !!out.lockout || (!!e.missable && !/^fl\d+$/.test(String(e.id)));
    return out;
  };
  return {
    ...pr,
    walkthrough: (pr.walkthrough || []).map((s: any) => ({ ...s, title: unlabel(s.title), text: unlabel(s.text) })),
    choices: (pr.choices || []).map((c: any) => ({ ...c, title: unlabel(c.title) })),
    advice: { matters: (pr.advice?.matters || []).map(unlabel), skip: (pr.advice?.skip || []).map(unlabel), mistakes: (pr.advice?.mistakes || []).map(unlabel) },
    items: (pr.items || []).map(entry),
    secrets: (pr.secrets || []).map(entry),
  };
}

type Verdict = { status: 'passed' | 'failed' | 'waiting'; reason?: string };

/** The Pro consistency review with its verdict: fixes applied to the draft, and pass / fail (waiting: no Pro request). */
async function proReview(game: string, p: any, neighbours: string[], draft: Draft): Promise<Verdict & { fixed: number; dropped: number }> {
  try {
    const res: any = await call(reviewerFor('pro', 'other'), {
      contents: [{ role: 'user', parts: [{ text: consistencyPrompt(game, p, neighbours, draft) }] }],
      config: { temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const text = String(res?.text || '');
    const t = applyFixes(text, draft);
    const v = text.split('\n').map((l) => fields(l, 'VERDICT')).filter(Boolean).pop();
    if (!v) return { status: 'failed', reason: 'the reviewer gave no verdict', ...t };
    return /^pass/i.test(v[0]) ? { status: 'passed', ...t } : { status: 'failed', reason: cut(v.slice(1).join(' | ') || v[0].replace(/^fail\s*/i, ''), 300) || 'failed review', ...t };
  } catch (e: any) {
    if (e instanceof ProQuotaWait) return { status: 'waiting', reason: 'no Pro reviewer requests left today', fixed: 0, dropped: 0 };
    return { status: 'waiting', reason: cut(e?.message || e, 200), fixed: 0, dropped: 0 };
  }
}

/**
 * One flagship page, written to guidePrototypes/{key}__{slug} with the reviewer's verdict. `from` is the guide copy to
 * build on (the live guide, or its staged rebuild). Returns its searches, real cost and verdict.
 */
async function buildPage(key: string, game: string, slug: string, order: { slug: string; name: string }[], from = key) {
  const before = { searches: ledger.searches, dollars: ledgerDollars() };
  const p: any = (await db().collection('guides').doc(from).collection('areas').doc(slug).get()).data();
  if (!p) throw new Error(`no page ${slug}`);
  console.log(`\n${p.name}`);
  const i = order.findIndex((o) => o.slug === slug);
  const neighbours = order.slice(Math.max(0, i - 3), i + 4).map((o) => o.name).filter((n) => n !== p.name);
  const sources = new Set<string>(p.sources || []);

  // What the page lacks first: the summary box and directions, and key fights.
  // An earlier prototype run's summary box and fights are reused (no need to search for them again).
  const prev: any = (await db().collection('guidePrototypes').doc(`${key}__${slug}`).get()).data();
  let info: GuideInfo | undefined = p.info || prev?.info;
  if (!info) {
    const r = await infoForPage(game, p, neighbours, false);
    if (r.info) { info = r.info; (r.info.sources || []).forEach((s) => sources.add(s)); }
    console.log(`  summary box: ${r.info ? 'written' : 'nothing confirmed'}`);
  }
  let fights: GuideFight[] = (p.fights || []).length ? p.fights : prev ? prev.fights || [] : [];
  if (!fights.length && !prev) {
    const r = await fightsForPage(game, p, false);
    fights = r.fights;
    console.log(`  key fights: ${fights.map((f) => f.name).join('; ') || 'none'}`);
  }

  const entries = entryList(p);
  // 1. Research: sourced notes on the area, from several searches (the wiki page, its quests, its choices).
  const notes = await grounded(researchPrompt(game, p, neighbours), 'research');
  if (!notes) throw new Error('the research reply ran no searches or named no sources');
  notes.sources.forEach((s) => sources.add(s));
  // 2. The walkthrough, the short version and the choices, written from the notes (searching again where they're thin).
  const w = await grounded(walkPrompt(game, p, entries, fights, neighbours, notes.text), 'walkthrough', true);
  if (!w) throw new Error('the walkthrough reply ran no searches or named no sources');
  w.sources.forEach((s) => sources.add(s));
  const draft: Draft = {
    steps: parseSteps(w.text, new Set(entries.map((e) => e.id)), new Set(fights.map((f) => f.id))),
    news: parseNew(w.text, w.sources),
    advice: parseAdvice(w.text),
    choices: [],
    old: [...(p.items || []).map((e: GuideEntry) => ({ entry: e, kind: 'item' as const })), ...(p.secrets || []).map((e: GuideEntry) => ({ entry: e, kind: 'secret' as const }))],
  };
  const c = await grounded(choicePrompt(game, p, notes.text), 'choices', true);
  if (c) { draft.choices = parseChoices(c.text); c.sources.forEach((s) => sources.add(s)); }

  // 3. Fact-checks against sources, every line searched: the walkthrough and new entries, then the choices and the
  //    short version. Wrong lines are corrected, unsupported ones dropped.
  const tally = { fixed: 0, dropped: 0 };
  const add = (t: { fixed: number; dropped: number }) => { tally.fixed += t.fixed; tally.dropped += t.dropped; };
  const k1 = await grounded(checkPrompt(game, p, draft, 'walk'), 'check: walkthrough');
  if (k1) { k1.sources.forEach((s) => sources.add(s)); add(applyFixes(k1.text, draft)); }
  const k2 = await grounded(checkPrompt(game, p, draft, 'choices'), 'check: choices');
  if (k2) { k2.sources.forEach((s) => sources.add(s)); add(applyFixes(k2.text, draft)); }
  // 4. A consistency review by the Pro reviewer (no searches): contradictions between lines, things that happen in a
  //    neighbouring area, a wrong order.
  const verdict = await proReview(game, p, neighbours, draft);
  add(verdict);
  console.log(`  fact-checks: ${tally.fixed} corrected, ${tally.dropped} dropped; Pro review: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`);
  let { steps, news, choices, advice } = draft;

  // The page's own entries (as checked), then the new ones, onto the lists and into their step.
  const items = [...draft.old.filter((o) => o.kind === 'item').map((o) => o.entry), ...news.filter((n) => n.kind === 'item').map((n) => ({ ...n.entry, updatedFrom: 'flagship' }))];
  const secrets = [...draft.old.filter((o) => o.kind === 'secret').map((o) => o.entry), ...news.filter((n) => n.kind === 'secret').map((n) => ({ ...n.entry, updatedFrom: 'flagship' }))];
  for (const n of news) {
    const s = steps[Math.min(steps.length, n.step) - 1];
    if (s) s.entries = [...(s.entries || []), n.entry.id];
  }
  const placed = new Set(steps.flatMap((s) => s.entries || []));
  const unplaced = [...items, ...secrets].filter((e) => !placed.has(e.id)).map((e) => e.name || cut(e.text, 40));
  const spent = { searches: ledger.searches - before.searches, dollars: ledgerDollars() - before.dollars };
  const proto = {
    key, slug, game, name: p.name, walkthrough: steps, choices, advice, items, secrets, fights, ...(info ? { info } : {}),
    sources: [...sources].slice(0, 12), newEntries: news.length, unplaced, cost: spent, model: MODEL, at: Date.now(),
    status: verdict.status, ...(verdict.reason ? { reason: verdict.reason } : {}), from,
  };
  const clean = tidyProto(proto);
  await db().collection('guidePrototypes').doc(`${key}__${slug}`).set(JSON.parse(JSON.stringify(clean)));
  fs.mkdirSync('scratchpad/flagship', { recursive: true });
  fs.writeFileSync(`scratchpad/flagship/${key}__${slug}.json`, JSON.stringify(clean, null, 1));
  console.log(`  ${steps.length} steps, ${choices.length} choices, ${news.length} new entries${unplaced.length ? `, not placed in a step: ${unplaced.join('; ')}` : ''}`);
  console.log(`  cost: ${spent.searches} searches, $${spent.dollars.toFixed(3)} (tokens and searches)`);
  return { ...spent, verdict, proto: clean };
}

/** A prototype built before verdicts existed: only the Pro review (fixes and verdict), no rebuilding. */
async function reviewOnly(key: string, game: string, slug: string, order: { slug: string; name: string }[], pr: any) {
  const before = ledgerDollars();
  const i = order.findIndex((o) => o.slug === slug);
  const neighbours = order.slice(Math.max(0, i - 3), i + 4).map((o) => o.name).filter((n) => n !== pr.name);
  const draft: Draft = { steps: pr.walkthrough || [], news: [], choices: pr.choices || [], advice: pr.advice || { matters: [], skip: [], mistakes: [] }, old: [...(pr.items || []).map((e: any) => ({ entry: e, kind: 'item' as const })), ...(pr.secrets || []).map((e: any) => ({ entry: e, kind: 'secret' as const }))] };
  const verdict = await proReview(game, { name: pr.name }, neighbours, draft);
  const clean = tidyProto({ ...pr, walkthrough: draft.steps, choices: draft.choices, advice: draft.advice, items: draft.old.filter((o) => o.kind === 'item').map((o) => o.entry), secrets: draft.old.filter((o) => o.kind === 'secret').map((o) => o.entry), status: verdict.status, ...(verdict.reason ? { reason: verdict.reason } : { reason: null }), from: key, at: Date.now() });
  await db().collection('guidePrototypes').doc(`${key}__${slug}`).set(JSON.parse(JSON.stringify(clean)));
  console.log(`\n${pr.name}: review only: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}, ${verdict.fixed} corrected, ${verdict.dropped} dropped`);
  return { searches: 0, dollars: ledgerDollars() - before, verdict, proto: clean };
}

/** The flagship fields written onto a page (the live guide's, or the staged rebuild's). */
async function writePage(target: string, slug: string, pr: any) {
  await db().collection('guides').doc(target).collection('areas').doc(slug).set(JSON.parse(JSON.stringify({
    walkthrough: pr.walkthrough, choices: pr.choices, advice: pr.advice, items: pr.items, secrets: pr.secrets, fights: pr.fights || [],
    ...(pr.info ? { info: pr.info } : {}), sources: pr.sources || [], verified: true,
    flagship: { at: Date.now(), cost: pr.cost?.dollars ?? null, model: pr.model }, updatedAt: Date.now(),
  })), { merge: true });
}

// ---------- the programme ----------
const DAY_TZ = 'America/Chicago';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: DAY_TZ });
type GuideProgress = { phase: 'outline' | 'pages' | 'done'; source?: 'live' | 'stage'; total?: number; done: string[]; failed: { slug: string; name: string; reason: string }[]; tries?: Record<string, number>; outlineTries?: number };
/** Estimated cost per page until the programme has measured its own, and for an outline rebuild. */
const PAGE_GUESS = 0.42, OUTLINE_GUESS = 0.5;
const MINUTES = Number(process.env.FLAGSHIP_MINUTES || 150);

async function program() {
  const ref = db().collection('system').doc('flagship');
  const st: any = (await ref.get()).data();
  if (!st?.guides?.length) { console.log('No flagship programme (system/flagship.guides).'); return; }
  const budget = { total: 90, daily: 15, stopAt: 100, ...(st.budget || {}) };
  if (st.day !== today()) Object.assign(st, { day: today(), spentToday: 0, runPages: [], runFailures: [] });
  st.spent = Number(st.spent || 0); st.spentToday = Number(st.spentToday || 0);
  st.progress = st.progress || {};
  st.runPages = st.runPages || []; st.runFailures = st.runFailures || [];
  const save = () => ref.set(JSON.parse(JSON.stringify(st)), { merge: true });
  const measured = Number(st.pagesBuilt || 0) >= 5 ? Number(st.pageDollars || 0) / Number(st.pagesBuilt) : PAGE_GUESS;

  // What's left, and the estimate to finish.
  const plan: { key: string; game: string; left: number; total: number; outline: boolean }[] = [];
  for (const g of st.guides) {
    const pg: GuideProgress = st.progress[g.key] || { phase: g.outline ? 'outline' : 'pages', done: [], failed: [] };
    st.progress[g.key] = pg;
    const info: any = (await db().collection('guides').doc(g.key).get()).data() || {};
    const src = pg.source === 'stage' ? stageKey(g.key) : g.key;
    const order: { slug: string }[] = ((await db().collection('guides').doc(src).get()).data()?.areas || []);
    const left = pg.phase === 'done' ? 0 : pg.phase === 'outline' ? Number(g.pagesGuess || 30) : order.filter((o) => !pg.done.includes(o.slug) && !pg.failed.some((f) => f.slug === o.slug)).length;
    plan.push({ key: g.key, game: String(info.game || g.key), left, total: pg.phase === 'outline' ? Number(g.pagesGuess || 30) : order.length, outline: pg.phase === 'outline' });
  }
  const estimate = st.spent + plan.reduce((n, x) => n + x.left * measured + (x.outline ? OUTLINE_GUESS : 0), 0);
  st.estimate = Math.round(estimate * 100) / 100;
  console.log(`Flagship programme: $${st.spent.toFixed(2)} of $${budget.total} spent ($${st.spentToday.toFixed(2)} of $${budget.daily} today); estimate to finish $${estimate.toFixed(2)} at $${measured.toFixed(2)} a page.`);
  for (const x of plan) console.log(`  ${x.game}: ${x.outline ? `outline rebuild first, about ${x.left} pages` : `${x.left} of ${x.total} pages left`}`);
  if (arg('estimate') === 'true') { await save(); return; }
  if (estimate > budget.stopAt) {
    st.halted = `the estimate to finish ($${estimate.toFixed(2)}) is over $${budget.stopAt}: stopped for a decision`;
    console.log(`Stopped: ${st.halted}.`);
    await save();
    return;
  }
  st.halted = null;

  const started = Date.now();
  const room = () => Math.min(budget.total - st.spent, budget.daily - st.spentToday);
  const charge = (d: number) => { st.spent += d; st.spentToday += d; };
  let wentLive = false;
  for (const g of st.guides) {
    const pg: GuideProgress = st.progress[g.key];
    if (pg.phase === 'done') continue;
    const info: any = (await db().collection('guides').doc(g.key).get()).data();
    const game = String(info?.game || g.key);

    // An outline rebuild into staging first (no whole-guide gate: each page is gated by its review).
    if (pg.phase === 'outline') {
      if (room() < 1) break;
      await db().collection('guides').doc(g.key).set({ outline: { layout: g.outline.layout, note: g.outline.note || '' } }, { merge: true });
      console.log(`\n${game}: outline rebuild (${g.outline.layout}) into staging`);
      const cli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const r = spawnSync(process.execPath, [cli, 'scripts/guides/repair.ts', '--game', game, '--action', 'outline', '--stage-only', '--max-searches', '300'], { encoding: 'utf8', timeout: 60 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PIPELINE_STEP_DOLLARS: Math.max(0.5, room()).toFixed(2) } });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      process.stdout.write(out.slice(-3000));
      const before = ledgerDollars();
      addChildUsage(out);
      charge(ledgerDollars() - before);
      const staged: any = (await db().collection('guides').doc(stageKey(g.key)).get()).data();
      if (staged?.areas?.length && /Gate: skipped \(built into staging only/.test(out)) {
        Object.assign(pg, { phase: 'pages', source: 'stage', total: staged.areas.length });
        console.log(`  staged outline: ${staged.areas.length} pages`);
      } else {
        pg.outlineTries = (pg.outlineTries || 0) + 1;
        st.runFailures.push({ key: g.key, slug: '(outline)', name: `${game} outline`, reason: /continues on the next run/.test(out) ? 'continues next run' : 'the outline rebuild did not finish (see the job log)' });
      }
      await save();
      if ((pg.phase as string) !== 'pages') break; // carries on next run, before later guides
    }

    // The pages, in guide order.
    const src = pg.source === 'stage' ? stageKey(g.key) : g.key;
    const srcDoc: any = (await db().collection('guides').doc(src).get()).data() || {};
    const order: { slug: string; name: string }[] = srcDoc.areas || [];
    pg.total = order.length;
    const pages = (await db().collection('guides').doc(src).collection('areas').get()).docs;
    const usable = new Set(pages.filter((d) => (pg.source === 'stage' ? ['draft', 'published'] : ['published']).includes(d.data().status)).map((d) => d.id));
    let stopped = false;
    for (const o of order) {
      if (!usable.has(o.slug) || pg.done.includes(o.slug) || pg.failed.some((f) => f.slug === o.slug)) continue;
      if (room() < Math.max(1, measured * 2)) { stopped = true; console.log(`\nBudget: $${room().toFixed(2)} left for today or in all; next run carries on.`); break; }
      if (Date.now() - started > MINUTES * 60_000) { stopped = true; console.log('\nTime limit for this run; next run carries on.'); break; }
      const before = ledgerDollars();
      let r: Awaited<ReturnType<typeof buildPage>> | null = null;
      try {
        const prior: any = (await db().collection('guidePrototypes').doc(`${g.key}__${o.slug}`).get()).data();
        // A prototype from before verdicts (built on the live guide) only needs its review.
        r = prior && !prior.status && prior.walkthrough?.length && pg.source !== 'stage' ? await reviewOnly(g.key, game, o.slug, order, prior) : await buildPage(g.key, game, o.slug, order, src);
      } catch (e: any) {
        pg.tries = pg.tries || {};
        pg.tries[o.slug] = (pg.tries[o.slug] || 0) + 1;
        console.log(`  ${o.name}: failed to build (${e?.message || e})${pg.tries[o.slug] >= 2 ? '; counted as failed' : '; tried again next run'}`);
        if (pg.tries[o.slug] >= 2) { pg.failed.push({ slug: o.slug, name: o.name, reason: `could not be built: ${cut(e?.message || e, 120)}` }); st.runFailures.push({ key: g.key, slug: o.slug, name: o.name, reason: 'could not be built' }); }
      }
      const spent = ledgerDollars() - before;
      charge(spent);
      if (r) {
        st.pagesBuilt = Number(st.pagesBuilt || 0) + 1;
        st.pageDollars = Number(st.pageDollars || 0) + spent;
        if (r.verdict.status === 'passed') {
          await writePage(src, o.slug, r.proto);
          if (pg.source !== 'stage') {
            // Live now: its translations are brought up to date by the pipeline (translationsDue).
            const gi: any = (await db().collection('guides').doc(g.key).get()).data() || {};
            await db().collection('guides').doc(g.key).set({ translationsDue: { at: Date.now(), pages: [...new Set([...(gi.translationsDue?.pages || []), o.slug])].slice(0, 500) } }, { merge: true });
            wentLive = true;
          }
          pg.done.push(o.slug);
          st.runPages.push({ key: g.key, slug: o.slug });
        } else if (r.verdict.status === 'failed') {
          pg.failed.push({ slug: o.slug, name: o.name, reason: r.verdict.reason || 'failed review' });
          st.runFailures.push({ key: g.key, slug: o.slug, name: o.name, reason: r.verdict.reason || 'failed review' });
        } // waiting: tried again next run
      }
      await save();
    }
    if (stopped) break;
    // A rebuilt guide goes live when all its pages are reviewed: pages that failed are held back.
    if (pg.source === 'stage') {
      for (const f of pg.failed) await db().collection('guides').doc(src).collection('areas').doc(f.slug).set({ status: 'held', heldReason: `flagship review: ${f.reason}` }, { merge: true }).catch(() => {});
      const pr = await promote(stageKey(g.key));
      console.log(`\n${game}: rebuilt guide promoted (${pr?.published || 0} pages live, ${pg.failed.length} held back).`);
      wentLive = true;
    }
    pg.phase = 'done';
    await save();
  }
  st.lastRun = Date.now();
  await save();

  // The website, when anything went live.
  if (wentLive && arg('no-publish') !== 'true') {
    const cli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    spawnSync(process.execPath, [cli, 'scripts/guides/publish.ts'], { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, stdio: 'inherit' });
    if (process.env.NETLIFY_AUTH_TOKEN && process.env.NETLIFY_SITE_ID) {
      try {
        const n = await deployToNetlify('Marketing_Website_Files', process.env.NETLIFY_SITE_ID, process.env.NETLIFY_AUTH_TOKEN);
        console.log(`Deployed to Netlify (${n.uploaded} changed file(s)).`);
      } catch (e: any) {
        console.log(`Netlify deploy failed: ${e?.message}`);
      }
    }
  }
  console.log(`\nDone: flagship programme, $${st.spentToday.toFixed(2)} today, $${st.spent.toFixed(2)} of $${budget.total} in all.`);
}

async function main() {
  if (arg('program') === 'true') {
    await program();
    return setTimeout(() => process.exit(0), 1000);
  }
  const key = arg('key') || '';
  const pages = String(arg('pages') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!key || !pages.length) {
    console.log('Usage: npx tsx scripts/guides/flagship.ts --key baldur-s-gate-3 --pages ravaged-beach,emerald-grove');
    process.exit(1);
  }
  const info: any = (await db().collection('guides').doc(key).get()).data();
  if (!info) throw new Error(`no guide ${key}`);
  // --retidy: clean up the stored prototypes again (no AI calls).
  if (arg('retidy') === 'true') {
    for (const slug of pages) {
      const ref = db().collection('guidePrototypes').doc(`${key}__${slug}`);
      const pr = (await ref.get()).data();
      if (!pr) continue;
      const clean = tidyProto(pr);
      await ref.set(JSON.parse(JSON.stringify(clean)));
      fs.writeFileSync(`scratchpad/flagship/${key}__${slug}.json`, JSON.stringify(clean, null, 1));
      console.log(`tidied ${slug}`);
    }
    return setTimeout(() => process.exit(0), 500);
  }
  let total = { searches: 0, dollars: 0 };
  for (const slug of pages) {
    const s = await buildPage(key, String(info.game || key), slug, info.areas || []);
    total = { searches: total.searches + s.searches, dollars: total.dollars + s.dollars };
  }
  console.log(`\nDone: ${pages.length} flagship page(s) in staging (guidePrototypes), ${total.searches} searches used, cost ≈ $${total.dollars.toFixed(3)}.`);
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => {
  console.error('flagship failed:', e?.message || e);
  process.exit(1);
});
