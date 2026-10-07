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
 *     --only <key>        just that guide        --concurrency N   pages built at once (default 1, at most 6)
 * system/flagship: budget.dayOverrides { "2026-10-05": 30 } raises one day's cap; pauseAfter <key> pauses the
 * programme (paused) once that guide is done; paused stops it until it's cleared.
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
  db, gemini, MODEL, arg, searchesIn, sourcesIn, parseItem, ledger, ledgerDollars, usageScope, MISSABLE_STANDARD, stageKey, addChildUsage, slug as slugOf, LAYOUT_CHOICES, isLayout,
  type GuideEntry, type GuideStep, type GuideChoice, type GuideAdvice, type GuideFight, type GuideInfo,
} from './common';
import { recordMonthly } from '../../searchGuard';
import { infoForPage } from './areaInfo';
import { fightsForPage } from './fights';
import { call, reviewerFor, queueForReview, MIN_PAGES, type Review } from './review';
import { sourcePack, packNotes, type SourcePack } from './sourcePack';
import { ProQuotaWait } from './reviewerQuota';
import { apiLimits, searchesToday, pipelineRoom, SearchDayWait } from '../../apiLimits';
import { promote, stageCopy, discard } from './promote';
import { deployToNetlify } from '../pipeline/netlify';
import { FieldValue } from 'firebase-admin/firestore';
import { acquireGuideLock, waitForGuideLock, isRefusal, lockedLine, releaseGuideLocks, SITE_LOCK, type GuideLock } from './guideLock';

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

/** A call without searches (writing and checking from a source pack). */
async function plain(prompt: string, label: string): Promise<string> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.3, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  console.log(`  [${label}] no searches`);
  return String(res?.text || '');
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

/** Pack mode: the research notes are the source pack, and nothing is searched while writing. */
const PACK_RULE = 'Write ONLY from the fact pack below (facts from the game\'s wiki), in your own words: never copy its sentences, and never add a fact it doesn\'t contain.';

