/**
 * Drawn answers, step 1 (owner, Nov 18 2026; docs/proposals/drawn-answers.md): after an answer arrives, a picture that
 * SHOWS it, made only when seeing it helps the player (decided by itself, never a button):
 *
 *   screen        Nano Banana 2 draws the route, arrows, circles and short labels on the player's own screenshot
 *                 (their in-game map, or the place in front of them).
 *   wiki          a "where / how do I get there" question with nothing on screen to draw on: the area's picture or map
 *                 from the game's wikis (credited and linked), drawn on the same way.
 *   illustration  a picture made from what the answer says, for puzzles (which symbols, in which order), what a hidden
 *                 thing looks like, or a boss's tell. Always labelled "Illustration".
 *
 * Every drawing is checked before it's shown:
 *   - drawn on a picture: the drawing is compared with the original pixel by pixel (no AI): the strokes are bright,
 *     strongly changed pixels; anything else that changed means the model altered the scene (a moved door, a swapped
 *     background) and the drawing is thrown away. Then one cheap look (Flash) at both: is the drawing clear (not a
 *     tangle of arrows) and does it agree with the answer?
 *   - an illustration: one cheap look: does it agree with the answer, are its labels readable, is it uncluttered?
 * Failed: nothing is shown (the answer is complete in words).
 *
 * The answer itself never waits for this or changes. Costs: about $0.08-0.10 an image plus a cent or less for the
 * decision and the check; the whole feature stops for the day at DRAWN_DAILY_DOLLARS (default $3, owner Nov 18 2026).
 * Drawings on a player's screenshot are never saved; wiki drawings and illustrations are saved by question and topic
 * (drawnCache), so a repeat costs nothing.
 */
import sharp from 'sharp';
import { ThinkingLevel } from '@google/genai';
import { estimateCost } from './usage';
import { wikiPicture, topicKey, type Cost, type MoreWiki, type WikiPage } from './visualAnswer';

type Gen = { models: { generateContent: (r: any) => Promise<any> } };
const FAST = process.env.VISUAL_MODEL || 'gemini-3.8-flash';
export const DRAW_MODEL = process.env.DRAW_MODEL || 'gemini-3.1-flash-image';
const UA = 'QuestCompendium-Visuals/0.1 (+https://questcompendium.com)';
/** What one drawing is reserved at against the day's cap before it's made (the image, its decision and its check). */
export const DRAW_RESERVE = 0.12;
export const DRAWN_V = 'd1';

export type DrawnOn = 'screen' | 'wiki' | 'illustration';
export type Drawn = {
  kind: 'drawn';
  /** The picture itself (a JPEG data URL): nothing of a player's screen is stored on the server. */
  url: string;
  on: DrawnOn;
  /** What it shows, one short line. */
  alt: string;
  /** A wiki drawing: the picture's page, credited and linked. */
  page?: WikiPage;
  /**
   * Drawn on the player's screen, and that screen holds still (the game's map, a menu, a skill tree, an inventory):
   * the strokes alone as a see-through PNG (data URL) the size of the screenshot, laid over the live game by the desktop
   * app while the screen stays the same (drawn answers step 2, Nov 18 2026). Never saved; the app doesn't keep it.
   */
  layer?: string;
  /**
   * A wiki picture that already marks what the answer means (owner, Nov 22 2026: a map with the spot highlighted got
   * arrows drawn on top for 8 cents): shown as found, nothing drawn. The apps label it as the site's map, not "Drawn on".
   */
  found?: boolean;
};
export type DrawnResult = { drawn: Drawn | null; cost: number; ms: number; steps: string[]; cached?: boolean; decided: DrawnOn | 'none'; failed?: string; pins?: Pins | null };

const parse = (t: string): any => { const s = String(t || '').replace(/```json|```/g, ''); const a = s.indexOf('{'), z = s.lastIndexOf('}'); try { return a >= 0 && z > a ? JSON.parse(s.slice(a, z + 1)) : null; } catch { return null; } };
const jpegPart = (b: Buffer) => ({ inlineData: { mimeType: 'image/jpeg', data: b.toString('base64') } });
/** The image model's price: $0.50 a million in, $60 a million out (images), per Google's price list. */
export const imageDollars = (res: any) => { const u = res?.usageMetadata || {}; return ((u.promptTokenCount || 0) * 0.5 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 60) / 1e6; };

