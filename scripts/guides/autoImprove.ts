/**
 * The guides improve themselves every night (owner, Oct 29 2026): no approval first. Every change is logged on
 * /admin/asked with its reason and a one-click undo (autoChanges.ts); the Monday summary lists them.
 *
 * Inputs:
 *   - the site's ask box (siteAsk.ts): "missing" items (contributions, source "site", checked by contributions.ts),
 *     "Players asked" (the same question 3+ times on a page) and page suggestions ("add to the page", "fuller opening");
 *   - the app's questions (answerFeedback, answerReports: anonymous, with the question and the game), clustered by page;
 *   - the pipeline's own checks: cross-page contradictions settled against stored evidence (novemberWork.ts conflicts),
 *     and the guides' own pages (duplicates, thin pages, facts on the wrong page, lists in a poor order).
 *
 * What it may do, at most config/autoImprove.maxChanges (20) a night, of which at most maxDestructive (5) delete or
 * replace anything, within the pipeline's budget (PIPELINE_STEP_DOLLARS) and config/autoImprove.nightlyDollars:
 *   add       a missing fact on the page it was asked on (appended to the field it fits);
 *   opening   a fuller opening (sentences added to the page's overview);
 *   asked     a "Players asked" entry: the question reworded neutrally, the answer only what sources back;
 *   correct   a statement sources contradict, replaced by what they say (counts as a replace);
 *   merge     a duplicate or thin compendium page folded into the page that covers it: its address redirects there,
 *             and its facts the other page lacks are carried over (checked); counts as a delete;
 *   move      a sentence about another page's subject moved there (checked); counts as a delete;
 *   order     a list (items, secrets, shops, fights, sections) put in a clearer order.
 *
 * The rules (owner):
 *   - every new or changed fact is checked against sources first (stored evidence packs, else one search): only what a
 *     source supports goes on a page. An AI answer or a player's question is never a source;
 *   - no player text is published as written: "Players asked" questions are reworded (and checked not to match one);
 *   - nothing is deleted because tonight's sources don't mention it (the "not yet confirmed" rule stands): only a
 *     duplicate, a fold into another page, a move, or a contradiction by sources;
 *   - pictures are never touched: a page with an approved picture is never merged away, and nothing here adds one;
 *   - a page with search traffic (config impressionsKeep, 10 in 28 days) is only merged when it is a true duplicate;
 *   - a change the owner undid is never made again (its signature is kept).
 *
 * Changes are laid over the pages at publish (guideEdits with auto: the change's id, ownerEditsPublish.ts; merges in
 * publish.ts), so the stored pages stay as they were and an undo is exact.
 *
 *   npx tsx scripts/guides/autoImprove.ts [--dry-run] [--max 20]
 */
import crypto from 'crypto';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson, ledgerDollars, gameKey } from './common';
import { claimCheck, trusted, sentencesOf, type ClaimSlot, type Evidence, type EvidencePack } from './claimCheck';
import { searchedEvidence } from './entityV2';
import { coverage } from './benchmark';
import { pageImpressions } from './pageStats';
import { EDIT_PATH, getAt, listAt, entryKey, norm } from './ownerEdits';
import { normName } from './rebuildGuard';

const DRY = process.argv.includes('--dry-run');
const DAY = 86_400_000;
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

type Cfg = { enabled: boolean; maxChanges: number; maxDestructive: number; nightlyDollars: number; minAsks: number; impressionsKeep: number; reviewPages: number; appClusters: number };
const DEFAULTS: Cfg = { enabled: true, maxChanges: 20, maxDestructive: 5, nightlyDollars: 1.5, minAsks: 3, impressionsKeep: 10, reviewPages: 3, appClusters: 3 };

type Kind = 'add' | 'opening' | 'asked' | 'correct' | 'merge' | 'move' | 'order';
const DESTRUCTIVE = new Set<Kind>(['correct', 'merge', 'move']);
type EditSpec = { key: string; slug: string; page: 'area' | 'entity'; path: string; op: 'replace' | 'append' | 'order'; before: string; after: string; ids?: string[] };
type Change = {
  kind: Kind; key: string; slug: string; page: 'area' | 'entity'; name: string; reason: string; from: string;
  before?: string; after?: string; evidence: { text: string; sources: string[] }[];
  edits: EditSpec[]; asked?: { id?: string; q: string; a: string; lang: string; kind: string; source: string };
  merge?: { from: string; to: string; toName: string; page: 'area' | 'entity' };
  input?: { col: string; id: string };
  sig: string;
};

// ---- pages ----------------------------------------------------------------------------------------------------------
type Page = { key: string; slug: string; page: 'area' | 'entity'; name: string; data: any; game: string };
const games = new Map<string, string>();
async function gameName(key: string) {
  if (!games.has(key)) games.set(key, String((await db().collection('guides').doc(key).get()).data()?.game || key));
  return games.get(key)!;
}
const pageCache = new Map<string, Page | null>();
async function loadPage(key: string, slug: string, page?: 'area' | 'entity'): Promise<Page | null> {
  const id = `${key}/${slug}/${page || ''}`;
  if (pageCache.has(id)) return pageCache.get(id)!;
  let out: Page | null = null;
  if (page !== 'area') {
    const e: any = (await db().collection('guideCompendium').doc(key).collection('entities').doc(slug).get()).data();
    if (e && e.status === 'published') out = { key, slug, page: 'entity', name: String(e.displayName || e.name || slug), data: e, game: await gameName(key) };
  }
  if (!out && page !== 'entity') {
    const a: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
    if (a && a.status === 'published') out = { key, slug, page: 'area', name: String(a.name || slug), data: a, game: await gameName(key) };
  }
  pageCache.set(id, out);
  return out;
}

