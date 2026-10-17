/**
 * Building an approved guide blueprint (guideBlueprints/{key}, status "approved"): the core programme (core.ts) runs
 * this instead of its fixed template for guides that have one. Sections go in priority order, each up to its own cap:
 *
 *   walkthrough, new page   a page the guide lacks (Epilogue Part 1): created as a draft in its place in the guide's
 *                           order, built with the evidence method, published when it passes the review
 *   walkthrough, deepen     an existing thin page (Chapter 6, Brain Stem) rebuilt with the evidence method
 *   quest-short / quest-full  quest pages (quests.ts): story missions short, Stranger strands and side quests full
 *   entity                  entity pages of the section's own type (compendium.ts), e.g. legendary animals
 *   list-page / page        list pages and reference pages (refpages.ts)
 *
 * What a section covers (its quest names, animals, page topics) is researched once (one searched call) and saved in
 * the blueprint's progress (progress.{section}.plan). Every built unit is logged for the checkpoint (core.ts).
 * Shared standards hold: the evidence check and review gate, stable addresses (new pages get new addresses; nothing
 * existing is renamed), the shared budget.
 */
import { ThinkingLevel } from '@google/genai';
import { FieldValue } from 'firebase-admin/firestore';
import { db, gemini, MODEL, usageScope, searchesIn } from './common';
import { entitySlug } from './compendium';
import { chapterKey } from './siteText';
import { apiLimits, searchesToday, pipelineRoom } from '../../apiLimits';
import { isTransient } from './claimCheck';
import { notifyOwner } from '../pipeline/summary';

/** A stop that isn't the unit's fault (the day's search or Pro limit, the API down): the run stops, nothing is recorded. */
const isStop = (e: any) => /search day limit|ProQuotaWait|Pro reviewer|no Pro reviewer/i.test(String(e?.message || e) + String(e?.name || '')) || isTransient(e);

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
type Section = { id: string; title: string; kind: string; what?: string; unit: string; units: number; cap?: number; priority: number; cost?: number };
type Progress = { plan?: string[]; planChapters?: Record<string, string>; built: { name: string; slug?: string; status: string; dollars: number }[]; done?: number };
/** What a unit usually costs (measured), for the budget check before starting one. */
const UNIT_COST: Record<string, number> = { page: 0.4, 'quest-short': 0.08, 'quest-full': 0.15, entity: 0.15, 'list-page': 0.35 };

export type BlueprintCtx = {
  /** Room left in the shared budget (today and this month). */
  room: () => Promise<number>;
  charge: (dollars: number) => Promise<void>;
  /** Log a built unit; returns a reason when the checkpoint paused the programme. */
  logUnit: (u: { key: string; slug: string; status: string; dollars: number }) => Promise<string | null>;
  timeUp: () => boolean;
};

/**
 * How many names a section may build: its cap (the owner's limit) when it has one, else its estimated units. The
 * estimate isn't a limit on a plan with a cap: RDR2's story missions were estimated at 108 units, capped at 120 and
 * planned with 122 names, and building only the first 108 cut off all of Epilogue Part 2.
 */
export const sectionLimit = (s: { units: number; cap?: number }) => Math.max(0, s.cap != null ? Number(s.cap) || 0 : Number(s.units) || 0);

/**
 * A section's plan against what's built: the names to build next (in plan order, up to the limit), the names beyond
 * the limit (waiting for the owner to raise the cap), whether the plan names more than the estimate, and whether
 * every planned name is built (only then is the section done).
 */
/**
 * A section's whole plan: its names, then any the plan's chapter list has that the names lost (plans saved before the
 * names stopped being cut to the estimate), in the order they were researched.
 */
export function fullPlan(p: { plan?: string[]; planChapters?: Record<string, string> }): string[] {
  const plan = Array.isArray(p.plan) ? p.plan : [];
  const has = new Set(plan);
  return [...plan, ...Object.keys(p.planChapters || {}).filter((n) => !has.has(n))];
}

export function unitsToBuild(s: { units: number; cap?: number }, plan: string[], built: { name: string }[]) {
  const want = Math.min(sectionLimit(s), plan.length);
  const has = new Set(built.map((b) => b.name));
  return {
    want,
    next: plan.slice(0, want).filter((n) => !has.has(n)),
    beyondCap: plan.slice(want).filter((n) => !has.has(n)),
    overUnits: plan.length > (Number(s.units) || 0),
    complete: plan.length > 0 && plan.every((n) => has.has(n)),
  };
}

