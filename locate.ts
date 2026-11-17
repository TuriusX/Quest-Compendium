/**
 * Area items for on-screen pointers: POST /api/locate
 *   { imageBase64: "data:image/jpeg;base64,...", targets: [{ label, hint }], game?: string }
 *   -> { found: [{ index, x, y }] }   (x, y are 0-1 fractions from the top-left of the screenshot)
 *
 * When the AI points things out, it can also list other items in the same area that aren't on screen yet
 * ("nearby"). As the player walks around, the desktop app sends a small screenshot here to ask: are any of these
 * visible now? Found ones get a marker that sticks like the others.
 *
 * Also POST /api/refine: the precision pass. Right after an answer, the app sends a zoomed-in crop around each marked
 * spot, with the AI's own description of which object it is ("lower-right barrel of the three"), and gets back the
 * exact spot inside each crop. Tiny objects in a scaled-down screenshot are easy to miss by one; close-ups aren't.
 *
 * And POST /api/refind (markers v2, Nov 2026): answers arrive about 20 s after their screenshot, so the screen has
 * usually moved on (in a 3D game the camera has turned). The desktop app takes a fresh picture when the answer arrives
 * and sends it with a close-up of each marked thing from the question's screenshot; this finds each thing on the
 * screen as it is now. Tested on 51 objects after a big camera move: 50 right with close-ups (61% by lining up the old
 * screenshot), and things that had left the screen were marked anyway 1 time in 8. Replaces /api/refine on desktop.
 *
 * Free: these never use the player's Pro/Flash questions. Limited instead (each endpoint separately):
 *   LOCATE_PER_USER_HOURLY (60), LOCATE_PER_GUEST_HOURLY (60), LOCATE_GLOBAL_DAILY (10000), LOCATE_MODEL (gemini-3.8-flash)
 */