async function look(ai: Gen, cost: Cost, parts: any[], label: string, maxOut = 400): Promise<any> {
  const res = await ai.models.generateContent({
    model: FAST,
    contents: [{ role: 'user', parts }],
    config: { temperature: 0, maxOutputTokens: maxOut + 2000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  cost.d += estimateCost(FAST, res) || 0;
  cost.log?.(label, FAST, res);
  return parse(res.text || '');
}

/** A screenshot from the app (a data URL or bare base64) as a JPEG at most `width` wide. */
export async function shotJpeg(image: string, width = 1280): Promise<Buffer | null> {
  try {
    const b64 = String(image || '').replace(/^data:[^,]*,/, '');
    if (b64.length < 1000) return null;
    return await sharp(Buffer.from(b64, 'base64')).flatten({ background: '#101010' }).resize({ width, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { return null; }
}

// ---- 1. Decide ----------------------------------------------------------------------------------------------------

/**
 * Could a drawing help this question at all (no screenshot)? Where / how-to-get-there, puzzles and orders, what
 * something looks like, dodging. Anything else skips the decision (and its cost). English words only: a question in
 * another language goes on to the decision.
 */
export function mightDraw(question: string): boolean {
  const q = String(question || '').toLowerCase();
  if (/[^\x00-\x7f]/.test(q.replace(/[’‘“”–—…]/g, ''))) return true;
  return /\b(where|how (do|can|to|should) i (get|reach|go|find|solve|open|beat|dodge|reach|climb|cross|enter|unlock)|get to|way to|route|path|find|puzzle|solve|solution|order|sequence|combination|code|look(s)? like|dodge|lever|switch|symbol|pillar|statue|dial|map)\b/.test(q);
}

/**
 * Step 3 (owner, Nov 18 2026): shapes that hang off the answer's markers over the live game, so they follow the camera
 * with them: `order`, the markers to join with a line in the order to visit or use them (indexes into the answer's
 * markers, at least 2); `labels`, a 1-3 word note on the link from order[k] to order[k+1] ("jump", "climb"), by k;
 * `areas`, markers that stand for a rough area ("somewhere around here"): a ring instead of a pin.
 */
export type Pins = { order: number[]; labels: Record<number, string>; areas: number[] };
export const noPins = (p: Pins | null | undefined) => !p || (p.order.length < 2 && !p.areas.length);

/** The model's pins (1-based marker numbers) checked against the markers: 0-based, no repeats, nothing out of range. */
export function cleanPins(j: any, count: number): Pins | null {
  if (!j || !count) return null;
  const nums = (a: any) => (Array.isArray(a) ? a : []).map((n: any) => Number(n) - 1).filter((n: number) => Number.isInteger(n) && n >= 0 && n < count);
  const order = [...new Set(nums(j.join))].slice(0, 8);
  const areas = [...new Set(nums(j.areas))].slice(0, 4);
  const labels: Record<number, string> = {};
  if (order.length >= 2 && j.joinLabels && typeof j.joinLabels === 'object') {
    for (const [k, v] of Object.entries(j.joinLabels)) {
      const from = Number(k) - 1;
      const at = order.indexOf(from);
      const text = String(v || '').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 24);
      if (at >= 0 && at < order.length - 1 && text) labels[at] = text;
    }
  }
  const p = { order: order.length >= 2 ? order : [], labels: order.length >= 2 ? labels : {}, areas };
  return noPins(p) ? null : p;
}

export type Decision = { on: DrawnOn | 'none'; draw: string; place: string; isMap: boolean; still: boolean; why: string; confidence: string; pins: Pins | null };

export async function decide(ai: Gen, cost: Cost, o: { game: string; question: string; answer: string; shot: Buffer | null; shotOnly?: boolean; markers?: string[] }): Promise<Decision> {
  const markers = (o.markers || []).slice(0, 8);
  const prompt =
    `A player of "${o.game}" ${o.shotOnly ? 'sent a screenshot with no typed question' : `asked: "${o.question}"`}${o.shot ? ' (their screenshot is attached)' : ' (no screenshot)'}.\n` +
    `The answer they got:\n"""${o.answer.slice(0, 2500)}"""\n\n` +
    'Would a DRAWN picture show this answer better than the words alone? Pictures cost money and take time, so only when ' +
    'seeing it really helps. Pick one:\n' +
    (o.shot
      ? '- "screen": draw on THEIR screenshot. Only when the screenshot is the game\'s own map and the answer says where to ' +
        'go or where something is on it; or the screenshot shows the very place the answer is about and the answer says ' +
        'which way to go, which path, door, ledge or lever to use, or what to hit here, and you can see those things in ' +
        'the screenshot. Never to circle one thing that looks like ordinary scenery (a rock among rocks, a patch of ' +
        'ground, a bush) unless the screenshot shows its name or a highlight on it: a circle on the wrong rock is worse ' +
        'than none.\n'
      : '') +
    '- "wiki": the player asks WHERE something is or HOW TO GET somewhere, the answer names the area' +
    (o.shot ? ', and their screenshot does NOT show that place or a map of it' : '') +
    ': the area\'s map or picture from the game\'s wiki, with the route or spot drawn on it.\n' +
    '- "illustration": a picture made from the answer, ONLY when the answer gives exact facts that are much easier to ' +
    'see than read: a puzzle\'s solution (which symbols, in which order, which levers), a combination or pattern, what a ' +
    'hidden switch or item looks like, a boss\'s attack and which way to dodge it. Never for vague answers.\n' +
    '- "none": everything else: simple answers ("talk to the blacksmith"), lore, builds, stats, lists, opinions, general ' +
    'tips, or when you are not sure exactly where things are. Most answers are "none".\n' +
    'Be strict: if it is not clearly one of the first ones, it is "none".\n' +
    'Reply with JSON only: {"on": ' + (o.shot ? '"screen" | ' : '') + '"wiki" | "illustration" | "none", "confidence": "high" | "medium" | "low", ' +
    '"isMap": true if the screenshot is the game\'s map screen, ' +
    '"still": true if the screenshot is a screen that holds still while the player reads it (the game\'s map, a menu, an ' +
    'inventory, a skill tree, a puzzle screen shown flat), false for a view of the game world that moves with the camera, ' +
    '"place": "for wiki: the in-game name of the area to show, as the answer names it; else empty", ' +
    '"draw": "what to draw, for an artist, in at most 3 marks: e.g. \\"a route from the player icon along the road north to Blackwater, a circle on Blackwater labelled Blackwater\\" or \\"number the levers 1 left, 2 right, 3 middle\\"; labels of 1-3 words", ' +
    '"why": "one short sentence"' +
    (markers.length
      ? ', "join": [...], "joinLabels": {...}, "areas": [...]}\n\n' +
        'SEPARATELY, whatever you chose for "on": the app has already placed these markers on the things the answer names, ' +
        `on the player's screen: ${markers.map((m, i) => `${i + 1}. ${m}`).join('; ')}. You don't need to see them yourself; ` +
        'go by the answer\'s words.\n' +
        '- "join": the marker numbers in the order the answer says to go to or use them, when the answer gives such an ' +
        'order or a path through 2 or more of them ("cross the bridge, then the path, then the gate"; levers in order). ' +
        'Else [].\n' +
        '- "joinLabels": {"marker number": "1-3 words for how to get from that marker to the next one in join, only when ' +
        'the answer says how (climb, jump, swim across)"}; else {}.\n' +
        '- "areas": the marker numbers that stand for a rough area rather than an exact spot (the answer says "search ' +
        'around", "somewhere near", "in this area"). Else [].'
      : '}');
  const j = await look(ai, cost, [...(o.shot ? [jpegPart(o.shot)] : []), { text: prompt }], 'drawn-decide');
  const on = ['screen', 'wiki', 'illustration'].includes(j?.on) && j?.confidence === 'high' && String(j?.draw || '').trim() ? (j.on as DrawnOn) : 'none';
  return {
    on: on === 'screen' && !o.shot ? 'none' : on === 'wiki' && !String(j?.place || '').trim() ? 'none' : on,
    draw: String(j?.draw || '').slice(0, 400), place: String(j?.place || '').slice(0, 80), isMap: j?.isMap === true, still: j?.isMap === true || j?.still === true,
    why: String(j?.why || '').slice(0, 200), confidence: String(j?.confidence || ''),
    pins: cleanPins(j, markers.length),
  };
}

// ---- 2. Draw --------------------------------------------------------------------------------------------------------

export function drawPrompt(game: string, d: Decision, answer: string, base: 'screenshot' | 'map' | 'picture' | null): string {
  if (!base) {
    return `Make a clear, simple illustration for a player of the video game "${game}" that shows this: ${d.draw}\n` +
      `It must agree with this answer: """${answer.slice(0, 1200)}"""\n` +
      'Style: a clean game-guide illustration in the look of the game, a few large readable labels in English, no paragraphs ' +
      'of text, no extra panels or decorations.';
  }
  return `This is a ${base === 'map' ? 'map' : base === 'screenshot' ? 'screenshot' : 'picture'} from the video game "${game}". ` +
    `Draw on it to show the player: ${d.draw}\n` +
    'Use bright purple: one route line or a few arrows, circles on the targets, and short labels (1-3 words) where they ' +
    'belong. A route follows the roads, paths or corridors drawn in the picture, bend for bend, never cutting across ' +
    'open ground, from the exact spot where the start is shown to the exact spot where the end is shown. Where the picture ' +
    'already shows a place\'s name, add no label for it; otherwise a label with its name as the answer gives it (never ' +
    '"start" or "destination"). ' +
    'Keep it sparse and clear: at most 3 marks, never a tangle of arrows. Change nothing else in the picture: same ' +
    'framing, same scene, same colours.';
}

async function drawCall(ai: Gen, cost: Cost, prompt: string, base: Buffer | null): Promise<Buffer | null> {
  const res: any = await ai.models.generateContent({
    model: DRAW_MODEL,
    contents: [{ role: 'user', parts: [...(base ? [jpegPart(base)] : []), { text: prompt }] }],
    config: { responseModalities: ['IMAGE', 'TEXT'] } as any,
  });
  cost.d += imageDollars(res);
  cost.log?.('drawn-image', DRAW_MODEL, res);
  const part = (res?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  return part ? Buffer.from(part.inlineData.data, 'base64') : null;
}

// ---- 3. Check -----------------------------------------------------------------------------------------------------

/**
 * The drawing against the original (no AI): `strokes` is the share of pixels drawn on (big change to a bright or
 * coloured pixel), `altered` the share that changed elsewhere (the scene itself). The free test (Nov 18 2026): good
 * drawings were 2-13% strokes and mostly under 10% altered; a swapped background was about 50% strokes.
 */
export async function compare(orig: Buffer, drawn: Buffer): Promise<{ strokes: number; altered: number }> {
  const m = await sharp(orig).metadata();
  const w = Math.min(m.width || 640, 640), h = Math.round(((m.height || 360) * w) / (m.width || 640));
  const a = await sharp(orig).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const b = await sharp(drawn).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const n = w * h;
  const stroke = new Uint8Array(n), mid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
    const mx = Math.max(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]), mn = Math.min(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
    if (d > 150 && (mx - mn > 70 || mx > 235)) stroke[i] = 1;
    else if (d > 60) mid[i] = 1;
  }
  // The strokes' soft edges count as strokes.
  const near = new Uint8Array(n);
  const R = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (stroke[y * w + x])
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) near[yy * w + xx] = 1;
    }
  let s = 0, alt = 0;
  for (let i = 0; i < n; i++) { if (near[i] && (stroke[i] || mid[i])) s++; else if (mid[i]) alt++; }
  return { strokes: s / n, altered: alt / n };
}
/**
 * The strokes alone, lifted off the drawing: a see-through PNG at the original's size (at most 1280 wide), the drawn
 * pixels kept (with their soft edges), everything else clear. Laid over the live game, it lines up with the screen the
 * screenshot was taken of.
 */
export async function strokeLayer(orig: Buffer, drawn: Buffer): Promise<Buffer> {
  const m = await sharp(orig).metadata();
  const w = Math.min(m.width || 1280, 1280), h = Math.round(((m.height || 720) * w) / (m.width || 1280));
  const a = await sharp(orig).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const b = await sharp(drawn).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const n = w * h;
  const stroke = new Uint8Array(n), diff = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
    diff[i] = d;
    const mx = Math.max(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]), mn = Math.min(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
    if (d > 150 && (mx - mn > 70 || mx > 235)) stroke[i] = 1;
  }
  // Lone specks (a white button icon that came back slightly brighter) aren't strokes: a stroke pixel needs at least 6
  // others within 2 pixels.
  const keep = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!stroke[y * w + x]) continue;
    let c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w && stroke[yy * w + xx]) c++;
    }
    if (c >= 7) keep[y * w + x] = 1;
  }
  stroke.set(keep);
  const out = Buffer.alloc(n * 4);
  const R = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (diff[i] < 40) continue;
    let near = stroke[i] === 1;
    for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R && !near; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w && stroke[yy * w + xx]) near = true;
    }
    if (!near) continue;
    out[i * 4] = b[i * 3]; out[i * 4 + 1] = b[i * 3 + 1]; out[i * 4 + 2] = b[i * 3 + 2];
    // Soft edges fade in with how much they changed.
    out[i * 4 + 3] = stroke[i] ? 255 : Math.min(255, Math.round((diff[i] - 40) * 2.2));
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/** Too much drawn (a swapped background) or too much of the scene changed. */
export const STROKES_MAX = 0.3;
export const ALTERED_MAX = 0.15;

