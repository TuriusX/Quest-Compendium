/**
 * The gate for page passes (repair.ts --action fights | missables | info | queries): it judges the repaired part, not
 * the whole guide. A whole-guide review grades the outline, coverage and every older entry too, so a guide that already
 * scored below the pass mark (or one graded against a newer standard) failed no matter how good the new fights were.
 *
 * Two checks:
 *   1. Nothing else got worse (no AI, free): every live page is still there, in the same order, and nothing outside the
 *      pass's own fields changed; a missables or queries pass loses no entries and renames none; Key fights and summary
 *      boxes only go onto pages that had none.
 *   2. The changes themselves, graded by the reviewer: each new fight, rewritten missable, summary box or query answer
 *      gets a verdict (ok, vague, wrong, invented, worse than before). Wrong, invented and worse ones are taken out of the
 *      staged copy (a rewritten entry goes back to what it was), and the pass is judged on the rest.
 * A pass needs no regressions, a score at the pass mark, and at most 30% of the changes taken out.
 */
import fs from 'fs';
import { FieldValue } from 'firebase-admin/firestore';
import { ThinkingLevel } from '@google/genai';
import { db, parseJson, stageKey, liveKey, guideRelease, releasedAfter, REVIEWER_CUTOFF, MISSABLE_STANDARD } from './common';
import { estimateCost } from '../../usage';
import { call, reviewerFor, passMark, type Review } from './review';
import type { ReviewTier } from './reviewerQuota';

export type PassAction = 'fights' | 'missables' | 'info' | 'queries' | 'correction';
/** The fields each pass may change on a page. */
export const PASS_FIELDS: Record<PassAction, string[]> = {
  fights: ['fights'],
  missables: ['items', 'sections'],
  info: ['info'],
  queries: ['items', 'secrets', 'seoTitle', 'seoDescription'],
  // Player corrections (corrections.ts): an entry rewritten, or a missing fight added.
  correction: ['fights', 'items', 'secrets', 'sections'],
};
/** Passes that rewrite existing entries (which must not be lost or renamed). */
const REWRITES: PassAction[] = ['missables', 'queries', 'correction'];
/** Page fields that only record what a run did. */
const bookkeeping = (k: string) => ['status', 'staged', 'updatedAt', 'order', 'heldReason', 'unpublishedAt'].includes(k) || /Checked$/.test(k);
/** At most this share of the changes may be taken out (wrong, invented or worse) for the pass to go live. */
const MAX_DROPPED = 0.3;
const BATCH = 80;

const stable = (v: any): string =>
  v === undefined ? 'undefined' : JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a: any, b: any) => stable(a ?? null) === stable(b ?? null);
const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const entryName = (e: any) => cut(e?.name || String(e?.text || '').split(/[:.]/)[0], 60);

/** One change for the reviewer, and how to take it out again. */
type Change = { page: string; slug: string; kind: string; id: string; name: string; text: string; before?: string };

/** Check 1: what changed outside the pass's own fields (each a short reason; empty = nothing got worse). */
export function regressions(action: PassAction, live: Map<string, any>, staged: Map<string, any>, liveOrder: string[], stagedOrder: string[]): string[] {
  const out: string[] = [];
  const allowed = new Set(PASS_FIELDS[action]);
  for (const [slug, lp] of live) {
    const sp = staged.get(slug);
    const name = cut(lp.name || slug, 60);
    if (!sp || sp.status === 'held') { out.push(`${name}: page missing from the repair`); continue; }
    for (const k of new Set([...Object.keys(lp), ...Object.keys(sp)])) {
      if (bookkeeping(k) || allowed.has(k)) continue;
      if (!same(lp[k], sp[k])) out.push(`${name}: "${k}" changed`);
    }
    if ((action === 'fights' || action === 'info') && lp[action] && (!Array.isArray(lp[action]) || lp[action].length) && !same(lp[action], sp[action]))
      out.push(`${name}: existing ${action === 'fights' ? 'key fights' : 'summary box'} replaced`);
    if (action === 'correction') {
      const now = new Set((sp.fights || []).map((f: any) => String(f.id)));
      for (const f of lp.fights || []) if (!now.has(String(f.id))) out.push(`${name}: key fight "${cut(f.name, 60)}" lost`);
    }
    if (REWRITES.includes(action)) {
      for (const f of ['items', 'secrets'] as const) {
        const now = new Map((sp[f] || []).map((e: any) => [String(e.id), e]));
        for (const e of lp[f] || []) {
          const n: any = now.get(String(e.id));
          if (!n) out.push(`${name}: ${f === 'items' ? 'item' : 'secret'} "${entryName(e)}" lost`);
          else if (f === 'items' && cut(n.name, 100) !== cut(e.name, 100)) out.push(`${name}: item "${entryName(e)}" renamed`);
        }
      }
      for (const x of lp.sections || []) {
        const y = (sp.sections || []).find((s: any) => s.title === x.title);
        if (!y || (y.entries || []).length < (x.entries || []).length) out.push(`${name}: section "${cut(x.title, 40)}" lost entries`);
      }
    }
  }
  for (const slug of staged.keys()) if (!live.has(slug) && staged.get(slug).status !== 'held') out.push(`${cut(staged.get(slug).name || slug, 60)}: page added by the repair`);
  if (!same(liveOrder, stagedOrder.filter((s) => live.has(s)))) out.push('the page order changed');
  return out.slice(0, 20);
}