import type { Express, NextFunction, Request, Response } from 'express';
import { ThinkingLevel, type GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { clientIp } from './guestGuard';
import { logUsage } from './usage';

export interface LocateDeps {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Whether this player gets marker AI features (Premium, or everyone during the beta). Default: yes. */
  allowed?: (req: Request) => Promise<boolean>;
  /**
   * The close-up check looked at `checked` markers and kept `kept` (marker drop counts per game). `details`: each marker
   * it removed or moved far, with why, for the Quality page (no screenshots or crops are kept).
   */
  onChecked?: (game: string, checked: number, kept: number, details?: MarkerCheckDetail[]) => void;
  /** Markers v2: one more "find again" fits under today's cap (markerFindCap.ts). The first placement isn't capped. */
  findAgainAllowed?: () => Promise<boolean>;
}

/** What the close-up check made of one marker ('off screen': finding it on the screen now didn't see it, /api/refind). */
export type MarkerOutcome = 'kept' | 'moved' | 'not there' | 'no person' | 'off screen';
export interface MarkerCheckDetail {
  label: string;
  category: string;
  guide: boolean;
  outcome: Exclude<MarkerOutcome, 'kept'>;
  client: string;
  appVersion: string;
}

/** Found this far (0-1 of the close-up) from the close-up's centre, a marker was on the wrong thing next to it. */
const MOVED_FAR = 0.25;
/**
 * Each checked marker's outcome: not found ("not there"), found by the first look but the blind look saw no one there
 * ("no person"), found far from where the answer put it ("moved"), else kept.
 */
export function markerOutcomes(count: number, firstLook: { index: number; x: number; y: number }[], noOne: Set<number>): MarkerOutcome[] {
  return Array.from({ length: count }, (_, i) => {
    const f = firstLook.find((x) => x.index === i);
    if (!f) return 'not there';
    if (noOne.has(i)) return 'no person';
    return Math.hypot(f.x - 0.5, f.y - 0.5) > MOVED_FAR ? 'moved' : 'kept';
  });
}

export interface LocateTarget {
  label: string;
  hint?: string;
}

const MAX_TARGETS = 6;
// These replies are a short JSON list, so default thinking was nearly all the cost (often 3,000+ thinking tokens to
// answer "[]"). LOW is the lowest level gemini-3.8-flash accepts (MINIMAL is rejected with a 400).
const LOCATE_THINKING = { thinkingLevel: ThinkingLevel.LOW };
/** The precision pass checks every marker an answer can have: 5, or 8 in a fight. */
export const REFINE_MAX_CROPS = 8;
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
  const perUserHourly = envNum(env.LOCATE_PER_USER_HOURLY, 60);
  const perGuestHourly = envNum(env.LOCATE_PER_GUEST_HOURLY, 60);
  const globalDaily = envNum(env.LOCATE_GLOBAL_DAILY, 10000);
  const proxyHops = envNum(env.GUEST_PROXY_HOPS, 1);

  const hourly = new Map<string, { n: number; reset: number }>();
  let global = { day: '', n: 0 };
  setInterval(() => {
    const t = now();
    for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k);
  }, 60_000).unref();

  app.post('/api/locate', deps.requireAuth as any, async (req: Request, res: Response) => {
    if (deps.allowed && !(await deps.allowed(req))) return res.status(403).json({ error: 'Part of Premium.', premiumRequired: true, found: [] });
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
          config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: LOCATE_THINKING },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);
      logUsage('area-check', model, response);
      return res.json({ found: parseLocateReply(response?.text ?? '', targets.length) });
    } catch (err: any) {
      console.warn('[locate] failed:', err?.message);
      return res.status(502).json({ error: 'Could not check the screenshot.', found: [] });
    }
  });
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Precision pass: POST /api/refine { crops: [{ image, label, where }], game? } -> { found: [{ index, x, y }] } (0-1 within each crop). */
export function registerRefine(app: Express, deps: LocateDeps): void {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const model = env.LOCATE_MODEL || 'gemini-3.8-flash';
  const perUserHourly = envNum(env.LOCATE_PER_USER_HOURLY, 60);
  const perGuestHourly = envNum(env.LOCATE_PER_GUEST_HOURLY, 60);
  const globalDaily = envNum(env.LOCATE_GLOBAL_DAILY, 10000);
  const proxyHops = envNum(env.GUEST_PROXY_HOPS, 1);
  const hourly = new Map<string, { n: number; reset: number }>();
  let global = { day: '', n: 0 };
  setInterval(() => {
    const t = now();
    for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k);
  }, 60_000).unref();

  app.post('/api/refine', deps.requireAuth as any, async (req: Request, res: Response) => {
    if (deps.allowed && !(await deps.allowed(req))) return res.status(403).json({ error: 'Part of Premium.', premiumRequired: true, found: [] });
    const crops = (Array.isArray(req.body?.crops) ? req.body.crops : [])
      .slice(0, REFINE_MAX_CROPS)
      .map((c: any) => ({
        image: String(c?.image ?? ''),
        label: String(c?.label ?? '').trim().slice(0, 40),
        where: String(c?.where ?? '').trim().slice(0, 100),
        category: /^[a-z]{2,12}$/.test(String(c?.category ?? '')) ? String(c.category) : '',
        guide: c?.guide === true,
      }))
      .filter((c: any) => c.label && DATA_URL_RE.test(c.image) && c.image.length <= MAX_IMAGE_CHARS);
    if (!crops.length) return res.json({ found: [] });
    // Which app asked (desktop, web, deck) and its version, kept with the removals so a bad release shows up.
    const client = /^(desktop|web|deck)$/.test(String(req.body?.client ?? '')) ? String(req.body.client) : 'desktop';
    const appVersion = String(req.body?.appVersion ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 24);

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
      return res.status(429).json({ error: 'Precision checks are paused for a bit.', found: [] });
    }
    w.n++;
    global.n++;

    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const parts: any[] = [];
    crops.forEach((c: any, i: number) => {
      const m = c.image.match(DATA_URL_RE)!;
      parts.push({ text: `Image ${i}:` });
      parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    });
    const list = crops.map((c: any, i: number) => `${i}. In image ${i}: ${c.label}${c.where ? ` (${c.where})` : ''}${c.category ? ` [kind: ${c.category}]` : ''}`).join('\n');
    parts.push({
      text:
        `Each image is a close-up from a screenshot${game ? ` of the video game ${game}` : ''}. Find exactly this object in each:\n${list}\n\n` +
        'Reply with JSON only: an array of {"i": image number, "y": 0-1000 from the top of THAT image, "x": 0-1000 from its left} ' +
        'for the center of the exact object described (when there are several similar objects, pick the one the description ' +
        'singles out). If the description is a group of objects (for example "Search these", or "the three sarcophagi along ' +
        'the wall"), reply with the center of the whole group, never one member of it. Leave an image out if the object is not in it.\n' +
        'Be strict, this check exists to catch mistakes: only include an image if you can actually see the described thing ' +
        'in it. A person or character [kind: character or enemy] must be a visible character sprite, not a chair, table, ' +
        'statue or empty spot where someone might stand. Stairs, doors and exits must be visibly there. For an item inside ' +
        'a container, find the container described. Big things (a large monster, a building) can be bigger than the ' +
        'close-up: seeing part of it counts, so include it. If you are not sure, leave the image out.',
    });
    try {
      const ai = deps.getGeminiClient();
      const response: any = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: LOCATE_THINKING },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);
      logUsage('precision', model, response);
      let found = parseLocateReply(response?.text ?? '', crops.length);
      const firstLook = found;
      const noOne = new Set<number>();

      // Blind second look at people and enemies. Told what to expect, a model will happily see "an old man" in a
      // cushioned chair; asked cold what's in the middle of the picture, it says "a chair". So, without naming the
      // target, ask whether a character is actually there, and drop the marker if not.
      const people = crops.map((c: any, i: number) => ({ c, i })).filter(({ c }: any) => c.category === 'character' || c.category === 'enemy');
      if (people.length) {
        try {
          const blindParts: any[] = [];
          people.forEach(({ c }: any, k: number) => {
            const m = c.image.match(DATA_URL_RE)!;
            blindParts.push({ text: `Image ${k}:` });
            blindParts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          });
          blindParts.push({
            text:
              `Each image is a close-up from a video game screenshot${game ? ` (${game})` : ''}. For each, look at what is in the ` +
              'middle of the image and reply with JSON only: an array of {"i": image number, "what": "3 to 6 words", ' +
              '"character": true or false}. "character" is true only if a person, creature or enemy sprite is clearly there, ' +
              'with a visible head and body, or clearly part of a large creature (a close-up may only show part of a big monster). ' +
              'Furniture (chairs, tables, beds), statues, plants, objects, empty floor and walls are false. Describe only what you see.',
          });
          const blind: any = await Promise.race([
            ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts: blindParts }],
              config: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: LOCATE_THINKING },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
          ]);
          logUsage('precision-people', model, blind);
          const rows = JSON.parse(String(blind?.text ?? '[]').replace(/```json|```/g, '').trim());
          if (Array.isArray(rows)) {
            for (const r of rows) {
              const k = Number(r?.i);
              if (Number.isInteger(k) && people[k] && r?.character === false) {
                noOne.add(people[k].i);
                console.log(`[refine] no character at "${people[k].c.label}": ${String(r?.what ?? '').slice(0, 60)}`);
              }
            }
            if (noOne.size) found = found.filter((f: any) => !noOne.has(f.index));
          }
        } catch (e: any) {
          console.warn('[refine] people check skipped:', e?.message); // keep the first check's result
        }
      }
      // Markers the check looked at and couldn't find are dropped by the app: counted per game, and each removed or
      // badly placed one is noted (what it was, its kind, why) for the Quality page.
      if (deps.onChecked) {
        const details = markerOutcomes(crops.length, firstLook, noOne)
          .map((outcome, i) => ({ outcome, c: crops[i] }))
          .filter((d): d is { outcome: MarkerCheckDetail['outcome']; c: any } => d.outcome !== 'kept')
          .map(({ outcome, c }) => ({ label: c.label, category: c.category, guide: c.guide, outcome, client, appVersion }));
        deps.onChecked(game, crops.length, new Set(found.map((f: any) => f.index)).size, details);
      }
      // `checked`: how many markers were looked at, so the app only removes those (older servers checked 5).
      return res.json({ found, checked: crops.length });
    } catch (err: any) {
      console.warn('[refine] failed:', err?.message);
      return res.status(502).json({ error: 'Could not refine the markers.', found: [] });
    }
  });
}