export async function checkDrawing(ai: Gen, cost: Cost, game: string, question: string, answer: string, base: Buffer | null, drawn: Buffer): Promise<{ ok: boolean; why: string; what: string }> {
  const small = await sharp(drawn).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const parts = base
    ? [jpegPart(await sharp(base).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()), jpegPart(small), { text:
        `The first picture is from the video game "${game}"; the second is the same picture with a drawing on it for a player who asked "${question}". ` +
        `The answer: """${answer.slice(0, 1500)}"""\n` +
        'Reply with JSON only: {"sameScene": true if apart from the drawing the scene is unchanged (nothing added, moved or removed), ' +
        '"clear": true if the drawing is easy to follow at a glance (not a tangle of arrows, labels readable), ' +
        '"agrees": true if the places it marks (start, end, targets) are the ones the answer means and in the right spots, ' +
        'and any route follows roads or paths in the picture between them (a different road than the answer words it is ' +
        'fine if it gets there); false if a mark or label is in the wrong place or names the wrong thing, ' +
        '"what": "what the drawing shows, one short sentence"}' }]
    : [jpegPart(small), { text:
        `This illustration was made for a player of the video game "${game}" who asked "${question}". The answer: """${answer.slice(0, 1500)}"""\n` +
        'Reply with JSON only: {"sameScene": true, "clear": true if it is uncluttered and its labels are readable, ' +
        '"agrees": true if everything it shows (symbols, order, directions, names) agrees with the answer, "what": "what it shows, one short sentence"}' }];
  const j = await look(ai, cost, parts, 'drawn-check', 200);
  const ok = j?.sameScene === true && j?.clear === true && j?.agrees === true;
  return { ok, why: ok ? '' : `check: ${['sameScene', 'clear', 'agrees'].filter((k) => j?.[k] !== true).join(', ') || 'no reply'}`, what: String(j?.what || '').slice(0, 160) };
}

