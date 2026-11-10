/**
 * Settle the facts the sources contradict (owner, Nov 10 2026): a one-off run from its own fund, system/disputeFund,
 * separate from the pipeline's monthly budget. The verify step (recordsVerify.ts) only marks a fact as disputed; this
 * corrects the guide itself, through the same staged copy, final review and rollback history as player corrections.
 *
 *   small difference, real and here        corrected with the sources' wording ("correct")
 *   real item in the wrong place           keeps its checklist row, with the corrected location ("relocate")
 *   doesn't exist, or isn't here/sold here removed ("remove")
 *   the sources back the guide after all   left as it was, counted as checked ("keep")
 *   fewer than two outside sites agree     stays disputed, and out of answers ("unsettled")
 *
 * Walkthrough text and overviews that name a settled fact get just that wording changed. Forums, videos and our own site
 * can't count towards the two sites. Every number and name in new text must be in the evidence it cites (or the old text),
 * a second model reviews each change against that evidence, and an entry the owner edited by hand is never touched.
 *
 * Phases (each resumes where it stopped): recheck the facts that leaned only on our own site, decide each page (most
 * searched first), apply per guide, then re-import the records, sync the translations and report.
 *
 *   PIPELINE_STEP_DOLLARS=10 npx tsx scripts/guides/disputeSettle.ts [--only KEY[,KEY]] [--pages N] [--decide-only] [--dry-run]
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledger, ledgerDollars, searchesIn, stageKey } from './common';
import { claimCheck, claimSlots, supportedSegments, trusted, type Evidence, type EvidencePack } from './claimCheck';
import { RECORDS, importRecords } from './recordsImport';
import { contentSig, type GameRecord } from './records';
import { claimPageOf } from './recordsVerify';
import { stageCopy, discard } from './promote';
import { gateGuide } from './review';
import { scopedReview } from './scopedGate';
import { withGuideLock, lockedLine } from './guideLock';
import { FLASH_REVIEW_MODEL } from './reviewerQuota';

const OWN = /quest\s*compendium/i;
const FUND = () => db().collection('system').doc('disputeFund');
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^a-z0-9'"%+-]+/g, ' ').trim();
const numbersIn = (s: string): string[] => [...(s.match(/\d+/g) || [])];
const namesIn = (s: string): string[] => [...s.matchAll(/(?<![.!?:;]\s|^)\b[A-Z][a-z'’]{3,}\b/g)].map((m) => m[0]);
const f = (r: GameRecord, k: string) => { const v = r.fields?.[k]; return Array.isArray(v) ? v.join('; ') : String(v || ''); };
const textOf = (r: GameRecord) => String(r.prose?.text || f(r, 'text') || r.name || '');
const shortName = (r: GameRecord) => String(r.name || '').replace(/…$/, '').split(/[|,(:]/)[0].trim().toLowerCase();

const FIELDS: Record<string, string[]> = { item: ['where', 'how', 'lockout'], secret: ['text'], checklist: ['text'], tip: ['text'], enemy: ['weakness', 'steal', 'notes'], shop: ['sells'], boss: ['enemies', 'threats', 'weaknesses', 'tactics', 'rewards'] };
const LIST: Record<string, string> = { item: 'items', secret: 'secrets', enemy: 'enemies', shop: 'shops', boss: 'fights' };
const OUTCOMES = ['correct', 'relocate', 'remove', 'keep', 'unsettled'] as const;
type Outcome = (typeof OUTCOMES)[number];
type Decision = { id: string; outcome: Outcome; fields?: Record<string, string>; sites?: string[]; why?: string; before?: Record<string, string>; name?: string; type?: string; final?: Outcome };
type ProseEdit = { fact: string; step: string; field: string; find: string; replace: string };
type Settled = { at: number; dollars: number; decisions: Record<string, Decision>; prose: ProseEdit[]; applied?: boolean };
type Page = { key: string; game: string; slug: string; place: string; recs: GameRecord[]; facts: GameRecord[]; impressions: number; area: any };

/** The entry a record came from, in the guide's own data. */
function entryOf(a: any, r: GameRecord): any {
  const id = String(r.origin?.entry ?? '');
  if (r.type === 'tip') { const t = (a.tips || [])[Number(id.replace(/^tip/, ''))]; return t === undefined ? null : { text: t }; }
  if (r.type === 'checklist') { for (const s of a.sections || []) { const e = (s.entries || []).find((x: any) => String(x.id) === id); if (e) return e; } return null; }
  return (a[LIST[r.type]] || []).find((e: any) => String(e.id) === id) || null;
}
/** What the record says differs from the guide's data: the owner's edit (or an automatic one) is laid over it. Never touched. */
function editedByHand(a: any, r: GameRecord): boolean {
  const e = entryOf(a, r);
  if (!e) return true;
  return (FIELDS[r.type] || []).some((k) => { const rec = k === 'text' ? textOf(r) : f(r, k); return norm(String(e[k] ?? '')) !== norm(rec) && !(k === 'text' && r.type !== 'tip' && !e[k]); });
}