/** One marked thing to find again: a close-up of it from the question's screenshot plus the answer's words for it. */
export interface RefindItem {
  crop: string;
  label: string;
  where: string;
  category: string;
  guide: boolean;
}

/** The instructions for finding the marked things on the screen now (as tested in the Nov 17 2026 3D test). */
export function refindPrompt(items: { label: string; where: string; category: string }[], game: string): string {
  const list = items.map((c, i) => `${i}. ${c.label}${c.where ? ` (${c.where})` : ''}${c.category ? ` [kind: ${c.category}]` : ''}`).join('\n');
  return (
    `The first image is the screen of the video game${game ? ` ${game}` : ''} right now. The camera may have moved since these ` +
    `things were pointed out. Find each of them on the screen now:\n${list}\n` +
    'Each close-up shows what that thing looked like a few seconds earlier (it is in the centre of its close-up): find that ' +
    'same object on the screen now, not a similar one. If a description is a group of objects (for example "Search these"), ' +
    'give the centre of the whole group. Big things (a large monster, a building) count when part of them is on screen.\n' +
    'First decide whether the screen now shows the same place as the close-ups. A camera that turned, zoomed or moved ' +
    'within the same area is the same place, even if the close-ups\' things are partly or fully out of view. samePlace is ' +
    'false only when you are sure the screen shows somewhere else: a different area or game, a menu, a map, or a cutscene ' +
    'elsewhere, with nothing around it matching the close-ups.\n' +
    'Reply with JSON only: {"samePlace": true or false, "found": [{"i": number, "y": 0-1000 from the top, "x": 0-1000 from ' +
    'the left}]} with the centre of each one you can actually see now. If samePlace is false, "found" is []. Leave out ' +
    'any that are no longer on screen. If you are not sure, leave it out.'
  );
}

