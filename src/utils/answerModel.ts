/**
 * The player's model choice next to the send button: "pro" (best answers) or "fast". Remembered on this device; the
 * server answers with the other model when the chosen one is used up today (allowances.ts) and the app follows.
 */
export type AnswerModel = 'pro' | 'fast';

const KEY = 'qc-answer-model';
export const ANSWER_MODEL_EVENT = 'qc-answer-model';

export function readAnswerModel(): AnswerModel {
  try {
    return localStorage.getItem(KEY) === 'fast' ? 'fast' : 'pro';
  } catch {
    return 'pro';
  }
}
export function saveAnswerModel(m: AnswerModel): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {}
}

/**
 * What an answer's grey line says about its model: "Pro" or "Fast" (the player's two choices), never the model's
 * own name ("Gemini 3.1 Pro" -> Pro; any Flash, Flash-Lite or fallback -> Fast). '' for the app's own notes (the limit
 * message, an expired session, offline) and anything else.
 */
export function modelKind(modelUsed?: string): AnswerModel | '' {
  const m = String(modelUsed || '');
  if (/offline|limit reached|session expired|unavailable|^eval$|^app$/i.test(m)) return '';
  if (/flash|lite|fast/i.test(m)) return 'fast';
  if (/\bpro\b/i.test(m)) return 'pro';
  return '';
}

/** The device's time zone, for the midnight reset (the server falls back to UTC without it). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Questions left of each model, from the user status / chat response (older servers: one shared count). */
export type Balances = { pro: number; fast: number; dailyPro: number; dailyFast: number; resetAt?: number; rollover?: boolean; bankCap?: number };
export function balancesOf(d: any): Balances {
  const n = (v: any, def = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : def);
  return {
    pro: n(d?.proQueriesAvailable),
    fast: n(d?.flashQueriesAvailable),
    dailyPro: n(d?.dailyPro, 0),
    dailyFast: n(d?.dailyFlash, 0),
    ...(Number(d?.resetAt) > 0 ? { resetAt: Number(d.resetAt) } : {}),
    // Premium's carry-over: unused questions are kept, each model capped at bankCap.
    ...(d?.rollover === true ? { rollover: true, bankCap: n(d?.bankCap, 0) } : {}),
  };
}

/**
 * The next daily top-up: what each model gets at midnight (the player's time zone) and how long until then. Premium
 * (carry-over) gets the day's amount up to the cap: atMax when a model is already at it. Free and guest players get
 * their day's amounts. null while the reset time or the amounts aren't known.
 */
export function topUp(b: Balances, now = Date.now()): { pro: number; fast: number; proMax: boolean; fastMax: boolean; cap: number; h: number; m: number; reset: boolean } | null {
  if (!b.resetAt || (!b.dailyPro && !b.dailyFast)) return null;
  const cap = b.rollover && b.bankCap ? b.bankCap : 0;
  const add = (left: number, daily: number) => (cap ? Math.min(daily, Math.max(0, cap - left)) : daily);
  const { h, m } = untilReset(b.resetAt, now);
  return {
    pro: add(b.pro, b.dailyPro),
    fast: add(b.fast, b.dailyFast),
    proMax: !!cap && b.pro >= cap,
    fastMax: !!cap && b.fast >= cap,
    cap,
    h,
    m,
    // Free and guest days don't carry over: midnight sets the balance back to the day's amount, it doesn't add to it.
    reset: !cap,
  };
}

/**
 * One count of questions (owner, Nov 22 2026): players never see the two kinds. The total left, and what the next
 * top-up adds to it.
 */
export const questionsLeft = (b: { pro: number; fast: number }) => b.pro + b.fast;
type T = (k: string, v?: Record<string, string | number>) => string;
/** A free or guest day's amount, as what the balance goes back to: "5 questions". */
export const resetParts = (u: { pro: number; fast: number }, t: T) => t('topup.backQ', { n: u.pro + u.fast });
/** What the next Premium top-up adds: "+25 questions", or that they're already holding the most they can. */
export const addParts = (u: { pro: number; fast: number; proMax: boolean; fastMax: boolean }, t: T) => {
  const n = (u.proMax ? 0 : u.pro) + (u.fastMax ? 0 : u.fast);
  return n > 0 ? t('topup.addQ', { n }) : t('topup.fullQ');
};

/** The top-up as one line: "+25 questions in 13h 20m"; free and guest: "Back to 5 questions in 13h 20m". */
export function topUpLine(b: Balances, t: T, now = Date.now()): string {
  const u = topUp(b, now);
  if (!u) return '';
  const when = u.h > 0 ? t('topup.hm', { h: u.h, m: u.m }) : t('topup.m', { m: u.m });
  if (u.reset) return t('topup.backLine', { parts: resetParts(u, t), when });
  return t('topup.line', { parts: addParts(u, t), when });
}

/**
 * The model named on an answer's grey line (owner, Nov 22 2026: show which model answered, e.g. "Gemini 4 Hydrogen
 * (medium)"; no Best / Quick). Older answers get readable names; '' for the app's own notes.
 */
export function modelLabel(modelUsed?: string): string {
  const m = String(modelUsed || '').trim();
  if (!m || /offline|limit reached|session expired|unavailable|^eval$|^app$/i.test(m)) return '';
  const gpt = m.match(/\((gpt-[a-z0-9.-]+)\)/i)?.[1] || (/^gpt-/i.test(m) ? m : '');
  if (gpt) return gpt.replace(/^gpt-/i, 'GPT-').replace(/-([a-z])/g, (_x, c) => ` ${c.toUpperCase()}`);
  return m.replace(/\s*\((?:emergency )?fallback\)/i, '');
}

/**
 * The model to start with: the remembered one if it has questions left, else the other one when it has some; when
 * neither has, the remembered one (the server then answers with the limit message).
 */
export function startingModel(saved: AnswerModel, b: { pro: number; fast: number }): AnswerModel {
  if ((saved === 'pro' ? b.pro : b.fast) > 0) return saved;
  const other: AnswerModel = saved === 'pro' ? 'fast' : 'pro';
  return (other === 'pro' ? b.pro : b.fast) > 0 ? other : saved;
}

/** "in 3 h 20 min" style countdown parts to the reset. */
export function untilReset(resetAt: number, now = Date.now()): { h: number; m: number } {
  const mins = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}
