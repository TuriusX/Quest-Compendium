/**
 * The compendium rollout to the intent-first method (entityV2.ts), run by the core programme (core.ts) before
 * anything else, paid from the core budget, with the core checkpoint:
 *
 *   1. Rebuilds (system/core.rollout {guides}): every live entity page still built the old way, across those guides
 *      together, in order of demand (entities/{slug}.demand.score: Search Console impressions plus in-app questions,
 *      scripts/pipeline/scCompendium.ts; ties by the type's tier). A page that's held keeps its live version.
 *   2. New pages (system/core.newPages {from, first: {key, section}}): from that date and once the rebuilds are done,
 *      the approved blueprints' entity sections (RDR2 animals, fish, bounties, hideouts; BG3 companions, NPCs,
 *      illithid powers), the first section's names first, then all other names in order of demand
 *      (guideBlueprints/{key}.planDemand from scCompendium.ts). A held new page isn't shown.
 *
 * Each unit is logged in system/core.rolloutLog for the pipeline summary's daily line.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common';
import { apiLimits, searchesToday, pipelineRoom, SearchDayWait } from '../../apiLimits';
import { ProQuotaWait } from './reviewerQuota';
import { isTransient } from './claimCheck';
import { CORE_TIERS } from './core';
/** What the core programme lends the rollout: its budget room and charge, the checkpoint log, the run's time limit. */
export type RolloutCtx = {
  room: () => Promise<number>;
  charge: (dollars: number, key: string) => Promise<void>;
  logUnit: (u: { key: string; slug: string; status: string; dollars: number }) => Promise<string | null>;
  timeUp: () => boolean;
};

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** About what a page costs (rebuild about $0.20, new page about $0.25; the retry can take it to $0.30). */
const UNIT = 0.3;
const cref = () => db().collection('system').doc('core');
const isStop = (e: any) => e instanceof ProQuotaWait || e instanceof SearchDayWait || /search day limit|ProQuotaWait|Pro reviewer/i.test(String(e?.message || e) + String(e?.name || '')) || isTransient(e);

type Unit = { key: string; name: string; slug: string; type?: string; section?: string; score: number; tier: number; at: number };

/** Live entity pages still built the old way, across the rollout's guides, by demand. */
export async function rebuildQueue(guides: string[]): Promise<Unit[]> {
  const out: Unit[] = [];
  for (const key of guides) {
    const tax = (((await db().collection('guideCompendium').doc(key).get()).data() || {}).taxonomy || []) as any[];
    const tier = (type: string) => { const t = tax.find((x) => x.id === type)?.tier; return CORE_TIERS.includes(t) ? CORE_TIERS.indexOf(t) : 9; };
    const docs = (await db().collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get()).docs;
    docs.forEach((d, i) => {
      const e: any = d.data();
      if (e.kind === 'quest' || e.quest || e.ref || e.method === 'intent' || e.v2Held) return;
      out.push({ key, name: String(e.name), slug: d.id, type: e.type, score: Number(e.demand?.score || 0), tier: tier(e.type), at: i });
    });
  }
  return out.sort((a, b) => b.score - a.score || a.tier - b.tier || a.at - b.at);
}

