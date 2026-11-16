/**
 * "Worth getting here" on demand, for any game (owner, Nov 15 2026): when a player's area is known and the fact
 * database has no list for it, the area's worth pass (scripts/guides/worthIt.ts worthArea: one searched call, only lines
 * a trusted source backs) runs for that one area, its items get cards (wiki page and checked picture), and everything is
 * saved in gameRecords, so later players get it at once and for free.
 *
 * Nothing here needs a guide. A game's key is its guide's when it has one, else its name's; an area is the guide's area
 * when the place is one of them (the guide's records, story order and version then come along), else the place's own
 * name, cut to the main area ("South Figaro, Relic Shop" -> "South Figaro").
 *
 * Who can start one: only the server, from Help me here or an answer (each player's allowance already applies), as a
 * one-time ticket (worthTickets/{id}) the app redeems with POST /api/worth/fill, which runs the pass while it waits
 * (Cloud Run's CPU is only there during a request). Older apps don't redeem tickets: the areas they asked about are noted
 * (worthWanted) and filled overnight (worthNightly.ts).
 *
 * Once per area: a lock in gameRecords/{key}/worthFill/{slug} (status running | done | empty | failed), taken in a
 * transaction, so players arriving together start one pass. An area with nothing sourced stays empty; a guided area runs
 * again only when its guide is rebuilt. A run that crashed is retried once (after 5 minutes), then left failed. No spending
 * cap (owner); an abuse guard of 30 new areas per account a day, and the day's spend in system/worthOnDemand (the nightly
 * summary warns above $5 and /stats shows it).
 */
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { worthArea } from './scripts/guides/worthIt';
import { applyWorth, type GameRecord, type WorthEntry } from './scripts/guides/records';
import { wikiFor, cardFor } from './scripts/guides/itemCards';
import { usageScope, searchForPlayers, slug as slugOf, gemini, MODEL } from './scripts/guides/common';
import { ThinkingLevel } from '@google/genai';
import { SearchDayWait } from './apiLimits';
import { guideKeyFor, baseGameKey, guideAreasByKey, areaFacts, forgetAreaFacts } from './guidesApi';
import { placeKey } from './src/utils/placeName';

const db = () => getFirestore();
const REC = (key: string) => db().collection('gameRecords').doc(key);
const STALE_MS = 5 * 60_000;
const TICKET_MS = 15 * 60_000;
export const USER_DAILY = 30;
export const ALERT_DOLLARS = 5;
const day = () => new Date().toISOString().slice(0, 10);

export type AreaRef = { key: string; slug: string; name: string; game: string; guided: boolean; version: number };
export type WorthStatus = 'ready' | 'empty' | 'running' | 'missing' | 'failed';

/** Not places: what a misread screen or a vague answer can call one. */
const NOT_A_PLACE = /^(unknown|none|n\/?a|main menu|title screen|start screen|menu|pause menu|loading( screen)?|inventory|map|world map|settings|options|character creation|tutorial|cutscene|credits|camp)$/i;