/** The fields a change may touch, with their paths (the same paths the owner's editor uses). */
const TEXT_KEYS = new Set(['overview', 'description', 'text', 'where', 'how', 'tactics', 'notes', 'tip', 'warn', 'outcome', 'when', 'rewards', 'sells']);
const LIST_KEYS = new Set(['walkthrough', 'items', 'secrets', 'shops', 'fights', 'enemies', 'sections', 'entries', 'story', 'gameplay', 'choices', 'options', 'tips', 'advice']);
/** Lists whose order isn't the play order, so a clearer order changes no fact. */
const ORDERABLE = new Set(['items', 'secrets', 'shops', 'fights', 'enemies', 'sections', 'gameplay']);
function fieldsOf(data: any): { path: string; text: string; label: string }[] {
  const out: { path: string; text: string; label: string }[] = [];
  const walk = (o: any, path: string, label: string, depth: number) => {
    if (depth > 4 || !o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && TEXT_KEYS.has(k) && v.length >= 20) {
        const p = path ? `${path}/${k}` : k;
        if (EDIT_PATH.test(p)) out.push({ path: p, text: v, label: `${label}${label ? ' › ' : ''}${k}` });
      } else if (Array.isArray(v) && LIST_KEYS.has(k)) {
        v.forEach((x: any, i: number) => {
          const seg = x && typeof x === 'object' && x.id != null && /^[A-Za-z0-9_.:-]{1,80}$/.test(String(x.id)) ? `#${x.id}` : String(i);
          const p = `${path ? `${path}/` : ''}${k}/${seg}`;
          if (typeof x === 'string') { if (x.length >= 20 && EDIT_PATH.test(p)) out.push({ path: p, text: x, label: `${k} ${i + 1}` }); }
          else walk(x, p, `${k}: ${cut(x?.name || x?.title || x?.heading || i + 1, 50)}`, depth + 1);
        });
      }
    }
  };
  walk(data, '', '', 0);
  return out;
}
const pageText = (data: any) => fieldsOf(data).map((f) => f.text).join('\n');
const entryNames = (data: any) => ['items', 'secrets', 'shops', 'fights', 'enemies'].flatMap((k) => (Array.isArray(data?.[k]) ? data[k] : []).map((e: any) => String(e?.name || ''))).filter(Boolean);

// ---- evidence: sources only ------------------------------------------------------------------------------------------
const OURS = /(^|\.)questcompendium\.com$/i;
const host = (s: unknown) => String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
/** Evidence a source backs: never our own site, a code host, or a line without a source. */
function sourced(lines: Evidence[]): Evidence[] {
  return lines.map((e) => ({ ...e, sources: (e.sources || []).filter((s) => !OURS.test(host(s)) && !/(^|\.)(github\.com|nexusmods\.com)$/i.test(host(s))) })).filter((e) => e.sources.length);
}
async function storedEvidence(pages: { key: string; slug: string; page: 'area' | 'entity' }[]): Promise<Evidence[]> {
  const lines: Evidence[] = [];
  for (const p of pages) {
    if (!p.slug) continue;
    const id = p.page === 'entity' ? `${p.key}__entity__${p.slug}` : `${p.key}__${p.slug}`;
    const pack: any = (await db().collection('evidencePacks').doc(id).get()).data();
    for (const e of (pack?.evidence || []) as Evidence[]) if (!lines.some((x) => x.text === e.text)) lines.push({ ...e, id: `p${lines.length + 1}` });
  }
  return lines;
}
function pack(key: string, slug: string, game: string, area: string, lines: Evidence[]): EvidencePack {
  const ev = sourced(lines).map((e, i) => ({ ...e, id: `e${i + 1}` }));
  return trusted({ key, slug, game, area, evidence: ev, sites: [...new Set(ev.flatMap((e) => e.sources))], servicesComplete: false, searches: 0, at: Date.now() });
}
/** Each sentence's verdict against the evidence; only "supported" counts as checked. */
async function check(game: string, where: string, sentences: string[], ev: EvidencePack) {
  if (!sentences.length || !ev.evidence.length) return sentences.map((text) => ({ text, verdict: 'unsupported' as const, evidence: [] as string[], fix: '' }));
  const slots: ClaimSlot[] = sentences.map((t, i) => ({ id: `K${i + 1}`, label: `S${i + 1}`, kind: 'sentence', sentence: 0, text: t }));
  const v = await claimCheck(game, where, slots, ev);
  return sentences.map((text, i) => {
    const x = v.find((y) => y.id === `K${i + 1}`);
    return { text, verdict: (x?.verdict || 'unsupported') as 'supported' | 'unsupported' | 'contradicted' | 'general', evidence: x?.evidence || [], fix: String(x?.fix || '') };
  });
}
const usedEvidence = (ev: EvidencePack, ids: string[]) => ev.evidence.filter((e) => ids.includes(e.id)).slice(0, 6).map((e) => ({ text: cut(e.text, 300), sources: e.sources.slice(0, 3) }));
/** Stored evidence first; a search only when the stored evidence doesn't back every sentence. */
async function checked(p: Page, sentences: string[], extra: Evidence[] = [], also: Page[] = [], question = '') {
  const stored = await storedEvidence([p, ...also]);
  let ev = pack(p.key, p.slug, p.game, p.name, [...extra, ...stored]);
  let v = await check(p.game, p.name, sentences, ev);
  // Out of searches (the pipeline's day or month share): the stored evidence decides, and the rest waits.
  if (v.some((x) => x.verdict !== 'supported' && x.verdict !== 'contradicted') && room() > 0.05 && searchesLeft) {
    const found = await searchedEvidence(`In the video game "${p.game}", about "${p.name}"${question ? ` (players asked: "${cut(question, 200)}")` : ''}: check what the game's wikis and guides say about each of these points:\n${sentences.map((s) => `- ${s}`).join('\n')}`, 'q', 'auto check').catch((e) => { if (/search day limit/i.test(String(e?.message))) { searchesLeft = false; return { evidence: [] as Evidence[], searches: 0 }; } throw e; });
    if (found.evidence.length) {
      ev = pack(p.key, p.slug, p.game, p.name, [...found.evidence, ...extra, ...stored]);
      v = await check(p.game, p.name, sentences, ev);
    }
  }
  return { v, ev, ok: v.filter((x) => x.verdict === 'supported').map((x) => x.text), used: usedEvidence(ev, v.flatMap((x) => (x.verdict === 'supported' ? x.evidence : []))) };
}