/**
 * The reply to refindPrompt: the found list, or nothing when the model says the screen is a different place (markers
 * v2 step 3: finding again on an unrelated scene marked look-alikes). A bare array (the older format) is accepted.
 */
export function parseRefindReply(text: string, count: number): { found: { index: number; x: number; y: number }[]; samePlace: boolean | null } {
  const raw = String(text || '').replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        /* below */
      }
    }
  }
  if (obj && !Array.isArray(obj) && typeof obj === 'object') {
    const samePlace = obj.samePlace === false ? false : obj.samePlace === true ? true : null;
    if (samePlace === false) return { found: [], samePlace };
    return { found: parseLocateReply(JSON.stringify(Array.isArray(obj.found) ? obj.found : []), count), samePlace };
  }
  return { found: parseLocateReply(raw, count), samePlace: null };
}

/** Each item's outcome: found (kept), not found ('off screen'), or found where the blind look saw no one ('no person'). */
export function refindOutcomes(count: number, found: { index: number }[], noOne: Set<number>): MarkerOutcome[] {
  return Array.from({ length: count }, (_, i) => (!found.some((f) => f.index === i) ? 'off screen' : noOne.has(i) ? 'no person' : 'kept'));
}

/** A rate limiter per player (or guest IP) per hour plus a global daily count, like the other marker endpoints. */
function makeLimiter(env: Record<string, string | undefined>, now: () => number) {
  const perUserHourly = envNum(env.LOCATE_PER_USER_HOURLY, 60);
  const perGuestHourly = envNum(env.LOCATE_PER_GUEST_HOURLY, 60);
  const globalDaily = envNum(env.LOCATE_GLOBAL_DAILY, 10000);
  const proxyHops = envNum(env.GUEST_PROXY_HOPS, 1);
  const hourly = new Map<string, { n: number; reset: number }>();
  let global = { day: '', n: 0 };
  setInterval(() => {
    const t = now();
    for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k);
  }, 60_000).unref();
  return (req: Request): boolean => {
    const user = (req as any).user ?? {};
    const uid = String(user.uid ?? '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    const key = isGuest ? `ip:${clientIp(req, proxyHops)}` : `uid:${uid}`;
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (global.day !== day) global = { day, n: 0 };
    let w = hourly.get(key);
    if (!w || t >= w.reset) {
      w = { n: 0, reset: t + 60 * 60 * 1000 };
      hourly.set(key, w);
    }
    if (w.n >= (isGuest ? perGuestHourly : perUserHourly) || global.n >= globalDaily) return false;
    w.n++;
    global.n++;
    return true;
  };
}