/** The main area of a place name: the part before any detail ("South Figaro, Relic Shop"), tidied. */
export function mainArea(place: string): string {
  const first = String(place || '').split(/[,、，;|]/)[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  return first.replace(/^["“'‘]+|["”'’.]+$/g, '').trim();
}

/**
 * An area's address from its name: one per place however it's written ("The Emerald Grove", "Emerald Grove.",
 * "Emerald Grove area" -> emerald-grove). Articles, "&"/"and", punctuation, case and a trailing "area"/"region"/"zone"
 * don't make another area. Names that differ in words (another name for the same place) are matched by resolveAlias.
 */
export function areaSlug(name: string): string {
  let n = placeKey(mainArea(name).replace(/&/g, ' and '), '').replace(/\s+/g, ' ').trim();
  n = n.replace(/^(the|a|an) /, '').replace(/ (area|region|zone|district|map)$/, '').trim();
  return slugOf(n, 80);
}

/** Which area a place is in, for a game (guide or not). Null for something that isn't a place. */
export async function areaRef(game: string, place: string, appId?: number, guideHint?: string | null): Promise<AreaRef | null> {
  const g = String(game || '').trim().slice(0, 120);
  const name = mainArea(place);
  if (!g || !name || name.length < 3 || NOT_A_PLACE.test(name) || !/\p{L}/u.test(name)) return null;
  const guideKey = await guideKeyFor(g, appId, undefined, guideHint).catch(() => null);
  if (guideKey) {
    const ga = await guideAreasByKey(guideKey).catch(() => null);
    const hit = ga?.areas.find((a) => placeKey(a.name) === placeKey(name)) || ga?.areas.find((a) => placeKey(a.name) === placeKey(place));
    if (hit) {
      const info: any = (await db().collection('guides').doc(guideKey).get()).data() || {};
      return { key: guideKey, slug: hit.slug, name: hit.name, game: String(info.game || ga?.game || g), guided: true, version: Number(info.rebuiltAt || info.updatedAt || info.createdAt || 0) };
    }
  }
  const key = guideKey || baseGameKey(g);
  const slug = areaSlug(name);
  if (!key || !slug) return null;
  // Another name for an area the game already has (resolveAlias decided it once): that area.
  const al: any = (await REC(key).collection('worthAlias').doc(slug).get().catch(() => null))?.data();
  if (al?.to?.slug) return { ...al.to, game: String(al.to.game || g) } as AreaRef;
  return { key, slug, name, game: g, guided: false, version: 0 };
}

/** Is `name` another name for one of `known` in this game? The exact known name, or '' (a small unsearched call). */
export type AliasJudge = (game: string, name: string, known: string[]) => Promise<string>;
export const aiAliasJudge: AliasJudge = async (game, name, known) => {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text:
      `In the video game "${game}", is the place "${name}" one of these areas under another name, or a place inside one of ` +
      `them (a building, room or spot within that area)? A neighbouring area or a different region doesn't count.\n` +
      `${known.map((k) => `- ${k}`).join('\n')}\n` +
      `Reply with that area's name exactly as listed, or "none" if it's a different place or you're not sure.` }] }],
    config: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const said = String(res?.text || '').replace(/^["'\s-]+|["'.\s]+$/g, '').trim();
  return known.find((k) => k.toLowerCase() === said.toLowerCase()) || '';
};

/**
 * Before an area's first pass: is its name another name for an area this game already has (a guide area, or one
 * filled before), or a place inside one? Then that area is used, and the name is remembered as its alias (worthAlias/{slug}), so one place
 * gets one list and one pass however players or answers name it. Decided once per name.
 */
export async function resolveAlias(a: AreaRef, judge: AliasJudge = aiAliasJudge): Promise<AreaRef> {
  if (a.guided) return a;
  const aliasRef = REC(a.key).collection('worthAlias').doc(a.slug);
  const al: any = (await aliasRef.get()).data();
  if (al) return al.to?.slug ? { ...al.to } : a;
  // The game's other areas: its guide's, and the ones filled (or being filled) before.
  const known = new Map<string, AreaRef>();
  const ga = await guideAreasByKey(a.key).catch(() => null);
  const info: any = ga ? (await db().collection('guides').doc(a.key).get()).data() || {} : {};
  for (const x of ga?.areas || []) known.set(x.name, { key: a.key, slug: x.slug, name: x.name, game: String(info.game || ga?.game || a.game), guided: true, version: Number(info.rebuiltAt || info.updatedAt || info.createdAt || 0) });
  for (const d of (await REC(a.key).collection('worthFill').get()).docs) {
    const f: any = d.data();
    if (d.id !== a.slug && f?.name && !known.has(f.name)) known.set(String(f.name), { key: a.key, slug: d.id, name: String(f.name), game: String(f.game || a.game), guided: false, version: 0 });
  }
  let to: AreaRef | null = null;
  if (known.size) {
    const scope = { dollars: 0, searches: 0 };
    const pick = await usageScope.run(scope, () => judge(a.game, a.name, [...known.keys()].slice(0, 200))).catch(() => '');
    await tally({ dollars: scope.dollars });
    to = pick ? known.get(pick) || null : null;
  }
  await aliasRef.set(JSON.parse(JSON.stringify({ name: a.name, to, at: Date.now() })));
  if (to) console.log(`[worth] ${a.game}: "${a.name}" is ${to.name}`);
  return to || a;
}

/** Where an area stands: a list (ready), nothing sourced (empty), being filled, never tried (missing), or failed. */
export async function worthStatus(a: AreaRef): Promise<WorthStatus> {
  const [w, f] = await Promise.all([REC(a.key).collection('worth').doc(a.slug).get(), REC(a.key).collection('worthFill').doc(a.slug).get()]);
  const fill: any = f.data();
  const sameVersion = !fill || Number(fill.version || 0) === a.version;
  if (fill?.status === 'running') {
    if (Date.now() - Number(fill.startedAt || 0) < STALE_MS) return 'running';
    // Crashed twice: left failed (never a loop). Once: "never tried", so it gets its one retry.
    if (sameVersion && Number(fill.attempts || 0) >= 2) return 'failed';
  }
  // Only the area's own pass (it sets `at`) decides: items answers added (fromAnswers) never stop it from running.
  const wd: any = w.exists && (w.data() as any)?.at ? w.data() : null;
  if (wd && (wd.entries?.length ? true : false) && (sameVersion || !a.guided)) return 'ready';
  if (fill && sameVersion) {
    if (fill.status === 'empty') return 'empty';
    if (fill.status === 'done') return wd?.entries?.length ? 'ready' : 'empty';
    if (fill.status === 'failed' && Number(fill.attempts || 0) >= 2) return 'failed';
  }
  // The batch pass (worthIt.ts) ran here before on-demand fills existed.
  if (wd) return wd.entries?.length ? 'ready' : 'empty';
  return 'missing';
}

/** Help me here or an answer found the player's area: a ticket when it has no list yet (and a note for older apps). */
export async function worthTicket(a: AreaRef | null, uid: string): Promise<{ key: string; slug: string; name: string; status: WorthStatus; ticket?: string } | null> {
  if (!a || !uid) return null;
  const status = await worthStatus(a).catch(() => 'ready' as WorthStatus);
  const base = { key: a.key, slug: a.slug, name: a.name, status };
  if (status !== 'missing') return base;
  const id = crypto.randomBytes(12).toString('hex');
  await Promise.all([
    db().collection('worthTickets').doc(id).set({ ...a, uid, exp: Date.now() + TICKET_MS, at: Date.now() }),
    // Filled overnight unless an app redeems a ticket first (apps before the on-demand fill never do).
    db().collection('worthWanted').doc(`${a.key}__${a.slug}`).set({ ...a, n: FieldValue.increment(1), at: Date.now() }, { merge: true }),
  ]).catch(() => {});
  return { ...base, ticket: id };
}

/** Today's spend and counts, for the nightly summary and /stats. */
async function tally(patch: Partial<Record<'dollars' | 'areas' | 'empty' | 'failed' | 'items' | 'pics', number>>) {
  const inc: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) if (v) inc[k] = FieldValue.increment(v);
  if (!Object.keys(inc).length) return;
  await db().collection('system').doc('worthOnDemand').set({ days: { [day()]: inc }, updatedAt: Date.now() }, { merge: true }).catch(() => {});
}