const isDeepen = (s: Section) => /deepen|expan|flesh|thin|enhance/i.test(`${s.id} ${s.title}`);
const isRebuildExisting = (s: Section) => s.unit === 'entity' && /rebuild/i.test(`${s.id} ${s.title}`);

/** The names a section covers: one searched call, saved in the blueprint's progress. */
async function planSection(game: string, s: Section, n: number): Promise<{ names: string[]; chapters: Record<string, string> }> {
  const noun = s.unit === 'quest-short' ? 'story missions, in the order they are played' : s.unit === 'quest-full' ? 'Stranger mission strands and side quests (one name per strand), in the order they first become available' : s.unit === 'entity' ? 'entries' : 'page titles (one topic each)';
  // Quests come with their chapter (the one they're in, or first become available in), for the compendium's grouping.
  const quest = s.unit === 'quest-short' || s.unit === 'quest-full';
  const shape = quest ? 'Reply one per line as: chapter | name (e.g. "Chapter 2 | Who Is Not Without Sin", "Epilogue Part 1 | Pouring Forth Oil"), no numbering or commentary.' : 'Reply with the names only, one per line, no numbering or commentary.';
  // Searched, never from memory: asked again firmly when the reply ran no searches, refused if it still didn't.
  let res: any = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const r: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `${attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : ''}For a player's guide to the video game "${game}", the section "${s.title}" (${s.what || ''}): list the ${n} ${noun} it covers, exact in-game names${quest ? '' : ', most important first'}. Run a few searches (the game's wikis and guides; never fandom.com or fextralife.com). ${shape}` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    console.log(`  [plan] ${s.title}: ${searchesIn(r)} searches`);
    if (searchesIn(r)) res = r;
  }
  if (!res) throw new Error(`the plan for "${s.title}" ran no searches twice; not using a memory answer`);
  const lines = String(res?.text || '').split('\n').map((l) => l.replace(/^[\s*\-\d.)]+/, '').replace(/\*\*/g, '').trim()).filter((l) => l.length >= 2 && l.length <= 160 && !/^(here|sure|note)/i.test(l));
  const names: string[] = [];
  const chapters: Record<string, string> = {};
  for (const l of lines) {
    const bar = quest ? l.indexOf('|') : -1;
    const name = (bar >= 0 ? l.slice(bar + 1) : l).trim();
    if (!name || name.length > 100 || names.includes(name)) continue;
    names.push(name);
    if (bar >= 0) chapters[name] = l.slice(0, bar).trim().slice(0, 60);
  }
  // Every name the reply gives is kept: the plan is what the section covers, and the cap limits what gets built. (Cutting
  // the list to the estimate here is how Epilogue Part 2 fell off RDR2's plan while its chapters were still recorded.)
  return { names: names.slice(0, 400), chapters };
}

/** A new walkthrough page (Epilogue Part 1): its name and where it goes in the guide's order. */
async function newPage(key: string, s: Section) {
  const name = cut(s.title.replace(/\s*walkthrough\s*$/i, '').replace(/^walkthrough[:\s-]*/i, ''), 80);
  const slug = entitySlug(name);
  const gref = db().collection('guides').doc(key);
  const info: any = (await gref.get()).data() || {};
  const areas: { slug: string; name: string }[] = info.areas || [];
  if (!areas.some((a) => a.slug === slug)) {
    // In story order: before the first page whose chapter comes after it (Epilogue Part 1 before Epilogue Part 2).
    const rank = (n: string) => { const k = chapterKey(n); if (!k) return 999; const [kind, num] = k.split(' '); return (kind === 'prologue' ? 0 : kind === 'epilogue' ? 100 : 1) * 1000 + Number(num || 0); };
    const at = areas.findIndex((a) => rank(a.name) > rank(name));
    const next = [...areas];
    next.splice(at < 0 ? areas.length : at, 0, { slug, name });
    await gref.set({ areas: next }, { merge: true });
    // Every field a guide page has (the site build expects them), empty until the build fills them.
    await gref.collection('areas').doc(slug).set({ name, slug, order: at < 0 ? areas.length : at, story: cut(s.what || '', 160), overview: '', status: 'draft', items: [], secrets: [], enemies: [], shops: [], tips: [], sections: [], fights: [], walkthrough: [], createdBy: 'blueprint', createdAt: Date.now() }, { merge: true });
  }
  return { slug, name, order: (await gref.get()).data()?.areas || areas };
}