/** The blueprints' entity sections not built yet: the first section's names first, then the rest by demand. */
export async function newPagesQueue(first?: { key: string; section: string }): Promise<Unit[]> {
  const { planEntitySection } = await import('./blueprintBuild');
  const out: Unit[] = [];
  for (const d of (await db().collection('guideBlueprints').where('status', '==', 'approved').get()).docs) {
    const b: any = d.data();
    for (const s of b.sections || []) {
      if (s.unit !== 'entity' || /rebuild/i.test(`${s.id} ${s.title}`) || b.progress?.[s.id]?.done) continue;
      const plan = await planEntitySection(d.id, s.id);
      if (!plan) continue;
      const built = new Set((b.progress?.[s.id]?.built || []).map((x: any) => x.name));
      const isFirst = first?.key === d.id && first?.section === s.id;
      plan.names.forEach((name, i) => {
        if (built.has(name)) return;
        out.push({ key: d.id, name, slug: '', type: s.id, section: s.id, score: isFirst ? Number.MAX_SAFE_INTEGER - i : Number(b.planDemand?.[s.id]?.[name] || 0), tier: 0, at: i });
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.at - b.at);
}

/** One run's share of the rollout. Returns whether anything went live and why it stopped (budget, time, limits). */
export async function runRollout(ctx: RolloutCtx): Promise<{ wentLive: boolean; stopped: string | null }> {
  const st: any = (await cref().get()).data() || {};
  const ro = st.rollout;
  const np = st.newPages;
  if (!ro?.guides?.length && !np) return { wentLive: false, stopped: null };
  const { buildEntityV2 } = await import('./entityV2');
  const { recordEntityUnit } = await import('./blueprintBuild');
  let wentLive = false;
  const before = async () => {
    if (ctx.timeUp()) return 'Time limit for this run';
    if ((await ctx.room()) < UNIT * 1.5) return 'Budget for today or this month is used up';
    if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 20) return "Today's pipeline searches are used up";
    return null;
  };
  const build = async (u: Unit, phase: 'rebuild' | 'new') => {
    let r: any;
    try {
      r = await buildEntityV2(u.key, u.name, { type: u.type });
    } catch (e: any) {
      if (isStop(e)) return { stop: `Stopped: ${cut(e?.message || e, 120)}` };
      // Not the method's verdict (a bad name, a missing guide): recorded so it isn't retried every run.
      r = { status: 'error', reasons: [cut(e?.message || e, 160)], dollars: 0, slug: u.slug };
      if (phase === 'rebuild') await db().collection('guideCompendium').doc(u.key).collection('entities').doc(u.slug).set({ v2Held: { at: Date.now(), reasons: r.reasons } }, { merge: true });
    }
    await ctx.charge(r.dollars, u.key);
    if (r.status === 'published') wentLive = true;
    if (phase === 'new' && u.section) await recordEntityUnit(u.key, u.section, { name: u.name, slug: r.slug, status: r.status, dollars: r.dollars });
    await cref().set({ rolloutLog: FieldValue.arrayUnion({ phase, key: u.key, slug: r.slug || u.slug, name: u.name, status: r.status, reasons: (r.reasons || []).slice(0, 2).map((x: string) => cut(x, 160)), dollars: Math.round(r.dollars * 1000) / 1000, at: Date.now() }) }, { merge: true });
    console.log(`  [rollout] ${u.key} / ${u.name}: ${r.status}${r.reasons?.length ? ` (${cut(r.reasons.join(' | '), 140)})` : ''}, $${Number(r.dollars).toFixed(3)}`);
    const paused = await ctx.logUnit({ key: u.key, slug: r.slug || u.slug, status: r.status === 'published' ? 'passed' : 'failed', dollars: r.dollars });
    return paused ? { stop: paused } : {};
  };

  // 1. Rebuilds.
  if (ro?.guides?.length && !ro.done) {
    const queue = await rebuildQueue(ro.guides);
    for (const u of queue) {
      const why = await before();
      if (why) return { wentLive, stopped: why };
      const r = await build(u, 'rebuild');
      if (r.stop) return { wentLive, stopped: r.stop };
    }
    if (!(await rebuildQueue(ro.guides)).length) {
      await cref().set({ rollout: { done: Date.now() } }, { merge: true });
      console.log('Compendium rollout: every live entity page in the rollout guides is built with the new method (or kept, held).');
    }
  }
  // 2. New pages: from newPages.from, after the rebuilds.
  const today = new Date().toISOString().slice(0, 10);
  if (np && (!ro?.guides?.length || ro.done || (await cref().get()).data()?.rollout?.done) && today >= String(np.from || '')) {
    for (const u of await newPagesQueue(np.first)) {
      const why = await before();
      if (why) return { wentLive, stopped: why };
      const r = await build(u, 'new');
      if (r.stop) return { wentLive, stopped: r.stop };
    }
  }
  return { wentLive, stopped: null };
}

/** The pipeline summary's daily line: the last day's rollout units, and the core budget left this month. */
export async function rolloutLine(): Promise<string | null> {
  const st: any = (await cref().get()).data() || {};
  if (!st.rollout && !st.newPages) return null;
  const since = Date.now() - 24 * 3600_000;
  const log = ((st.rolloutLog || []) as any[]).filter((x) => Number(x.at) >= since);
  const { coreBudget } = await import('./core');
  const b = await coreBudget();
  const rebuilt = log.filter((x) => x.status === 'published');
  const held = log.filter((x) => x.status !== 'published');
  const left = (await rebuildQueue(st.rollout?.guides || [])).length;
  const cost = log.reduce((a, x) => a + Number(x.dollars || 0), 0);
  const heldText = held.length ? ` (${held.slice(0, 6).map((x) => `${x.name}: ${cut((x.reasons || [])[0] || x.status, 90)}`).join('; ')}${held.length > 6 ? `; and ${held.length - 6} more` : ''})` : '';
  return `🧩 Compendium rollout: ${rebuilt.length} page(s) rebuilt with the new method, ${held.length} held${heldText}; $${cost.toFixed(2)} in the last day. ${st.rollout?.done ? 'Rebuilds done.' : `${left} page(s) left to rebuild.`} Core budget left this month: $${Math.max(0, b.monthly - b.spentMonth).toFixed(2)}.`;
}
