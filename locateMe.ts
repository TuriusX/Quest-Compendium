/**
 * "Locate me": POST /api/locate-me
 *   { imageBase64: "data:image/jpeg;base64,...", game: string, guideKey?: string, areas: [{ name, story }], auto?: boolean }
 *   -> { area: string | "unknown", story: string, evidence: "read" | "guessed", seenText: string, confident: boolean,
 *        locatesLeft: number }
 *
 * The objectives tracker and the PlaceBar send a screenshot with the game's guide areas; the cheapest model picks the
 * area the player is in (only from that list) and a one-line story beat, and says whether it READ the place name on
 * screen (a minimap label, an area title, a map screen: seenText is that text) or GUESSED from the scenery. A read only
 * counts when seenText really names the chosen area or one of its sub-locations (the guide's own matching: see
 * src/utils/guideMatch.ts); otherwise it's a guess. The app confirms the place only for a read.
 *
 * The Fast model (owner, Oct 31 2026: LOCATE_ME_MODEL, else MAIN_MODEL) looks at everything on screen that says where
 * the player is: a place name (an area banner, a minimap label), a map screen with the player's marker, the quest
 * journal, the surroundings. It says how sure it is: confident is a read the server checked, or "high" confidence. The
 * app uses only a confident answer and asks the player otherwise (never a guess: the quest log shows nothing from the
 * guide for a place the player may not be in). Low thinking and short area lines keep it to a fraction of a cent.
 *
 * Automatic locates (auto: the app checks when a game starts, a tab is opened or switched to, and the player comes back
 * to the game) use the same allowance but stop at LOCATE_AUTO_DAILY (15) / LOCATE_AUTO_PREMIUM_DAILY (60), so the
 * player's own Locate me always has some left.
 *
 * It never uses the player's daily questions. Its own limit instead, per player per day (UTC, like questions):
 * LOCATE_ME_DAILY (30), LOCATE_ME_PREMIUM_DAILY (100). Signed-in players are counted on their user record (locateDate,
 * locatesUsed: server-only fields, see firestore.rules); guests in memory. Every check is counted for the owner's
 * /stats (statsHours/{hour}.loc, per anonymous player: ownerStats.ts).
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { ThinkingLevel } from '@google/genai';
import { logUsage, billedUsage } from './usage';
import { isTestTraffic } from './testTraffic';
import { matchGuideArea } from './src/utils/guideMatch';
import { nameKey, samePlace, storyPhrase } from './src/utils/placeName';

type GuideWithPages = { areas: { slug: string; name: string; story: string }[]; pages: Record<string, any> } | null;
type Deps = {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  getUserDoc: (idToken: string, uid: string) => Promise<any>;
  updateUserDoc: (idToken: string, uid: string, fields: Record<string, any>) => Promise<unknown>;
  /** The guide's areas with their pages (sub-locations), by guide key or game name. */
  loadGuide: (keyOrGame: string) => Promise<GuideWithPages>;
};

const envInt = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
const DAILY = envInt(process.env.LOCATE_ME_DAILY, 30);
const PREMIUM_DAILY = envInt(process.env.LOCATE_ME_PREMIUM_DAILY, 100);
const AUTO_DAILY = envInt(process.env.LOCATE_AUTO_DAILY, 15);
const AUTO_PREMIUM_DAILY = envInt(process.env.LOCATE_AUTO_PREMIUM_DAILY, 60);
/** Locate me: the Fast model (the answers' own). */
const MODEL = process.env.LOCATE_ME_MODEL || process.env.MAIN_MODEL || 'gemini-3.8-flash';
/** An answer's screenshot read for its place (readPlaceOnScreen): the cheapest model the app uses. */
const PLACE_READ_MODEL = process.env.PLACE_READ_MODEL || 'gemini-3.1-flash-lite';
const MAX_IMAGE_CHARS = 4_000_000;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_AREAS = 150;

/** Guests (guest_… tokens): today's count per guest, in memory. */
const guestCounts = new Map<string, { day: string; used: number }>();

