/**
 * Core guides: depth over breadth. A short list of the most-used guides is taken to "complete", one guide at a time,
 * most popular first, within one monthly budget ($30 by default; the old flagship rollout's $20 and the compendium's $10
 * merged). The weekly Search Console entity pages (compendium.ts demandEntities) are paid from the same budget.
 *
 *   npx tsx scripts/guides/core.ts --estimate [--keys a,b,c]   what's left and what it would cost (nothing built)
 *   npx tsx scripts/guides/core.ts --run                        build the next pieces (the guide-flagship job runs this
 *                                                               through flagship.ts --program once the list is approved)
 *
 * A core guide is complete when:
 *   - every live page is a flagship walkthrough by the evidence method (claim check and Pro review passed:
 *     flagship.mode "evidence" and verified), built in the order players visit them (Search Console impressions, then
 *     the guide's own order);
 *   - the guide has a core compendium taxonomy (compendium.ts coreTaxonomy: entity types fitting the game, each with a
 *     tier, and the game's important entities by exact name);
 *   - entity pages for the important entities, at most system/core.entityCap (40) per guide: characters, NPCs and
 *     merchants, then bosses, then key locations (auto-linked in the guide and covered by the guide search at publish).
 *     Collectibles and the rest come only by Search Console demand (the weekly step, compendium.ts demandEntities).
 * Guides in system/core.keepPages (Baldur's Gate 3) keep their existing flagship pages (earlier flagship method,
 * reviewed): those count as complete and are rebuilt only when flagged (the page's `reverify` field, set by a failed
 * review or a re-verification request); only their compendium is built.
 * Pages and entities that fail review aren't retried automatically (listed in the Discord summary; add their ids to
 * system/core.retry to try again). A guide moves on once everything has been tried.
 *
 * Guides with an approved blueprint (guideBlueprints/{key}, scripts/guides/blueprintBuild.ts) follow it instead of the
 * fixed template above, first (system/core.blueprintOrder sets their order), section by section in priority order.
 *
 * system/core: { approved: true, guides: [keys in order], monthly: 30, daily: 6, month, spentMonth, day, spentToday,
 *   perGuide: { [key]: { spent, failedPages: [{slug,name,reason,score}], failedEntities: [...], done: <ms> } },
 *   retry: ["key/slug" | "key:entity-slug"], paused: { why } }
 * Nothing runs until `approved` is true and `guides` is set.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db, arg, usageScope } from './common';
import { acquireGuideLock, isRefusal, lockedLine } from './guideLock';
import { apiLimits, searchesToday, pipelineRoom, SearchDayWait } from '../../apiLimits';
import { ProQuotaWait } from './reviewerQuota';
import { isTransient } from './claimCheck';

export const CORE_MONTHLY_DEFAULT = 30;
export const CORE_DAILY_DEFAULT = 6;
/** Measured: the evidence method's page ($18.16 for 81 pages, failures included) and an entity page's first build. */
export const PAGE_COST = 0.224;
export const ENTITY_COST = 0.17;
export const TAXONOMY_COST = 0.05;
/** Entities a game's core taxonomy lists, until its taxonomy is built (then its own count). */
export const ENTITIES_GUESS = 120; // (before the cap; kept for reference)
/** Build order of the entity tiers. */
export const TIERS = ['people', 'bosses', 'locations', 'collectibles', 'other'] as const;
/** The tiers the programme builds (the rest only by Search Console demand), and the default cap per guide. */
export const CORE_TIERS = ['people', 'bosses', 'locations'];
export const ENTITY_CAP_DEFAULT = 40;

const MINUTES = Number(process.env.FLAGSHIP_MINUTES || 150);
const RUN_STARTED = Date.now();
const DAY_TZ = 'America/Chicago';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: DAY_TZ });
const month = () => new Date().toISOString().slice(0, 7);
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cref = () => db().collection('system').doc('core');

/**
 * A page that meets the core standard: a flagship page by the evidence method that passed (claim check, Pro review).
 * keep: the guide keeps its existing flagship pages (system/core.keepPages): any flagship page counts unless flagged.
 */