async function ask(prompt: string, maxOut = 1200): Promise<any> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  return parseJson(String(res?.text || '')) || {};
}

/** Where checked sentences fit on a page: one field, and only the sentences it doesn't already say. */
async function placement(p: Page, sentences: string[], hint: 'any' | 'overview'): Promise<{ path: string; add: string } | null> {
  const fields = fieldsOf(p.data);
  if (hint === 'overview') {
    const ov = fields.find((f) => f.path === 'overview');
    if (!ov) return null;
    const j = await ask([
      `A guide page about "${p.name}" in "${p.game}" opens with:`, ov.text, '',
      'These checked sentences could make the opening fuller:', ...sentences.map((s) => `- ${s}`), '',
      'Pick those the opening doesn\'t already say and that belong in an opening (what or who it is, where, why it matters). Keep their facts exactly; you may join or lightly tidy them, adding no fact. Reply with JSON only: {"add": "the sentences to add, or empty"}',
    ].join('\n'), 600);
    const add = cut(j.add, 600);
    return add ? { path: 'overview', add } : null;
  }
  const j = await ask([
    `A guide page about "${p.name}" in "${p.game}". Its fields (path: text):`,
    ...fields.slice(0, 60).map((f) => `${f.path} [${f.label}]: ${cut(f.text, 300)}`), '',
    'These checked sentences are missing from it:', ...sentences.map((s) => `- ${s}`), '',
    'Choose the one field they fit best (the overview when nothing fits better) and write what to add at its end: only facts from the sentences, plain guide style, no "players asked". If the page already says all of it, reply with an empty path.',
    'Reply with JSON only: {"path": "...", "add": "..."}',
  ].join('\n'), 800);
  const path = String(j.path || ''), add = cut(j.add, 700);
  if (!path || !add || !fields.some((f) => f.path === path)) return null;
  return { path, add };
}

// ---- the night ------------------------------------------------------------------------------------------------------
let CFG = DEFAULTS;
let searchesLeft = true;
const startDollars = ledgerDollars();
const stepLimit = Number(process.env.PIPELINE_STEP_DOLLARS || 0);
const room = () => Math.min(CFG.nightlyDollars, stepLimit || Infinity) - (ledgerDollars() - startDollars);
const made: Change[] = [];
const skipped: string[] = [];
let blocked = new Set<string>();
/** Candidates tried without a change (sources didn't confirm, nothing to add): not tried again for 30 days. */
let tried: Record<string, number> = {};
const fresh = (sig: string) => Number(tried[sig] || 0) < Date.now() - 30 * DAY;
const mark = (sig: string) => { tried[sig] = Date.now(); };
const touched = new Set<string>();
const full = () => made.length >= CFG.maxChanges;
const destructiveLeft = () => CFG.maxDestructive - made.filter((c) => DESTRUCTIVE.has(c.kind)).length;
const can = (kind: Kind) => !full() && room() > 0.03 && (!DESTRUCTIVE.has(kind) || destructiveLeft() > 0);

async function commit(c: Change): Promise<string | null> {
  if (blocked.has(c.sig) || !can(c.kind)) return null;
  blocked.add(c.sig);
  made.push(c);
  touched.add(`${c.key}/${c.slug}`);
  if (DRY) { console.log(`  [dry] ${c.kind} ${c.key}/${c.slug}: ${c.reason}`); return 'dry'; }
  const at = Date.now();
  const ref = db().collection('autoChanges').doc();
  const batch = db().batch();
  batch.set(ref, {
    kind: c.kind, key: c.key, slug: c.slug, page: c.page, name: c.name, reason: c.reason, from: c.from,
    before: cut(c.before, 2000), after: cut(c.after, 2000), evidence: c.evidence.slice(0, 6), destructive: DESTRUCTIVE.has(c.kind),
    ...(c.merge ? { merge: c.merge } : {}), ...(c.asked ? { asked: { q: c.asked.q, a: c.asked.a, lang: c.asked.lang } } : {}), ...(c.input ? { input: c.input } : {}),
    sig: c.sig, status: 'live', at, day: new Date(at).toISOString().slice(0, 10),
  });
  for (const e of c.edits) {
    batch.set(db().collection('guideEdits').doc(), {
      key: e.key, slug: e.slug, page: e.page, lang: 'en', path: e.path, op: e.op, before: e.before, after: e.after, ...(e.ids ? { ids: e.ids } : {}),
      label: cut(`${c.kind}: ${c.reason}`, 200), status: 'live', by: 'auto', auto: ref.id, createdAt: at,
    });
  }
  if (c.asked) {
    const doc = c.asked.id ? db().collection('playersAsked').doc(c.asked.id) : db().collection('playersAsked').doc();
    batch.set(doc, {
      ...(c.asked.id ? {} : { key: c.key, slug: c.slug, kind: c.asked.kind, lang: c.asked.lang, count: 0, at, source: c.asked.source }),
      q: c.asked.q, a: c.asked.a, status: 'approved', auto: ref.id, decided: { by: 'auto (sources checked)', at },
    }, { merge: true });
  }
  if (c.input) batch.set(db().collection(c.input.col).doc(c.input.id), { status: 'auto', auto: ref.id, decided: { by: 'auto (sources checked)', at } }, { merge: true });
  await batch.commit();
  console.log(`  ${c.kind} ${c.key}/${c.slug}: ${c.reason}`);
  return ref.id;
}
/** An input that sources didn't confirm: set aside (tried again after 30 days, in case sources fill in). */
async function setAside(col: string, id: string, why: string) {
  skipped.push(why);
  if (!DRY) await db().collection(col).doc(id).set({ status: 'unconfirmed', unconfirmed: { why: cut(why, 300), at: Date.now() } }, { merge: true });
}
const sigOf = (...parts: unknown[]) => sha(parts.map((x) => norm(String(x ?? ''))).join('|'));