/** Facts marked checked whose only support may have been a line from our own site: checked again without it (no searches). */
async function recheckOwnSite(keys: string[]): Promise<{ rechecked: number; stillChecked: number; unconfirmed: number; disputed: number }> {
  const t = { rechecked: 0, stillChecked: 0, unconfirmed: 0, disputed: 0 };
  for (const key of keys) {
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
    for (const v of (await RECORDS().doc(key).collection('verified').get()).docs) {
      const data: any = v.data();
      if (data.ownSiteRechecked) continue;
      const pack = ((await db().collection('evidencePacks').doc(`${key}__${v.id}`).get()).data() as EvidencePack | undefined);
      const own = (pack?.evidence || []).filter((e) => (e.sources || []).length && e.sources.every((s) => OWN.test(s))).map((e) => e.text.toLowerCase());
      if (!pack || !own.length) continue;
      const ids = Object.entries<any>(data.results || {}).filter(([, x]) => x.status === 'checked').map(([id]) => id);
      const recs: GameRecord[] = [];
      for (const id of ids) {
        const r = (await RECORDS().doc(key).collection('records').doc(id).get()).data() as GameRecord | undefined;
        const n = r ? shortName(r) : '';
        if (r && n.length >= 4 && own.some((x) => x.includes(n))) recs.push(r);
      }
      if (!recs.length) continue;
      const { page, owner } = claimPageOf(recs);
      const verdicts = await claimCheck(game, recs[0].placeName || v.id, claimSlots(page), trusted(pack));
      const results = { ...data.results };
      for (const r of recs) {
        const mine = verdicts.filter((x) => owner.get(x.label) === r.id && x.verdict !== 'general');
        const bad = mine.find((x) => x.verdict === 'contradicted');
        const ok = mine.length > 0 && mine.every((x) => x.verdict === 'supported');
        const status = bad ? 'disputed' : ok ? 'checked' : 'unconfirmed';
        results[r.id] = { sig: contentSig(r), status, ...(bad?.fix ? { fix: bad.fix } : {}), claims: mine.length, supported: mine.filter((x) => x.verdict === 'supported').length };
        t.rechecked++;
        if (status === 'checked') t.stillChecked++; else if (status === 'disputed') t.disputed++; else t.unconfirmed++;
      }
      await v.ref.set({ results, ownSiteRechecked: Date.now() }, { merge: true });
      console.log(`recheck ${key}/${v.id}: ${recs.length} fact(s)`);
    }
  }
  return t;
}

const outsideOf = (lines: Evidence[]) => [...new Set(lines.flatMap((e) => e.sources || []))];
const linesFor = (p: EvidencePack, r: GameRecord) => { const n = shortName(r).slice(0, 40); return n.length >= 4 ? p.evidence.filter((e) => e.text.toLowerCase().includes(n)) : []; };

