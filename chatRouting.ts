/**
 * Which model answers a player's question (server-side, changeable without a deploy): Firestore config/chatRouting.
 *
 *   premiumPro        true: Premium players' answers come from Gemini 3.1 Pro.
 *   freeProTypes      question kinds (src/utils/questionType.ts) that free players get Pro for, e.g. ["location", "puzzle"].
 *   freeProMarkers    true: for free players' screenshot questions, a Pro step places the markers on the Flash answer.
 *   playerProDaily    the most Pro requests players may use in a day. They come out of the same 250 a day as the guide
 *                     pipeline's reviews (its careful rebuilds may otherwise use all of them), so players' share is
 *                     kept small, and players stop when the day's 250 are gone.
 *   proTimeoutMs      how long a player waits for Pro before the answer comes from Flash instead.
 *
 * Every default keeps answers as they were (Flash for everyone during the beta): nothing here raises the cost of a
 * question until it's switched on. Pro is counted in system/proBudget (the same daily count as the guide reviewer's,
 * which Google limits to 250 requests a day); when players' share is used up, or Pro is slow or fails, the answer
 * comes from Flash, so a player never waits on the quota.
 */
import { getFirestore } from 'firebase-admin/firestore';
import type { QuestionType } from './src/utils/questionType';

export type Routing = { premiumPro: boolean; freeProTypes: QuestionType[]; freeProMarkers: boolean; playerProDaily: number; proTimeoutMs: number; testAsFree?: boolean };
export const ROUTING_DEFAULTS: Routing = { premiumPro: false, freeProTypes: [], freeProMarkers: false, playerProDaily: 40, proTimeoutMs: 25000 };
export const PRO_CHAT_MODEL = process.env.PRO_CHAT_MODEL || 'gemini-3.1-pro-preview';
const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v ? Number(v) : d);
const PRO_DAILY = num(process.env.PRO_DAILY_REQUESTS, 250);

let cache: { at: number; value: Routing } | null = null;
/** The routing settings (cached for a minute). */
export async function routing(): Promise<Routing> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = ROUTING_DEFAULTS;
  try {
    // CHAT_ROUTING (JSON) overrides the Firestore settings: for a local test server, never set in production.
    const d: any = process.env.CHAT_ROUTING ? JSON.parse(process.env.CHAT_ROUTING) : (await getFirestore().collection('config').doc('chatRouting').get()).data() || {};
    value = normalizeRouting(d);
    // A local test server can route a Premium test account as a free player (only from CHAT_ROUTING).
    if (process.env.CHAT_ROUTING && d?.testAsFree === true) value = { ...value, testAsFree: true };
  } catch {
    /* defaults */
  }
  cache = { at: Date.now(), value };
  return value;
}

export function normalizeRouting(d: any): Routing {
  const types = ['location', 'puzzle', 'fight', 'choice', 'missable', 'general'];
  return {
    premiumPro: d?.premiumPro === true,
    freeProTypes: (Array.isArray(d?.freeProTypes) ? d.freeProTypes : []).filter((t: unknown) => types.includes(String(t))) as QuestionType[],
    freeProMarkers: d?.freeProMarkers === true,
    playerProDaily: Number.isFinite(Number(d?.playerProDaily)) ? Math.max(0, Math.floor(Number(d.playerProDaily))) : ROUTING_DEFAULTS.playerProDaily,
    proTimeoutMs: Number.isFinite(Number(d?.proTimeoutMs)) ? Math.max(5000, Math.min(60000, Number(d.proTimeoutMs))) : ROUTING_DEFAULTS.proTimeoutMs,
  };
}

/** What a question gets: Pro for the answer, Pro for the marker step, or neither. */
export function route(r: Routing, q: { premium: boolean; type: QuestionType; image: boolean }): { answer: 'pro' | 'default'; markers: boolean } {
  if (q.premium) return { answer: r.premiumPro ? 'pro' : 'default', markers: false };
  const answer = r.freeProTypes.includes(q.type) ? 'pro' : 'default';
  // A Pro answer places its own markers; a Flash answer to a screenshot question gets the Pro marker step.
  return { answer, markers: answer === 'default' && q.image && r.freeProMarkers };
}

const quotaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

/** Count one Pro request for a player, or false if players' share of today's Pro requests is used up. */
export async function takePlayerPro(r: Routing): Promise<boolean> {
  if (r.playerProDaily <= 0) return false;
  const ref = getFirestore().collection('system').doc('proBudget');
  const day = quotaDay();
  try {
    return await getFirestore().runTransaction(async (t) => {
      const d: any = (await t.get(ref)).data() || {};
      const today = d.day === day ? d : { day, count: 0, careful: 0, other: 0, player: 0 };
      if (Number(today.player || 0) >= r.playerProDaily || Number(today.count || 0) >= PRO_DAILY) return false;
      t.set(ref, { ...today, day, count: Number(today.count || 0) + 1, player: Number(today.player || 0) + 1, updatedAt: Date.now() });
      return true;
    });
  } catch {
    return false;
  }
}