// ---- 1. corrections: statements sources contradict (the pipeline's consistency checks) ----
async function corrections() {
  const aw: any = (await db().collection('system').doc('auditWork').get()).data() || {};
  for (const [key, x] of Object.entries((aw.conflicts || {}) as Record<string, any>)) {
    for (const it of (x.items || []) as any[]) {
      if (!can('correct')) return;
      const tsig = sigOf('try-correct', key, it.on, it.text);
      if (!fresh(tsig)) continue;
      mark(tsig);
      const entity = String(it.on).startsWith('entity:');
      const p = await loadPage(key, String(it.on).replace(/^entity:/, ''), entity ? 'entity' : 'area');
      if (!p) continue;
      const fields = fieldsOf(p.data);
      const j = await ask([
        `A guide page about "${p.name}" in "${p.game}". Sources contradict what it says about "${it.name}": "${cut(it.text, 300)}"${it.why ? ` (${cut(it.why, 200)})` : ''}.`,
        it.right?.length ? `Other pages say, backed by sources: ${it.right.map((r: string) => `"${cut(r, 200)}"`).join('; ')}` : '',
        'Its fields (path: text):', ...fields.slice(0, 60).map((f) => `${f.path}: ${cut(f.text, 400)}`), '',
        'Find the sentence that states the contradicted claim, copied exactly as it is in its field, and write it corrected using only what the backed statements say (same style). Reply with JSON only: {"path": "...", "before": "exact sentence", "after": "corrected sentence"} or {} if it is not there.',
      ].join('\n'));
      const path = String(j.path || ''), before = String(j.before || ''), after = cut(j.after, 600);
      const cur = getAt(p.data, path);
      if (!cur || !before || !after || !cur.includes(before) || norm(before) === norm(after)) continue;
      const sig = sigOf('correct', key, p.slug, before);
      if (blocked.has(sig)) continue;
      // Both sides checked: the old sentence contradicted, every new sentence supported.
      const c = await checked(p, [before, ...sentencesOf(after)]);
      if (c.v[0]?.verdict !== 'contradicted' || c.v.slice(1).some((v) => v.verdict !== 'supported')) { skipped.push(`${p.name}: correction not confirmed by sources`); continue; }
      await commit({
        kind: 'correct', key, slug: p.slug, page: p.page, name: p.name, from: 'the pipeline\'s consistency check',
        reason: `Sources contradict "${cut(before, 120)}"; replaced with what they say.`, before, after, evidence: c.used,
        edits: [{ key, slug: p.slug, page: p.page, path, op: 'replace', before, after }], sig,
      });
    }
  }
}

// ---- 2. missing facts: the ask box's "missing" items, checked by contributions.ts ----
async function missingFacts() {
  const docs = (await db().collection('contributions').where('status', '==', 'checked').get()).docs.filter((d) => ['site', 'site-suggestion'].includes(String(d.data().source)));
  // Also the ones set aside a month ago (sources may have filled in).
  const retry = (await db().collection('contributions').where('status', '==', 'unconfirmed').get()).docs.filter((d) => ['site', 'site-suggestion'].includes(String(d.data().source)) && Number(d.data().unconfirmed?.at || 0) < Date.now() - 30 * DAY);
  for (const d of [...docs, ...retry]) {
    if (!can('add')) return;
    const x: any = d.data();
    const p = await loadPage(x.key, x.slug, x.page === 'entity' ? 'entity' : 'area');
    if (!p) continue;
    const isRetry = x.status === 'unconfirmed';
    if (!isRetry && x.check?.verdict !== 'supported') { await setAside('contributions', d.id, `${p.name}: "${cut(x.label, 80)}" (${x.check?.verdict || 'not checked'})`); continue; }
    const proposal = String(x.check?.proposal || '');
    const seed: Evidence[] = (x.check?.evidence || []).map((e: any, i: number) => ({ id: `c${i}`, text: e.text, sources: e.sources || [], topic: 'check' }));
    const c = await checked(p, sentencesOf(proposal).slice(0, 6), seed, [], x.label);
    if (!c.ok.length) { await setAside('contributions', d.id, `${p.name}: "${cut(x.label, 80)}" (sources didn't confirm)`); continue; }
    await addFacts(p, c, 'add', `Players asked "${cut(x.label, 100)}" and the page didn't say; added what sources back.`, 'site questions', { col: 'contributions', id: d.id });
  }
}

/** Checked sentences placed on a page as an "append" edit, the placed text checked again. */
async function addFacts(p: Page, c: Awaited<ReturnType<typeof checked>>, kind: 'add' | 'opening', reason: string, from: string, input?: Change['input']) {
  const at = await placement(p, c.ok, kind === 'opening' ? 'overview' : 'any');
  if (!at) return false;
  const sents = sentencesOf(at.add);
  // The placed wording may differ from the checked sentences: it is checked again against the same evidence.
  const again = await check(p.game, p.name, sents, c.ev);
  const add = again.filter((v) => v.verdict === 'supported').map((v) => v.text).join(' ');
  if (!add || norm(getAt(p.data, at.path) || '').includes(norm(add))) return false;
  const sig = sigOf(kind, p.key, p.slug, add);
  if (blocked.has(sig)) return false;
  return !!(await commit({
    kind, key: p.key, slug: p.slug, page: p.page, name: p.name, reason, from, after: add, evidence: c.used,
    edits: [{ key: p.key, slug: p.slug, page: p.page, path: at.path, op: 'append', before: '', after: add }], input, sig,
  }));
}