/**
 * Fill one area, once: the lock, the pass, the records, the cards. `uid` counts toward the account's 30 a day ('' for
 * the overnight lane). Returns the area's status afterwards ('limited': the account's new areas for today are used up).
 */
export type FillDeps = { pass?: typeof worthArea; judge?: AliasJudge; cards?: boolean };
export async function fillArea(given: AreaRef, uid: string, by: 'player' | 'night', deps: FillDeps = {}): Promise<{ status: WorthStatus | 'limited'; area: AreaRef }> {
  const a = await resolveAlias(given, deps.judge);
  const status = await fillOne(a, uid, by, deps);
  return { status, area: a };
}
async function fillOne(a: AreaRef, uid: string, by: 'player' | 'night', deps: FillDeps): Promise<WorthStatus | 'limited'> {
  const fillRef = REC(a.key).collection('worthFill').doc(a.slug);
  const userRef = uid ? db().collection('worthFillUsers').doc(uid) : null;
  const claim = await db().runTransaction(async (tx) => {
    const [f, u] = await Promise.all([tx.get(fillRef), userRef ? tx.get(userRef) : Promise.resolve(null)]);
    const cur: any = f.data();
    // Only an area never tried (or tried once and failed or crashed, for this guide version) is filled.
    const status = await worthStatus(a);
    if (status !== 'missing') return { go: false as const, status };
    const ud: any = u?.data();
    const used = ud?.day === day() ? Number(ud.n || 0) : 0;
    if (userRef && used >= USER_DAILY) return { go: false as const, status: 'limited' as const };
    const attempts = cur && Number(cur.version || 0) === a.version ? Number(cur.attempts || 0) + 1 : 1;
    tx.set(fillRef, { status: 'running', startedAt: Date.now(), attempts, version: a.version, name: a.name, game: a.game, by, uid: uid || null });
    if (userRef) tx.set(userRef, { day: day(), n: used + 1 });
    return { go: true as const, status: 'running' as const };
  });
  if (!claim.go) return claim.status;

  const scope = { dollars: 0, searches: 0 };
  try {
    // A player waiting: their room for searches (the answers'), not the pipeline's share. Overnight: the pipeline's.
    const run = <T,>(f: () => Promise<T>) => (by === 'player' ? searchForPlayers.run('players', f) : f());
    const result = await run(() => usageScope.run(scope, async () => {
      const recsSnap = await REC(a.key).collection('records').where('place', '==', a.slug).get();
      const have = recsSnap.docs.map((d) => d.data() as GameRecord);
      // The story order's act, when the game's guide has one.
      const spine: any = a.guided ? (await REC(a.key).collection('spine').doc('main').get()).data() : null;
      const act = String((spine?.acts || []).find((x: any) => (x.steps || []).some((s: any) => (s.areas || []).includes(a.slug)))?.name || '');
      const { entries, dropped } = await (deps.pass || worthArea)(a.key, a.slug, a.game, a.name, act, have);
      const prev: any = (await REC(a.key).collection('worth').doc(a.slug).get()).data() || {};
      await REC(a.key).collection('worth').doc(a.slug).set(JSON.parse(JSON.stringify({ entries, dropped, at: Date.now(), dollars: Math.round(scope.dollars * 10000) / 10000, placeName: a.name, by: 'demand', version: a.version, ...(prev.fromAnswers ? { fromAnswers: prev.fromAnswers } : {}) })));
      if (!entries.length && !(prev.fromAnswers || []).length) return { entries: 0, items: 0, pics: 0 };
      // The records, as the next import would lay them (recordsImport.ts), written now so the list shows at once.
      const next = applyWorth(have.map((r) => ({ ...r })), { entries: allEntries({ entries, fromAnswers: prev.fromAnswers }) }, { key: a.key, place: a.slug, placeName: a.name });
      const before = new Map(have.map((r) => [r.id, r.hash]));
      const writes = next.filter((r) => before.get(r.id) !== r.hash);
      const col = REC(a.key).collection('records');
      for (let i = 0; i < writes.length; i += 400) {
        const b = db().batch();
        for (const r of writes.slice(i, i + 400)) b.set(col.doc(r.id), { ...r, importedAt: Date.now() });
        await b.commit();
      }
      // A game with no records before: a summary doc, so the store lists the game.
      await REC(a.key).set({ updatedAt: Date.now() }, { merge: true });
      // Cards for the gear (its wiki page and a checked picture), four at a time.
      const gear = next.filter((r) => (r.type === 'item' || r.type === 'secret') && r.fields?.rank);
      const wiki = deps.cards === false ? null : await wikiFor(a.key, a.game).catch(() => null);
      let pics = 0;
      const cost = { d: 0 } as any;
      for (let i = 0; deps.cards !== false && i < gear.length; i += 4) {
        await Promise.all(gear.slice(i, i + 4).map(async (r) => {
          const c = await cardFor(a.key, a.game, wiki, r, cost).catch(() => null);
          if (c?.pic) pics++;
        }));
      }
      scope.dollars += cost.d || 0;
      return { entries: entries.length, items: gear.length, pics };
    }));
    const dollars = Math.round(scope.dollars * 10000) / 10000;
    const status: WorthStatus = result.entries ? 'ready' : 'empty';
    await fillRef.set({ status: result.entries ? 'done' : 'empty', at: Date.now(), dollars }, { merge: true });
    await tally({ dollars, areas: 1, empty: result.entries ? 0 : 1, items: result.items, pics: result.pics });
    await db().collection('worthWanted').doc(`${a.key}__${a.slug}`).delete().catch(() => {});
    forgetAreaFacts(a.key, a.slug);
    console.log(`[worth] ${a.game} / ${a.name}: ${result.entries} line(s), ${result.items} item card(s), ${result.pics} picture(s); $${dollars.toFixed(4)} (${by})`);
    return status;
  } catch (e: any) {
    const dollars = Math.round(scope.dollars * 10000) / 10000;
    if (e instanceof SearchDayWait) {
      // Google's search day is used up: not this area's fault. Back to "never tried" (the overnight lane picks it up).
      console.warn(`[worth] ${a.game} / ${a.name}: waiting for search room (${e.message})`);
      await fillRef.delete().catch(() => {});
      if (userRef) await userRef.set({ n: FieldValue.increment(-1) }, { merge: true }).catch(() => {});
      return 'missing';
    }
    await fillRef.set({ status: 'failed', at: Date.now(), error: String(e?.message || e).slice(0, 300), dollars }, { merge: true }).catch(() => {});
    await tally({ dollars, failed: 1 });
    console.warn(`[worth] ${a.game} / ${a.name} failed: ${e?.message || e}`);
    return 'failed';
  }
}