/** One searched call about this page's disputed facts, added to its evidence pack. */
async function research(p: Page, pack: EvidencePack): Promise<EvidencePack> {
  const facts = p.facts.slice(0, 20);
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `In the video game "${p.game}", the place "${p.place}": a guide says the things below, and another source disagreed. Find out what the game's wikis and detailed guides say. Run a few searches (at most four).`,
      'One line per thing, starting with its exact name and a colon. Say what the sources say: where it really is, what it really does or sells or drops. If the sources say it does not exist in this game, or is not in this place, say so plainly.',
      'Only what the sources say. Leave a thing out if the sources do not cover it.',
      '',
      ...facts.map((r) => `- ${cut(r.type === 'tip' || r.type === 'secret' || r.type === 'checklist' ? textOf(r) : r.name, 160)}${r.type === 'tip' || r.type === 'secret' || r.type === 'checklist' ? '' : ` (the guide says: ${cut(Object.values(r.fields || {}).join('; '), 160)})`}`),
    ].join('\n') }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const evidence: Evidence[] = [...(pack.evidence || [])];
  const sites = new Set<string>(pack.sites || []);
  for (const seg of supportedSegments(res)) {
    if (evidence.some((e) => e.text === seg.text)) continue;
    evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: 'disputes' });
    seg.sites.forEach((s) => sites.add(s));
  }
  const next: EvidencePack = { ...pack, evidence, sites: [...sites], searches: (pack.searches || 0) + searchesIn(res), at: Date.now() };
  await db().collection('evidencePacks').doc(`${p.key}__${p.slug}`).set(JSON.parse(JSON.stringify(next)));
  return next;
}

const describe = (r: GameRecord) => ({ id: r.id, type: r.type, name: cut(r.name, 100), says: Object.fromEntries((FIELDS[r.type] || []).map((k) => [k, cut(k === 'text' ? textOf(r) : f(r, k), 400)]).filter(([, v]) => v)), disputedBecause: cut((r as any).dispute, 300) });
/** The walkthrough steps and overview that name one of these facts. */
function proseNaming(p: Page): { id: string; field: string; text: string }[] {
  const out: { id: string; field: string; text: string }[] = [];
  const names = p.facts.map(shortName).filter((n) => n.length >= 4);
  const hit = (t: string) => names.some((n) => t.toLowerCase().includes(n));
  if (hit(String(p.area.overview || ''))) out.push({ id: 'overview', field: 'text', text: cut(p.area.overview, 1200) });
  for (const s of p.area.walkthrough || []) for (const field of ['text', 'tip', 'warn']) if (s[field] && hit(String(s[field]))) out.push({ id: String(s.id), field, text: String(s[field]) });
  return out.slice(0, 12);
}

function decidePrompt(p: Page, ev: Evidence[], prose: ReturnType<typeof proseNaming>): string {
  return [
    `A guide to the video game "${p.game}", page "${p.place}", states the FACTS below, and another check disagreed with them. Settle each one from the EVIDENCE only, never from your own knowledge.`,
    'Reply with JSON only: {"facts": [{"id": "fact id", "outcome": "correct|relocate|remove|keep|unsettled", "fields": {"field": "new text"}, "evidence": ["e12", "e14"], "why": "a few words"}], "prose": [{"fact": "fact id", "step": "step id or overview", "field": "text|tip|warn", "find": "the exact words to change, copied character for character", "replace": "the new words, or empty to delete them"}]}',
    '',
    'correct: the thing is real and is here, but a detail is off. Give only the fields that change, using the sources\' wording, and keep every detail that was right.',
    'relocate: a real item that is somewhere else, even in another area. Give "where": the real location, naming the place and starting from something the player can find on the map. Items only.',
    'remove: the sources say it does not exist in this game; or an enemy, boss, secret, tip or shop that is not in this place, or a "shop" that sells nothing.',
    'keep: the evidence actually backs what the guide says.',
    'unsettled: the evidence does not settle it. Use this rather than guessing.',
    'Cite in "evidence" the lines that say it. Never add a name or number the cited lines do not contain.',
    'prose: for walkthrough text that states the same wrong thing, change only the words that are wrong. Leave text alone if it merely mentions the name correctly.',
    '',
    `FACTS: ${JSON.stringify(p.facts.map(describe))}`,
    '',
    `WALKTHROUGH TEXT THAT NAMES THEM: ${JSON.stringify(prose)}`,
    '',
    'EVIDENCE:',
    ...ev.map((e) => `${e.id} [${e.sources.join(', ')}] ${e.text}`),
  ].join('\n');
}