export type LocateMeReply = {
  area: string; story: string; evidence: 'read' | 'guessed'; seenText: string;
  confidence: 'high' | 'medium' | 'low';
  /** What it went by: a place name read on screen, the map's marker, the quest journal, or the surroundings. */
  how: 'read' | 'map' | 'journal' | 'surroundings';
};

/** The model's reply, checked against the list: an area name from it (exactly as listed), or "unknown". */
export function parseLocateMeReply(text: string, areaNames: string[]): LocateMeReply {
  let parsed: any = {};
  try {
    parsed = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    parsed = {};
  }
  const wanted = String(parsed?.area ?? '').trim().toLowerCase();
  const area = areaNames.find((n) => n.toLowerCase() === wanted) || 'unknown';
  const seenText = String(parsed?.seenText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const c = String(parsed?.confidence ?? '').toLowerCase();
  const how = String(parsed?.how ?? '').toLowerCase();
  return {
    area,
    story: area === 'unknown' ? '' : String(parsed?.story ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
    evidence: area !== 'unknown' && String(parsed?.evidence ?? '').toLowerCase() === 'read' && !!seenText ? 'read' : 'guessed',
    seenText: area === 'unknown' ? '' : seenText,
    confidence: area !== 'unknown' && (c === 'high' || c === 'medium') ? c : 'low',
    how: how === 'read' || how === 'map' || how === 'journal' ? how : 'surroundings',
  };
}

/**
 * Good enough to set the place without asking: a place name read on screen that the server checked names the area, or
 * "high" confidence (the map's marker, the journal's current location, unmistakable surroundings). Anything less: the
 * app asks "Where are you?".
 */
export const isConfident = (r: LocateMeReply): boolean => r.area !== 'unknown' && (r.evidence === 'read' || r.confidence === 'high');

/** Locate me's question to the Fast model: which listed area, from everything on screen, and how sure. */
export function locateMePrompt(game: string, areas: { name: string; story: string }[]): string {
  // Short area lines keep the prompt small (a 60-area guide is about 1,500 tokens).
  const list = areas.map((a) => `- ${a.name}${a.story ? `: ${a.story.replace(/\s+/g, ' ').slice(0, 70)}` : ''}`).join('\n');
  return (
    `This is a screenshot of the video game "${game}". Which of these areas is the player in right now? Use everything ` +
    `on screen: a place name (an area title or banner, a minimap or compass label, a waypoint), a map screen with the ` +
    `player's marker, the quest journal's current location or quest, and the surroundings (landmarks, buildings, ` +
    `characters). Pick one name exactly as written, or "unknown" when the screen doesn't show enough (a menu, a loading ` +
    `screen, a dialogue close-up, a map with no marker, somewhere not in the list). Never assume the start of the game.\n` +
    `Areas (name: story beat):\n${list}\n` +
    `"how": "read" when a place name is visibly written on screen (put that exact text in seenText), "map" for the map's ` +
    `player marker, "journal" for the quest journal, "surroundings" otherwise. "confidence": "high" only when the screen ` +
    `clearly shows this area and no other listed area fits; else "medium" or "low".\n` +
    `Reply with JSON only: {"area": "<a name from the list, or unknown>", "how": "read" | "map" | "journal" | ` +
    `"surroundings", "confidence": "high" | "medium" | "low", "evidence": "read" | "guessed", "seenText": "<the place ` +
    `name as written on screen, or empty>", "story": "<where they are in the story, under 12 words>"}`
  );
}

/**
 * Does the text read off the screen really name this area? The area's own name ("Ravaged Beach", or with detail:
 * "Overgrown Ruins - Dank Crypt"), or one of its sub-locations by the guide's matching ("Dank Crypt" is in the
 * Overgrown Ruins' entries). Another area's name, or text the guide doesn't place in this area, doesn't count.
 */
export function seenTextNamesArea(
  seenText: string,
  area: string,
  areas: { slug: string; name: string; story: string }[],
  pages?: Record<string, any>,
): boolean {
  const seen = nameKey(seenText);
  const want = nameKey(area);
  if (!seen || !want) return false;
  if (samePlace(seenText, area) || seen === want) return true;
  if (want.length >= 4 && ` ${seen} `.includes(` ${want} `)) return true; // the name, with more around it
  const m = matchGuideArea(areas, seenText, undefined, pages);
  return !!m && m.via !== 'story' && areas[m.index]?.name === area;
}

/** The answers' place check (readPlaceOnScreen): which listed area, and the place name read on screen (if any). */
function locatePrompt(game: string, areas: { name: string; story: string }[], place: string): string {
  const list = areas.map((a) => `- ${a.name}${a.story ? `: ${a.story}` : ''}`).join('\n');
  return (
    `This is a screenshot of the video game "${game}". Which of these areas is the player in right now? Pick one name ` +
    `exactly as written, or "unknown" if the screenshot doesn't show enough to tell (a menu, a loading screen, a map with ` +
    `no marker, or somewhere not in the list).${place ? ` The player was last known to be in: ${place}.` : ''}\n` +
    `Areas (name: story beat):\n${list}\n` +
    `Say how you know. "read": a place name is visibly written on screen (a minimap label, an area title card, a map ` +
    `screen, a location banner); put that exact text in seenText. "guessed": you're going by the scenery, characters or ` +
    `story; leave seenText empty. Never claim "read" unless you can quote the text.\n` +
    `Reply with JSON only: {"area": "<a name from the list, or unknown>", "story": "<where they are in the story, under 12 ` +
    `words>", "evidence": "read" | "guessed", "seenText": "<the place name as written on screen, or empty>"}`
  );
}

type GuideAreasPages = { areas: { slug: string; name: string; story: string }[]; pages: Record<string, any> };

/**
 * Read the place off an answer's screenshot with Locate me's check (the cheapest model; it doesn't use Locate me's
 * daily allowance or the player's questions). A place name read on screen (a minimap label, an area title) that names
 * a guide area or one of its sub-locations wins over the stored place. Null when nothing was read, the read doesn't
 * name a guide area, or the check failed.
 */
export async function readPlaceOnScreen(
  client: GoogleGenAI,
  image: string,
  game: string,
  guide: GuideAreasPages,
  place = '',
): Promise<{ area: string; seenText: string; story: string } | null> {
  const m = String(image || '').match(DATA_URL_RE);
  if (!m || !guide.areas.length) return null;
  const areas = guide.areas.slice(0, MAX_AREAS);
  try {
    const response: any = await client.models.generateContent({
      model: PLACE_READ_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: locatePrompt(game, areas, place) }] }],
      config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 120 },
    });
    logUsage('place-read', PLACE_READ_MODEL, response);
    const r = parseLocateMeReply(response?.text ?? '', areas.map((a) => a.name));
    if (r.evidence !== 'read' || !seenTextNamesArea(r.seenText, r.area, areas, guide.pages)) return null;
    // Story beats are quest-log phrases ("Exploring the inner sanctum"), never notes about "the player".
    return { area: r.area, seenText: r.seenText, story: storyPhrase(r.story) };
  } catch (err: any) {
    console.warn('[place-read] failed:', err?.message);
    return null;
  }
}