/** An area's list as records see it: the pass's entries first (they win), then what answers added. */
export function allEntries(w: { entries?: WorthEntry[]; fromAnswers?: WorthEntry[] } | undefined): WorthEntry[] {
  return [...(w?.entries || []), ...(w?.fromAnswers || [])];
}

/** Questions about what's worth getting in a place (the answers that may add to its list). */
export const ASKS_WHATS_WORTH = /\b(worth|best (gear|items?|loot|weapons?|armou?r|equipment|rewards?)|good (gear|items?|loot)|loot|missable|what (should|can) i (get|grab|pick up|find|loot)|items? (here|in this area|around here)|(get|find|pick up) here)\b/i;

/**
 * Answers top it up (owner, Nov 15 2026): an answer about what's worth getting in a sure area, that searched, adds the
 * items its search backs (factsBackedBySearch) that the list doesn't have, unconfirmed, with their cards. Kept apart
 * from the pass's own entries (fromAnswers): the pass still runs for the area, and its entries win.
 */
export async function topUpFromAnswer(a: AreaRef | null, facts: { subject?: string; fact?: string; kind?: string; status?: string }[], sources: string[]): Promise<number> {
  if (!a) return 0;
  const items = facts.filter((f) => f.subject && f.status !== 'disputed' && ['item', 'secret', 'missable'].includes(String(f.kind || '')));
  if (!items.length) return 0;
  const ref = REC(a.key).collection('worth').doc(a.slug);
  const key = (s: string) => placeKey(s, '');
  const added = await db().runTransaction(async (tx) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const have = new Set(allEntries(cur).map((e) => key(e.name)));
    const fresh: WorthEntry[] = [];
    for (const f of items) {
      const name = String(f.subject).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!name || have.has(key(name))) continue;
      have.add(key(name));
      fresh.push({ type: 'item', name, rank: 100 + (cur.fromAnswers || []).length + fresh.length, fields: { kind: f.kind === 'secret' ? 'secret' : 'gear', why: String(f.fact || '').slice(0, 300), ...(f.kind === 'missable' ? { lockout: 'missable' } : {}) }, sources: sources.slice(0, 4) });
    }
    if (!fresh.length) return [] as WorthEntry[];
    tx.set(ref, { fromAnswers: [...(cur.fromAnswers || []), ...fresh].slice(-40), placeName: cur.placeName || a.name, answersAt: Date.now() }, { merge: true });
    return fresh;
  });
  if (!added.length) return 0;
  // Their records and cards now, so the list shows them at once.
  const recs = (await REC(a.key).collection('records').where('place', '==', a.slug).get()).docs.map((d) => d.data() as GameRecord);
  const next = applyWorth(recs.map((r) => ({ ...r })), { entries: added }, { key: a.key, place: a.slug, placeName: a.name });
  const before = new Map(recs.map((r) => [r.id, r.hash]));
  const writes = next.filter((r) => before.get(r.id) !== r.hash);
  const b = db().batch();
  for (const r of writes.slice(0, 400)) b.set(REC(a.key).collection('records').doc(r.id), { ...r, importedAt: Date.now() });
  await b.commit();
  const wiki = await wikiFor(a.key, a.game).catch(() => null);
  const cost = { d: 0 } as any;
  await Promise.all(writes.filter((r) => r.type === 'item' || r.type === 'secret').map((r) => cardFor(a.key, a.game, wiki, r, cost).catch(() => null)));
  await tally({ dollars: cost.d || 0, items: writes.length });
  forgetAreaFacts(a.key, a.slug);
  console.log(`[worth] ${a.game} / ${a.name}: ${added.length} item(s) added from an answer`);
  return added.length;
}