/** The page an "deepen" section is about: the live page whose name its title names. */
async function deepenTarget(key: string, s: Section) {
  const pages = (await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, name: String(d.data().name || d.id) }));
  const t = `${s.title} ${s.what || ''}`.toLowerCase();
  const k = chapterKey(t);
  return pages.find((p) => k && chapterKey(p.name) === k) || pages.find((p) => t.includes(p.name.toLowerCase().split(':')[0].trim()) && p.name.length > 3) || null;
}

/**
 * An entity section's plan (the names it covers), researched once and saved like any section's, with the section's
 * own compendium type in the taxonomy. For the new-pages phase (rollout.ts), which builds entity sections across
 * guides in order of demand.
 */
export async function planEntitySection(key: string, sectionId: string): Promise<{ names: string[]; section: Section } | null> {
  const ref = db().collection('guideBlueprints').doc(key);
  const b: any = (await ref.get()).data();
  const s: Section | undefined = (b?.sections || []).find((x: Section) => x.id === sectionId);
  if (!s || s.unit !== 'entity') return null;
  const p: Progress = b.progress?.[s.id] || { built: [] };
  if (!p.plan) {
    const game = String((await db().collection('guides').doc(key).get()).data()?.game || key);
    p.plan = (await planSection(game, s, sectionLimit(s))).names;
    await ref.set({ progress: { [s.id]: p }, updatedAt: Date.now() }, { merge: true });
  }
  const { coreTaxonomy } = await import('./compendium');
  const cref = db().collection('guideCompendium').doc(key);
  if (!((await cref.get()).data() || {}).taxonomy) await coreTaxonomy(key).catch(() => null);
  const tax = ((await cref.get()).data()?.taxonomy || []) as any[];
  if (!tax.some((t) => t.id === s.id)) await cref.set({ taxonomy: FieldValue.arrayUnion({ id: s.id, label: s.title, description: cut(s.what, 200), tier: 'other', examples: p.plan.slice(0, 12) }) }, { merge: true });
  await warnPlanLength(key, s, p);
  return { names: p.plan.slice(0, unitsToBuild(s, p.plan, []).want), section: s };
}

/**
 * A plan that names more than the section's estimate, or more than its cap, or a section marked done with names left:
 * the owner hears once (the job log every run, Discord when it changes), since unbuilt names are missing pages.
 */
async function warnPlanLength(key: string, s: Section, p: Progress & { warned?: string }) {
  const plan = fullPlan(p);
  const u = unitsToBuild(s, plan, p.built || []);
  const left = plan.filter((n) => !(p.built || []).some((b) => b.name === n));
  if (!u.overUnits && !u.beyondCap.length && !(p.done && left.length)) return;
  const text = [
    `Blueprint ${key} / ${s.title}: the plan names ${plan.length}, the estimate was ${Number(s.units) || 0} units${s.cap != null ? `, the cap is ${s.cap}` : ''}.`,
    u.beyondCap.length ? `${u.beyondCap.length} name(s) beyond the cap wait for it to be raised: ${u.beyondCap.slice(0, 12).join(', ')}${u.beyondCap.length > 12 ? ', …' : ''}.` : '',
    p.done && left.length ? `The section was marked done with ${left.length} name(s) unbuilt: ${left.slice(0, 12).join(', ')}${left.length > 12 ? ', …' : ''}.` : '',
  ].filter(Boolean).join(' ');
  const sig = `${plan.length}/${left.length}/${sectionLimit(s)}/${p.done ? 1 : 0}`;
  if (p.warned === sig) { console.log(`  ${text}`); return; }
  await notifyOwner(text);
  p.warned = sig;
  await db().collection('guideBlueprints').doc(key).set({ progress: { [s.id]: { warned: sig } } }, { merge: true });
}

