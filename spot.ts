/**
 * "Spot it" (roadmap item 7): POST /api/spot
 *   { imageBase64, game, entry, where?, guideKey?, slug?, id? }
 *   -> { visible: boolean, x?, y?, label?, spotsLeft }   (x, y: 0-1 fractions of the screenshot)
 *
 * A guide or quest-log entry's "Spot it (landmarks, NPCs, chests)": the cheapest model looks at a fresh screenshot for
 * that one named thing. Tested on Oct 14, 2026 with 30 cases (scratchpad/spot): it found all 14 large landmarks, NPCs
 * and objects that were on screen and marked none of the 16 that weren't; small pickups weren't tested, hence the
 * wording. It never uses the player's questions: its own limit instead, SPOT_DAILY (20) a day, SPOT_PREMIUM_DAILY
 * (100) for Premium, counted in spotUse/{player} (server only).
 *
 * Every use is counted per day in spotStats/{day} (uses, found, not in view): with the 👎 "marker" reports on spot
 * results (answerFeedback, kind "spot"), that's the weekly hit rate in the pipeline's Discord summary (run.ts).
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logUsage } from './usage';

type Deps = {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  getUserDoc: (idToken: string, uid: string) => Promise<any>;
};

const envInt = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
const DAILY = envInt(process.env.SPOT_DAILY, 20);
const PREMIUM_DAILY = envInt(process.env.SPOT_PREMIUM_DAILY, 100);
const MODEL = process.env.SPOT_MODEL || 'gemini-3.1-flash-lite';
const MAX_IMAGE_CHARS = 4_000_000;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const db = () => getFirestore();
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The question to the model: the same wording as the Oct 14 test, which found 14 of 14 and marked 0 of 16 wrongly. */
export function spotPrompt(game: string, entry: string, where: string): string {
  const thing = where ? `${entry}: ${where}` : entry;
  return (
    `This is a screenshot of the video game "${game}". The player wants to find this, from the game's guide: "${thing}". ` +
    `Is that exact thing visible in this screenshot? Only say yes if you can see it itself (not just the kind of place it ` +
    `might be in). Reply with JSON only: {"visible": true|false, "x": <0-1000 from the left, its centre>, "y": <0-1000 from the top>, "label": "<what you see, a few words>"}`
  );
}

/** The model's reply: visible only with a point on the screenshot. */
export function parseSpotReply(text: string): { visible: boolean; x?: number; y?: number; label?: string } {
  let j: any = {};
  try {
    j = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { visible: false };
  }
  const x = Number(j?.x), y = Number(j?.y);
  if (j?.visible !== true || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) return { visible: false };
  return { visible: true, x: Math.round(x) / 1000, y: Math.round(y) / 1000, label: clip(j?.label, 60) };
}

/** Guests: today's count per guest, in memory. */
const guestCounts = new Map<string, { day: string; used: number }>();

export function registerSpot(app: Express, deps: Deps) {
  app.post('/api/spot', deps.requireAuth as any, async (req: Request, res: Response) => {
    const image = String(req.body?.imageBase64 ?? '');
    const m = image.match(DATA_URL_RE);
    if (!m || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'A screenshot is required.' });
    const game = clip(req.body?.game, 120);
    const entry = clip(req.body?.entry, 120);
    const where = clip(req.body?.where, 200);
    if (!game || !entry) return res.status(400).json({ error: 'The game and what to find are required.' });

    const user = (req as any).user || {};
    const uid = String(user.uid || '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    const idToken = String(req.headers.authorization || '').split('Bearer ')[1] || '';
    const today = new Date().toISOString().slice(0, 10);
    let used = 0;
    let limit = DAILY;
    const useRef = isGuest ? null : db().collection('spotUse').doc(uid);
    if (isGuest) {
      const g = guestCounts.get(uid);
      used = g && g.day === today ? g.used : 0;
    } else {
      const [userDoc, use] = await Promise.all([deps.getUserDoc(idToken, uid).catch(() => null), useRef!.get().catch(() => null)]);
      if (userDoc?.isPremium === true) limit = PREMIUM_DAILY;
      const u: any = use?.data() || {};
      used = u.day === today ? Number(u.used) || 0 : 0;
    }
    if (used >= limit) {
      return res.status(429).json({ error: `You've used today's ${limit} "Spot it" checks. They reset at midnight UTC; your questions aren't affected.`, spotLimitReached: true, spotsLeft: 0 });
    }

    try {
      const response: any = await deps.getGeminiClient().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: spotPrompt(game, entry, where) }] }],
        config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 120 },
      });
      logUsage('spot', MODEL, response);
      const result = parseSpotReply(response?.text ?? '');
      if (isGuest) guestCounts.set(uid, { day: today, used: used + 1 });
      else await useRef!.set({ day: today, used: used + 1 }).catch(() => {});
      void db().collection('spotStats').doc(today).set(
        { uses: FieldValue.increment(1), [result.visible ? 'found' : 'notInView']: FieldValue.increment(1), updatedAt: Date.now() },
        { merge: true },
      ).catch(() => {});
      return res.json({ ...result, spotsLeft: Math.max(0, limit - used - 1) });
    } catch (err: any) {
      console.warn('[spot] failed:', err?.message);
      return res.status(502).json({ error: "Couldn't check the screenshot. Try again in a moment." });
    }
  });
}

/**
 * The weekly "Spot it" line for the Discord summary: the last 7 days' uses, how often it found the thing, and the hit
 * rate (found, less the found ones reported 👎 "marker"). Null with no uses.
 */
export async function spotWeekLine(now = new Date()): Promise<string | null> {
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (i + 1) * 86_400_000).toISOString().slice(0, 10));
  const docs = await Promise.all(days.map((d) => db().collection('spotStats').doc(d).get()));
  let uses = 0, found = 0;
  for (const d of docs) {
    const s: any = d.data() || {};
    uses += Number(s.uses) || 0;
    found += Number(s.found) || 0;
  }
  if (!uses) return null;
  const since = now.getTime() - 7 * 86_400_000;
  const fb = (await db().collection('answerFeedback').where('at', '>=', since).get()).docs.map((d) => d.data() as any).filter((r) => r.kind === 'spot');
  const wrong = fb.filter((r) => r.vote === 'down' && r.reason === 'marker').length;
  const up = fb.filter((r) => r.vote === 'up').length;
  const hit = found ? Math.round(((found - Math.min(wrong, found)) / found) * 100) : 0;
  return `🔎 Spot it, last 7 days: ${uses} uses, found ${found} (${Math.round((found / uses) * 100)}%), not in view ${uses - found}. ` +
    `👎 wrong marker ${wrong}, 👍 ${up}: hit rate ${found ? `${hit}%` : 'n/a'} of the ones it found.`;
}