/** The area's facts (areaFacts) with its status, for the app. */
async function factsFor(a: AreaRef, status: WorthStatus | 'limited') {
  const facts = status === 'ready' ? await areaFacts(a.key, a.slug).catch(() => null) : null;
  return { key: a.key, slug: a.slug, name: a.name, status, ...(facts || {}) };
}

/**
 * GET  /api/worth?game=&place=[&appId=&guideKey=]   an area's list and status (anyone; reads only)
 * POST /api/worth/fill { ticket }                    fill the ticket's area while the app waits (signed-in players)
 */
export function registerWorthRoutes(app: Express, deps: { requireAuth: any }): void {
  app.get('/api/worth', async (req: Request, res: Response) => {
    try {
      const a = await areaRef(String(req.query.game || ''), String(req.query.place || ''), Number(req.query.appId) || undefined, String(req.query.guideKey || '') || null);
      if (!a) return res.status(400).json({ error: 'A game and a place are required.' });
      res.json(await factsFor(a, await worthStatus(a)));
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
  app.post('/api/worth/fill', deps.requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.body?.ticket || '').replace(/[^a-f0-9]/g, '').slice(0, 40);
      const uid = String((req as any).user?.uid || '');
      if (!id || !uid) return res.status(400).json({ error: 'A ticket is required.' });
      const ref = db().collection('worthTickets').doc(id);
      const t: any = (await ref.get()).data();
      if (!t || t.uid !== uid || Number(t.exp || 0) < Date.now()) return res.status(404).json({ error: 'This ticket is not valid.' });
      await ref.delete().catch(() => {});
      const a: AreaRef = { key: t.key, slug: t.slug, name: t.name, game: t.game, guided: !!t.guided, version: Number(t.version || 0) };
      const r = await fillArea(a, uid, 'player');
      res.json(await factsFor(r.area, r.status));
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}

/** The day's spend line for the nightly summary (with the $5 warning) and the last days for /stats. */
export async function worthDays(n = 14): Promise<{ day: string; dollars: number; areas: number; empty: number; failed: number; items: number; pics: number }[]> {
  const d: any = (await db().collection('system').doc('worthOnDemand').get()).data() || {};
  const days = d.days || {};
  return Object.keys(days).sort().slice(-n).map((k) => ({ day: k, dollars: Number(days[k].dollars || 0), areas: Number(days[k].areas || 0), empty: Number(days[k].empty || 0), failed: Number(days[k].failed || 0), items: Number(days[k].items || 0), pics: Number(days[k].pics || 0) }));
}
export async function worthSummaryLine(date: string): Promise<string> {
  const x = (await worthDays(60)).find((r) => r.day === date);
  if (!x || (!x.areas && !x.failed)) return '';
  const warn = x.dollars > ALERT_DOLLARS ? ` ⚠️ over the $${ALERT_DOLLARS} alert (no cap: check nothing is looping)` : '';
  return `🧭 Worth getting here on demand (${date}): ${x.areas} area(s) filled (${x.empty} with nothing sourced), ${x.failed} failed, ${x.items} item card(s) with ${x.pics} picture(s); $${x.dollars.toFixed(2)}.${warn}`;
}