const fightText = (f: any) => [f.enemies && `enemies: ${f.enemies}`, f.threats && `threats: ${f.threats}`, f.weaknesses && `weak: ${f.weaknesses}`, f.tactics && `tactics: ${f.tactics}`, f.rewards && `rewards: ${f.rewards}`]
  .filter(Boolean).map((s) => cut(s, 260)).join('; ');
const itemText = (e: any) => `where ${cut(e.where || '-', 220)}; how ${cut(e.how || '-', 120)}; missable because ${cut(e.lockout || '-', 120)}`;
const infoText = (i: any) => [i.region && `region: ${i.region}`, i.levels && `levels: ${i.levels}`, i.quests?.length && `quests: ${i.quests.join('; ')}`,
  i.services?.length && `services and people: ${i.services.join('; ')}`, i.enemyTypes?.length && `enemies: ${i.enemyTypes.join('; ')}`,
  i.directions && `getting there: ${i.directions}`, i.connected?.length && `connects to: ${i.connected.join('; ')}`, i.coords && `coordinates: ${i.coords}`]
  .filter(Boolean).map((s) => cut(s, 200)).join(' | ');

/** The changes a pass made, page by page. */
export function changesOf(action: PassAction, live: Map<string, any>, staged: Map<string, any>): Change[] {
  const out: Change[] = [];
  for (const [slug, lp] of live) {
    const sp = staged.get(slug);
    if (!sp) continue;
    const page = cut(lp.name || slug, 60);
    if ((action === 'fights' || action === 'correction') && !same(lp.fights, sp.fights)) {
      const was = new Map((lp.fights || []).map((f: any) => [String(f.id), f]));
      for (const f of sp.fights || []) if (!same(was.get(String(f.id)), f)) out.push({ page, slug, kind: 'fight', id: String(f.id), name: cut(f.name, 100), text: fightText(f) + (f.sources?.length ? ` [sources: ${f.sources.slice(0, 3).join(', ')}]` : '') });
    }
    if (action === 'info' && sp.info && !same(lp.info, sp.info)) out.push({ page, slug, kind: 'info', id: 'info', name: 'summary box', text: infoText(sp.info), ...(lp.info ? { before: infoText(lp.info) } : {}) });
    if (REWRITES.includes(action)) {
      const before = new Map((lp.items || []).map((e: any) => [String(e.id), e]));
      for (const e of sp.items || []) {
        const b: any = before.get(String(e.id));
        if (b && same(b, e)) continue;
        out.push({ page, slug, kind: 'item', id: String(e.id), name: entryName(e), text: itemText(e), ...(b ? { before: itemText(b) } : {}) });
      }
      const sBefore = new Map((lp.secrets || []).map((e: any) => [String(e.id), e]));
      for (const e of sp.secrets || []) {
        const b: any = sBefore.get(String(e.id));
        if (b && same(b, e)) continue;
        out.push({ page, slug, kind: 'secret', id: String(e.id), name: entryName(e), text: cut(e.text, 400), ...(b ? { before: cut(b.text, 400) } : {}) });
      }
      for (const x of sp.sections || []) {
        const lx = (lp.sections || []).find((s: any) => s.title === x.title);
        const eb = new Map((lx?.entries || []).map((e: any) => [String(e.id), e]));
        for (const e of x.entries || []) {
          const b: any = eb.get(String(e.id));
          if (b && same(b, e)) continue;
          out.push({ page, slug, kind: `section:${x.title}`, id: String(e.id), name: entryName(e), text: cut(e.text, 400), ...(b ? { before: cut(b.text, 400) } : {}) });
        }
      }
      for (const f of ['seoTitle', 'seoDescription'] as const)
        if (sp[f] && sp[f] !== lp[f]) out.push({ page, slug, kind: f, id: f, name: f === 'seoTitle' ? 'search title' : 'search description', text: cut(sp[f], 300), ...(lp[f] ? { before: cut(lp[f], 300) } : {}) });
    }
  }
  return out;
}

