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
import { applyWorth, finish, type GameRecord } from './scripts/guides/records';
import { wikiFor, cardFor } from './scripts/guides/itemCards';
import { usageScope, searchForPlayers, slug as slugOf } from './scripts/guides/common';
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
  const slug = slugOf(name.replace(/^the\s+/i, ''), 80);
  if (!key || !slug) return null;
  return { key, slug, name, game: g, guided: false, version: 0 };
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
  const wd: any = w.data();
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
export async function fillArea(a: AreaRef, uid: string, by: 'player' | 'night'): Promise<WorthStatus | 'limited'> {
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
      const { entries, dropped } = await worthArea(a.key, a.slug, a.game, a.name, act, have);
      await REC(a.key).collection('worth').doc(a.slug).set(JSON.parse(JSON.stringify({ entries, dropped, at: Date.now(), dollars: Math.round(scope.dollars * 10000) / 10000, placeName: a.name, by: 'demand', version: a.version })));
      if (!entries.length) return { entries: 0, items: 0, pics: 0 };
      // The records, as the next import would lay them (recordsImport.ts), written now so the list shows at once.
      const next = applyWorth(have.map((r) => ({ ...r })), { entries }, { key: a.key, place: a.slug, placeName: a.name });
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
      const wiki = await wikiFor(a.key, a.game).catch(() => null);
      let pics = 0;
      const cost = { d: 0 } as any;
      for (let i = 0; i < gear.length; i += 4) {
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
      res.json(await factsFor(a, await fillArea(a, uid, 'player')));
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