export const isCorePage = (a: any, keep = false) =>
  a?.status === 'published' && (keep ? !!a?.flagship && !a?.reverify : a?.flagship?.mode === 'evidence' && a?.verified === true);

/** The programme's settings (system/core): the guides whose pages are kept, and the entity cap. */
async function coreConfig() {
  const st: any = (await cref().get()).data() || {};
  return { keep: new Set<string>((st.keepPages || []).map(String)), cap: Number.isFinite(Number(st.entityCap)) ? Number(st.entityCap) : ENTITY_CAP_DEFAULT };
}

/** The guide's planned core entities: the core tiers only, in build order, the first `cap`. */
function plannedCore(comp: any, cap: number): any[] {
  const tierIdx = (tier: string) => CORE_TIERS.indexOf(tier);
  const tierOf = new Map<string, number>((comp?.taxonomy || []).map((t: any) => [t.id, tierIdx(t.tier)]));
  return (comp?.entities || [])
    .filter((e: any) => e?.slug && (tierOf.get(e.type) ?? -1) >= 0)
    .sort((a: any, b: any) => (tierOf.get(a.type)! - tierOf.get(b.type)!) || (Number(a.rank) || 999) - (Number(b.rank) || 999))
    .slice(0, cap);
}

/** The shared budget: this month's and today's spending against the caps. */
export async function coreBudget() {
  const st: any = (await cref().get()).data() || {};
  const monthly = Number.isFinite(Number(st.monthly)) ? Number(st.monthly) : CORE_MONTHLY_DEFAULT;
  const daily = Number.isFinite(Number(st.daily)) ? Number(st.daily) : CORE_DAILY_DEFAULT;
  const spentMonth = st.month === month() ? Number(st.spentMonth || 0) : 0;
  const spentToday = st.day === today() ? Number(st.spentToday || 0) : 0;
  return { monthly, daily, spentMonth, spentToday, room: Math.max(0, Math.min(monthly - spentMonth, daily - spentToday)), monthRoom: Math.max(0, monthly - spentMonth) };
}

/** Charge spending to the shared budget (and to a guide), resetting the month and day counters when they turn. */
export async function chargeCore(dollars: number, key?: string): Promise<void> {
  if (!(dollars > 0)) return;
  await db().runTransaction(async (tx) => {
    const st: any = (await tx.get(cref())).data() || {};
    const m = month(), d = today();
    const upd: any = {
      month: m, spentMonth: (st.month === m ? Number(st.spentMonth || 0) : 0) + dollars,
      day: d, spentToday: (st.day === d ? Number(st.spentToday || 0) : 0) + dollars,
    };
    if (key) upd.perGuide = { [key]: { spent: FieldValue.increment(dollars) } };
    tx.set(cref(), upd, { merge: true });
  });
}

/** One guide's completeness: flagship pages, compendium entities, and what it has cost so far (pages and entities). */
export async function coreStatus(key: string, cfg?: { keep: Set<string>; cap: number }) {
  const { keep, cap } = cfg || (await coreConfig());
  const gref = db().collection('guides').doc(key);
  const info: any = (await gref.get()).data() || {};
  const pages = (await gref.collection('areas').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) })).filter((a) => a.status === 'published');
  const corePages = pages.filter((a) => isCorePage(a, keep.has(key)));
  const comp: any = (await db().collection('guideCompendium').doc(key).get()).data() || null;
  const ents = comp ? (await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) })) : [];
  const planned: any[] = comp?.core ? plannedCore(comp, cap) : [];
  const plannedSlugs = new Set(planned.map((e) => e.slug));
  const published = ents.filter((e) => e.status === 'published');
  const tried = ents.filter((e) => plannedSlugs.has(e.slug));
  const cost =
    corePages.reduce((n, a) => n + (Number(a.flagship?.cost) || 0), 0) +
    ents.reduce((n, e) => n + (Number(e.cost?.dollars) || 0), 0) +
    (Number(comp?.cost?.dollars) || 0) + (Number(comp?.core?.cost?.dollars) || 0);
  const pagesLeft = pages.length - corePages.length;
  // Until the taxonomy is built, the cap is the plan (pages already published count toward it).
  const entitiesTotal = comp?.core ? planned.length : cap;
  const entitiesPublished = comp?.core ? published.filter((e) => plannedSlugs.has(e.slug)).length : Math.min(cap, published.length);
  const entitiesLeft = comp?.core ? planned.filter((e) => !ents.some((x) => x.slug === e.slug)).length : Math.max(0, cap - published.length);
  const left = pagesLeft * PAGE_COST + entitiesLeft * ENTITY_COST + (comp?.core ? 0 : TAXONOMY_COST);
  return {
    key, game: String(info.game || key), pages: pages.length, corePages: corePages.length, pagesLeft, keptPages: keep.has(key),
    taxonomy: !!comp?.core, entitiesTotal, entitiesPublished, entitiesTried: tried.length, entitiesLeft, cap, cost, left,
  };
}