/** The guide area that a place name read on screen names (the area itself, or one of its sub-locations), or null. */
export function areaForSeenText(seenText: string, guide: GuideAreasPages): string | null {
  const seen = String(seenText || '').trim();
  if (!seen || !guide.areas.length) return null;
  const named = guide.areas.find((a) => seenTextNamesArea(seen, a.name, guide.areas, guide.pages));
  return named ? named.name : null;
}

/** One Locate me check for the owner's /stats: per anonymous player and UTC hour (never test traffic). */
function countForStats(uid: string, auto: boolean, found: boolean, dollars: number): void {
  if (!uid || isTestTraffic(uid)) return;
  try {
    const who = crypto.createHash('sha256').update(`qc:${uid}`).digest('hex').slice(0, 12);
    const hour = new Date().toISOString().slice(0, 13);
    getFirestore().collection('statsHours').doc(hour).set({
      at: Date.parse(`${hour}:00:00Z`),
      loc: { [who]: { n: FieldValue.increment(1), ...(auto ? { a: FieldValue.increment(1) } : {}), ...(found ? { f: FieldValue.increment(1) } : {}), c: FieldValue.increment(Math.round(dollars * 1e6)) } },
    }, { merge: true }).catch(() => {});
  } catch {
    // no database (local dev): not counted
  }
}