/** Pack mode: the draft checked against the same pack; a specific claim it can't settle is a GAP (searched later, capped). */
function packCheckPrompt(game: string, p: any, d: Draft, notes: string) {
  return [
    `Fact-check this draft for the area "${p.name}" of a guide to the video game "${game}" against the FACT PACK below (facts from the game's wiki). Do not search.`,
    ...FIX_RULES.slice(0, 2),
    'For a line the pack contradicts, or that it shows belongs to another area: FIX or DROP as above.',
    'For a line with a specific fact (a name, place, check, reward, outcome) that the pack neither supports nor contradicts: GAP: the label | the exact question to look up. At most 4 GAP lines, the most important first.',
    'Never DROP a line just because the pack does not mention it: that is a GAP (or no reply, for general advice). Lines the pack supports need no reply. If everything is supported, reply OK.',
    '',
    'FACT PACK:',
    notes.slice(0, 12000),
    '',
    'DRAFT:',
    ...draftLines(d, 'all'),
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

function consistencyPrompt(game: string, p: any, neighbours: string[], d: Draft, facts = '') {
  return [
    `You are the final reviewer of a guide page for the video game "${game}": the area "${p.name}"${p.story ? ` (${p.story})` : ''}. Neighbouring areas: ${neighbours.join(', ') || 'unknown'}.`,
    'Check it as an expert on this game: lines that contradict each other, events or characters that are really in a neighbouring area, a wrong order, wrong facts you are sure of. Do not rewrite style.',
    // Pack mode: the facts the page was written from (the game's wiki). A detail that matches them isn't invented,
    // even if the reviewer doesn't remember it.
    ...(facts ? [`Facts from the game's wiki that this page was written from (a line that matches them is not invented, even if you don't remember the detail; a line that contradicts them is wrong):`, facts.slice(0, 10000), ''] : []),
    ...FIX_RULES,
    'Then one line "SCORE: 0-100" for the page with your fixes applied (90+: accurate, specific and useful; 75: usable with a few weak lines; below 60: unreliable).',
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

type Verdict = { status: 'passed' | 'failed' | 'waiting'; reason?: string; score?: number };

/** The Pro consistency review with its verdict: fixes applied to the draft, and pass / fail (waiting: no Pro request). */
async function proReview(game: string, p: any, neighbours: string[], draft: Draft, retried = false, facts = ''): Promise<Verdict & { fixed: number; dropped: number }> {
  try {
    // A network failure ("fetch failed") is retried, after 5 and 20 seconds; the quota running out is not.
    let res: any;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await call(reviewerFor('pro', 'careful'), {
          contents: [{ role: 'user', parts: [{ text: consistencyPrompt(game, p, neighbours, draft, facts) }] }],
          // Pro usually answers in seconds, but a call can hang, or a long page take minutes when Pro is busy: each try
          // gets longer (2, 4, then 7 minutes) before giving up for this run.
          // Fixes and a verdict fit in 4,096 tokens: a review that runs on past that is a runaway (and billed as one).
          config: { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, httpOptions: { timeout: [120_000, 240_000, 420_000][attempt] } },
        });
        break;
      } catch (e: any) {
        if (e instanceof ProQuotaWait || attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, attempt ? 20_000 : 5_000));
      }
    }
    const text = String(res?.text || '');
    if (String(res?.candidates?.[0]?.finishReason || '') === 'MAX_TOKENS') {
      // A runaway is hit and miss: one more try (capped too) before the page counts as failed.
      if (!retried) return proReview(game, p, neighbours, draft, true, facts);
      return { status: 'failed', reason: 'the review ran past its 4,096-token cap twice (a runaway reply)', fixed: 0, dropped: 0 };
    }
    const t = applyFixes(text, draft);
    const sc = Number((text.match(/SCORE\s*:\s*(\d{1,3})/i) || [])[1]);
    const score = Number.isFinite(sc) && sc >= 0 && sc <= 100 ? sc : undefined;
    const v = text.split('\n').map((l) => fields(l, 'VERDICT')).filter(Boolean).pop();
    if (!v) return { status: 'failed', reason: 'the reviewer gave no verdict', score, ...t };
    return /^pass/i.test(v[0]) ? { status: 'passed', score, ...t } : { status: 'failed', reason: cut(v.slice(1).join(' | ') || v[0].replace(/^fail\s*/i, ''), 300) || 'failed review', score, ...t };
  } catch (e: any) {
    if (e instanceof ProQuotaWait) return { status: 'waiting', reason: 'no Pro reviewer requests left today', fixed: 0, dropped: 0 };
    return { status: 'waiting', reason: cut(e?.message || e, 200), fixed: 0, dropped: 0 };
  }
}

/**
 * One flagship page, written to guidePrototypes/{key}__{slug} with the reviewer's verdict. `from` is the guide copy to
 * build on (the live guide, or its staged rebuild). Returns its searches, real cost and verdict.
 */
async function buildPage(key: string, game: string, slug: string, order: { slug: string; name: string }[], from = key, opts: { pack?: boolean; gapSearches?: boolean; protoId?: string } = {}) {
  const scope = usageScope.getStore();
  const before = scope ? { ...scope } : { searches: ledger.searches, dollars: ledgerDollars() };
  const p: any = (await db().collection('guides').doc(from).collection('areas').doc(slug).get()).data();
  if (!p) throw new Error(`no page ${slug}`);
  console.log(`\n${p.name}`);
  const i = order.findIndex((o) => o.slug === slug);
  const neighbours = order.slice(Math.max(0, i - 3), i + 4).map((o) => o.name).filter((n) => n !== p.name);
  const sources = new Set<string>(p.sources || []);

  // Pack mode: the area's facts from the game's wiki (cached), the basis for everything below; no searches to write.
  const sp: SourcePack | null = opts.pack ? await sourcePack(key, slug, { from, game }) : null;
  if (opts.pack && !sp) throw new Error('no source pack (no wiki for this game, or nothing fetchable)');
  // What the page lacks first: the summary box and directions, and key fights.
  // An earlier prototype run's summary box and fights are reused (no need to search for them again).
  const prev: any = (await db().collection('guidePrototypes').doc(`${key}__${slug}`).get()).data();
  let info: GuideInfo | undefined = p.info || prev?.info;
  if (!info && sp) {
    const k = sp.pack;
    info = JSON.parse(JSON.stringify({ region: k.region || undefined, levels: k.levels || undefined, quests: (k.quests || []).slice(0, 8), services: (k.services || []).slice(0, 8), directions: k.directions || undefined, connected: (k.connected || []).slice(0, 8), sources: [sp.wiki] }));
  }
  if (!info) {
    const r = await infoForPage(game, p, neighbours, false);
    if (r.info) { info = r.info; (r.info.sources || []).forEach((s) => sources.add(s)); }
    console.log(`  summary box: ${r.info ? 'written' : 'nothing confirmed'}`);
  }
  let fights: GuideFight[] = (p.fights || []).length ? p.fights : prev ? prev.fights || [] : [];
  if (!fights.length && sp) {
    fights = sp.pack.fights.slice(0, 6).map((f, i) => JSON.parse(JSON.stringify({ id: `f${i + 1}`, name: cut(f.name, 100), enemies: f.enemies || undefined, threats: f.threats || undefined, weaknesses: f.weaknesses || undefined, tactics: f.tactics || undefined, rewards: f.rewards || undefined, sources: [sp.wiki] })));
  }
  if (!fights.length && !prev && !sp) {
    const r = await fightsForPage(game, p, false);
    fights = r.fights;
    console.log(`  key fights: ${fights.map((f) => f.name).join('; ') || 'none'}`);
  }

  const entries = entryList(p);
  // 1. Research: the source pack (pack mode), or sourced notes from several searches.
  const notes = sp ? { text: packNotes(sp), sources: [sp.wiki] } : await grounded(researchPrompt(game, p, neighbours), 'research');
  if (!notes) throw new Error('the research reply ran no searches or named no sources');
  notes.sources.forEach((s) => sources.add(s));
  // 2. The walkthrough, the short version and the choices, written from the notes (pack mode: from the pack only,
  //    without searching; otherwise searching again where the notes are thin).
  const w = sp
    ? { text: await plain(walkPrompt(game, p, entries, fights, neighbours, notes.text).replace(/Write from the research notes below;[^\n]*/, PACK_RULE).replace('Research notes:', 'FACT PACK:'), 'walkthrough'), sources: [] as string[] }
    : await grounded(walkPrompt(game, p, entries, fights, neighbours, notes.text), 'walkthrough', true);
  if (!w) throw new Error('the walkthrough reply ran no searches or named no sources');
  w.sources.forEach((s) => sources.add(s));
  const draft: Draft = {
    steps: parseSteps(w.text, new Set(entries.map((e) => e.id)), new Set(fights.map((f) => f.id))),
    news: parseNew(w.text, w.sources),
    advice: parseAdvice(w.text),
    choices: [],
    old: [...(p.items || []).map((e: GuideEntry) => ({ entry: e, kind: 'item' as const })), ...(p.secrets || []).map((e: GuideEntry) => ({ entry: e, kind: 'secret' as const }))],
  };
  const c = sp
    ? { text: await plain(choicePrompt(game, p, notes.text).replace(/Search guides and wikis to confirm each choice and its outcomes, and write only what the sources say\./, PACK_RULE), 'choices'), sources: [] as string[] }
    : await grounded(choicePrompt(game, p, notes.text), 'choices', true);
  if (c) { draft.choices = parseChoices(c.text); c.sources.forEach((s) => sources.add(s)); }

  // 3. Fact-checks against sources, every line searched: the walkthrough and new entries, then the choices and the
  //    short version. Wrong lines are corrected, unsupported ones dropped.
  const tally = { fixed: 0, dropped: 0 };
  const add = (t: { fixed: number; dropped: number }) => { tally.fixed += t.fixed; tally.dropped += t.dropped; };
  let gaps = 0;
  if (sp) {
    // Pack mode: one check against the same pack (no searches); what the pack can't settle is looked up in one capped
    // searched call (a single attempt), or dropped when gap searches are off.
    const k = await plain(packCheckPrompt(game, p, draft, notes.text), 'check: pack');
    const gapLines = k.split('\n').map((l) => fields(l, 'GAP')).filter(Boolean).slice(0, 4) as string[][];
    gaps = gapLines.length;
    const before = draftLines(draft, 'all');
    add(applyFixes(k, draft));
    if (gapLines.length && opts.gapSearches !== false) {
      const want = new Set(gapLines.map((g) => String(g[0]).toUpperCase().replace(/[^SNCAE0-9]/g, '')));
      const lines = before.filter((l) => want.has(l.split(':')[0]));
      const res: any = await gemini().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: [
          `For the video game "${game}", the area "${p.name}": check these lines of a guide draft with a quick search (two or three searches in all).`,
          ...FIX_RULES,
          '', ...gapLines.map((g) => `${g[0]}: ${g.slice(1).join(' | ')}`), '', ...lines,
        ].join('\n') }] }],
        config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      const n = searchesIn(res);
      if (n) recordMonthly(n);
      console.log(`  [gaps: ${gapLines.length}] ${n} searches`);
      // Only a reply that searched counts (one from memory is no source): otherwise the gap lines are dropped.
      if (n && sourcesIn(res).length) {
        sourcesIn(res).forEach((s) => sources.add(s));
        add(applyFixes(String(res?.text || ''), draft));
      } else add(applyFixes(gapLines.filter((g) => !/^E/i.test(String(g[0]).trim())).map((g) => `DROP: ${g[0]} | not in the source pack, and not confirmed by a search`).join('\n'), draft));
    } else if (gapLines.length) {
      // The page's own entries (E) were checked when they were written: they stay; new lines nothing confirms go.
      add(applyFixes(gapLines.filter((g) => !/^E/i.test(String(g[0]).trim())).map((g) => `DROP: ${g[0]} | not in the source pack`).join('\n'), draft));
    }
  } else {
    const k1 = await grounded(checkPrompt(game, p, draft, 'walk'), 'check: walkthrough');
    if (k1) { k1.sources.forEach((s) => sources.add(s)); add(applyFixes(k1.text, draft)); }
    const k2 = await grounded(checkPrompt(game, p, draft, 'choices'), 'check: choices');
    if (k2) { k2.sources.forEach((s) => sources.add(s)); add(applyFixes(k2.text, draft)); }
  }
  // 4. A consistency review by the Pro reviewer (no searches): contradictions between lines, things that happen in a
  //    neighbouring area, a wrong order.
  const verdict = await proReview(game, p, neighbours, draft, false, sp ? notes.text : '');
  add(verdict);
  console.log(`  fact-checks: ${tally.fixed} corrected, ${tally.dropped} dropped${sp ? ` (${gaps} gap(s) beyond the pack)` : ''}; Pro review: ${verdict.status}${verdict.score !== undefined ? `, score ${verdict.score}` : ''}${verdict.reason ? ` (${verdict.reason})` : ''}`);
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
  const spent = scope ? { searches: scope.searches - before.searches, dollars: scope.dollars - before.dollars } : { searches: ledger.searches - before.searches, dollars: ledgerDollars() - before.dollars };
  const proto = {
    key, slug, game, name: p.name, walkthrough: steps, choices, advice, items, secrets, fights, ...(info ? { info } : {}),
    sources: [...sources].slice(0, 12), newEntries: news.length, unplaced, cost: spent, model: MODEL, at: Date.now(),
    status: verdict.status, ...(verdict.reason ? { reason: verdict.reason } : {}), ...(verdict.score !== undefined ? { score: verdict.score } : {}), from,
    // Pack mode: the wiki articles it came from, credited on the page under the wiki's licence.
    ...(sp ? { mode: 'pack', sourceLinks: { wiki: sp.wiki, license: sp.license, licenseUrl: sp.licenseUrl, pages: sp.sources } } : {}),
  };
  const clean = tidyProto(proto);
  // A trial (protoId) is saved apart, so it never replaces the prototype a live page came from.
  const docId = opts.protoId || `${key}__${slug}`;
  await db().collection('guidePrototypes').doc(docId).set(JSON.parse(JSON.stringify(clean)));
  fs.mkdirSync('scratchpad/flagship', { recursive: true });
  fs.writeFileSync(`scratchpad/flagship/${docId}.json`, JSON.stringify(clean, null, 1));
  console.log(`  ${steps.length} steps, ${choices.length} choices, ${news.length} new entries${unplaced.length ? `, not placed in a step: ${unplaced.join('; ')}` : ''}`);
  console.log(`  cost: ${spent.searches} searches, $${spent.dollars.toFixed(3)} (tokens and searches)`);
  return { ...spent, verdict, proto: clean };
}