// ---- 3. "Players asked": the same question 3+ times on a page (site), or in the app ----
async function playersAsked() {
  // New ones, and ones set aside a month ago (sources may have filled in).
  const docs = [
    ...(await db().collection('playersAsked').where('status', '==', 'suggested').get()).docs,
    ...(await db().collection('playersAsked').where('status', '==', 'unconfirmed').get()).docs.filter((d) => Number(d.data().unconfirmed?.at || 0) < Date.now() - 30 * DAY),
  ].filter((d) => Number(d.data().count || 0) >= CFG.minAsks);
  for (const d of docs.sort((a, b) => Number(b.data().count) - Number(a.data().count))) {
    if (!can('asked')) return;
    const x: any = d.data();
    // Asked on a guide's front page (no slug): the game's guide as a whole.
    const p = x.slug ? await loadPage(x.key, x.slug, x.kind === 'entity' ? 'entity' : 'area') : { key: x.key, slug: '', page: 'area' as const, name: await gameName(x.key), data: {}, game: await gameName(x.key) };
    if (!p) continue;
    const tsig = sigOf('try-asked', d.id, x.count);
    if (!fresh(tsig)) continue;
    mark(tsig);
    await askedEntry(p, x.examples?.length ? x.examples : [x.q], String(x.a || ''), String(x.lang || 'en'), x.count, 'site questions', { id: d.id, kind: String(x.kind || 'area'), source: 'site' });
  }
}

async function askedEntry(p: Page, examples: string[], answer: string, lang: string, count: number, from: string, target: { id?: string; kind: string; source: string }) {
  // The answer's sentences, checked (the AI answer is only a draft: what sources back stays).
  const c = await checked(p, sentencesOf(answer).filter((s) => !/^more on:/i.test(s)).slice(0, 8), [], [], examples[0]);
  if (!c.ok.length) { if (target.id) await setAside('playersAsked', target.id, `${p.name}: "${cut(examples[0], 80)}" (sources didn't confirm the answer)`); return false; }
  const langName: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };
  const j = await ask([
    `Players of "${p.game}" asked this on the guide page about "${p.name}", in different words:`, ...examples.slice(0, 8).map((e) => `- ${cut(e, 200)}`), '',
    'Checked facts that answer it:', ...c.ok.map((s) => `- ${s}`), '',
    `Write a "Players asked" entry in ${langName[lang] || 'English'}: the question reworded as a short, neutral FAQ question (not any player's exact words; no slang, no names of people), and a short answer (1-3 sentences) that uses only the checked facts.`,
    'Reply with JSON only: {"q": "...", "a": "..."}',
  ].join('\n'), 700);
  const q = cut(j.q, 160), a = cut(j.a, 900);
  if (!q || !a) return false;
  // Never a player's text as written.
  if (examples.some((e) => norm(e).toLowerCase().replace(/[?!.]+$/, '') === norm(q).toLowerCase().replace(/[?!.]+$/, ''))) return false;
  const again = await check(p.game, p.name, sentencesOf(a), c.ev);
  if (again.some((v) => v.verdict !== 'supported')) return false;
  const sig = sigOf('asked', p.key, p.slug, q);
  if (blocked.has(sig)) return false;
  return !!(await commit({
    kind: 'asked', key: p.key, slug: p.slug, page: p.page, name: p.name, from,
    reason: `Asked ${count} times on this page; added under "Players asked", reworded, with what sources back.`, after: `${q}\n${a}`, evidence: c.used, edits: [],
    asked: { id: target.id, q, a, lang, kind: target.kind, source: target.source }, sig,
  }));
}