/** The estimate for a list of guides (the approved list by default): per guide and in all, with months at the budget. */
export async function coreEstimate(keys?: string[]) {
  const st: any = (await cref().get()).data() || {};
  const list = keys?.length ? keys : (st.guides || []);
  const cfg = await coreConfig();
  const rows = [];
  for (const k of list) rows.push(await coreStatus(k, cfg));
  const total = rows.reduce((n, r) => n + r.left, 0);
  const monthly = Number(st.monthly) || CORE_MONTHLY_DEFAULT;
  return { rows, total, monthly, months: total / monthly };
}

/** The guide's pages still to build, the most-visited first (Search Console impressions, then the guide's order). */
async function pagesToBuild(key: string, failed: Set<string>, retry: Set<string>, keep = false) {
  const gref = db().collection('guides').doc(key);
  const info: any = (await gref.get()).data() || {};
  const order: { slug: string; name: string }[] = info.areas || [];
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const impr = new Map<string, number>();
  for (const p of sc.topPages || []) if (p.key === key) impr.set(p.slug, (impr.get(p.slug) || 0) + Number(p.impressions || 0));
  const pos = (s: string) => { const i = order.findIndex((o) => o.slug === s); return i < 0 ? 9999 : i; };
  return (await gref.collection('areas').get()).docs
    .map((d) => ({ slug: d.id, ...(d.data() as any) }))
    .filter((a) => a.status === 'published' && !isCorePage(a, keep) && (!failed.has(a.slug) || retry.has(`${key}/${a.slug}`)))
    .sort((a, b) => (impr.get(b.slug) || 0) - (impr.get(a.slug) || 0) || pos(a.slug) - pos(b.slug))
    .map((a) => ({ slug: a.slug as string, name: String(a.name || a.slug) }));
}