/** The Pro review's score for a page as it stands (its live flagship content), saving nothing: a baseline to compare. */
async function scoreOnly(key: string, game: string, slug: string, order: { slug: string; name: string }[]) {
  const a: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
  if (!a?.walkthrough?.length) return null;
  const i = order.findIndex((o) => o.slug === slug);
  const neighbours = order.slice(Math.max(0, i - 3), i + 4).map((o) => o.name).filter((n) => n !== a.name);
  const draft: Draft = { steps: a.walkthrough, news: [], choices: a.choices || [], advice: a.advice || { matters: [], skip: [], mistakes: [] }, old: [...(a.items || []).map((e: any) => ({ entry: e, kind: 'item' as const })), ...(a.secrets || []).map((e: any) => ({ entry: e, kind: 'secret' as const }))] };
  return proReview(game, a, neighbours, draft);
}

/** A prototype built before verdicts existed: only the Pro review (fixes and verdict), no rebuilding. */
async function reviewOnly(key: string, game: string, slug: string, order: { slug: string; name: string }[], pr: any, from = key) {
  const scope = usageScope.getStore();
  const before = scope ? scope.dollars : ledgerDollars();
  const i = order.findIndex((o) => o.slug === slug);
  const neighbours = order.slice(Math.max(0, i - 3), i + 4).map((o) => o.name).filter((n) => n !== pr.name);
  const draft: Draft = { steps: pr.walkthrough || [], news: [], choices: pr.choices || [], advice: pr.advice || { matters: [], skip: [], mistakes: [] }, old: [...(pr.items || []).map((e: any) => ({ entry: e, kind: 'item' as const })), ...(pr.secrets || []).map((e: any) => ({ entry: e, kind: 'secret' as const }))] };
  const verdict = await proReview(game, { name: pr.name }, neighbours, draft);
  const clean = tidyProto({ ...pr, walkthrough: draft.steps, choices: draft.choices, advice: draft.advice, items: draft.old.filter((o) => o.kind === 'item').map((o) => o.entry), secrets: draft.old.filter((o) => o.kind === 'secret').map((o) => o.entry), status: verdict.status, ...(verdict.reason ? { reason: verdict.reason } : { reason: null }), from, at: Date.now() });
  await db().collection('guidePrototypes').doc(`${key}__${slug}`).set(JSON.parse(JSON.stringify(clean)));
  console.log(`\n${pr.name}: review only: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}, ${verdict.fixed} corrected, ${verdict.dropped} dropped`);
  return { searches: 0, dollars: (scope ? scope.dollars : ledgerDollars()) - before, verdict, proto: clean };
}