// ---- 4. page suggestions from the ask box: "add to the page" and "fuller opening" ----
async function pageSuggestions() {
  const docs = (await db().collection('pageSuggestions').where('status', '==', 'suggested').get()).docs;
  for (const d of docs.sort((a, b) => Number(b.data().count || 1) - Number(a.data().count || 1))) {
    const x: any = d.data();
    const kind: Kind = x.kind === 'opening' ? 'opening' : 'add';
    if (!can(kind)) return;
    const p = await loadPage(x.key, x.slug, x.pageKind === 'entity' ? 'entity' : 'area');
    if (!p) continue;
    // The pages the answer came from: their stored evidence is checked evidence for the same facts.
    const also: Page[] = [];
    for (const href of (x.sources || []) as string[]) {
      const m = String(href).match(/guides\/([a-z0-9-]+)\/([a-z0-9-]+)\//);
      if (m && m[1] === x.key) { const o = await loadPage(m[1], m[2]); if (o) also.push(o); }
    }
    const text = String(x.answer || x.a || '').replace(/\n\nMore on:[\s\S]*$/, '');
    const c = await checked(p, sentencesOf(text).slice(0, 8), [], also, x.q);
    if (!c.ok.length) { await setAside('pageSuggestions', d.id, `${p.name}: "${cut(x.q, 80)}" (sources didn't confirm)`); continue; }
    const why = kind === 'opening'
      ? `Players asked what this page is about ("${cut(x.q, 80)}"); its opening now says more, from sources.`
      : `The answer to "${cut(x.q, 80)}" came from other pages${also.length ? ` (${also.map((o) => o.name).join(', ')})` : ''}; the fact is now on this page.`;
    const ok = await addFacts(p, c, kind as 'add' | 'opening', why, 'site questions', { col: 'pageSuggestions', id: d.id });
    if (!ok && !DRY) await db().collection('pageSuggestions').doc(d.id).set({ status: 'done', decided: { by: 'auto (the page already says it)', at: Date.now() } }, { merge: true });
  }
}

// ---- 5. the app's questions (anonymous): clusters of 3+ on one page ----
function words(s: string) { return normName(s).split(' ').filter((w) => w.length > 2); }
function similar(a: string, b: string) {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}
async function appQuestions() {
  if (!can('asked')) return;
  const since = Date.now() - 60 * DAY;
  const qs: { q: string; key: string }[] = [];
  for (const [col, at] of [['answerFeedback', 'at'], ['answerReports', 'createdAt']] as const) {
    const snap = await db().collection(col).where(at, '>=', since).limit(3000).get().catch(() => null);
    for (const d of snap?.docs || []) { const x: any = d.data(); const key = x.game ? gameKey(String(x.game)) : ''; if (x.question && /^[a-z0-9-]{2,120}$/.test(key)) qs.push({ q: cut(x.question, 300), key }); }
  }
  // Each question on the page whose name it mentions (the longest name wins).
  const byPage = new Map<string, { p: { key: string; slug: string; page: 'area' | 'entity'; name: string }; qs: string[] }>();
  const names = new Map<string, { key: string; slug: string; page: 'area' | 'entity'; name: string }[]>();
  for (const key of new Set(qs.map((q) => q.key))) {
    const list: { key: string; slug: string; page: 'area' | 'entity'; name: string }[] = [];
    const [areas, ents] = await Promise.all([
      db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get().catch(() => null),
      db().collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get().catch(() => null),
    ]);
    for (const d of areas?.docs || []) list.push({ key, slug: d.id, page: 'area', name: String(d.data().name || d.id) });
    for (const d of ents?.docs || []) list.push({ key, slug: d.id, page: 'entity', name: String(d.data().displayName || d.data().name || d.id) });
    names.set(key, list.filter((x) => normName(x.name).length >= 4).sort((a, b) => b.name.length - a.name.length));
  }
  for (const q of qs) {
    const nq = ` ${normName(q.q)} `;
    const hit = (names.get(q.key) || []).find((x) => nq.includes(` ${normName(x.name)} `));
    if (!hit) continue;
    const k = `${hit.key}/${hit.slug}`;
    byPage.set(k, { p: hit, qs: [...(byPage.get(k)?.qs || []), q.q] });
  }
  let done = 0;
  for (const { p: ref, qs: list } of [...byPage.values()].sort((a, b) => b.qs.length - a.qs.length)) {
    if (done >= CFG.appClusters || !can('asked')) return;
    // The biggest group of similar questions on the page.
    const groups: string[][] = [];
    for (const q of list) { const g = groups.find((x) => similar(x[0], q) >= 0.5); if (g) g.push(q); else groups.push([q]); }
    const g = groups.sort((a, b) => b.length - a.length)[0];
    if (!g || g.length < CFG.minAsks) continue;
    const have = (await db().collection('playersAsked').where('key', '==', ref.key).where('slug', '==', ref.slug).get()).docs.some((d) => similar(String(d.data().q), g[0]) >= 0.5 || (d.data().examples || []).some((e: string) => similar(e, g[0]) >= 0.5));
    if (have) continue;
    const tsig = sigOf('try-app', ref.key, ref.slug, g[0]);
    if (!fresh(tsig)) continue;
    mark(tsig);
    const p = await loadPage(ref.key, ref.slug, ref.page);
    if (!p) continue;
    // No answer to start from: what sources say, found with one search.
    if (!searchesLeft) return;
    const found = await searchedEvidence(`In the video game "${p.game}", about "${p.name}": players ask "${cut(g[0], 200)}". What do the game's wikis and guides say?`, 'a', 'auto asked').catch((e) => { if (/search day limit/i.test(String(e?.message))) { searchesLeft = false; return { evidence: [] as Evidence[], searches: 0 }; } throw e; });
    const draft = found.evidence.map((e) => e.text).slice(0, 6).join(' ');
    if (!draft) continue;
    done++;
    await askedEntry(p, g, draft, 'en', g.length, 'app questions', { kind: p.page, source: 'app' });
  }
}

// ---- 6. merges: duplicate compendium pages, and thin ones that are part of another page's subject ----
async function pictures(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const d of (await db().collection('guideImages').where('status', 'in', ['approved', 'waiting']).get().catch(() => null))?.docs || []) {
    const x: any = d.data();
    if (x.game && x.target?.slug) out.add(`${x.game}/${x.target.slug}`);
    if (x.game && x.target?.area) out.add(`${x.game}/${x.target.area}`);
  }
  return out;
}
async function merges() {
  if (!can('merge')) return;
  let mergeTries = 0;
  const pics = await pictures();
  const live = (await db().collection('autoChanges').where('kind', '==', 'merge').get()).docs.map((d) => d.data() as any);
  const mergedAway = new Set(live.filter((m) => m.status === 'live').map((m) => `${m.key}/${m.merge?.from}`));
  for (const cd of (await db().collection('guideCompendium').get()).docs) {
    if (!can('merge')) return;
    const key = cd.id;
    const ents = (await cd.ref.collection('entities').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) }))
      .filter((e) => !mergedAway.has(`${key}/${e.slug}`));
    const pairs: { a: any; b: any; why: 'duplicate' | 'part' }[] = [];
    for (const a of ents) {
      for (const b of ents) {
        if (a.slug === b.slug || a.type !== b.type) continue;
        const na = normName(a.name), nb = normName(b.name);
        const dup = na === nb || (a.aliases || []).some((x: string) => normName(x) === nb) || a.slug.replace(/-\d+$/, '') === b.slug;
        if (dup && (a.slug > b.slug || a.slug.replace(/-\d+$/, '') === b.slug)) pairs.push({ a, b, why: 'duplicate' });
        // A thin page whose name is another page's name and more ("X Upper Floors" in "X"); quests keep their pages.
        else if (!dup && a.kind !== 'quest' && nb.length >= 5 && na.startsWith(`${nb} `) && pageText(a).length < 600) pairs.push({ a, b, why: 'part' });
      }
    }
    for (const { a, b, why } of pairs) {
      if (!can('merge')) return;
      if (pics.has(`${key}/${a.slug}`)) { skipped.push(`${a.name}: has a picture, kept`); continue; }
      const sig = sigOf('merge', key, a.slug, b.slug);
      if (blocked.has(sig) || !fresh(sig) || ++mergeTries > 8) continue;
      mark(sig);
      const imp = await pageImpressions(key, a.slug).catch(() => 0);
      if (why === 'part' && imp >= CFG.impressionsKeep) continue;
      const A = await loadPage(key, a.slug, 'entity'), B = await loadPage(key, b.slug, 'entity');
      if (!A || !B) continue;
      // Nothing may be lost: A's named entries on B, A's facts on B or carried over (checked).
      const bText = pageText(B.data);
      if (entryNames(A.data).some((n) => !normName(bText).includes(normName(n)))) continue;
      const aSents = sentencesOf(pageText(A.data)).slice(0, 20);
      const covered = await coverage(A.game, B.name, bText, aSents.map((s) => ({ point: s, kind: 'other', core: true })));
      const missing = aSents.filter((_, i) => !covered[i]);
      let carry: { ok: string[]; ev: EvidencePack; used: any[]; v: any[] } | null = null;
      if (missing.length) {
        carry = await checked(B, missing, [], [A]);
        // A fact that can't be confirmed tonight is never dropped: then the pages stay as they are.
        if (carry.ok.length < missing.length) { skipped.push(`${A.name} into ${B.name}: some facts not confirmed, kept apart`); continue; }
      }
      if (why === 'part') {
        const same = await checked(B, [`${A.name} is part of ${B.name}.`], [], [A]);
        if (!same.ok.length) continue;
      }
      const at = carry ? await placement(B, carry.ok, 'any') : null;
      if (carry && !at) continue;
      await commit({
        kind: 'merge', key, slug: A.slug, page: 'entity', name: A.name, from: 'the guide\'s own pages',
        reason: why === 'duplicate'
          ? `A duplicate of "${B.name}": folded into it; its address redirects there${carry ? ', and its facts that page lacked were added' : ''}.`
          : `A thin page about part of "${B.name}" (${imp} search impressions in 28 days): folded into it; its address redirects there${carry ? ', and its facts were carried over' : ''}.`,
        before: cut(pageText(A.data), 2000), after: at?.add || '', evidence: carry?.used || [],
        edits: at ? [{ key, slug: B.slug, page: 'entity', path: at.path, op: 'append', before: '', after: at.add }] : [],
        merge: { from: A.slug, to: B.slug, toName: B.name, page: 'entity' }, sig,
      });
      mergedAway.add(`${key}/${A.slug}`);
    }
  }
}