/** Record a unit built outside the runner (the new-pages phase) in the blueprint's progress; the section is done when all its names are. */
export async function recordEntityUnit(key: string, sectionId: string, u: { name: string; slug?: string; status: string; dollars: number }) {
  const ref = db().collection('guideBlueprints').doc(key);
  const b: any = (await ref.get()).data() || {};
  const s: Section | undefined = (b.sections || []).find((x: Section) => x.id === sectionId);
  const p: Progress = b.progress?.[sectionId] || { built: [] };
  p.built = [...(p.built || []).filter((x) => x.name !== u.name), { ...u, dollars: Math.round(u.dollars * 1000) / 1000 }];
  // Done only when every planned name is built, not just the ones within the cap.
  if (s && p.plan && unitsToBuild(s, fullPlan(p), p.built).complete) p.done = Date.now();
  await ref.set({ progress: { [sectionId]: p }, updatedAt: Date.now() }, { merge: true });
}

/** Build an approved blueprint's next units. Returns whether anything went live and whether it stopped (budget, time, checkpoint). */
export async function runBlueprint(key: string, ctx: BlueprintCtx, opts: { only?: string[] } = {}): Promise<{ wentLive: boolean; stopped: string | null; done: boolean }> {
  const ref = db().collection('guideBlueprints').doc(key);
  const b: any = (await ref.get()).data();
  if (b?.status !== 'approved') return { wentLive: false, stopped: null, done: true };
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const progress: Record<string, Progress> = b.progress || {};
  // Entity sections held for a guide (system/core.entityHold.{key}: why), e.g. until the new compendium method's pilot
  // is reviewed, so pages aren't built the old way and then rebuilt. The guide's other sections carry on.
  const coreDoc: any = (await db().collection('system').doc('core').get()).data() || {};
  const hold = String((coreDoc.entityHold || {})[key] || '');
  // With the new-pages phase set up (system/core.newPages), entity sections are built there (rollout.ts), across
  // guides in order of demand, not here.
  const elsewhere = !!coreDoc.newPages;
  const save = (id: string) => ref.set({ progress: { [id]: progress[id] }, updatedAt: Date.now() }, { merge: true });
  let wentLive = false;
  let incomplete = false;
  const { buildPageEvidenceForCore, writePageForCore } = await import('./flagship');
  const { buildQuest } = await import('./quests');
  const { buildEntity, coreTaxonomy } = await import('./compendium');
  const { buildReference } = await import('./refpages');

  for (const s of (b.sections || []).slice().sort((x: Section, y: Section) => (x.priority || 99) - (y.priority || 99)) as Section[]) {
    if (opts.only && !opts.only.includes(s.id)) continue;
    const p: Progress = (progress[s.id] ||= { built: [] });
    // A section marked done before this check could leave planned names unbuilt: said, not built here (that's the
    // owner's call: it's new spend).
    if (p.done) { if (p.plan && !unitsToBuild(s, fullPlan(p), p.built || []).complete) await warnPlanLength(key, s, p); continue; }
    if (s.unit === 'entity' && !isRebuildExisting(s) && (hold || elsewhere)) { if (hold) console.log(`  ${s.title}: held (${hold}).`); continue; }
    const want = sectionLimit(s);
    // Entity pages that only needed a rebuild (done by the re-research of existing pages): nothing new to build.
    if (isRebuildExisting(s) || want === 0) { p.done = Date.now(); await save(s.id); continue; }
    const est = UNIT_COST[s.unit] ?? 0.3;
    const before = async () => {
      if (ctx.timeUp()) return 'Time limit for this run';
      if ((await ctx.room()) < est * 1.5) return 'Budget for today or this month is used up';
      if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 15) return "Today's pipeline searches are used up";
      return null;
    };
    const record = async (name: string, slug: string, status: string, dollars: number) => {
      p.built.push({ name, slug, status, dollars: Math.round(dollars * 1000) / 1000 });
      await ctx.charge(dollars);
      await save(s.id);
      if (status === 'published' || status === 'passed') wentLive = true;
      // A held rebuild passed its review (it's held only because it would drop content), so it counts as a pass.
      return ctx.logUnit({ key, slug, status: status === 'published' || status === 'held' ? 'passed' : status, dollars });
    };

    if (s.kind === 'walkthrough' || (s.unit === 'page' && isDeepen(s))) {
      const why = await before();
      if (why) return { wentLive, stopped: why, done: false };
      const target = isDeepen(s) ? await deepenTarget(key, s) : await newPage(key, s);
      if (!target) { console.log(`  ${s.title}: no page to deepen found; skipped.`); p.done = Date.now(); await save(s.id); continue; }
      const order = (await db().collection('guides').doc(key).get()).data()?.areas || [];
      const scope = { dollars: 0, searches: 0 };
      const r: any = await usageScope.run(scope, () => buildPageEvidenceForCore(key, game, target.slug, order, key, { rebuild: isDeepen(s) })).catch((e: any) => ({ error: String(e?.message || e), stop: isStop(e) }));
      if (r?.stop) { await ctx.charge(scope.dollars); return { wentLive, stopped: `Stopped: ${cut(r.error, 120)}`, done: false }; }
      let passed = r?.review?.status === 'passed';
      // A deepened live page whose rebuild would lose content is held by the rebuild guard: the live page stays.
      const held = passed && !(await writePageForCore(key, target.slug, r.proto));
      if (passed && !held) await db().collection('guides').doc(key).collection('areas').doc(target.slug).set({ status: 'published', translationsDue: { at: Date.now() } }, { merge: true });
      if (held) passed = false;
      console.log(`  [blueprint] ${game} / ${target.name}: ${held ? 'passed, held for review (it would drop content)' : passed ? 'passed' : r?.error ? `not built (${cut(r.error, 80)})` : `failed ${r?.review?.score ?? ''}`}, $${scope.dollars.toFixed(3)}`);
      p.done = Date.now();
      const paused = await record(target.name, target.slug, held ? 'held' : passed ? 'published' : 'failed', scope.dollars);
      if (paused) return { wentLive, stopped: paused, done: false };
      continue;
    }

    // Sections of many units: the plan first, then each unit not built yet.
    if (!p.plan) {
      const why = await before();
      if (why) return { wentLive, stopped: why, done: false };
      const scope = { dollars: 0, searches: 0 };
      try {
        const plan = await usageScope.run(scope, () => planSection(game, s, want));
        p.plan = plan.names;
        if (Object.keys(plan.chapters).length) p.planChapters = plan.chapters;
      } catch (e: any) {
        await ctx.charge(scope.dollars);
        return { wentLive, stopped: `Stopped: ${cut(e?.message || e, 120)}`, done: false };
      }
      await ctx.charge(scope.dollars);
      await save(s.id);
      console.log(`  [plan] ${s.title}: ${p.plan.length} of ${want} named, $${scope.dollars.toFixed(3)}`);
      if (s.unit === 'entity') {
        // The section's own compendium type (if the taxonomy lacks it), so its pages are grouped and typed.
        const cref = db().collection('guideCompendium').doc(key);
        const comp: any = (await cref.get()).data() || {};
        if (!comp.taxonomy) await coreTaxonomy(key).catch(() => null);
        const tax = ((await cref.get()).data()?.taxonomy || []) as any[];
        if (!tax.some((t) => t.id === s.id)) await cref.set({ taxonomy: FieldValue.arrayUnion({ id: s.id, label: s.title, description: cut(s.what, 200), tier: 'other', examples: p.plan.slice(0, 12) }) }, { merge: true });
      }
    }
    await warnPlanLength(key, s, p);
    for (const name of unitsToBuild(s, fullPlan(p), p.built).next) {
      if (p.built.some((x) => x.name === name)) continue;
      const why = await before();
      if (why) return { wentLive, stopped: why, done: false };
      let res: { status: string; dollars: number; slug?: string };
      try {
        if (s.unit === 'quest-short' || s.unit === 'quest-full') res = await buildQuest(key, name, s.unit === 'quest-short' ? 'story' : 'stranger');
        else if (s.unit === 'entity') res = await buildEntity(key, name, { type: s.id });
        else res = await buildReference(key, name, s.unit === 'list-page' ? 'list' : 'reference', s);
      } catch (e: any) {
        if (isStop(e)) return { wentLive, stopped: `Stopped: ${cut(e?.message || e, 120)}`, done: false };
        console.log(`  ${name}: not built (${cut(e?.message || e, 100)})`);
        res = { status: 'error', dollars: 0 };
      }
      const paused = await record(name, res.slug || entitySlug(name), res.status, res.dollars);
      if (paused) return { wentLive, stopped: paused, done: false };
    }
    // Done only when every planned name is built: names beyond the cap keep the section open (and warned about) until
    // the owner raises the cap.
    if (!unitsToBuild(s, fullPlan(p), p.built).complete) { incomplete = true; continue; }
    p.done = Date.now();
    await save(s.id);
  }
  return { wentLive, stopped: null, done: !incomplete };
}
