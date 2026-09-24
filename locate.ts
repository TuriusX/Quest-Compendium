/**
 * Area items for on-screen pointers: POST /api/locate
 *   { imageBase64: "data:image/jpeg;base64,...", targets: [{ label, hint }], game?: string }
 *   -> { found: [{ index, x, y }] }   (x, y are 0-1 fractions from the top-left of the screenshot)
 *
 * When the AI points things out, it can also list other items in the same area that aren't on screen yet
 * ("nearby"). As the player walks around, the desktop app sends a small screenshot here to ask: are any of these
 * visible now? Found ones get a marker that sticks like the others.
 *
 * Free: these checks never use the player's Pro/Flash questions. Limited instead:
 *   LOCATE_PER_USER_HOURLY (30), LOCATE_PER_GUEST_HOURLY (30), LOCATE_GLOBAL_DAILY (5000), LOCATE_MODEL (gemini-3.8-flash)
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';
import { clientIp } from './guestGuard';

export interface LocateDeps {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export interface LocateTarget {
  label: string;
  hint?: string;
}

const MAX_TARGETS = 6;
const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB of base64: a 1280x720 JPEG is far smaller

const envNum = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** The model's reply: a JSON array of { i, y, x } on a 0-1000 scale. Returns valid, de-duplicated hits. */
export function parseLocateReply(text: string, targetCount: number): { index: number; x: number; y: number }[] {
  const raw = String(text || '').replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<number>();
  const out: { index: number; x: number; y: number }[] = [];
  for (const p of parsed) {
    const index = Number((p as any)?.i ?? (p as any)?.index);
    const x = Number((p as any)?.x);
    const y = Number((p as any)?.y);
    if (!Number.isInteger(index) || index < 0 || index >= targetCount || seen.has(index)) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) continue;
    seen.add(index);
    out.push({ index, x: x / 1000, y: y / 1000 });
  }
  return out;
}

export function registerLocate(app: Express, deps: LocateDeps): void {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const model = env.LOCATE_MODEL || 'gemini-3.8-flash';
  const perUserHourly = envNum(env.LOCATE_PER_USER_HOURLY, 30);
  const perGuestHourly = envNum(env.LOCATE_PER_GUEST_HOURLY, 30);
  const globalDaily = envNum(env.LOCATE_GLOBAL_DAILY, 5000);
  const proxyHops = envNum(env.GUEST_PROXY_HOPS, 1);

  const hourly = new Map<string, { n: number; reset: number }>();
  let global = { day: '', n: 0 };
  setInterval(() => {
    const t = now();
    for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k);
  }, 60_000).unref();

  app.post('/api/locate', deps.requireAuth as any, async (req: Request, res: Response) => {
    const image = String(req.body?.imageBase64 ?? '');
    const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'A screenshot is required.' });
    const targets: LocateTarget[] = (Array.isArray(req.body?.targets) ? req.body.targets : [])
      .slice(0, MAX_TARGETS)
      .map((t: any) => ({ label: String(t?.label ?? '').trim().slice(0, 40), hint: String(t?.hint ?? '').trim().slice(0, 100) }))
      .filter((t: LocateTarget) => t.label);
    if (!targets.length) return res.json({ found: [] });

    const user = (req as any).user ?? {};
    const uid = String(user.uid ?? '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    const limiterKey = isGuest ? `ip:${clientIp(req, proxyHops)}` : `uid:${uid}`;
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (global.day !== day) global = { day, n: 0 };
    let w = hourly.get(limiterKey);
    if (!w || t >= w.reset) {
      w = { n: 0, reset: t + 60 * 60 * 1000 };
      hourly.set(limiterKey, w);
    }
    if (w.n >= (isGuest ? perGuestHourly : perUserHourly) || global.n >= globalDaily) {
      return res.status(429).json({ error: 'Area checks are paused for a bit. Try again later.', found: [] });
    }
    w.n++;
    global.n++;

    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const list = targets.map((tg, i) => `${i}. ${tg.label}${tg.hint ? ` (${tg.hint})` : ''}`).join('\n');
    const prompt =
      `This is a screenshot${game ? ` from the video game ${game}` : ''}. ` +
      'Which of these things are visible in it right now?\n' +
      `${list}\n\n` +
      'Reply with JSON only: an array of {"i": number from the list, "y": 0-1000 from the top, "x": 0-1000 from the left} ' +
      'for the center of each one that you can actually see. Be precise and conservative: if you are not sure it is ' +
      'the right spot, leave it out. Reply [] if none are visible.';

    try {
      const ai = deps.getGeminiClient();
      const response: any = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);
      return res.json({ found: parseLocateReply(response?.text ?? '', targets.length) });
    } catch (err: any) {
      console.warn('[locate] failed:', err?.message);
      return res.status(502).json({ error: 'Could not check the screenshot.', found: [] });
    }
  });
}