/** The flagship fields written onto a page (the live guide's, or the staged rebuild's). */
async function writePage(target: string, slug: string, pr: any) {
  await db().collection('guides').doc(target).collection('areas').doc(slug).set(JSON.parse(JSON.stringify({
    walkthrough: pr.walkthrough, choices: pr.choices, advice: pr.advice, items: pr.items, secrets: pr.secrets, fights: pr.fights || [],
    ...(pr.info ? { info: pr.info } : {}), sources: pr.sources || [], verified: true,
    ...(pr.sourceLinks ? { sourceLinks: pr.sourceLinks } : {}),
    flagship: { at: Date.now(), cost: pr.cost?.dollars ?? null, model: pr.model, mode: pr.mode || 'searched' }, updatedAt: Date.now(),
  })), { merge: true });
}

// ---------- the programme ----------
const DAY_TZ = 'America/Chicago';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: DAY_TZ });
type GuideProgress = { phase: 'outline' | 'pages' | 'done'; source?: 'live' | 'stage'; total?: number; done: string[]; failed: { slug: string; name: string; reason: string }[]; tries?: Record<string, number>; outlineTries?: number };
/** Estimated cost per page until the programme has measured its own, and for an outline rebuild. */
const PAGE_GUESS = 0.42, OUTLINE_GUESS = 0.5;
/** The source-pack method's rate (measured on 9 pages: $0.07 with a wiki, $0.12-0.18 from searches). */
const PACK_PAGE_GUESS = 0.16;
const MINUTES = Number(process.env.FLAGSHIP_MINUTES || 150);
const DAY_MS = 86_400_000;

