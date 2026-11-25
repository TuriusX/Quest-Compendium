/**
 * How Pro answers run (server-side, changeable without a deploy): Firestore config/chatRouting. Which model a question
 * gets is the player's choice, within their Pro and Fast questions (allowances.ts, config/allowances).
 *
 *   freeProMarkers    true: for free players' screenshot questions, a Pro step places the markers on the Flash answer.
 *   playerProDaily    the most Pro requests players may use in a day (default 40,000 of Google's 50,000: Pro is limited
 *                     by our dollar caps, not by requests).
 *   proTimeoutMs      how long a player waits for Pro before the answer comes from Flash instead.
 *
 * Pro is counted in system/proBudget, the same daily count as the guide reviewer's
 * (Google's limit and the reserve for careful rebuilds are in config/apiLimits, apiLimits.ts). Players never wait on the
 * count: the decision comes from a cached read and the count is updated in the background. A Pro answer that fails or
 * is too slow comes from Flash instead.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { apiLimits, quotaDay } from './apiLimits';

export type Routing = {
  freeProMarkers: boolean; playerProDaily: number; proTimeoutMs: number; testAsFree?: boolean;
  /**
   * OpenAI settings (Nov 19 2026). NOT USED since Nov 24 2026: players' questions and the server's helpers run on
   * Gemini only. Kept so the stored config still reads; the guide pipeline has its own OpenAI switches.
   */
  openaiPro: string; openaiFast: string; openaiShare: number; openaiUids: string[];
  /** The owner's accounts (ADMIN_EMAILS) get OpenAI whatever the share: the owner tries it first. */
  openaiOwner: boolean;
  /** The website's questions ("Ask about this", siteAsk.ts) too, with the same models. */
  openaiSite: boolean;
  /**
   * The server's helper calls on OpenAI (openaiGemini.ts): pop-up summaries, visual answers' choices, Locate me, Spot it,
   * place reading, drawn answers' decisions. What OpenAI can't do (video by link, images out) stays on Gemini.
   */
  openaiHelpers: boolean;
  /** The prompt split for cheaper follow-ups (owner, Nov 21 2026; server.ts promptSplit): off until its quality test passes. */
  promptSplit?: boolean;
  /**
   * The app's Gemini models (owner, Nov 22 2026: Hydrogen medium for questions, Hydrogen low for the faster ones, after
   * blind picks over his own BG3 chats): geminiPro '' = PRO_CHAT_MODEL; geminiFast '' = the Flash models as before (every
   * player gets geminiFast when it's set, so free and Premium answers sound the same). Thinking 'low' | 'medium' | 'high'.
   * proFallback answers when geminiPro fails (not when it's too slow: then Flash, as before). The website is unchanged.
   */
  geminiPro?: string; geminiProThinking?: Thinking; geminiFast?: string; geminiFastThinking?: Thinking; proFallback?: string;
  /** The voice rule (searchPolicy.ts VOICE_RULE) on the app's answers. */
  voiceRule?: boolean;
  /**
   * Light answers first (owner, Nov 24 2026; src/utils/answerEffort.ts): the light answer (geminiFast) for every app
   * question except what next, puzzles, builds, details on the screen, long questions and voice. On unless set false
   * (false: the medium answer first, as before, with only simple lookups light).
   */
  lightFirst?: boolean;
  /** Voice questions light too (owner, Nov 24 2026: a third of all questions; the server can't read them first). On unless set false. */
  lightVoice?: boolean;
};
export type Thinking = 'low' | 'medium' | 'high';
export const ROUTING_DEFAULTS: Routing = { freeProMarkers: false, playerProDaily: 40000, proTimeoutMs: 25000, openaiPro: '', openaiFast: '', openaiShare: 0, openaiUids: [], openaiOwner: false, openaiSite: false, openaiHelpers: false, promptSplit: false, geminiPro: '', geminiProThinking: 'low', geminiFast: '', geminiFastThinking: 'low', proFallback: '', voiceRule: false, lightFirst: true, lightVoice: true };
const geminiName = (v: unknown) => (/^gemini-[a-z0-9.-]+$/i.test(String(v || '')) ? String(v) : '');
const thinking = (v: unknown, d: Thinking): Thinking => (v === 'low' || v === 'medium' || v === 'high' ? v : d);

export const PRO_CHAT_MODEL = process.env.PRO_CHAT_MODEL || 'gemini-3.1-pro-preview';

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
  return {
    freeProMarkers: d?.freeProMarkers === true,
    playerProDaily: Number.isFinite(Number(d?.playerProDaily)) ? Math.max(0, Math.floor(Number(d.playerProDaily))) : ROUTING_DEFAULTS.playerProDaily,
    proTimeoutMs: Number.isFinite(Number(d?.proTimeoutMs)) ? Math.max(5000, Math.min(60000, Number(d.proTimeoutMs))) : ROUTING_DEFAULTS.proTimeoutMs,
    openaiPro: /^gpt-[a-z0-9.-]+$/i.test(String(d?.openaiPro || '')) ? String(d.openaiPro) : '',
    openaiFast: /^gpt-[a-z0-9.-]+$/i.test(String(d?.openaiFast || '')) ? String(d.openaiFast) : '',
    openaiShare: Number.isFinite(Number(d?.openaiShare)) ? Math.max(0, Math.min(100, Number(d.openaiShare))) : 0,
    openaiUids: Array.isArray(d?.openaiUids) ? d.openaiUids.map(String).filter(Boolean).slice(0, 50) : [],
    openaiOwner: d?.openaiOwner === true,
    openaiSite: d?.openaiSite === true,
    openaiHelpers: d?.openaiHelpers === true,
    promptSplit: d?.promptSplit === true,
    geminiPro: geminiName(d?.geminiPro),
    geminiProThinking: thinking(d?.geminiProThinking, 'low'),
    geminiFast: geminiName(d?.geminiFast),
    geminiFastThinking: thinking(d?.geminiFastThinking, 'low'),
    proFallback: geminiName(d?.proFallback),
    voiceRule: d?.voiceRule === true,
    lightFirst: d?.lightFirst !== false,
    lightVoice: d?.lightVoice !== false,
  };
}

let proRead: { at: number; day: string; count: number; player: number } | null = null;
/** Count one Pro request for a player, or false if today's Pro requests for players are used up (rare: 50,000 a day). */
export async function takePlayerPro(r: Routing): Promise<boolean> {
  if (r.playerProDaily <= 0) return false;
  const ref = getFirestore().collection('system').doc('proBudget');
  const day = quotaDay();
  try {
    const { proDaily, proCarefulReserve } = await apiLimits();
    if (!proRead || proRead.day !== day || Date.now() - proRead.at > 30_000) {
      const d: any = (await ref.get()).data() || {};
      proRead = { at: Date.now(), day, count: d.day === day ? Number(d.count || 0) : 0, player: d.day === day ? Number(d.player || 0) : 0 };
    }
    if (proRead.player >= r.playerProDaily || proRead.count >= proDaily - proCarefulReserve) return false;
    proRead.count++; proRead.player++;
    // Counted in the background: the answer doesn't wait for it.
    void getFirestore().runTransaction(async (t) => {
      const d: any = (await t.get(ref)).data() || {};
      const today = d.day === day ? d : { day, count: 0, careful: 0, other: 0, player: 0 };
      t.set(ref, { ...today, day, count: Number(today.count || 0) + 1, player: Number(today.player || 0) + 1, updatedAt: Date.now() });
    }).catch(() => {});
    return true;
  } catch {
    return true; // the count couldn't be read: Pro anyway (the dollar caps still apply)
  }
}