/** The guide's planned core entities still to build (the core tiers, in order, within the cap). */
async function entitiesToBuild(key: string, comp: any, failed: Set<string>, retry: Set<string>, cap: number) {
  const built = new Set((await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.filter((d) => d.data().status === 'published' || !retry.has(`${key}:${d.id}`)).map((d) => d.id));
  return plannedCore(comp, cap).filter((e: any) => !built.has(e.slug) && (!failed.has(e.slug) || retry.has(`${key}:${e.slug}`)));
}

/**
 * The owner's checkpoint (system/core.checkpoint { since, pages: 10, maxAvg: 0.40, minPass: 0.70 }), rolling: every
 * time that many units (pages, quest pages, entity, list and reference pages) have been built since the last check
 * (system/core.pageLog), their average cost and pass rate are saved on the checkpoint, and the programme pauses itself
 * if the average is over maxAvg or the pass rate under minPass. Returns the reason when it paused.
 */
async function checkpoint(): Promise<string | null> {
  const st: any = (await cref().get()).data() || {};
  const cp = st.checkpoint;
  if (!cp) return null;
  const from = Math.max(Number(cp.since || 0), Number(cp.result?.at || 0));
  const log = ((st.pageLog || []) as any[]).filter((x) => Number(x.at) > from);
  const n = Number(cp.pages || 10);
  if (log.length < n) return null;
  const first = log.sort((a, b) => a.at - b.at).slice(0, n);
  const avg = first.reduce((s, x) => s + Number(x.dollars || 0), 0) / first.length;
  const pass = first.filter((x) => x.status === 'passed').length / first.length;
  const bad = avg > Number(cp.maxAvg ?? 0.4) || pass < Number(cp.minPass ?? 0.7);
  const why = `checkpoint after ${n} pages: average $${avg.toFixed(3)} a page, ${Math.round(pass * 100)}% passed (limits: $${Number(cp.maxAvg ?? 0.4).toFixed(2)}, ${Math.round(Number(cp.minPass ?? 0.7) * 100)}%)`;
  await cref().set({ checkpoint: { ...cp, result: { at: Date.now(), avg, pass, pages: n, paused: bad }, history: FieldValue.arrayUnion({ at: Date.now(), avg: Math.round(avg * 1000) / 1000, pass: Math.round(pass * 100) / 100 }) }, ...(bad ? { paused: { at: Date.now(), why } } : {}) }, { merge: true });
  console.log(`\nCore guides ${why}${bad ? ': paused until the owner decides.' : ': within the limits, carrying on.'}`);
  return bad ? `Paused: ${why}` : null;
}

/** A built unit for the checkpoint (pages, quest, entity, list and reference pages); the reason when it paused. */
export async function logUnit(u: { key: string; slug: string; status: string; dollars: number }): Promise<string | null> {
  await cref().set({ pageLog: FieldValue.arrayUnion({ key: u.key, slug: u.slug, status: u.status, dollars: Math.round(u.dollars * 1000) / 1000, at: Date.now() }) }, { merge: true });
  return checkpoint();
}

/** One run: the first incomplete guide in the list, then the next, while the budget, time and limits allow. */
export async function runCore(): Promise<void> {
  const st: any = (await cref().get()).data() || {};
  if (!st.approved || !Array.isArray(st.guides) || !st.guides.length) { console.log('Core guides: no approved list yet (system/core.approved and guides). Nothing to do.'); return; }
  if (st.paused) { console.log(`Core guides: paused (${st.paused.why || 'until the owner says go'}).`); return; }
  const { buildPageEvidenceForCore, writePageForCore, publishSiteForCore } = await import('./flagship');
  const { coreTaxonomy, buildEntity } = await import('./compendium');
  const retry = new Set<string>((st.retry || []).map(String));
  const cfg = await coreConfig();
  let wentLive = false;
  const timeUp = () => Date.now() - RUN_STARTED > MINUTES * 60_000;
  // The compendium rollout to the new method first (rollout.ts): rebuilds across guides by demand, then (from
  // system/core.newPages.from) the blueprints' new entity pages.
  // Blueprint sections the rollout waits for (system/core.rollout.after: [{key, section}], e.g. RDR2's Stranger
  // missions) are built first.
  for (const g of ((st.rollout?.after || []) as { key: string; section: string }[])) {
    const bp: any = (await db().collection('guideBlueprints').doc(g.key).get()).data();
    if (bp?.status !== 'approved' || bp.progress?.[g.section]?.done) continue;
    const lk = await acquireGuideLock(g.key, 'core blueprint');
    if (isRefusal(lk)) { console.log(lockedLine(lk, g.key)); return; }
    try {
      const { runBlueprint: runFirst } = await import('./blueprintBuild');
      const r = await runFirst(g.key, { room: async () => (await coreBudget()).room, charge: (d) => chargeCore(d, g.key), logUnit, timeUp }, { only: [g.section] });
      if (r.wentLive) wentLive = true;
      if (r.stopped) { console.log(`
${r.stopped}; the next run carries on.`); await lk.release(); if (wentLive) await publishSiteForCore(); return; }
    } finally {
      await lk.release().catch(() => {});
    }
  }
  {
    const { runRollout } = await import('./rollout');
    const r = await runRollout({ room: async () => (await coreBudget()).room, charge: (d, k) => chargeCore(d, k), logUnit, timeUp });
    if (r.wentLive) wentLive = true;
    if (r.stopped) { console.log(`
${r.stopped}; the next run carries on.`); if (wentLive) await publishSiteForCore(); return; }
  }
  // Guides with an approved blueprint follow it (blueprintBuild.ts), first, in system/core.blueprintOrder.
  const approved = (await db().collection('guideBlueprints').where('status', '==', 'approved').get()).docs.map((d) => d.id);
  const bpOrder = [...((st.blueprintOrder || []) as string[]).filter((k) => approved.includes(k)), ...approved.filter((k) => !(st.blueprintOrder || []).includes(k))];
  const { runBlueprint } = await import('./blueprintBuild');
  for (const key of bpOrder) {
    const lk = await acquireGuideLock(key, 'core blueprint');
    if (isRefusal(lk)) { console.log(lockedLine(lk, key)); continue; }
    try {
      const r = await runBlueprint(key, {
        room: async () => (await coreBudget()).room,
        charge: (d) => chargeCore(d, key),
        logUnit,
        timeUp,
      });
      if (r.wentLive) wentLive = true;
      if (r.stopped) { console.log(`\n${r.stopped}; the next run carries on.`); await lk.release(); if (wentLive) await publishSiteForCore(); return; }
      if (r.done) console.log(`\n${key}: blueprint complete.`);
    } finally {
      await lk.release().catch(() => {});
    }
  }
  let transientRow = 0;
  const stop = (why: string) => { console.log(`\n${why}; the next run carries on.`); return true; };

  guides: for (const key of st.guides as string[]) {
    const pg = { failedPages: [], failedEntities: [], ...((st.perGuide || {})[key] || {}) } as any;
    if (pg.done || approved.includes(key)) continue; // a guide with an approved blueprint follows it (above)
    const gref = db().collection('guides').doc(key);
    const info: any = (await gref.get()).data();
    if (!info) { console.log(`${key}: no such guide; skipped.`); continue; }
    const game = String(info.game || key);
    const lk = await acquireGuideLock(key, 'core guide');
    if (isRefusal(lk)) { console.log(lockedLine(lk, game)); break; }
    const savePg = () => cref().set({ perGuide: { [key]: { failedPages: pg.failedPages, failedEntities: pg.failedEntities, ...(pg.done ? { done: pg.done } : {}) } } }, { merge: true });
    let stopped = false;
    try {
      // 1. Pages: every live page a flagship walkthrough by the evidence method, the most-visited first.
      const failedP = new Set<string>(pg.failedPages.map((f: any) => f.slug));
      const pages = await pagesToBuild(key, failedP, retry, cfg.keep.has(key));
      for (const p of pages) {
        const b = await coreBudget();
        if (b.room < PAGE_COST * 1.5) { stopped = stop(b.monthRoom < PAGE_COST * 1.5 ? `This month's $${b.monthly} is used up` : `Today's $${b.daily} is used up`); break; }
        if (timeUp()) { stopped = stop('Time limit for this run'); break; }
        if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 15) { stopped = stop("Today's pipeline searches are used up"); break; }
        const scope = { dollars: 0, searches: 0 };
        let r: any = null;
        try {
          r = await usageScope.run(scope, () => buildPageEvidenceForCore(key, game, p.slug, info.areas || [], key));
        } catch (e: any) {
          await chargeCore(scope.dollars, key);
          if (e instanceof SearchDayWait || e instanceof ProQuotaWait || /search day limit/.test(String(e?.message || e))) { stopped = stop(String(e?.message || e)); break; }
          if (isTransient(e)) { if (++transientRow >= 3) { stopped = stop('The API keeps failing'); break; } continue; }
          pg.failedPages.push({ slug: p.slug, name: p.name, reason: `not built: ${cut(e?.message || e, 120)}` });
          await savePg();
          continue;
        }
        transientRow = 0;
        await chargeCore(scope.dollars, key);
        if (r?.review?.status === 'waiting') { stopped = stop('No Pro reviewer requests left today'); break; }
        if (r?.review?.status === 'passed') {
          await writePageForCore(key, p.slug, r.proto);
          await gref.set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(p.slug) } }, { merge: true });
          wentLive = true;
          pg.failedPages = pg.failedPages.filter((f: any) => f.slug !== p.slug);
        } else {
          pg.failedPages = [...pg.failedPages.filter((f: any) => f.slug !== p.slug), { slug: p.slug, name: p.name, reason: cut(r?.review?.reason || 'failed review', 160), score: r?.review?.score ?? null }];
        }
        console.log(`  [core] ${game} / ${p.name}: ${r?.review?.status || 'not built'}${r?.review?.score != null ? ` ${r.review.score}` : ''}, $${scope.dollars.toFixed(3)}`);
        await savePg();
        await cref().set({ pageLog: FieldValue.arrayUnion({ key, slug: p.slug, status: r?.review?.status || 'not built', dollars: Math.round(scope.dollars * 1000) / 1000, at: Date.now() }) }, { merge: true });
        const cp = await checkpoint();
        if (cp) { stopped = stop(cp); break; }
      }
      if (stopped) break guides;

      // 2. The compendium taxonomy for this game's structure (its own entity types, each with a tier).
      let comp: any = (await db().collection('guideCompendium').doc(key).get()).data() || {};
      if (!comp.core) {
        const b = await coreBudget();
        if (b.room < TAXONOMY_COST * 2) { stop('No budget left for the taxonomy'); break guides; }
        const scope = { dollars: 0, searches: 0 };
        try {
          await usageScope.run(scope, () => coreTaxonomy(key));
        } finally {
          await chargeCore(scope.dollars, key);
        }
        comp = (await db().collection('guideCompendium').doc(key).get()).data() || {};
        if (!comp.core) { console.log(`${game}: the core taxonomy didn't come out; tried again next run.`); break guides; }
      }

      // 3. Entity pages, important ones first.
      const failedE = new Set<string>(pg.failedEntities.map((f: any) => f.slug));
      const ents = await entitiesToBuild(key, comp, failedE, retry, cfg.cap);
      for (const e of ents) {
        const b = await coreBudget();
        if (b.room < ENTITY_COST * 1.5) { stopped = stop(b.monthRoom < ENTITY_COST * 1.5 ? `This month's $${b.monthly} is used up` : `Today's $${b.daily} is used up`); break; }
        if (timeUp()) { stopped = stop('Time limit for this run'); break; }
        if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 10) { stopped = stop("Today's pipeline searches are used up"); break; }
        const scope = { dollars: 0, searches: 0 };
        try {
          const r = await usageScope.run(scope, () => buildEntity(key, e.name, { type: e.type }));
          if (r.status === 'published') wentLive = true;
          else pg.failedEntities = [...pg.failedEntities.filter((f: any) => f.slug !== e.slug), { slug: e.slug, name: e.name, reason: `review ${r.score}` }];
        } catch (err: any) {
          if (err instanceof SearchDayWait || err instanceof ProQuotaWait) { await chargeCore(scope.dollars, key); stopped = stop(String(err?.message || err)); break; }
          if (!isTransient(err)) pg.failedEntities = [...pg.failedEntities.filter((f: any) => f.slug !== e.slug), { slug: e.slug, name: e.name, reason: cut(err?.message || err, 100) }];
        }
        await chargeCore(scope.dollars, key);
        await savePg();
      }
      if (stopped) break guides;

      // Everything tried: this guide is done (failures listed); the next guide starts in the same run.
      pg.done = Date.now();
      await savePg();
      console.log(`\n${game}: core guide complete (${pg.failedPages.length} page(s) and ${pg.failedEntities.length} entity page(s) failed review).`);
    } finally {
      await lk.release();
    }
  }
  if (retry.size) await cref().set({ retry: [] }, { merge: true });
  if (wentLive) await publishSiteForCore();
}

async function main() {
  if (arg('estimate') === 'true') {
    const keys = arg('keys') && arg('keys') !== 'true' ? String(arg('keys')).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const e = await coreEstimate(keys);
    for (const r of e.rows) console.log(`${r.game}: flagship pages ${r.corePages}/${r.pages}${r.keptPages ? ' (existing pages kept)' : ''}, compendium ${r.entitiesPublished}/${r.entitiesTotal} (cap ${r.cap}), cost so far $${r.cost.toFixed(2)}, left ≈ $${r.left.toFixed(2)}`);
    console.log(`\nIn all ≈ $${e.total.toFixed(2)} left, about ${e.months.toFixed(1)} month(s) at $${e.monthly} a month.`);
  } else if (arg('run') === 'true') await runCore();
  setTimeout(() => process.exit(0), 500);
}
if (/core\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('core failed:', e?.message || e); process.exit(1); });