async function program() {
  const ref = db().collection('system').doc('flagship');
  const st: any = (await ref.get()).data();
  if (!st?.guides?.length) { console.log('No flagship programme (system/flagship.guides).'); return; }
  const budget = { total: 90, daily: 15, stopAt: 100, ...(st.budget || {}) };
  // One day's cap raised (budget.dayOverrides { "2026-10-05": 30 }), from the same total.
  const dayCap = Number(budget.dayOverrides?.[today()]) || budget.daily;
  budget.daily = dayCap;
  process.env.GUIDE_LOCK_LABEL = process.env.GUIDE_LOCK_LABEL || 'the flagship job';
  if (st.day !== today()) Object.assign(st, { day: today(), spentToday: 0, runPages: [], runFailures: [] });
  st.runSkips = [];
  if (st.paused && arg('estimate') !== 'true' && arg('ignore-pause') !== 'true') { console.log(`The flagship programme is paused (${st.paused.why || 'until the owner says go'}). Nothing to do.`); return; }
  const only = arg('only') && arg('only') !== 'true' ? String(arg('only')) : '';
  // The traffic-driven rollout, when it's on, replaces the list of whole guides (unless one guide is asked for).
  // The traffic-driven rollout takes over once every guide in the list is done (unless one guide is asked for).
  if (st.rollout?.enabled && !only && st.guides.every((g: any) => st.progress?.[g.key]?.phase === 'done')) return rollout(st, () => ref.set(JSON.parse(JSON.stringify(st)), { merge: true }));
  const concurrency = Math.max(1, Math.min(6, Number(arg('concurrency', '1')) || 1));
  st.spent = Number(st.spent || 0); st.spentToday = Number(st.spentToday || 0);
  st.progress = st.progress || {};
  st.runPages = st.runPages || []; st.runFailures = st.runFailures || [];
  const save = () => ref.set(JSON.parse(JSON.stringify(st)), { merge: true });
  const measured = Number(st.pagesBuilt || 0) >= 5 ? Number(st.pageDollars || 0) / Number(st.pagesBuilt) : budget.pack !== false ? PACK_PAGE_GUESS : PAGE_GUESS;

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
  let guideLock: GuideLock | null = null;
  for (const g of st.guides) {
    const pg: GuideProgress = st.progress[g.key];
    if (only && g.key !== only) continue;
    if (pg.phase === 'done') continue;
    const info: any = (await db().collection('guides').doc(g.key).get()).data();
    const game = String(info?.game || g.key);
    // One process at a time per guide (guideLock.ts): another one working on this guide means it waits for next run.
    if (guideLock) { await guideLock.release(); guideLock = null; }
    const lk = await acquireGuideLock(g.key, 'flagship build');
    if (isRefusal(lk)) {
      console.log(lockedLine(lk, game));
      st.runSkips.push({ key: g.key, name: game, reason: `in use by ${lk.heldBy}` });
      await save();
      continue;
    }
    guideLock = lk;

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
    const queue = order.filter((o) => usable.has(o.slug) && !pg.done.includes(o.slug) && !pg.failed.some((f) => f.slug === o.slug));
    let reserved = 0; // money held for pages being built right now
    // Google's spend-based rate limit (429 RESOURCE_EXHAUSTED) is the account's, shared with players: the page goes back
    // in the queue and everything waits 2 minutes; after 3 of them the run stops (next run carries on). Never the
    // page's fault, so it isn't counted as a try.
    let rateLimits = 0, pausedUntil = 0;
    const rateLimited = (e: any) => /RESOURCE_EXHAUSTED|spend-based rate limit|429/i.test(String(e?.message || e));
    const worker = async () => {
      while (queue.length && !stopped) {
        const need = Math.max(1, measured * 2);
        if (room() - reserved < need) { if (!stopped) console.log(`\nBudget: $${room().toFixed(2)} left for today or in all; next run carries on.`); stopped = true; break; }
        if (Date.now() - started > MINUTES * 60_000) { if (!stopped) console.log('\nTime limit for this run; next run carries on.'); stopped = true; break; }
        if (Date.now() < pausedUntil) { await new Promise((r) => setTimeout(r, pausedUntil - Date.now())); continue; }
        // Google's daily search limit (config/apiLimits): a page needs a few searches; with the pipeline's share of today's
        // nearly gone, the programme stops for the day (next run carries on).
        if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 15) { if (!stopped) console.log("\nToday's pipeline searches are used up (search day limit); next run carries on."); stopped = true; break; }
        const o = queue.shift()!;
        reserved += need;
        const scope = { dollars: 0, searches: 0 };
        let r: Awaited<ReturnType<typeof buildPage>> | null = null;
        try {
          const prior: any = (await db().collection('guidePrototypes').doc(`${g.key}__${o.slug}`).get()).data();
          // A prototype from before verdicts (built on the live guide) only needs its review.
          // A page whose review couldn't run last time (waiting) is only reviewed again, not rebuilt.
          const reviewAgain = prior?.walkthrough?.length && (prior.status === 'waiting' || (!prior.status && pg.source !== 'stage'));
          r = await usageScope.run(scope, () => (reviewAgain ? reviewOnly(g.key, game, o.slug, order, prior, src) : buildPage(g.key, game, o.slug, order, src, { pack: budget.pack !== false })));
        } catch (e: any) {
          if (e instanceof SearchDayWait || /search day limit/.test(String(e?.message || e))) {
            // Not the page's fault: back in the queue, and the run stops for today.
            reserved -= need;
            charge(scope.dollars);
            queue.unshift(o);
            if (!stopped) console.log(`
${o.name}: today's pipeline searches ran out (search day limit); next run carries on.`);
            stopped = true;
            break;
          }
          if (rateLimited(e)) {
            reserved -= need;
            charge(scope.dollars);
            queue.unshift(o);
            rateLimits++;
            if (rateLimits >= 3) { if (!stopped) console.log(`
Google's spend-based rate limit, ${rateLimits} times: stopped; next run carries on.`); stopped = true; st.rateLimitedAt = Date.now(); await save(); break; }
            console.log(`  ${o.name}: Google's spend-based rate limit; waiting 2 minutes (${rateLimits} of 3).`);
            pausedUntil = Date.now() + 120_000;
            continue;
          }
          pg.tries = pg.tries || {};
          pg.tries[o.slug] = (pg.tries[o.slug] || 0) + 1;
          console.log(`  ${o.name}: failed to build (${e?.message || e})${pg.tries[o.slug] >= 2 ? '; counted as failed' : '; tried again next run'}`);
          if (pg.tries[o.slug] >= 2) { pg.failed.push({ slug: o.slug, name: o.name, reason: `could not be built: ${cut(e?.message || e, 120)}` }); st.runFailures.push({ key: g.key, slug: o.slug, name: o.name, reason: 'could not be built' }); }
        }
        reserved -= need;
        charge(scope.dollars);
        if (r) {
          st.pagesBuilt = Number(st.pagesBuilt || 0) + 1;
          st.pageDollars = Number(st.pageDollars || 0) + scope.dollars;
          if (r.verdict.status === 'passed') {
            await writePage(src, o.slug, r.proto);
            if (pg.source !== 'stage') {
              // Live now: its translations are brought up to date by the pipeline (translationsDue).
              await db().collection('guides').doc(g.key).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(o.slug) } }, { merge: true });
              wentLive = true;
            }
            pg.done.push(o.slug);
            st.runPages.push({ key: g.key, slug: o.slug });
          } else if (r.verdict.status === 'failed') {
            pg.failed.push({ slug: o.slug, name: o.name, reason: r.verdict.reason || 'failed review' });
            st.runFailures.push({ key: g.key, slug: o.slug, name: o.name, reason: r.verdict.reason || 'failed review' });
          } // waiting: tried again next run
        }
        console.log(`  [${pg.done.length + pg.failed.length}/${usable.size}] ${o.name}: ${r ? r.verdict.status : 'not built'}, $${scope.dollars.toFixed(3)}; programme $${st.spent.toFixed(2)} ($${st.spentToday.toFixed(2)} today)`);
        await save();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (stopped) break;
    const open = [...usable].filter((slug) => !pg.done.includes(slug) && !pg.failed.some((f) => f.slug === slug));
    if (open.length) { console.log(`\n${game}: ${open.length} page(s) still waiting for a review; next run carries on.`); break; }
    // A rebuilt guide goes live when all its pages are reviewed: pages that failed are held back.
    if (pg.source === 'stage') {
      for (const f of pg.failed) await db().collection('guides').doc(src).collection('areas').doc(f.slug).set({ status: 'held', heldReason: `flagship review: ${f.reason}` }, { merge: true }).catch(() => {});
      const pr = await promote(stageKey(g.key));
      console.log(`\n${game}: rebuilt guide promoted (${pr?.published || 0} pages live, ${pg.failed.length} held back).`);
      wentLive = true;
    }
    pg.phase = 'done';
    // Paused once this guide is done (pauseAfter): the next guides wait for the owner's go.
    if (st.pauseAfter === g.key) {
      st.paused = { after: g.key, at: Date.now(), why: `${game} is finished: waiting for the owner's review before the next guides` };
      console.log(`\nPaused after ${game}: the next guides wait for the owner's go.`);
      await save();
      break;
    }
    await save();
  }
  if (guideLock) await guideLock.release();
  st.lastRun = Date.now();
  await save();

  if (wentLive) await publishSite();
  await releaseGuideLocks();
  console.log(`\nDone: flagship programme, $${st.spentToday.toFixed(2)} today, $${st.spent.toFixed(2)} of $${budget.total} in all.`);
}