/** The blind look's question: is a character really in the middle of each close-up? */
const BLIND_PROMPT = (game: string) =>
  `Each image is a close-up from a video game screenshot${game ? ` (${game})` : ''}. For each, look at what is in the ` +
  'middle of the image and reply with JSON only: an array of {"i": image number, "what": "3 to 6 words", ' +
  '"character": true or false}. "character" is true only if a person, creature or enemy sprite is clearly there, ' +
  'with a visible head and body, or clearly part of a large creature (a close-up may only show part of a big monster). ' +
  'Furniture (chairs, tables, beds), statues, plants, objects, empty floor and walls are false. Describe only what you see.';

/**
 * Find the marked things on the screen now: POST /api/refind
 *   { image: fresh screen (data URL), items: [{ crop, label, where, category, guide }], game?, client?, appVersion? }
 *   -> { found: [{ index, x, y }] (0-1 of the fresh screen), checked }
 * Things it can't see now are left out (the app lists them as not on screen). People and enemies get the blind
 * "is someone really there" look, on a close-up of the fresh screen around where they were found.
 */
export function registerRefind(app: Express, deps: LocateDeps): void {
  const env = deps.env ?? process.env;
  const model = env.LOCATE_MODEL || 'gemini-3.8-flash';
  const allow = makeLimiter(env, deps.now ?? Date.now);

  app.post('/api/refind', deps.requireAuth as any, async (req: Request, res: Response) => {
    if (deps.allowed && !(await deps.allowed(req))) return res.status(403).json({ error: 'Part of Premium.', premiumRequired: true, found: [] });
    const screen = String(req.body?.image ?? '');
    const sm = screen.match(DATA_URL_RE);
    if (!sm || screen.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'A screenshot is required.', found: [] });
    const items: RefindItem[] = (Array.isArray(req.body?.items) ? req.body.items : [])
      .slice(0, REFINE_MAX_CROPS)
      .map((c: any) => ({
        crop: String(c?.crop ?? ''),
        label: String(c?.label ?? '').trim().slice(0, 40),
        where: String(c?.where ?? '').trim().slice(0, 100),
        category: /^[a-z]{2,12}$/.test(String(c?.category ?? '')) ? String(c.category) : '',
        guide: c?.guide === true,
      }));
    if (!items.length) return res.json({ found: [], checked: 0 });
    // Indexes are the answer's marker numbers, so a bad item can't just be dropped (the rest would shift): refuse, and
    // the app falls back to the screenshot.
    if (!items.every((c) => c.label && DATA_URL_RE.test(c.crop) && c.crop.length <= MAX_IMAGE_CHARS)) {
      return res.status(400).json({ error: 'Each marker needs a label and a close-up.', found: [] });
    }
    const client = /^(desktop|web|deck)$/.test(String(req.body?.client ?? '')) ? String(req.body.client) : 'desktop';
    const appVersion = String(req.body?.appVersion ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 24);
    if (!allow(req)) return res.status(429).json({ error: 'Marker checks are paused for a bit.', found: [] });
    // Finding again (the view changed, or the player asked): paused for the day once the daily cap is spent.
    if (req.body?.again === true && deps.findAgainAllowed && !(await deps.findAgainAllowed())) {
      return res.status(429).json({ error: 'Finding markers again is paused for today.', capped: true, found: [] });
    }

    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const parts: any[] = [{ text: 'The screen now:' }, { inlineData: { mimeType: sm[1], data: sm[2] } }];
    items.forEach((c, i) => {
      const m = c.crop.match(DATA_URL_RE)!;
      parts.push({ text: `Close-up ${i}, from a screenshot taken a few seconds earlier (the thing is in its centre):` });
      parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    });
    parts.push({ text: refindPrompt(items, game) });
    try {
      const ai = deps.getGeminiClient();
      const response: any = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: LOCATE_THINKING },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      logUsage('refind', model, response);
      const reply = parseRefindReply(response?.text ?? '', items.length);
      if (reply.samePlace === false) console.log(`[refind] a different place now: nothing marked (${items.length} looked for)`);
      let found = reply.found;
      const firstLook = found;
      const noOne = new Set<number>();

      // The blind look at people and enemies, on the screen now: a close-up around where each was found, asked cold
      // whether a character is there (told what to expect, a model sees "an old man" in an empty chair).
      const people = found.filter((f) => items[f.index].category === 'character' || items[f.index].category === 'enemy');
      if (people.length) {
        try {
          const buf = Buffer.from(sm[2], 'base64');
          const meta = await sharp(buf).metadata();
          const W = meta.width || 0;
          const H = meta.height || 0;
          const side = Math.round(Math.min(W * 0.3, H * 0.7));
          if (side >= 40) {
            const blindParts: any[] = [];
            for (const [k, f] of people.entries()) {
              const left = Math.max(0, Math.min(W - side, Math.round(f.x * W - side / 2)));
              const top = Math.max(0, Math.min(H - side, Math.round(f.y * H - side / 2)));
              const crop = await sharp(buf).extract({ left, top, width: side, height: side }).resize(384, 384).jpeg({ quality: 85 }).toBuffer();
              blindParts.push({ text: `Image ${k}:` });
              blindParts.push({ inlineData: { mimeType: 'image/jpeg', data: crop.toString('base64') } });
            }
            blindParts.push({ text: BLIND_PROMPT(game) });
            const blind: any = await Promise.race([
              ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: blindParts }],
                config: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: LOCATE_THINKING },
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
            ]);
            logUsage('refind-people', model, blind);
            const rows = JSON.parse(String(blind?.text ?? '[]').replace(/```json|```/g, '').trim());
            if (Array.isArray(rows)) {
              for (const r of rows) {
                const k = Number(r?.i);
                if (Number.isInteger(k) && people[k] && r?.character === false) {
                  noOne.add(people[k].index);
                  console.log(`[refind] no character at "${items[people[k].index].label}": ${String(r?.what ?? '').slice(0, 60)}`);
                }
              }
              if (noOne.size) found = found.filter((f) => !noOne.has(f.index));
            }
          }
        } catch (e: any) {
          console.warn('[refind] people check skipped:', e?.message); // keep the first look's result
        }
      }
      if (deps.onChecked) {
        const details = refindOutcomes(items.length, firstLook, noOne)
          .map((outcome, i) => ({ outcome, c: items[i] }))
          .filter((d): d is { outcome: MarkerCheckDetail['outcome']; c: RefindItem } => d.outcome !== 'kept')
          .map(({ outcome, c }) => ({ label: c.label, category: c.category, guide: c.guide, outcome, client, appVersion }));
        deps.onChecked(game, items.length, found.length, details);
      }
      return res.json({ found, checked: items.length, ...(reply.samePlace === false ? { samePlace: false } : {}) });
    } catch (err: any) {
      console.warn('[refind] failed:', err?.message);
      return res.status(502).json({ error: 'Could not find the markers on screen.', found: [] });
    }
  });
}