// ---- 7. structure: facts on the wrong page, lists in a poor order (the most-asked pages first) ----
async function structure() {
  const sys = db().collection('system').doc('autoImprove');
  const st: any = (await sys.get()).data() || {};
  const reviewed: Record<string, number> = st.reviewed || {};
  const asked = new Map<string, number>();
  for (const d of (await db().collection('siteQuestions').where('at', '>=', Date.now() - 30 * DAY).get()).docs) {
    const x: any = d.data();
    if (x.slug && !x.test) asked.set(`${x.key}/${x.slug}`, (asked.get(`${x.key}/${x.slug}`) || 0) + 1);
  }
  const month = new Date().toISOString().slice(0, 7);
  const misses: any = (await db().collection('groundingMisses').doc(month).get()).data() || {};
  for (const [key, pages] of Object.entries(misses)) {
    if (key === 'updatedAt' || typeof pages !== 'object') continue;
    for (const [slug, reasons] of Object.entries(pages as any)) {
      if (slug === '-') continue;
      const n = Object.values(reasons as Record<string, unknown>).reduce<number>((s, v) => s + (Number(v) || 0), 0);
      asked.set(`${key}/${slug}`, (asked.get(`${key}/${slug}`) || 0) + n);
    }
  }
  const order = [...asked.entries()].filter(([k]) => Number(reviewed[k] || 0) < Date.now() - 30 * DAY).sort((a, b) => b[1] - a[1]).slice(0, CFG.reviewPages);
  for (const [k] of order) {
    if (full() || room() < 0.05) break;
    const [key, slug] = k.split('/');
    const p = await loadPage(key, slug);
    if (!p) continue;
    reviewed[k] = Date.now();
    const others = [
      ...((await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, name: String(d.data().name || d.id), page: 'area' as const }))),
      ...(((await db().collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get().catch(() => null))?.docs || []).map((d) => ({ slug: d.id, name: String(d.data().displayName || d.data().name || d.id), page: 'entity' as const }))),
    ].filter((o) => o.slug !== slug);
    const fields = fieldsOf(p.data);
    const lists = Object.keys(p.data || {}).filter((n) => ORDERABLE.has(n) && Array.isArray(p.data[n]) && p.data[n].length >= 3);
    const j = await ask([
      `A guide page about "${p.name}" in "${p.game}". Its fields (path: text):`, ...fields.slice(0, 70).map((f) => `${f.path}: ${cut(f.text, 300)}`), '',
      lists.length ? `Lists that may be reordered (not play order): ${lists.map((n) => `${n} [${p.data[n].map((x: any) => entryKey(x)).join(' | ')}]`).join('; ')}` : '',
      `Other pages of this guide: ${others.slice(0, 200).map((o) => `${o.slug} (${o.name})`).join('; ')}`, '',
      'Find, if any: (1) up to 2 sentences that are about another page\'s subject and don\'t belong here (copied exactly from their field), and the page they belong on; (2) one list whose order would be clearer for a player (for example by where things are, or most important first), with the new order of its entry keys. Only real improvements; none is a fine answer.',
      'Reply with JSON only: {"moves": [{"path": "...", "sentence": "...", "to": "slug", "reason": "..."}], "order": {"list": "...", "keys": ["..."], "reason": "..."} or null}',
    ].join('\n'), 1500);
    for (const m of (Array.isArray(j.moves) ? j.moves : []).slice(0, 2)) {
      if (!can('move')) break;
      const cur = getAt(p.data, String(m.path || '')), sentence = String(m.sentence || '');
      const to = others.find((o) => o.slug === String(m.to || ''));
      if (!cur || !sentence || !cur.includes(sentence) || !to || sentence.length < 15) continue;
      const B = await loadPage(key, to.slug, to.page);
      if (!B || norm(pageText(B.data)).includes(norm(sentence))) continue;
      const sig = sigOf('move', key, slug, sentence);
      if (blocked.has(sig)) continue;
      const c = await checked(B, [sentence], [], [p]);
      if (!c.ok.length) continue;
      const at = await placement(B, c.ok, 'any');
      if (!at) continue;
      await commit({
        kind: 'move', key, slug, page: p.page, name: p.name, from: 'the guide\'s own pages',
        reason: `Moved to "${B.name}", where it belongs: ${cut(m.reason, 160)}`, before: sentence, after: `On ${B.name}: ${at.add}`, evidence: c.used,
        edits: [{ key, slug, page: p.page, path: String(m.path), op: 'replace', before: sentence, after: '' }, { key, slug: B.slug, page: B.page, path: at.path, op: 'append', before: '', after: at.add }], sig,
      });
    }
    const o = j.order;
    if (o && lists.includes(String(o.list)) && can('order')) {
      const list = listAt(p.data, String(o.list)) || [];
      const have = list.map(entryKey);
      const keys = (Array.isArray(o.keys) ? o.keys : []).map(String).filter((x: string, i: number, a: string[]) => have.includes(x) && a.indexOf(x) === i);
      if (keys.length === have.length && keys.some((x: string, i: number) => x !== have[i])) {
        const sig = sigOf('order', key, slug, o.list, keys.join(','));
        if (!blocked.has(sig)) await commit({
          kind: 'order', key, slug, page: p.page, name: p.name, from: 'the guide\'s own pages', reason: `${o.list}: a clearer order (${cut(o.reason, 160)}).`,
          before: have.join(' · '), after: keys.join(' · '), evidence: [], edits: [{ key, slug, page: p.page, path: String(o.list), op: 'order', before: '', after: '', ids: keys }], sig,
        });
      }
    }
  }
  if (!DRY) await sys.set({ reviewed: Object.fromEntries(Object.entries(reviewed).filter(([, t]) => t > Date.now() - 60 * DAY)) }, { merge: true });
}