/** Second opinion on each proposed change, against the cited evidence only. */
async function reviewChanges(p: Page, ev: Evidence[], ds: Decision[], prose: ProseEdit[]): Promise<{ facts: Set<string>; prose: Set<number> }> {
  const lines = (d: Decision) => d.sites;
  void lines;
  const res: any = await gemini().models.generateContent({
    model: FLASH_REVIEW_MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `You check corrections to a guide to "${p.game}" (page "${p.place}") before players see them. Judge each one against the EVIDENCE only.`,
      'Approve only if the evidence clearly says what the change says, and the change does not lose a correct detail. "remove" needs evidence that the thing does not exist or is not in this place. "keep" needs evidence backing the old text.',
      'Reply with JSON only: {"facts": [{"id": "...", "ok": true}], "prose": [{"n": 1, "ok": true}]}',
      '',
      `CHANGES: ${JSON.stringify(ds.map((d) => ({ id: d.id, name: d.name, outcome: d.outcome, was: d.before, now: d.fields })))}`,
      `TEXT CHANGES: ${JSON.stringify(prose.map((x, i) => ({ n: i + 1, find: x.find, replace: x.replace })))}`,
      '',
      'EVIDENCE:',
      ...ev.map((e) => `${e.id} [${e.sources.join(', ')}] ${e.text}`),
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 3000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let j: any = {};
  try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { j = {}; }
  return {
    facts: new Set((Array.isArray(j.facts) ? j.facts : []).filter((x: any) => x?.ok === true).map((x: any) => String(x.id))),
    prose: new Set((Array.isArray(j.prose) ? j.prose : []).filter((x: any) => x?.ok === true).map((x: any) => Number(x.n) - 1)),
  };
}

async function decidePage(p: Page, searchAllowed: boolean): Promise<Settled> {
  const before = ledgerDollars();
  const ref = db().collection('evidencePacks').doc(`${p.key}__${p.slug}`);
  let pack = ((await ref.get()).data() as EvidencePack | undefined) || { key: p.key, slug: p.slug, game: p.game, area: p.place, evidence: [], sites: [], servicesComplete: false, searches: 0, at: 0 };
  const thin = p.facts.some((r) => outsideOf(linesFor(trusted(pack), r)).length < 2);
  if (thin && searchAllowed) pack = await research(p, pack);
  const clean = trusted(pack);
  // Lines about these facts first (the newest research included), then a cap: what's cited is what's checked.
  const wanted = clean.evidence.filter((e) => e.topic === 'disputes' || p.facts.some((r) => linesFor({ ...clean, evidence: [e] }, r).length));
  const ev = wanted.slice(-70);
  const prose = proseNaming(p);
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: decidePrompt(p, ev, prose) }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let j: any = {};
  try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { j = {}; }
  const byEv = new Map(ev.map((e) => [e.id, e]));
  const decisions: Record<string, Decision> = {};
  const byId = new Map(p.facts.map((r) => [r.id, r]));
  const unsettled = (r: GameRecord, why: string): Decision => ({ id: r.id, name: cut(r.name, 100), type: r.type, outcome: 'unsettled', why });
  const proposed: Decision[] = [];
  const supportOf = new Map<string, string>();
  for (const x of Array.isArray(j.facts) ? j.facts : []) {
    const r = byId.get(String(x?.id));
    if (!r) continue;
    const outcome = OUTCOMES.includes(x?.outcome) ? (x.outcome as Outcome) : 'unsettled';
    if (outcome === 'unsettled') { decisions[r.id] = unsettled(r, cut(x?.why, 120) || 'the evidence does not settle it'); continue; }
    const cited = (Array.isArray(x.evidence) ? x.evidence : []).map((id: any) => byEv.get(String(id))).filter(Boolean) as Evidence[];
    const sites = outsideOf(cited);
    if (sites.length < 2) { decisions[r.id] = unsettled(r, `only ${sites.length} outside site(s) agree`); continue; }
    if (outcome === 'relocate' && r.type !== 'item') { decisions[r.id] = unsettled(r, 'only items can be relocated'); continue; }
    if (outcome === 'remove' && r.missable && r.type === 'item' && sites.length < 2) { decisions[r.id] = unsettled(r, 'a missable needs two sites to remove'); continue; }
    const allowed = FIELDS[r.type] || [];
    const fields = Object.fromEntries(Object.entries<any>(x.fields || {}).filter(([k, v]) => allowed.includes(k) && cut(v, 700)).map(([k, v]) => [k, cut(v, 700)]));
    if ((outcome === 'correct' || outcome === 'relocate') && !Object.keys(fields).length) { decisions[r.id] = unsettled(r, 'no corrected wording was given'); continue; }
    const old = (FIELDS[r.type] || []).map((k) => (k === 'text' ? textOf(r) : f(r, k))).join(' ');
    const hay = `${cited.map((e) => e.text).join(' ')} ${old} ${r.name} ${p.place} ${p.game}`;
    const text = Object.values(fields).join(' ');
    if (!numbersIn(text).every((n) => numbersIn(hay).includes(n))) { decisions[r.id] = unsettled(r, 'a number is not in the evidence'); continue; }
    if (!namesIn(text).every((w) => norm(hay).includes(norm(w)))) { decisions[r.id] = unsettled(r, 'a name is not in the evidence'); continue; }
    supportOf.set(r.id, hay);
    proposed.push({ id: r.id, name: cut(r.name, 100), type: r.type, outcome, fields, sites: sites.slice(0, 6), why: cut(x?.why, 160), before: Object.fromEntries((FIELDS[r.type] || []).map((k) => [k, cut(k === 'text' ? textOf(r) : f(r, k), 500)]).filter(([, v]) => v)) });
  }
  const proseText = (step: string, field: string) => (step === 'overview' ? String(p.area.overview || '') : String((p.area.walkthrough || []).find((s: any) => String(s.id) === step)?.[field] || ''));
  const edits: ProseEdit[] = (Array.isArray(j.prose) ? j.prose : []).map((x: any) => ({ fact: String(x?.fact || ''), step: String(x?.step || ''), field: String(x?.field || 'text'), find: String(x?.find || ''), replace: String(x?.replace || '') }))
    .filter((x: ProseEdit) => x.find.length >= 6 && proseText(x.step, x.field).includes(x.find) && proposed.some((d) => d.id === x.fact && d.outcome !== 'keep'))
    .filter((x: ProseEdit) => { const hay = `${supportOf.get(x.fact) || ''} ${x.find}`; return numbersIn(x.replace).every((n) => numbersIn(hay).includes(n)) && namesIn(x.replace).every((w) => norm(hay).includes(norm(w))); });
  let approved = { facts: new Set<string>(), prose: new Set<number>() };
  if (proposed.length) approved = await reviewChanges(p, ev, proposed, edits);
  for (const d of proposed) decisions[d.id] = approved.facts.has(d.id) ? d : unsettled(byId.get(d.id)!, 'the second check did not approve it');
  for (const r of p.facts) if (!decisions[r.id]) decisions[r.id] = unsettled(r, 'no decision was returned');
  const prosePass = edits.filter((x, i) => approved.prose.has(i) && decisions[x.fact]?.outcome !== 'unsettled');
  return { at: Date.now(), dollars: Math.round((ledgerDollars() - before) * 10000) / 10000, decisions, prose: prosePass };
}

/** Everything still disputed, page by page, most searched first. */
async function loadPages(keys: string[]): Promise<Page[]> {
  const pages: Page[] = [];
  for (const key of keys) {
    const disputed = (await RECORDS().doc(key).collection('records').where('status', '==', 'disputed').get()).docs.map((d) => d.data() as GameRecord).filter((r) => r.origin?.from === 'area' && r.place && FIELDS[r.type]);
    if (!disputed.length) continue;
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
    const byPlace = new Map<string, GameRecord[]>();
    disputed.forEach((r) => byPlace.set(r.place!, [...(byPlace.get(r.place!) || []), r]));
    for (const [slug, recs] of byPlace) {
      const area: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
      if (!area || area.status !== 'published') continue;
      pages.push({ key, game, slug, place: recs[0].placeName || slug, recs, facts: recs.filter((r) => !editedByHand(area, r)), impressions: recs[0].impressions || 0, area });
    }
  }
  return pages.sort((a, b) => b.impressions - a.impressions);
}

/** Write one guide's decisions into a staged copy, then the final review. */
async function applyGuide(key: string, game: string, list: { slug: string; s: Settled }[]): Promise<string> {
  const r = await withGuideLock(key, 'settling disputed facts', async () => {
    const staged: any = (await db().collection('guides').doc(stageKey(key)).get()).data();
    if (staged && staged.repair !== 'correction') return 'skipped: another rebuild of this guide is staged';
    await discard(key);
    await stageCopy(key);
    const stageRef = db().collection('guides').doc(stageKey(key));
    await stageRef.set({ repair: 'correction' }, { merge: true });
    const removals = new Set<string>();
    const now = Date.now();
    for (const { slug, s } of list) {
      const ref = stageRef.collection('areas').doc(slug);
      const page: any = (await ref.get()).data();
      if (!page) continue;
      const recs = new Map((await RECORDS().doc(key).collection('records').where('place', '==', slug).get()).docs.map((d) => [d.id, d.data() as GameRecord]));
      const patch: any = {};
      const dropTips = new Set<number>();
      const tips = [...(page.tips || [])];
      for (const d of Object.values(s.decisions)) {
        if (d.outcome === 'unsettled' || d.outcome === 'keep') continue;
        const r = recs.get(d.id);
        if (!r) continue;
        const entry = String(r.origin?.entry ?? '');
        const stamp = { sources: d.sites || [], checked: true, updatedFrom: 'source check', reportUpdatedAt: now };
        if (r.type === 'tip') {
          const i = Number(entry.replace(/^tip/, ''));
          if (d.outcome === 'remove') { dropTips.add(i); removals.add(`${slug}|tip${i}`); } else if (d.fields?.text) tips[i] = d.fields.text;
          patch.tips = tips;
          continue;
        }
        const edit = (l: any[]) => (l || []).flatMap((e: any) => {
          if (String(e.id) !== entry) return [e];
          if (d.outcome === 'remove') { removals.add(`${slug}|${entry}`); return []; }
          const { unconfirmed: _u, ...rest } = e;
          return [{ ...rest, ...d.fields, ...stamp }];
        });
        if (r.type === 'checklist') patch.sections = (patch.sections || page.sections || []).map((x: any) => ({ ...x, entries: edit(x.entries) }));
        else patch[LIST[r.type]] = edit(patch[LIST[r.type]] || page[LIST[r.type]]);
      }
      if (dropTips.size) patch.tips = tips.filter((_t, i) => !dropTips.has(i));
      const steps = (page.walkthrough || []).map((x: any) => ({ ...x, ...(x.entries ? { entries: x.entries.filter((id: any) => !removals.has(`${slug}|${id}`)) } : {}), ...(x.fights ? { fights: x.fights.filter((id: any) => !removals.has(`${slug}|${id}`)) } : {}) }));
      let overview = page.overview;
      const tidy = (t: string) => t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
      for (const e of s.prose || []) {
        if (e.step === 'overview') { if (String(overview || '').includes(e.find)) overview = tidy(String(overview).replace(e.find, e.replace)); continue; }
        const st = steps.find((x: any) => String(x.id) === e.step);
        if (st && String(st[e.field] || '').includes(e.find)) st[e.field] = tidy(String(st[e.field]).replace(e.find, e.replace));
      }
      if (page.walkthrough) patch.walkthrough = steps;
      if (overview !== page.overview) patch.overview = overview;
      if (Object.keys(patch).length) await ref.update({ ...patch, updatedAt: now });
    }
    const v = await scopedReview(key, game, 'disputes', 'flash', { removals });
    return v.changes || removals.size ? gateGuide(stageKey(key), game, v.review) : 'Gate: nothing to review.';
  });
  return 'refusal' in r ? lockedLine(r.refusal, game) : r.value;
}

/** What actually went live: the decision stands only if the guide now says it (the final review can take a change out). */
function outcomeLive(a: any, r: GameRecord | undefined, d: Decision): Outcome {
  if (d.outcome === 'unsettled' || d.outcome === 'keep') return d.outcome;
  if (!r) return d.outcome === 'remove' ? 'remove' : 'unsettled';
  const entry = String(r.origin?.entry ?? '');
  if (r.type === 'tip') {
    const has = (t: string) => (a.tips || []).some((x: string) => norm(x) === norm(t));
    return d.outcome === 'remove' ? (has(textOf(r)) ? 'unsettled' : 'remove') : d.fields?.text && has(d.fields.text) ? d.outcome : 'unsettled';
  }
  const lists = r.type === 'checklist' ? (a.sections || []).flatMap((x: any) => x.entries || []) : a[LIST[r.type]] || [];
  const e = lists.find((x: any) => String(x.id) === entry);
  if (d.outcome === 'remove') return e ? 'unsettled' : 'remove';
  return e && Object.entries(d.fields || {}).every(([k, v]) => norm(String(e[k] ?? '')) === norm(v)) ? d.outcome : 'unsettled';
}

async function main() {
  const limit = Number(process.env.PIPELINE_STEP_DOLLARS || 0);
  if (!limit) throw new Error('PIPELINE_STEP_DOLLARS is required: this run has a hard stop');
  const dry = process.argv.includes('--dry-run');
  const decideOnly = process.argv.includes('--decide-only');
  const maxPages = Number(arg('pages', '0')) || 0;
  const keys = String(arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const all = keys.length ? keys : (((await db().collection('config').doc('factPages').get()).data() as any)?.guides as string[]);
  const fund: any = (await FUND().get()).data() || { budget: 10, spent: 0 };
  const earlier = Number(fund.spent || 0);
  const reserve = 1.5; // the final reviews and the translations, after the decisions.
  console.log(`Fund: $${earlier.toFixed(2)} of $${Number(fund.budget || 10).toFixed(2)} spent before this run; this run may spend $${limit.toFixed(2)}.`);

  if (!dry && !fund.recheckDone) {
    const t = await recheckOwnSite(all);
    console.log(`Own-site recheck: ${t.rechecked} fact(s), ${t.stillChecked} still checked, ${t.unconfirmed} unconfirmed, ${t.disputed} disputed.`);
    await FUND().set({ budget: 10, recheckDone: Date.now(), recheck: t }, { merge: true });
    if (t.rechecked) for (const key of all) await importRecords({ only: key });
  }

  const pages = await loadPages(all);
  const skippedByHand = pages.reduce((n, p) => n + p.recs.length - p.facts.length, 0);
  console.log(`${pages.reduce((n, p) => n + p.facts.length, 0)} disputed fact(s) on ${pages.length} page(s); ${skippedByHand} edited by hand and left alone.`);
  const done = new Map<string, Settled>();
  for (const key of new Set(pages.map((p) => p.key))) for (const d of (await RECORDS().doc(key).collection('settled').get()).docs) done.set(`${key}/${d.id}`, d.data() as Settled);
  const todo = pages.filter((p) => p.facts.length && !done.has(`${p.key}/${p.slug}`)).slice(0, maxPages || undefined);
  if (dry) { console.log(`Would decide ${todo.length} page(s).`); process.exit(0); }
  let searchAllowed = true, capped = false;
  for (let i = 0; i < todo.length && !capped; i += 4) {
    if (ledgerDollars() >= limit - reserve) { console.log(`Stopped deciding at $${ledgerDollars().toFixed(2)}, keeping $${reserve.toFixed(2)} for the final reviews and translations.`); break; }
    await Promise.all(todo.slice(i, i + 4).map(async (p) => {
      try {
        const s = await decidePage(p, searchAllowed);
        await RECORDS().doc(p.key).collection('settled').doc(p.slug).set(JSON.parse(JSON.stringify(s)));
        done.set(`${p.key}/${p.slug}`, s);
        const c = (o: Outcome) => Object.values(s.decisions).filter((d) => d.outcome === o).length;
        console.log(`${p.key}/${p.slug}: corrected ${c('correct')}, relocated ${c('relocate')}, removed ${c('remove')}, kept ${c('keep')}, unsettled ${c('unsettled')}; ${s.prose.length} text edit(s); $${s.dollars.toFixed(4)}`);
      } catch (e: any) {
        console.warn(`${p.key}/${p.slug} skipped: ${e?.message}`);
        if (/spending cap/.test(String(e?.message))) capped = true;
        if (/search/i.test(String(e?.name)) || /SearchDayWait/.test(String(e?.constructor?.name))) searchAllowed = false;
      }
    }));
  }
  console.log(`Decisions done: $${ledgerDollars().toFixed(4)} so far (${ledger.searches} searches).`);
  await FUND().set({ budget: 10, spent: earlier + ledgerDollars(), at: Date.now() }, { merge: true });
  if (decideOnly) { setTimeout(() => process.exit(0), 300); return; }

  // Apply, guide by guide.
  const lines: string[] = [];
  const touched = new Set<string>();
  for (const key of new Set(pages.map((p) => p.key))) {
    const list = pages.filter((p) => p.key === key).map((p) => ({ slug: p.slug, s: done.get(`${key}/${p.slug}`)! })).filter((x) => x.s && !x.s.applied && Object.values(x.s.decisions).some((d) => ['correct', 'relocate', 'remove'].includes(d.outcome)));
    if (!list.length) continue;
    const game = pages.find((p) => p.key === key)!.game;
    try {
      const line = await applyGuide(key, game, list);
      lines.push(`${key}: ${line}`);
      console.log(`${key}: ${line}`);
      touched.add(key);
      for (const { slug, s } of list) await RECORDS().doc(key).collection('settled').doc(slug).set({ ...JSON.parse(JSON.stringify(s)), applied: true, gate: line.slice(0, 300) });
    } catch (e: any) {
      console.warn(`${key} not applied: ${e?.message}`);
    }
  }

  // The records, and what really went live.
  const counts: Record<string, number> = { correct: 0, relocate: 0, remove: 0, keep: 0, unsettled: 0 };
  for (const key of new Set(pages.map((p) => p.key))) {
    const before = new Map<string, GameRecord>(pages.filter((p) => p.key === key).flatMap((p) => p.recs.map((r) => [r.id, r] as [string, GameRecord])));
    await importRecords({ only: key });
    for (const p of pages.filter((x) => x.key === key)) {
      const s = done.get(`${key}/${p.slug}`);
      if (!s) { for (const _r of p.facts) counts.unsettled++; continue; }
      const live: any = (await db().collection('guides').doc(key).collection('areas').doc(p.slug).get()).data() || {};
      const now = new Map((await RECORDS().doc(key).collection('records').where('place', '==', p.slug).get()).docs.map((d) => [d.id, d.data() as GameRecord]));
      const results: Record<string, any> = {};
      for (const d of Object.values(s.decisions)) {
        if (d.final) { counts[d.final]++; continue; } // settled by an earlier run
        const was = before.get(d.id);
        d.final = outcomeLive(live, was, d);
        counts[d.final]++;
        if (d.final === 'keep' && was) results[d.id] = { sig: contentSig(was), status: 'checked', claims: 1, supported: 1, settled: true };
        if (d.final === 'correct' || d.final === 'relocate') {
          const r = [...now.values()].find((x) => was && x.type === was.type && String(x.origin?.entry) === String(was.origin?.entry) && x.origin?.from === 'area');
          if (r) results[r.id] = { sig: contentSig(r), status: 'checked', claims: 1, supported: 1, settled: true };
        }
      }
      await RECORDS().doc(key).collection('settled').doc(p.slug).set(JSON.parse(JSON.stringify(s)));
      if (Object.keys(results).length) {
        const ref = RECORDS().doc(key).collection('verified').doc(p.slug);
        const cur: any = (await ref.get()).data() || {};
        await ref.set({ at: Date.now(), results: { ...(cur.results || {}), ...results } }, { merge: true });
      }
    }
    await importRecords({ only: key });
  }

  // Translations: the changed pages, from this fund, so the pipeline's budget isn't charged.
  const left = () => limit - ledgerDollars();
  let translateDollars = 0;
  for (const key of touched) {
    const ref = db().collection('guides').doc(key);
    const info: any = (await ref.get()).data() || {};
    if (!info.translationsDue || !(info.languages || []).length) continue;
    const room = left() - translateDollars - 0.05;
    if (room < 0.1) { console.log(`Translations for ${key} left for the pipeline's sync: the fund is used.`); continue; }
    const r = spawnSync('npx', ['tsx', 'scripts/guides/translate-guide.ts', '--game', `"${String(info.game || key)}"`, '--lang', info.languages.join(','), '--max-dollars', room.toFixed(2)], { encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', env: { ...process.env, PIPELINE_STEP_DOLLARS: room.toFixed(2) } });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const m = out.match(/^Usage: \d+ call\(s\), .*? = \$(\d+(?:\.\d+)?)/m);
    translateDollars += m ? Number(m[1]) : 0;
    console.log(`translations ${key}: exit ${r.status}, $${m ? m[1] : '?'}`);
    if (r.status === 0) await ref.set({ translationsDue: null }, { merge: true });
  }
  const total = earlier + ledgerDollars() + translateDollars;
  await FUND().set({ budget: 10, spent: total, at: Date.now(), counts, gates: lines }, { merge: true });
  fs.writeFileSync('scratchpad/dispute-settle.json', JSON.stringify({ counts, lines }, null, 1));
  console.log(`Settled: corrected ${counts.correct}, relocated ${counts.relocate}, removed ${counts.remove}, kept ${counts.keep}, unsettled ${counts.unsettled}; fund spent $${total.toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/disputeSettle\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('disputeSettle failed:', e?.message || e); process.exit(1); });