/**
 * A wiki picture that already shows the answer: the spot or route the answer means is marked on it (highlighted,
 * circled, pinned, arrowed or labelled in the right place). One cheap look (Flash, a fraction of a cent) before the
 * drawing (8-10 cents) is paid for.
 */
export async function alreadyMarked(ai: Gen, cost: Cost, game: string, question: string, answer: string, pic: Buffer): Promise<{ marked: boolean; what: string }> {
  const small = await sharp(pic).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const j = await look(ai, cost, [jpegPart(small), { text:
    `This picture is from a wiki for the video game "${game}". A player asked "${question}". The answer: """${answer.slice(0, 1500)}"""\n` +
    'Does the picture ALREADY mark what the answer points the player to, so drawing on it would add nothing? Marked means the ' +
    'spot, item or route the answer means is highlighted, circled, pinned, arrowed or labelled on the picture, in the right ' +
    'place. A plain map of the area with nothing marked is not marked; a mark on something else is not marked.\n' +
    'Reply with JSON only: {"alreadyMarked": true | false, "confidence": "high" | "medium" | "low", "what": "what the picture shows and marks, one short sentence"}' }], 'drawn-marked', 120);
  return { marked: j?.alreadyMarked === true && j?.confidence === 'high', what: String(j?.what || '').slice(0, 160) };
}