async function main() {
  CFG = { ...DEFAULTS, ...((await db().collection('config').doc('autoImprove').get()).data() || {}) } as Cfg;
  const max = Number(arg('max'));
  if (max > 0) CFG.maxChanges = Math.min(CFG.maxChanges, max);
  if (!CFG.enabled) { console.log('Done: improvements off (config/autoImprove.enabled).'); process.exit(0); }
  // Every change made before, live or undone: never made twice, and never again once undone.
  blocked = new Set((await db().collection('autoChanges').get()).docs.map((d) => String(d.data().sig || '')).filter(Boolean));
  const sys = db().collection('system').doc('autoImprove');
  tried = ((await sys.get()).data() || {}).tried || {};
  const steps: [string, () => Promise<void>][] = [['corrections', corrections], ['missing facts', missingFacts], ['players asked', playersAsked], ['page suggestions', pageSuggestions], ['app questions', appQuestions], ['merges', merges], ['structure', structure]];
  for (const [name, fn] of steps) {
    if (full() || room() < 0.05) break;
    try { await fn(); } catch (e: any) { console.log(`  ${name}: stopped (${cut(e?.message || e, 160)})`); }
  }
  if (!DRY) await sys.set({ tried: Object.fromEntries(Object.entries(tried).filter(([, t]) => t > Date.now() - 30 * DAY)), lastRun: { at: Date.now(), changes: made.length, skipped: skipped.length, dollars: ledgerDollars() - startDollars } }, { merge: true });
  const n = (k: Kind) => made.filter((c) => c.kind === k).length;
  const parts = ([['add', 'fact(s) added'], ['opening', 'fuller opening(s)'], ['asked', '"Players asked"'], ['correct', 'correction(s)'], ['merge', 'merge(s)'], ['move', 'move(s)'], ['order', 'reorder(s)']] as [Kind, string][]).filter(([k]) => n(k)).map(([k, l]) => `${n(k)} ${l}`);
  console.log(`Done: improvements: ${made.length} change(s) on ${touched.size} page(s)${parts.length ? ` (${parts.join(', ')})` : ''}${skipped.length ? `; ${skipped.length} not confirmed by sources, left as they are` : ''}; $${(ledgerDollars() - startDollars).toFixed(2)}.`);
  setTimeout(() => process.exit(0), 300);
}
main().catch((e) => { console.error('improvements failed:', e?.message || e); process.exit(1); });