const WHAT: Record<PassAction, string> = {
  fights: 'key fights (bosses and set-piece battles) were added to pages that had none',
  missables: 'missable entries were rewritten so players can find them',
  info: 'each page got a summary box (region, levels, quests, services and people, enemy types) and directions',
  queries: 'entries were rewritten or added to answer what players search for, with clearer search titles and descriptions',
  correction: 'entries players reported as wrong were corrected, and fights players reported missing were added, each checked against sources',
};

type Verdict = { verdict: 'ok' | 'vague' | 'wrong' | 'invented' | 'worse'; reason: string };

async function judge(game: string, released: string, newer: boolean, action: PassAction, tier: ReviewTier, changes: Change[]): Promise<{ score: number; summary: string; verdicts: Verdict[]; dollars: number }> {
  const rv = reviewerFor(tier, 'careful');
  const text = [
    `You are checking one repair of a video game guide before it goes live. Game: "${game}" (released ${released}). In this repair, ${WHAT[action]}.`,
    'Judge ONLY the changes listed below. The rest of the guide (its outline, coverage, page choice and every other entry) is not part of this check.',
    ...(REWRITES.includes(action) ? [MISSABLE_STANDARD] : []),
    'Give each change a verdict:',
    '- ok: right for this game and this place, and specific enough to act on',
    '- vague: plausible but too generic to act on (no names, positions, steps or numbers)',
    '- wrong: real, but in the wrong place, or with wrong facts (weakness, reward, lockout, level)',
    '- invented: not in this game, as far as you know',
    '- worse: a rewrite that lost a correct detail the "before" had',
    newer
      ? 'This game came out after your knowledge cutoff, so these entries were written from searched sources (listed after each). Do not call a name invented only because you do not know it: judge whether it is specific, consistent with the page and plausible, and say ok unless something is clearly off.'
      : 'Use what you know about this game. Be strict about invented bosses, items and places.',
    'Then a score from 0 to 100 for these changes as a whole (90+: accurate and specific; 75: usable with a few weak entries; below 60: unreliable).',
    'Reply with JSON only: {"score": 0, "summary": "one or two sentences", "verdicts": [{"n": 1, "verdict": "ok", "reason": "a few words"}]}',
    '',
    'Changes:',
    ...changes.map((c, i) => `${i + 1}. [${c.page}] ${c.name}: ${c.text}${c.before ? `\n   before: ${c.before}` : ''}`),
  ].join('\n');
  const res: any = await call(rv, {
    contents: [{ role: 'user', parts: [{ text }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const dollars = estimateCost(rv.model, res) || 0;
  // The reply is an object (parseJson would find its verdicts array first).
  const raw = String(res?.text || '').replace(/```json|```/g, '');
  let j: any = {};
  try {
    j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    j = parseJson(raw) || {};
  }
  const ok =['ok', 'vague', 'wrong', 'invented', 'worse'];
  const verdicts: Verdict[] = changes.map((_c, i) => {
    const v = (Array.isArray(j.verdicts) ? j.verdicts : []).find((x: any) => Number(x?.n) === i + 1);
    return { verdict: ok.includes(v?.verdict) ? v.verdict : 'ok', reason: cut(v?.reason, 160) };
  });
  const score = Math.max(0, Math.min(100, Math.round(Number(j.score))));
  if (!Number.isFinite(score) || !Array.isArray(j.verdicts)) throw new Error('the reviewer did not return a readable grade for the changes');
  return { score, summary: cut(j.summary, 400), verdicts, dollars };
}

/** Take the bad changes out of the staged copy: new ones removed, rewritten ones back to the live version. */
async function dropChanges(key: string, live: Map<string, any>, staged: Map<string, any>, drop: Change[]) {
  const stage = db().collection('guides').doc(stageKey(key)).collection('areas');
  const bySlug = new Map<string, Change[]>();
  for (const c of drop) bySlug.set(c.slug, [...(bySlug.get(c.slug) || []), c]);
  for (const [slug, cs] of bySlug) {
    const lp = live.get(slug) || {};
    const sp = staged.get(slug) || {};
    const ids = (kind: string) => new Set(cs.filter((c) => c.kind === kind).map((c) => c.id));
    const patch: any = {};
    if (cs.some((c) => c.kind === 'fight')) {
      const was = new Map((lp.fights || []).map((f: any) => [String(f.id), f]));
      patch.fights = (sp.fights || []).flatMap((f: any) => (!ids('fight').has(String(f.id)) ? [f] : was.has(String(f.id)) ? [was.get(String(f.id))] : []));
    }
    if (cs.some((c) => c.kind === 'info')) patch.info = lp.info ?? FieldValue.delete();
    const revert = (field: 'items' | 'secrets', kind: string) => {
      const bad = ids(kind);
      if (!bad.size) return;
      const was = new Map((lp[field] || []).map((e: any) => [String(e.id), e]));
      patch[field] = (sp[field] || []).flatMap((e: any) => (!bad.has(String(e.id)) ? [e] : was.has(String(e.id)) ? [was.get(String(e.id))] : []));
    };
    revert('items', 'item');
    revert('secrets', 'secret');
    if (cs.some((c) => c.kind.startsWith('section:'))) {
      patch.sections = (sp.sections || []).map((x: any) => {
        const bad = ids(`section:${x.title}`);
        if (!bad.size) return x;
        const lx = (lp.sections || []).find((s: any) => s.title === x.title);
        const was = new Map((lx?.entries || []).map((e: any) => [String(e.id), e]));
        return { ...x, entries: (x.entries || []).flatMap((e: any) => (!bad.has(String(e.id)) ? [e] : was.has(String(e.id)) ? [was.get(String(e.id))] : [])) };
      });
    }
    for (const f of ['seoTitle', 'seoDescription']) if (ids(f).size) patch[f] = lp[f] ?? FieldValue.delete();
    await stage.doc(slug).set(patch, { merge: true });
  }
}

/**
 * Review a page pass's staged copy (guides/{key}--next) on its changes. Returns a Review for gateGuide (pageCount is the
 * guide's, so the 5-page rule still applies) and what it cost. dryRun: grade and report, but change nothing.
 */
export async function scopedReview(key: string, game: string, action: PassAction, tier: ReviewTier, opts: { dryRun?: boolean } = {}): Promise<{ review: Review; dollars: number; dropped: number; changes: number; regressions: string[] }> {
  const live = liveKey(key);
  const liveRef = db().collection('guides').doc(live);
  const stageRef = db().collection('guides').doc(stageKey(live));
  const [liveInfo, stageInfo, liveSnap, stageSnap] = await Promise.all([liveRef.get(), stageRef.get(), liveRef.collection('areas').get(), stageRef.collection('areas').get()]);
  const li: any = liveInfo.data() || {};
  const si: any = stageInfo.data() || {};
  const livePages = new Map(liveSnap.docs.filter((d) => ['published', 'draft'].includes(d.data().status)).map((d) => [d.id, d.data() as any]));
  const stagedPages = new Map(stageSnap.docs.map((d) => [d.id, d.data() as any]));
  const order = (x: any) => (x.areas || []).map((o: any) => String(o.slug));
  const regs = regressions(action, livePages, stagedPages, order(li).filter((s: string) => livePages.has(s)), order(si));
  const changes = changesOf(action, livePages, stagedPages);
  const rel = await guideRelease(game, li);
  const newer = releasedAfter(rel, REVIEWER_CUTOFF, !!li?.pipeline?.newRelease);
  const buildMode: Review['buildMode'] = [...livePages.values()].every((p) => p.verified === false) ? 'quick' : [...livePages.values()].some((p) => p.verified === false) ? 'mixed' : 'careful';
  const mark = passMark(tier, buildMode);

  let dollars = 0;
  const verdicts: Verdict[] = [];
  let scoreSum = 0;
  const summaries: string[] = [];
  for (let i = 0; i < changes.length; i += BATCH) {
    const part = changes.slice(i, i + BATCH);
    const j = await judge(game, rel.text, newer, action, tier, part);
    dollars += j.dollars;
    verdicts.push(...j.verdicts);
    scoreSum += j.score * part.length;
    if (j.summary) summaries.push(j.summary);
  }
  const bad = changes.filter((_c, i) => ['wrong', 'invented', 'worse'].includes(verdicts[i]?.verdict));
  const vague = changes.filter((_c, i) => verdicts[i]?.verdict === 'vague');
  const score = changes.length ? Math.round(scoreSum / changes.length) : 0;
  const droppedShare = changes.length ? bad.length / changes.length : 0;
  const pass = changes.length > bad.length && !regs.length && score >= mark && droppedShare <= MAX_DROPPED;
  if (bad.length && !opts.dryRun) await dropChanges(live, livePages, stagedPages, bad);

  const line = (c: Change) => `${c.page}: ${c.name}`;
  const reasonOf = (c: Change) => verdicts[changes.indexOf(c)]?.reason || '';
  const review: Review = {
    score, pass, recommendation: pass ? 'keep' : 'fix pages',
    summary: `Scoped review of the ${action} repair (${changes.length} change(s); ${bad.length} taken out, ${vague.length} vague)${regs.length ? `; ${regs.length} regression(s)` : ''}. ${summaries.join(' ')}`.slice(0, 900),
    layout: li.layout || 'area',
    structure: { kind: li.layout || 'area', consistent: !regs.length, problems: regs.map((r) => `Regression: ${r}`) },
    coverage: { expectedPages: '', ok: true, problems: [] },
    depth: { problems: vague.slice(0, 10).map((c) => `Vague: ${line(c)}${reasonOf(c) ? ` (${reasonOf(c)})` : ''}`) },
    knowledge: { problems: bad.slice(0, 12).map((c) => `${verdicts[changes.indexOf(c)].verdict === 'worse' ? 'Worse than before' : verdicts[changes.indexOf(c)].verdict === 'invented' ? 'Invented' : 'Wrong'}: ${line(c)}${reasonOf(c) ? ` (${reasonOf(c)})` : ''}`) },
    ordering: { ok: true, problems: [] },
    pages: [...new Set(bad.map((c) => c.page))].slice(0, 15).map((p) => ({ name: p, verdict: 'wrong entries', reason: bad.filter((c) => c.page === p).map((c) => c.name).join('; ').slice(0, 200) })),
    newerThanReviewer: newer, released: rel.text, buildMode, pageCount: livePages.size,
    model: reviewerFor(tier, 'careful').model, tier, passMark: mark, at: Date.now(),
  };
  if (!opts.dryRun) {
    // Saved apart from `review`, which promote() copies to the live guide: the guide's own whole-guide review stays.
    await stageRef.set({ scopedReview: { ...review, action, changes: changes.length, dropped: bad.length, regressions: regs }, review: FieldValue.delete() }, { merge: true });
  }
  fs.mkdirSync('scratchpad/reviews', { recursive: true });
  fs.writeFileSync(`scratchpad/reviews/${live}.${action}.md`, [
    `# ${game}: scoped review of the ${action} repair`, '',
    `Score ${score}/100 (pass mark ${mark}, ${tier}); ${pass ? 'pass' : 'fail'}. ${changes.length} change(s), ${bad.length} taken out, ${vague.length} vague.`, '',
    ...(regs.length ? ['## Regressions', ...regs.map((r) => `- ${r}`), ''] : []),
    '## Verdicts', ...changes.map((c, i) => `- ${verdicts[i]?.verdict || '?'}: ${line(c)}${verdicts[i]?.reason ? ` (${verdicts[i].reason})` : ''}`),
  ].join('\n'));
  return { review, dollars, dropped: bad.length, changes: changes.length, regressions: regs };
}
