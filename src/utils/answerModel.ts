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

/** The device's time zone, for the midnight reset (the server falls back to UTC without it). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Questions left of each model, from the user status / chat response (older servers: one shared count). */
export function balancesOf(d: any): { pro: number; fast: number; dailyPro: number; dailyFast: number; resetAt?: number } {
  const n = (v: any, def = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : def);
  return {
    pro: n(d?.proQueriesAvailable),
    fast: n(d?.flashQueriesAvailable),
    dailyPro: n(d?.dailyPro, 0),
    dailyFast: n(d?.dailyFlash, 0),
    ...(Number(d?.resetAt) > 0 ? { resetAt: Number(d.resetAt) } : {}),
  };
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