export function registerLocateMe(app: Express, deps: Deps) {
  app.post('/api/locate-me', deps.requireAuth as any, async (req: Request, res: Response) => {
    const image = String(req.body?.imageBase64 ?? '');
    const m = image.match(DATA_URL_RE);
    if (!m || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'A screenshot is required.' });
    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const guideKey = String(req.body?.guideKey ?? '').trim().slice(0, 120);
    const areas: { name: string; story: string }[] = (Array.isArray(req.body?.areas) ? req.body.areas : [])
      .slice(0, MAX_AREAS)
      .map((a: any) => ({ name: String(a?.name ?? '').trim().slice(0, 80), story: String(a?.story ?? '').trim().slice(0, 160) }))
      .filter((a: { name: string }) => a.name);
    if (!game || !areas.length) return res.status(400).json({ error: 'The game and its guide areas are required.' });
    const auto = req.body?.auto === true;

    // Today's allowance: its own, separate from questions.
    const user = (req as any).user || {};
    const uid = String(user.uid || '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    const idToken = String(req.headers.authorization || '').split('Bearer ')[1] || '';
    const today = new Date().toISOString().split('T')[0];
    let used = 0;
    let limit = DAILY;
    let autoLimit = AUTO_DAILY;
    if (isGuest) {
      const g = guestCounts.get(uid);
      used = g && g.day === today ? g.used : 0;
    } else {
      const userDoc = (await deps.getUserDoc(idToken, uid).catch(() => null)) || {};
      if (userDoc.isPremium === true) {
        limit = PREMIUM_DAILY;
        autoLimit = AUTO_PREMIUM_DAILY;
      }
      used = userDoc.locateDate === today ? Number(userDoc.locatesUsed) || 0 : 0;
    }
    // An automatic check stops early, so the player's own Locate me always has some left (the app then asks).
    if (auto && used >= Math.min(autoLimit, limit)) {
      return res.status(429).json({ error: 'Automatic checks are used up for today.', autoLimitReached: true, locatesLeft: Math.max(0, limit - used) });
    }
    if (used >= limit) {
      return res.status(429).json({
        error: `You've used today's ${limit} "Locate me" checks. They reset at midnight UTC; your questions aren't affected.`,
        locateLimitReached: true,
        limit,
        locatesLeft: 0,
      });
    }

    // No "last known place" in the question: it would pull the answer toward it (a resumed save is often elsewhere).
    const prompt = locateMePrompt(game, areas);
    try {
      const response: any = await deps.getGeminiClient().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      logUsage(auto ? 'locate-auto' : 'locate-me', MODEL, response);
      const result = parseLocateMeReply(response?.text ?? '', areas.map((a) => a.name));
      // A read only counts if the text really names that area (or one of its sub-locations in the guide).
      if (result.evidence === 'read') {
        const guide = await deps.loadGuide(guideKey || game).catch(() => null);
        const guideAreas = guide?.areas?.length ? guide.areas : areas.map((a) => ({ slug: '', name: a.name, story: a.story }));
        if (!seenTextNamesArea(result.seenText, result.area, guideAreas, guide?.pages)) {
          console.log(`[locate-me] "${result.seenText}" doesn't name ${result.area}: counted as a guess`);
          result.evidence = 'guessed';
        }
      }
      // Counted once the check ran (an unreadable screenshot still costs a model call).
      const confident = isConfident(result);
      if (isGuest) guestCounts.set(uid, { day: today, used: used + 1 });
      else await deps.updateUserDoc(idToken, uid, { locateDate: today, locatesUsed: used + 1 }).catch(() => {});
      countForStats(uid, auto, confident, billedUsage(MODEL, response).tokenDollars);
      return res.json({ ...result, confident, locatesLeft: Math.max(0, limit - used - 1) });
    } catch (err: any) {
      console.warn('[locate-me] failed:', err?.message);
      return res.status(502).json({ error: "Couldn't check the screenshot. Try again in a moment." });
    }
  });
}
