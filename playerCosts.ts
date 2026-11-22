/**
 * What each player's questions cost us, per month: Firestore playerCosts/{YYYY-MM}/players/{uid}
 *   { dollars, questions, searches, premium, guest, updatedAt }
 * counted from every AI call made while answering (usage.ts requestCost: tokens at Google's rates, searches at
 * SEARCH_DOLLARS). Shown on /admin/reviews (Costs tab: cost per player this month, Premium vs free, the 10 heaviest),
 * and Premium's average and maximum go in the weekly Discord summary (scripts/pipeline/searchConsole.ts).
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Express, RequestHandler } from 'express';
import { isTestId, isTestTraffic } from './testTraffic';

export const costMonth = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);

/**
 * The monthly safety cap (owner, Nov 21 2026): Firestore config/costCap { premiumMonthly, alertAt }. A Premium player
 * whose AI cost this month reaches premiumMonthly gets quick answers (the quick model) until the 1st; the weekly summary
 * names anyone past alertAt. Generous to start ($10 / $5) while real use is learned; changeable without a deploy.
 */
export type CostCap = { premiumMonthly: number; alertAt: number };
export const COST_CAP_DEFAULTS: CostCap = { premiumMonthly: 10, alertAt: 5 };
let capCache: { at: number; value: CostCap } | null = null;
export async function costCap(): Promise<CostCap> {
  if (capCache && Date.now() - capCache.at < 60_000) return capCache.value;
  let value = COST_CAP_DEFAULTS;
  try {
    const d: any = (await getFirestore().collection('config').doc('costCap').get()).data() || {};
    const n = (v: unknown, def: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    value = { premiumMonthly: n(d.premiumMonthly, COST_CAP_DEFAULTS.premiumMonthly), alertAt: n(d.alertAt, COST_CAP_DEFAULTS.alertAt) };
  } catch {}
  capCache = { at: Date.now(), value };
  return value;
}
/** What a player's answers have cost so far this month (0 when unknown: the cap never blocks on a failed read). */
export async function monthSpent(uid: string): Promise<number> {
  if (!uid) return 0;
  try {
    const d: any = (await getFirestore().collection('playerCosts').doc(costMonth()).collection('players').doc(uid).get()).data();
    return Number(d?.dollars) || 0;
  } catch {
    return 0;
  }
}

/** Add one answer's cost to the player's month (in the background: the answer never waits on it). */
export function recordPlayerCost(p: { uid: string; premium: boolean; guest: boolean; dollars: number; searches: number }): void {
  if (!p.uid || isTestTraffic(p.uid)) return; // test scripts and local servers aren't players
  void getFirestore()
    .collection('playerCosts').doc(costMonth()).collection('players').doc(p.uid)
    .set({
      dollars: FieldValue.increment(Math.max(0, p.dollars)),
      questions: FieldValue.increment(1),
      searches: FieldValue.increment(Math.max(0, p.searches)),
      premium: p.premium,
      guest: p.guest,
      updatedAt: Date.now(),
    }, { merge: true })
    .catch(() => {});
}

export type PlayerCost = { uid: string; dollars: number; questions: number; searches: number; premium: boolean; guest: boolean };
type Group = { players: number; questions: number; dollars: number; avg: number; max: number; perQuestion: number };

/** Totals for a month's players: Premium, free (signed in) and guests, and the heaviest players. */
export function summarizeCosts(rows: PlayerCost[], top = 10) {
  const group = (xs: PlayerCost[]): Group => {
    const dollars = xs.reduce((n, x) => n + x.dollars, 0);
    const questions = xs.reduce((n, x) => n + x.questions, 0);
    return {
      players: xs.length, questions, dollars,
      avg: xs.length ? dollars / xs.length : 0,
      max: xs.reduce((m, x) => Math.max(m, x.dollars), 0),
      perQuestion: questions ? dollars / questions : 0,
    };
  };
  return {
    premium: group(rows.filter((r) => r.premium)),
    free: group(rows.filter((r) => !r.premium && !r.guest)),
    guests: group(rows.filter((r) => r.guest)),
    all: group(rows),
    heaviest: rows.slice().sort((a, b) => b.dollars - a.dollars).slice(0, top),
  };
}

export async function monthCosts(month = costMonth()): Promise<PlayerCost[]> {
  const snap = await getFirestore().collection('playerCosts').doc(month).collection('players').get();
  return snap.docs.filter((d) => !isTestId(d.id)).map((d) => {
    const x: any = d.data();
    return { uid: d.id, dollars: Number(x.dollars) || 0, questions: Number(x.questions) || 0, searches: Number(x.searches) || 0, premium: x.premium === true, guest: x.guest === true };
  });
}

/** /api/admin/player-costs?month=YYYY-MM: the Costs tab's numbers (admins only). Player ids are shortened. */
export function registerPlayerCosts(app: Express, deps: { requireAuth: RequestHandler; isAdmin: (user: any) => boolean }): void {
  const requireAdmin: RequestHandler = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : void res.status(403).json({ error: 'Not an admin.' }));
  app.get('/api/admin/player-costs', deps.requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : costMonth();
      const s = summarizeCosts(await monthCosts(month));
      res.json({ month, ...s, heaviest: s.heaviest.map((r) => ({ ...r, uid: r.guest ? 'guest' : `${r.uid.slice(0, 6)}…` })) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed' });
    }
  });
}