/** The website, when anything went live: published and deployed to Netlify. */
async function publishSite() {
  if (arg('no-publish') === 'true') return;
  // The site-wide lock: one publish and deploy at a time (the pipeline's, this job's, a manual one), waiting up to
  // 15 minutes for another to finish.
  const lk = await waitForGuideLock(SITE_LOCK, 'publish and deploy', 15 * 60_000);
  if (isRefusal(lk)) { console.log(lockedLine(lk, 'the website')); return; }
  try { await publishAndDeploy(); } finally { await lk.release(); }
}

async function publishAndDeploy() {
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

/**
 * The traffic-driven rollout (system/flagship.rollout { enabled, monthly, perDay }): a few pages a day, the most-searched
 * pages first, across all guides, built from source packs (a wiki we may fetch, or one searched research step) and live
 * once they pass the Pro review, within a monthly budget. Order: the weekly Search Console pages by impressions, then
 * the rest of the pages of the guides people search for most, then of the guides players use most in the app. Skipped:
 * pages already flagship, pages that failed in the last 30 days, and guides with a staged rebuild.
 */
async function rollout(st: any, save: () => Promise<any>) {
  const r = st.rollout;
  const month = new Date().toISOString().slice(0, 7);
  if (r.month !== month) Object.assign(r, { month, spentMonth: 0, pagesMonth: 0 });
  r.failed = r.failed || {};
  r.runPages = []; r.runFailures = []; r.runSkips = [];
  const monthly = Number(r.monthly || 20), perDay = Number(r.perDay || 5);
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const top: { key: string; slug: string; impressions: number }[] = sc.topPages || [];
  const gameImpr = new Map<string, number>();
  for (const p of top) gameImpr.set(p.key, (gameImpr.get(p.key) || 0) + p.impressions);
  const players = new Map<string, number>();
  for (const d of (await db().collection('gameStats').get()).docs) players.set(d.id, Array.isArray(d.data().players) ? d.data().players.length : 0);
  const guides = (await db().collection('guides').get()).docs.filter((d) => !d.id.endsWith('--next'));
  const staged = new Set((await db().collection('guides').get()).docs.filter((d) => d.id.endsWith('--next')).map((d) => d.id.replace(/--next$/, '')));
  const order = guides.map((d) => d.id).filter((k) => !staged.has(k)).sort((a, b) => (gameImpr.get(b) || 0) - (gameImpr.get(a) || 0) || (players.get(b) || 0) - (players.get(a) || 0));
  const queue: { key: string; slug: string }[] = [...top.filter((p) => !staged.has(p.key)).map((p) => ({ key: p.key, slug: p.slug }))];
  for (const k of order.slice(0, 30)) for (const o of (guides.find((d) => d.id === k)!.data().areas || []) as { slug: string }[]) queue.push({ key: k, slug: o.slug });
  const seen = new Set<string>();
  let built = 0, wentLive = false;
  const started = Date.now();
  for (const c of queue) {
    const id = `${c.key}__${c.slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (built >= perDay || monthly - r.spentMonth < 0.5 || Date.now() - started > MINUTES * 60_000) break;
    const f = r.failed[id];
    if (f && Date.now() - f.at < 30 * DAY_MS) continue;
    const gref = db().collection('guides').doc(c.key);
    const page: any = (await gref.collection('areas').doc(c.slug).get()).data();
    if (!page || page.status !== 'published' || page.flagship) continue;
    const info: any = (await gref.get()).data() || {};
    const lk = await acquireGuideLock(c.key, 'flagship rollout');
    if (isRefusal(lk)) {
      console.log(lockedLine(lk, `${info.game} / ${page.name}`));
      r.runSkips = [...(r.runSkips || []), { key: c.key, name: `${info.game} / ${page.name}`, reason: `in use by ${lk.heldBy}` }];
      continue;
    }
    const scope = { dollars: 0, searches: 0 };
    let res: Awaited<ReturnType<typeof buildPage>> | null = null;
    try {
      res = await usageScope.run(scope, () => buildPage(c.key, String(info.game || c.key), c.slug, info.areas || [], c.key, { pack: true }));
    } catch (e: any) {
      console.log(`  ${page.name}: not built (${cut(e?.message || e, 120)})`);
      r.failed[id] = { at: Date.now(), reason: `not built: ${cut(e?.message || e, 100)}` };
    }
    r.spentMonth += scope.dollars;
    built++;
    if (res?.verdict.status === 'passed') {
      await writePage(c.key, c.slug, res.proto);
      await gref.set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(c.slug) } }, { merge: true });
      r.pagesMonth = Number(r.pagesMonth || 0) + 1;
      r.runPages.push({ key: c.key, slug: c.slug, name: page.name, score: res.verdict.score ?? null, dollars: Math.round(scope.dollars * 1000) / 1000 });
      wentLive = true;
    } else if (res?.verdict.status === 'failed') {
      r.failed[id] = { at: Date.now(), reason: res.verdict.reason || 'failed review' };
      r.runFailures.push({ key: c.key, slug: c.slug, name: page.name, reason: res.verdict.reason || 'failed review' });
    }
    console.log(`  [rollout] ${info.game} / ${page.name}: ${res ? res.verdict.status : 'not built'}${res?.verdict.score !== undefined ? `, score ${res.verdict.score}` : ''}, $${scope.dollars.toFixed(3)}; $${r.spentMonth.toFixed(2)} of $${monthly} this month`);
    await lk.release();
    await save();
  }
  r.lastRun = Date.now();
  await save();
  if (wentLive) await publishSite();
  console.log(`\nDone: flagship rollout, ${r.runPages.length} page(s) live this run, $${r.spentMonth.toFixed(2)} of $${monthly} this month.`);
}


// ---- careful builds on the source-pack method (repair.ts --action careful) ----

/** Searches a careful page usually takes (its search pack and a gap check): a page starts only with room for them. */
const CAREFUL_PAGE_SEARCHES = 10;
/** At most this many pages in a careful build. */
const CAREFUL_MAX_PAGES = 20;

/** The guide's pages, from one searched call: the layout that fits the game, then the pages in story order. */
async function packOutline(game: string, layout?: string, note?: string) {
  const prompt = [
    `List the pages of a player's guide for the video game "${game}", in the order a player meets them. Search guides and wikis for this game first.`,
    layout ? `The guide's outline: ${layout}.` : `First pick the outline that fits the game, one of these:\n${LAYOUT_CHOICES}\nand reply with a line "LAYOUT: <one word>".`,
    ...(note ? [`How the page list must look: ${note}`] : []),
    `Then one line per page, at most ${CAREFUL_MAX_PAGES} (the main areas, chapters or regions; never a page for a single room, shop or quest):`,
    'PAGE: page name | when in the story it comes up',
  ].join('\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = searchesIn(res);
    if (n) recordMonthly(n);
    console.log(`  [outline] ${n} searches`);
    if (!n) continue;
    const text = String(res?.text || '');
    const pickedRaw = (text.match(/LAYOUT:\s*([a-z]+)/i) || [])[1]?.toLowerCase();
    const picked = layout || (isLayout(pickedRaw) ? pickedRaw : 'area');
    const pages: { slug: string; name: string; story: string }[] = [];
    for (const line of text.split('\n')) {
      const f = fields(line, 'PAGE');
      if (!f || !f[0] || none(f[0])) continue;
      const name = cut(f[0], 100);
      const sl = slugOf(name);
      if (!sl || pages.some((x) => x.slug === sl)) continue;
      pages.push({ slug: sl, name, story: cut(f[1] || '', 120) });
    }
    return { layout: picked, pages: pages.slice(0, CAREFUL_MAX_PAGES) };
  }
  return { layout: layout || 'area', pages: [] as { slug: string; name: string; story: string }[] };
}

/**
 * A careful build or rebuild on the source-pack method, into the staged copy (guides/{key}--next): the page list from
 * one searched call, then each page from its source pack (the game's wiki where we may fetch it, otherwise one searched
 * research step), written and checked against the pack, and gated by the capped Pro review like a flagship page (a
 * page that fails is held back). A build that runs out of search room carries on next run. When every page has a
 * verdict, the guide goes live if at least MIN_PAGES passed; otherwise it goes to the review queue. Returns the gate
 * line (or "continues on the next run") for the pipeline.
 */
export async function packBuildGuide(key: string, game: string, opts: { maxSearches: number; layout?: string; note?: string; newRelease?: boolean }) {
  const stageRef = db().collection('guides').doc(stageKey(key));
  let staged: any = (await stageRef.get()).data();
  const startSearches = ledger.searches;
  // A pack build already under way carries on; anything else staged is replaced.
  if (!staged?.packBuild) {
    if (staged) await discard(key);
    const o = await packOutline(game, opts.layout, opts.note);
    if (!o.pages.length) return { line: 'Gate: failed (nothing was built: no page list from searched sources); queued for review: rebuild careful.', done: true };
    staged = {
      game, title: `${game} guide`, stagingFor: key, layout: o.layout, repair: 'careful', createdAt: Date.now(),
      areas: o.pages.map((x) => ({ slug: x.slug, name: x.name, story: x.story })),
      packBuild: { done: [], failed: [], scores: {} },
    };
    await stageRef.set(staged);
    for (const [i, x] of o.pages.entries()) await stageRef.collection('areas').doc(x.slug).set({ name: x.name, slug: x.slug, story: x.story, order: i, overview: '', items: [], secrets: [], enemies: [], shops: [], tips: [], sources: [], status: 'draft', verified: true, checks: { claims: 0, supported: 0, rejected: 0, singleSource: 0 }, updatedAt: Date.now() });
    console.log(`  outline (${o.layout}): ${o.pages.map((x) => x.name).join('; ')}`);
  }
  const pb = staged.packBuild;
  const order: { slug: string; name: string }[] = staged.areas || [];
  for (const o of order) {
    if (pb.done.includes(o.slug) || pb.failed.some((f: any) => f.slug === o.slug)) continue;
    if (ledger.searches - startSearches + CAREFUL_PAGE_SEARCHES > opts.maxSearches) {
      await stageRef.set({ packBuild: pb }, { merge: true });
      return { line: `Repair: ${order.length - pb.done.length - pb.failed.length} page(s) left at the search cap; the careful build continues on the next run.`, done: false };
    }
    try {
      // The page's facts first (its pack), seeding its items, secrets and overview; then the flagship writing, checks
      // and the capped Pro review.
      const sp = await sourcePack(key, o.slug, { from: stageKey(key), game });
      if (sp) {
        const k = sp.pack;
        await stageRef.collection('areas').doc(o.slug).set(JSON.parse(JSON.stringify({
          overview: cut(k.summary || '', 600),
          items: (k.items || []).slice(0, 20).map((x, i) => ({ ...parseItem([cut(x.name, 100), cut(x.where, 300), cut(x.how || '', 300), x.missable ? cut(x.lockout || 'missable', 300) : ''], `p${i + 1}`, [sp.wiki]), name: cut(x.name, 100) })),
          secrets: (k.secrets || []).slice(0, 10).map((x, i) => ({ id: `ps${i + 1}`, text: cut(x.text, 400), sources: [sp.wiki] })),
        })), { merge: true });
      }
      const r = await buildPage(key, game, o.slug, order, stageKey(key), { pack: true, protoId: `${key}__${o.slug}__careful` });
      if (r.verdict.status === 'passed') {
        await writePage(stageKey(key), o.slug, r.proto);
        pb.done.push(o.slug);
        if (r.verdict.score !== undefined) pb.scores[o.slug] = r.verdict.score;
      } else if (r.verdict.status === 'failed') {
        pb.failed.push({ slug: o.slug, name: o.name, reason: r.verdict.reason || 'failed review' });
        await stageRef.collection('areas').doc(o.slug).set({ status: 'held', heldReason: `review: ${r.verdict.reason || 'failed'}` }, { merge: true });
      }
    } catch (e: any) {
      console.log(`  ${o.name}: not built (${cut(e?.message || e, 160)})`);
      pb.failed.push({ slug: o.slug, name: o.name, reason: `not built: ${cut(e?.message || e, 100)}` });
      await stageRef.collection('areas').doc(o.slug).set({ status: 'held', heldReason: 'not built' }, { merge: true });
    }
    await stageRef.set({ packBuild: pb }, { merge: true });
  }
  // Every page has a verdict: the gate.
  const scores = Object.values(pb.scores as Record<string, number>);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const passedN = pb.done.length, total = order.length;
  if (passedN >= Math.min(MIN_PAGES, total) && passedN > 0) {
    const pr = await promote(stageKey(key));
    return { line: `Gate: passed (${passedN} of ${total} pages passed the Pro review, average score ${avg}); promoted, ${pr?.published || 0} page(s) live${pb.failed.length ? `, ${pb.failed.length} held back` : ''}.`, done: true, score: avg };
  }
  const review: Review = {
    score: avg, pass: false, recommendation: 'rebuild careful', summary: `Careful build on the source-pack method: only ${passedN} of ${total} pages passed the Pro review.`,
    layout: staged.layout || 'area', structure: { kind: staged.layout || 'area', consistent: true, problems: [] }, coverage: { expectedPages: String(total), ok: false, problems: [`Only ${passedN} of ${total} pages passed review.`] },
    depth: { problems: [] }, knowledge: { problems: pb.failed.slice(0, 6).map((f: any) => `${f.name}: ${f.reason}`) }, ordering: { ok: true, problems: [] },
    pages: pb.failed.slice(0, 15).map((f: any) => ({ name: f.name, verdict: 'failed review', reason: f.reason })),
    newerThanReviewer: !!opts.newRelease, released: '', buildMode: 'careful', pageCount: total, model: 'pro', tier: 'pro', passMark: 75, at: Date.now(),
  };
  await queueForReview(stageKey(key), game, review, true);
  return { line: `Gate: failed (${avg}, only ${passedN} of ${total} pages passed the Pro review); queued for review: rebuild careful.`, done: true, score: avg };
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
  // --score-only: the Pro review's score for pages as they are live (nothing saved), for comparing methods.
  if (arg('score-only') === 'true') {
    for (const slug of pages) {
      const scope = { dollars: 0, searches: 0 };
      const v = await usageScope.run(scope, () => scoreOnly(key, String(info.game || key), slug, info.areas || []));
      console.log(`${slug}: ${v ? `score ${v.score ?? '?'}, ${v.status}${v.reason ? ` (${v.reason})` : ''}` : 'no flagship content'}, $${scope.dollars.toFixed(3)}`);
    }
    return setTimeout(() => process.exit(0), 500);
  }
  // --pack: written from the wiki's source pack, staging only (guidePrototypes), nothing goes live.
  const packMode = arg('pack') === 'true';
  const lk = await acquireGuideLock(key, 'flagship pages');
  if (isRefusal(lk)) {
    console.log(lockedLine(lk, String(info.game || key)));
    return setTimeout(() => process.exit(0), 500);
  }
  let total = { searches: 0, dollars: 0 };
  for (const slug of pages) {
    const scope = { dollars: 0, searches: 0 };
    const s = await usageScope.run(scope, () => buildPage(key, String(info.game || key), slug, info.areas || [], key, { pack: packMode, ...(packMode ? { protoId: `${key}__${slug}__pack` } : {}) }));
    console.log(`  => ${slug}: ${s.verdict.status}${s.verdict.score !== undefined ? `, score ${s.verdict.score}` : ''}, ${scope.searches} searches, $${scope.dollars.toFixed(3)}`);
    total = { searches: total.searches + scope.searches, dollars: total.dollars + scope.dollars };
  }
  console.log(`\nDone: ${pages.length} flagship page(s) in staging (guidePrototypes), ${total.searches} searches used, cost ≈ $${total.dollars.toFixed(3)}.`);
  await lk.release();
  setTimeout(() => process.exit(0), 500);
}

// Run as a script only (repair.ts imports packBuildGuide from here).
if (/flagship\.ts$/.test(process.argv[1] || '')) main().catch(async (e) => {
  console.error('flagship failed:', e?.message || e);
  await releaseGuideLocks();
  process.exit(1);
});
