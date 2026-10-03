/**
 * "Locate me": POST /api/locate-me
 *   { imageBase64: "data:image/jpeg;base64,...", game: string, areas: [{ name, story }], place?: string }
 *   -> { area: string | "unknown", story: string, confidence: "high" | "medium" | "low", locatesLeft: number }
 *
 * The objectives tracker and the PlaceBar send a screenshot with the game's guide areas; the cheapest model picks the
 * area the player is in (only from that list) and a one-line story beat. It never uses the player's daily questions.
 * Its own limit instead, per player per day (UTC, like questions): LOCATE_ME_DAILY (20), LOCATE_ME_PREMIUM_DAILY (100).
 * Signed-in players are counted on their user record (locateDate, locatesUsed: server-only fields, see
 * firestore.rules); guests in memory.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';
import { logUsage } from './usage';

type Deps = {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  getUserDoc: (idToken: string, uid: string) => Promise<any>;
  updateUserDoc: (idToken: string, uid: string, fields: Record<string, any>) => Promise<unknown>;
};

const envInt = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
const DAILY = envInt(process.env.LOCATE_ME_DAILY, 20);
const PREMIUM_DAILY = envInt(process.env.LOCATE_ME_PREMIUM_DAILY, 100);
const MODEL = process.env.LOCATE_ME_MODEL || 'gemini-3.1-flash-lite'; // the cheapest model the app uses
const MAX_IMAGE_CHARS = 4_000_000;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_AREAS = 150;

/** Guests (guest_… tokens): today's count per guest, in memory. */
const guestCounts = new Map<string, { day: string; used: number }>();

/** The model's reply, checked against the list: an area name from it (exactly as listed), or "unknown". */
export function parseLocateMeReply(text: string, areaNames: string[]): { area: string; story: string; confidence: 'high' | 'medium' | 'low' } {
  let parsed: any = {};
  try {
    parsed = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    parsed = {};
  }
  const wanted = String(parsed?.area ?? '').trim().toLowerCase();
  const area = areaNames.find((n) => n.toLowerCase() === wanted) || 'unknown';
  const conf = String(parsed?.confidence ?? '').toLowerCase();
  return {
    area,
    story: area === 'unknown' ? '' : String(parsed?.story ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
    confidence: area === 'unknown' ? 'low' : conf === 'high' || conf === 'medium' ? conf : 'low',
  };
}

export function registerLocateMe(app: Express, deps: Deps) {
  app.post('/api/locate-me', deps.requireAuth as any, async (req: Request, res: Response) => {
    const image = String(req.body?.imageBase64 ?? '');
    const m = image.match(DATA_URL_RE);
    if (!m || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'A screenshot is required.' });
    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const areas: { name: string; story: string }[] = (Array.isArray(req.body?.areas) ? req.body.areas : [])
      .slice(0, MAX_AREAS)
      .map((a: any) => ({ name: String(a?.name ?? '').trim().slice(0, 80), story: String(a?.story ?? '').trim().slice(0, 160) }))
      .filter((a: { name: string }) => a.name);
    if (!game || !areas.length) return res.status(400).json({ error: 'The game and its guide areas are required.' });
    const place = String(req.body?.place ?? '').trim().slice(0, 80);

    // Today's allowance: its own, separate from questions.
    const user = (req as any).user || {};
    const uid = String(user.uid || '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    const idToken = String(req.headers.authorization || '').split('Bearer ')[1] || '';
    const today = new Date().toISOString().split('T')[0];
    let used = 0;
    let limit = DAILY;
    if (isGuest) {
      const g = guestCounts.get(uid);
      used = g && g.day === today ? g.used : 0;
    } else {
      const userDoc = (await deps.getUserDoc(idToken, uid).catch(() => null)) || {};
      if (userDoc.isPremium === true) limit = PREMIUM_DAILY;
      used = userDoc.locateDate === today ? Number(userDoc.locatesUsed) || 0 : 0;
    }
    if (used >= limit) {
      return res.status(429).json({
        error: `You've used today's ${limit} "Locate me" checks. They reset at midnight UTC; your questions aren't affected.`,
        locateLimitReached: true,
        limit,
        locatesLeft: 0,
      });
    }

    const list = areas.map((a) => `- ${a.name}${a.story ? `: ${a.story}` : ''}`).join('\n');
    const prompt =
      `This is a screenshot of the video game "${game}". Which of these areas is the player in right now? Pick one name ` +
      `exactly as written, or "unknown" if the screenshot doesn't show enough to tell (a menu, a loading screen, a map with ` +
      `no marker, or somewhere not in the list).${place ? ` The player was last known to be in: ${place}.` : ''}\n` +
      `Areas (name: story beat):\n${list}\n` +
      `Reply with JSON only: {"area": "<a name from the list, or unknown>", "story": "<where they are in the story, under 12 ` +
      `words>", "confidence": "high" | "medium" | "low"}. High only when the screenshot clearly shows that area.`;
    try {
      const response: any = await deps.getGeminiClient().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 120 },
      });
      logUsage('locate-me', MODEL, response);
      const result = parseLocateMeReply(response?.text ?? '', areas.map((a) => a.name));
      // Counted once the check ran (an unreadable screenshot still costs a model call).
      if (isGuest) guestCounts.set(uid, { day: today, used: used + 1 });
      else await deps.updateUserDoc(idToken, uid, { locateDate: today, locatesUsed: used + 1 }).catch(() => {});
      return res.json({ ...result, locatesLeft: Math.max(0, limit - used - 1) });
    } catch (err: any) {
      console.warn('[locate-me] failed:', err?.message);
      return res.status(502).json({ error: "Couldn't check the screenshot. Try again in a moment." });
    }
  });
}