// ---- The whole step -----------------------------------------------------------------------------------------------

export type DrawnStore = {
  get(keys: string[]): Promise<Drawn | null>;
  set(keys: string[], drawn: Drawn): Promise<void>;
};
/** The day's cap: reserve before drawing (false: the day's money is used up), then settle with what it really cost. */
export type DrawnBudget = { reserve(d: number): Promise<boolean>; settle(reserved: number, spent: number): Promise<void> };

async function fetchPicture(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const m = await sharp(buf).metadata();
    if (!m.width || m.width < 400) return null;
    return await sharp(buf).flatten({ background: '#101010' }).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { return null; }
}

export async function drawnFor(ai: Gen, o: {
  game: string; gameKey: string; question: string; answer: string;
  /** The question's screenshot (data URL or base64), if any. */
  image?: string; shotOnly?: boolean;
  /** The answer's markers on the player's screen, by name (step 3: shapes that hang off them). */
  markers?: string[];
  wiki: { fextralife?: string; fandom?: string; more?: MoreWiki[]; prefer?: string[] };
  budget: DrawnBudget; store?: DrawnStore; log?: Cost['log'];
}): Promise<DrawnResult> {
  const t0 = Date.now();
  const cost: Cost = { d: 0, log: o.log };
  const steps: string[] = [];
  const shot = o.image ? await shotJpeg(o.image) : null;
  // No screenshot and nothing in the question a drawing could show: no look at all (free).
  if (!shot && !mightDraw(o.question)) {
    steps.push('decide: none (the question has nothing to draw)');
    return { drawn: null, cost: 0, ms: Date.now() - t0, steps, decided: 'none' };
  }
  const d = await decide(ai, cost, { game: o.game, question: o.question, answer: o.answer, shot, shotOnly: o.shotOnly, markers: shot ? o.markers : [] });
  steps.push(`decide: ${d.on} (${d.confidence})${d.place ? ` place "${d.place}"` : ''}: ${d.draw.slice(0, 120)}${d.why ? ` / ${d.why}` : ''}`);
  // The route already joins the answer's markers on the player's live screen: a wiki picture of it adds little.
  if (d.on === 'wiki' && d.pins && d.pins.order.length >= 2) { steps.push('wiki drawing skipped: the markers are joined on screen'); d.on = 'none'; }
  if (d.pins) steps.push(`pins: join ${d.pins.order.map((i) => i + 1).join('>') || '-'}${Object.keys(d.pins.labels).length ? ` (${Object.values(d.pins.labels).join(', ')})` : ''}, areas ${d.pins.areas.map((i) => i + 1).join(',') || '-'}`);
  const done = (drawn: Drawn | null, extra: Partial<DrawnResult> = {}): DrawnResult => ({ drawn, cost: cost.d, ms: Date.now() - t0, steps, decided: d.on, pins: d.pins, ...extra });
  if (d.on === 'none') return done(null);

  // Saved: wiki drawings and illustrations (never a player's screen), by the question and by the topic.
  const keys = d.on === 'screen' ? [] : [topicKey(o.gameKey, `${DRAWN_V} q ${o.question}`), topicKey(o.gameKey, `${DRAWN_V} ${d.on} ${d.place} ${d.draw}`)];
  if (keys.length && o.store) {
    const hit = await o.store.get(keys).catch(() => null);
    if (hit) { steps.push('saved drawing reused'); return done(hit, { cached: true }); }
  }

  // The picture to draw on.
  let base: Buffer | null = null, page: WikiPage | undefined, kind: 'screenshot' | 'map' | 'picture' | null = null;
  if (d.on === 'screen') { base = shot; kind = d.isMap ? 'map' : 'screenshot'; }
  if (d.on === 'wiki') {
    const pic = await wikiPicture(ai as any, cost, o.wiki, o.game, o.question, d.place, steps, true, false, true).catch(() => null);
    if (pic?.kind === 'picture') base = await fetchPicture(pic.url);
    if (!base) { steps.push('no wiki picture to draw on'); return done(null, { failed: 'no picture' }); }
    page = pic!.page; kind = pic!.map ? 'map' : 'picture';
    // The picture already marks the place: shown as found (credited and linked), no drawing paid for.
    const m = await alreadyMarked(ai, cost, o.game, o.question, o.answer, base).catch(() => ({ marked: false, what: '' }));
    if (m.marked) {
      steps.push(`already marked, shown as found: ${m.what}`);
      const jpg = await sharp(base).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const found: Drawn = { kind: 'drawn', url: `data:image/jpeg;base64,${jpg.toString('base64')}`, on: 'wiki', alt: m.what || d.place, found: true, ...(page ? { page } : {}) };
      if (keys.length && o.store) await o.store.set(keys, found).catch(() => {});
      return done(found);
    }
  }

  if (!(await o.budget.reserve(DRAW_RESERVE))) { steps.push("today's drawing money is used up"); return done(null, { failed: 'cap' }); }
  const before = cost.d;
  let out: Buffer | null = null;
  try {
    out = await drawCall(ai, cost, drawPrompt(o.game, d, o.answer, kind), base);
    if (!out) { steps.push('the image model returned no picture'); return done(null, { failed: 'no image' }); }
    if (base) {
      const c = await compare(base, out);
      steps.push(`compare: strokes ${(c.strokes * 100).toFixed(1)}%, scene changed ${(c.altered * 100).toFixed(1)}%`);
      if (c.strokes > STROKES_MAX || c.altered > ALTERED_MAX) return done(null, { failed: 'scene changed' });
      if (c.strokes < 0.003) { steps.push('nothing was drawn'); return done(null, { failed: 'nothing drawn' }); }
    }
    const chk = await checkDrawing(ai, cost, o.game, o.question, o.answer, base, out);
    steps.push(chk.ok ? `check: ok (${chk.what})` : chk.why);
    if (!chk.ok) return done(null, { failed: 'check' });
    // The original's shape (the model sometimes returns another aspect), as a JPEG small enough to keep in a message.
    const m = base ? await sharp(base).metadata() : null;
    const jpg = await sharp(out)
      .resize(m ? { width: Math.min(m.width!, 1280), height: Math.round((Math.min(m.width!, 1280) * m.height!) / m.width!), fit: 'fill' } : { width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
    const drawn: Drawn = { kind: 'drawn', url: `data:image/jpeg;base64,${jpg.toString('base64')}`, on: d.on, alt: chk.what || d.draw.slice(0, 160), ...(page ? { page } : {}) };
    if (keys.length && o.store) await o.store.set(keys, drawn).catch(() => {});
    // A screen that holds still: the strokes alone too, for the desktop app to lay over the live game.
    if (d.on === 'screen' && d.still && base) {
      const layer = await strokeLayer(base, out).catch(() => null);
      if (layer) { drawn.layer = `data:image/png;base64,${layer.toString('base64')}`; steps.push(`layer: ${Math.round(layer.length / 1024)} KB`); }
    }
    return done(drawn);
  } catch (e: any) {
    steps.push(`error: ${String(e?.message || e).slice(0, 160)}`);
    return done(null, { failed: 'error' });
  } finally {
    await o.budget.settle(DRAW_RESERVE, cost.d - before).catch(() => {});
  }
}
