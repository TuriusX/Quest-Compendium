/**
 * Visual answers (PROTOTYPE, owner's request Nov 14 2026; nothing live): one visual under an answer, worked out AFTER
 * the answer arrives, so the answer text and its prompt never change.
 *
 *   1. choose:  the Fast model reads the question and the answer: video (movement or timing: routes, boss fights,
 *               puzzles with steps), picture ("what does it look like" / "where exactly") or nothing (lore, builds,
 *               general). Anything it isn't highly sure of is nothing: a wrong visual is worse than none.
 *   2. video:   YouTube Data API search (at most 2 of the day's ~100 per new topic), then video and channel stats
 *               (cheap calls, not the search bucket); the Fast model ranks the best match, any method (clear and
 *               complete first, then source quality, then getting to the point), WATCHES the top pick from its link
 *               (it must show it completely; it gives the start time) and keeps 2-3 alternatives with a note each.
 *   3. picture: the main picture of the game's wiki page for that name (Fextralife, then Fandom), checked by the Fast
 *               model, with a credit. Never our own guides' pictures (owner, Nov 14 2026: not good enough for this).
 *   4. saved:   each result under the question and under game + topic (visualCache), "nothing" too for a week, so a
 *               repeat costs nothing. "Not right" from a player drops it and keeps it from being picked again.
 * The server side (POST /api/visual, the day's counts for /stats) is in visualServer.ts.
 *
 * Costs come from the model's own usage (usage.ts rates); YouTube calls are free but limited (~100 searches a day).
 */
import { ThinkingLevel } from '@google/genai';
import sharp from 'sharp';
import { estimateCost } from './usage';
import { fextralifeImage } from './scripts/guides/suggestImages';

export type VisualKind = 'video' | 'picture' | 'none';
export type Visual =
  | { kind: 'video'; videoId: string; title: string; channel: string; seconds: number; start: number; why: string; thumb: string; note?: string; alts?: VideoAlt[] }
  | { kind: 'picture'; source: 'ours' | 'wiki'; url: string; alt: string; credit?: string; link?: string; why: string; map?: boolean }
  | { kind: 'none'; why: string };
export type VisualResult = { visual: Visual; cost: number; ms: number; cached: boolean; steps: string[]; youtubeSearches: number; quotaOut?: boolean; kindChosen?: VisualKind };

type Gen = { models: { generateContent: (r: any) => Promise<any> } };
const FAST = process.env.VISUAL_MODEL || 'gemini-3.8-flash';
const UA = 'QuestCompendium-Visuals/0.1 (+https://questcompendium.com)';
const WEEK = 7 * 24 * 3600 * 1000;

const parse = (t: string): any => { try { return JSON.parse(String(t || '').replace(/^```(json)?|```$/g, '').trim()); } catch { return null; } };
export const topicKey = (gameKey: string, topic: string) => `${gameKey}|${topic.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`.slice(0, 300);

/** Spend so far, and the server's usage log (logUsage) for each call: the visual step's cost shows in /stats. */
export type Cost = { d: number; log?: (label: string, model: string, res: any) => void };

async function ask(ai: Gen, cost: Cost, parts: any[], maxOut = 500, label = 'visual'): Promise<any> {
  const res = await ai.models.generateContent({
    model: FAST,
    contents: [{ role: 'user', parts }],
    config: { temperature: 0, maxOutputTokens: maxOut, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  cost.d += estimateCost(FAST, res) || 0;
  cost.log?.(label, FAST, res);
  return parse(res.text || '');
}

// ---- 1. Choose --------------------------------------------------------------------------------------------------

export async function choose(ai: Gen, cost: Cost, game: string, question: string, answer: string) {
  const prompt =
    `A player asked: "${question}" (their app was open on "${game}", but the question may be about another game).\n` +
    `The answer they got:\n"""${answer.slice(0, 2500)}"""\n\n` +
    'Would one visual under this answer help them, and which kind? Decide from what the QUESTION asks, not from what ' +
    'the answer happens to describe.\n' +
    '- "video": the player asks HOW TO DO something that is movement or timing: getting from one place to another, ' +
    'beating a boss or enemy, getting through a platforming section, solving a puzzle ("how do I solve / get to / get ' +
    'through / beat ..."). A puzzle is always a video, never a picture.\n' +
    '  Also "how do I get / unlock / find / obtain X" when, by the answer, getting X takes a QUESTLINE (several steps ' +
    'or NPC visits), a ROUTE (a path through an area), a PUZZLE or a FIGHT (a boss or enemy that drops it): owner, ' +
    'Nov 14 2026, "how do I get the Nagakiba" is Yura\'s questline, so a video. The subject is X itself.\n' +
    '- "picture": the player asks what something LOOKS LIKE, or WHERE EXACTLY a thing is (an item, a character, an ' +
    'enemy, a chest, lever or door, a place), and "how do I get X" only when X is simply picked up or bought at one spot.\n' +
    '- "none": lore and story ("who is / who are / why ..."), builds, stats, choices, opinions, general advice.\n' +
    'Be strict: if the question is not clearly one of the first two, it is "none".\n' +
    'Reply with JSON only: {"game": "the game the question is about, by its usual name", ' +
    '"kind": "video" | "picture" | "none", "confidence": "high" | "medium" | "low", ' +
    '"subject": "the one thing itself, by its exact in-game name only (\\"Skeleton Key\\", \\"Keira Metz\\", ' +
    '\\"Malenia, Blade of Miquella\\"), never words like location, map, route or guide", ' +
    '"place": "for a where-question: the in-game name of the area it is in, as the answer names it; else empty", ' +
    '"search": "for a video: a short YouTube search: the game name plus the start and end places, boss or puzzle as ' +
    'the game names them; else empty", "why": "one short sentence"}';
  const j = await ask(ai, cost, [{ text: prompt }], 300, 'visual-choose');
  const kind: VisualKind = ['video', 'picture'].includes(j?.kind) && j?.confidence === 'high' ? j.kind : 'none';
  return { kind, game: String(j?.game || '').trim().slice(0, 120), subject: String(j?.subject || '').slice(0, 80), place: String(j?.place || '').slice(0, 80), search: String(j?.search || '').slice(0, 120), why: String(j?.why || '').slice(0, 200), confidence: String(j?.confidence || '') };
}

// ---- 2. Video ---------------------------------------------------------------------------------------------------

const isoSeconds = (d: string) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

/** The day's free YouTube searches are used up (quotaExceeded): the answer simply shows no video until they come back. */
export class YouTubeQuotaOut extends Error {}

async function yt(path: string, params: Record<string, string>, key: string) {
  const q = new URLSearchParams({ ...params, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`);
  if (!r.ok) {
    const body: any = await r.json().catch(() => null);
    const reason = String(body?.error?.errors?.[0]?.reason || '');
    if (r.status === 403 && /quota|rateLimit/i.test(reason)) throw new YouTubeQuotaOut(`YouTube ${path}: ${reason}`);
    throw new Error(`YouTube ${path} ${r.status} ${reason}`);
  }
  return r.json();
}

/**
 * A video (owner, Nov 14 2026, second review): the BEST match for the question, cheese method or not, ranked by
 *   1. how clearly and completely it shows what was asked (most important),
 *   2. source quality: channel subscribers and track record, views, likes relative to views, how recent it is for the
 *      game's current version,
 *   3. how quickly it gets to the point.
 * A small channel can still win when it's clearly the best match. The top pick is WATCHED once (it must really show it,
 * completely; it gives the start time); 2-3 alternatives from the same search come with it, matched by title and
 * description only, each with what's different about it ("quicker cheese method", "full fight guide").
 * YouTube calls: one search (the ~100-a-day bucket) per try, at most 2 per new topic; video and channel stats come from
 * videos.list and channels.list (1 unit each, the separate 10,000-unit pool), so they don't touch the searches.
 */
export async function findVideo(ai: Gen, cost: Cost, key: string, game: string, question: string, answer: string, search: string, out: VideoOut) {
  const first = await videoSearch(ai, cost, key, game, question, answer, search, out, new Set());
  if (first.pick) return first.pick;
  const own = `${game} ${question.replace(/^(how (do|can) i|where is|what does)\s+/i, '').replace(/[?.!]+$/, '')}`.slice(0, 120);
  if (own.toLowerCase() === search.toLowerCase()) return null;
  out.steps.push(`second search: "${own}"`);
  return (await videoSearch(ai, cost, key, game, question, answer, own, out, first.seen)).pick;
}

type Cand = {
  id: string; title: string; channel: string; channelId: string; seconds: number; desc: string; thumb: string;
  views: number; likes: number; published: string; subs: number; channelVideos: number;
};
export type VideoAlt = { videoId: string; title: string; channel: string; seconds: number; start: number; thumb: string; /** guide | walkthrough | quick | cheese | run (VIDEO_KINDS) */ note: string };

/**
 * Where the video starts: the description's chapter when the moment found by watching falls inside it (a clean start at
 * the chapter's beginning, within 3 minutes of that moment); otherwise the moment found by watching.
 */
export function pickStart(chapter: number, watched: number): number {
  if (chapter > 0 && watched >= chapter && watched - chapter <= 180) return chapter;
  return watched > 0 ? watched : chapter;
}

/** What kind of video it is (the app shows it in the player's language, with "shorter"/"longer" than the top pick). */
export const VIDEO_KINDS = ['guide', 'walkthrough', 'quick', 'cheese', 'run'] as const;
export const videoKind = (k: unknown): string => ((VIDEO_KINDS as readonly string[]).includes(String(k)) ? String(k) : 'guide');

/** "1.2M", "34K": short counts for the ranking prompt. */
export const shortCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

async function videoSearch(ai: Gen, cost: Cost, key: string, game: string, question: string, answer: string, search: string, out: VideoOut, seen: Set<string>) {
  const none = { pick: null as any, seen };
  // Any length up to 20 minutes. Videos the first search already showed aren't looked at again.
  const candidates: any[] = [];
  await out.beforeSearch?.(); // the day's free searches: throws YouTubeQuotaOut when they're used up
  const s: any = await yt('search', { part: 'snippet', type: 'video', q: search, maxResults: '15', videoEmbeddable: 'true', safeSearch: 'moderate', relevanceLanguage: 'en' }, key);
  out.searches++;
  for (const it of s.items || []) if (it.id?.videoId && !seen.has(it.id.videoId) && !out.excluded?.has(it.id.videoId) && !candidates.some((c) => c.id === it.id.videoId)) candidates.push({ id: it.id.videoId });
  for (const c of candidates) seen.add(c.id);
  if (!candidates.length) return none;
  // Video stats and channel stats: 1 unit each from the 10,000-unit pool (not the search bucket).
  const v: any = await yt('videos', { part: 'snippet,contentDetails,status,statistics', id: candidates.slice(0, 15).map((c) => c.id).join(',') }, key);
  const items = (v.items || []).filter((x: any) => x.status?.embeddable !== false);
  const channelIds = [...new Set(items.map((x: any) => String(x.snippet?.channelId || '')).filter(Boolean))] as string[];
  const ch: any = channelIds.length ? await yt('channels', { part: 'statistics', id: channelIds.slice(0, 50).join(','), maxResults: '50' }, key).catch(() => ({ items: [] })) : { items: [] };
  const chStats = new Map<string, any>((ch.items || []).map((c: any) => [c.id, c.statistics || {}]));
  const list: Cand[] = items.map((x: any) => {
    const cs = chStats.get(String(x.snippet?.channelId || '')) || {};
    return {
      id: x.id, title: String(x.snippet?.title || ''), channel: String(x.snippet?.channelTitle || ''), channelId: String(x.snippet?.channelId || ''),
      seconds: isoSeconds(x.contentDetails?.duration), desc: String(x.snippet?.description || '').slice(0, 1500),
      thumb: String(x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url || ''),
      views: Number(x.statistics?.viewCount) || 0, likes: Number(x.statistics?.likeCount) || 0,
      published: String(x.snippet?.publishedAt || '').slice(0, 10),
      subs: cs.hiddenSubscriberCount ? 0 : Number(cs.subscriberCount) || 0, channelVideos: Number(cs.videoCount) || 0,
    };
  }).filter((x: Cand) => x.seconds > 0 && x.seconds <= 20 * 60);
  out.steps.push(`YouTube "${search}": ${list.length} new candidate(s), stats for ${chStats.size} channel(s)`);
  if (!list.length) return none;
  const lines = list.map((x, i) =>
    `#${i + 1} "${x.title}" by ${x.channel} (${shortCount(x.subs)} subscribers, ${x.channelVideos} videos), ` +
    `${Math.floor(x.seconds / 60)}:${String(x.seconds % 60).padStart(2, '0')} long, ${shortCount(x.views)} views, ` +
    `${x.views ? ((x.likes / x.views) * 100).toFixed(1) : '0'}% likes per view, published ${x.published}\n` +
    `Description: ${x.desc.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n\n');
  const prompt =
    `A player of "${game}" asked: "${question}". The answer they got (what the places and names mean):\n` +
    `"""${answer.slice(0, 1500)}"""\n\nWhich of these YouTube videos show what they asked (the same route, boss or ` +
    'puzzle, in this game; not a different game, a remake, a mod, a different boss, or a general guide where it is a small part)? ' +
    'For "how do I get X", a guide to the whole questline, route or fight that gets X matches, even when it covers more ' +
    'than the last step (owner, Nov 14 2026: a Yura questline video for the Nagakiba). ' +
    'Any method counts, a cheese or exploit included: rank purely by which is the BEST match for the question.\n' +
    'Rank by, in this order:\n' +
    '1. How clearly and completely it shows what was asked (most important).\n' +
    '2. Source quality: the channel\'s subscribers and track record (how many videos), the video\'s views, likes ' +
    'relative to views, and how recent it is for the game\'s current version (an old video may show a patched method).\n' +
    '3. How quickly it gets to the point.\n' +
    'A small channel can still rank first when it is clearly the best match.\n' +
    'If the description has chapter times (like "3:12 Tanith"), give the start of the part that matches, else 0. ' +
    'For each, its "kind", so a player can choose between them: "guide" (explains how, step by step), "walkthrough" ' +
    '(plays through the area or fight, part of a longer playthrough), "quick" (a short tip or clip), "cheese" (a cheese, ' +
    'exploit or trick method), "run" (a skilled or no-commentary run without explanation). ' +
    'List up to 4, best first; an empty list if none matches. "confidence" is how sure you are that each one shows what they asked.\n\n' + lines +
    '\n\nReply with JSON only: {"picks": [{"n": number, "confidence": "high" | "medium" | "low", "start": seconds, "kind": "guide" | "walkthrough" | "quick" | "cheese" | "run", "why": "one short sentence"}]}';
  const j = await ask(ai, cost, [{ text: prompt }], 600, 'visual-videos');
  const picks = (Array.isArray(j?.picks) ? j.picks : []).filter((p: any) => p?.confidence === 'high' && list[Number(p.n) - 1]);
  if (!picks.length) { out.steps.push('no confident match by title/description'); return none; }
  const alt = (p: any): VideoAlt => {
    const c = list[Number(p.n) - 1];
    return { videoId: c.id, title: c.title, channel: c.channel, seconds: c.seconds, start: Math.max(0, Math.min(c.seconds - 5, Math.round(Number(p.start) || 0))), thumb: c.thumb, note: videoKind(p.kind) };
  };
  // Watch the top pick (if it fails, the next one becomes the top pick; at most 2 watches). The rest are alternatives.
  for (let i = 0; i < Math.min(2, picks.length); i++) {
    const c = list[Number(picks[i].n) - 1];
    const w = await watch(ai, cost, game, question, answer, c);
    out.steps.push(`watched "${c.title.slice(0, 60)}" (${c.seconds}s): ${w.ok ? `yes, from ${w.start}s` : 'no'}: ${w.what}`);
    if (!w.ok) continue;
    const start = Math.max(0, Math.min(c.seconds - 5, pickStart(Math.round(Number(picks[i].start) || 0), w.start)));
    const alts = picks.filter((_: any, k: number) => k !== i).slice(0, 3).map(alt);
    return {
      pick: { kind: 'video' as const, videoId: c.id, title: c.title, channel: c.channel, seconds: c.seconds, start, why: w.what || String(picks[i].why || ''), thumb: c.thumb, note: videoKind(picks[i].kind), alts },
      seen,
    };
  }
  return none;
}

/**
 * The Fast model watches the video from its link (no download): 1 frame every 2 s at low resolution, about $0.003 a
 * minute. It must clearly and completely show what the question asks; it gives where that part starts.
 */
async function watch(ai: Gen, cost: Cost, game: string, question: string, answer: string, c: Cand) {
  const prompt =
    `A player of "${game}" asked: "${question}". The answer they got:\n"""${answer.slice(0, 1200)}"""\n\n` +
    'Watch this video. Does it COMPLETELY and CLEARLY show what the QUESTION asks, in this game (any method, a cheese ' +
    'included)? "complete" is about the question only: false if it skips part of the asked route, fight or puzzle, or ' +
    'is too fast or unclear to follow; extra steps the answer adds beyond the question do not have to be in it. ' +
    'For "how do I get X": a video of the whole questline, route or fight that ends with getting X counts as complete ' +
    'even when it also covers more (other quest steps, other rewards); then the start is where that questline, route ' +
    'or fight begins. If yes, ' +
    'at what second does the part that answers the question start (0 if from the beginning; skip intros, sponsor ' +
    'segments and unrelated parts)? Reply with JSON only: {"shows": true | false, "complete": true | false, "start": seconds, "what": "what the video shows, one sentence"}';
  try {
    const res = await ai.models.generateContent({
      model: FAST,
      contents: [{ role: 'user', parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${c.id}`, mimeType: 'video/*' }, videoMetadata: { fps: 0.5 } }, { text: prompt }] }],
      config: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json', mediaResolution: 'MEDIA_RESOLUTION_LOW' as any, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    cost.d += estimateCost(FAST, res) || 0;
    cost.log?.('visual-watch', FAST, res);
    const j = parse(res.text || '');
    return { ok: j?.shows === true && j?.complete === true, start: Math.max(0, Math.round(Number(j?.start) || 0)), what: String(j?.what || '').slice(0, 200) };
  } catch (e: any) {
    // Watching failed (a video Gemini can't open): only a short video may still go, on its title/description check.
    return { ok: c.seconds <= 180, start: 0, what: `could not watch (${String(e?.message || e).slice(0, 80)})` };
  }
}

// ---- 3. Picture -------------------------------------------------------------------------------------------------


async function fandomImage(domain: string, title: string) {
  const api = (q: string) => fetch(`https://${domain}/api.php?format=json&formatversion=2&${q}`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const pick = (j: any) => { const p = j?.query?.pages?.[0]; return p && !p.missing && p.original?.source ? { url: String(p.original.source), page: `https://${domain}/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}`, title: String(p.title) } : null; };
  return pick(await api(`action=query&prop=pageimages&piprop=original&redirects=1&titles=${encodeURIComponent(title)}`));
}

async function jpegOf(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const m = await sharp(buf).metadata();
    if (!m.width || m.width < 200) return null;
    return (await sharp(buf).flatten({ background: '#1a1a1a' }).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString('base64');
  } catch { return null; }
}

export async function wikiPicture(ai: Gen, cost: Cost, src: { fextralife?: string; fandom?: string }, game: string, question: string, subject: string, steps: string[], where = false) {
  const tries: { url: string; page: string; title: string; site: string }[] = [];
  if (src.fextralife) { const f = await fextralifeImage(src.fextralife, subject).catch(() => null); if (f) tries.push({ ...f, site: 'Fextralife' }); }
  if (src.fandom) { const f = await fandomImage(src.fandom, subject); if (f) tries.push({ ...f, site: 'Fandom' }); }
  steps.push(`wiki: ${tries.length} page picture(s) for "${subject}"`);
  for (const t of tries) {
    const jpeg = await jpegOf(t.url);
    if (!jpeg) continue;
    const prompt =
      `This is the main picture of the wiki page "${t.title}" for the video game "${game}". A player asked: "${question}".\n` +
      (where
        ? `They asked WHERE it is. Does it clearly show where "${subject}" is (an in-game map marking its spot, or the ` +
          'spot itself in the game), or "' + subject + '" itself as it looks in the game? Not a logo, concept sketch, ' +
          'collage, real-world photo or a different thing. Reply with JSON only: '
        : `Does it clearly show "${subject}" itself, as it looks in the game, so the player would recognise it? Not a map, ` +
          'logo, concept sketch, collage, real-world photo or a different thing. Reply with JSON only: ') +
      '{"ok": true | false, "confidence": "high" | "medium" | "low", "what": "what it shows, one short sentence"}';
    const j = await ask(ai, cost, [{ inlineData: { mimeType: 'image/jpeg', data: jpeg } }, { text: prompt }], 200, 'visual-picture');
    steps.push(`check ${t.site}: ${j?.ok ? 'yes' : 'no'} (${j?.confidence || '?'}) ${j?.what || ''}`);
    if (j?.ok === true && j?.confidence === 'high') {
      return { kind: 'picture' as const, source: 'wiki' as const, url: t.url, alt: String(j.what || subject), credit: `${t.site}: ${t.title}`, link: t.page, why: String(j.what || ''), ...(/map/i.test(String(j.what || '')) ? { map: true } : {}) };
    }
  }
  return null;
}

// ---- The whole step -----------------------------------------------------------------------------------------------

/** The rules' version in saved results' keys (2: Nov 14 2026, "how do I get X" questlines and the question's own game). */
export const RULES_V = 'r2';
/** Two names for the same game ("ELDEN RING" / "Elden Ring", "The Witcher 3: Wild Hunt" / "Witcher 3")? */
export function sameGameName(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[™®©]/g, '').replace(/\b(the|game of the year|goty|complete|definitive|remastered|special|enhanced|edition)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const x = n(a), y = n(b);
  if (!x || !y) return true;
  return x === y || x.startsWith(y) || y.startsWith(x) || x.split(':')[0] === y.split(':')[0];
}

/** What a video search may use: a hook before each YouTube search (the day's budget) and videos never to pick again. */
export type VideoOut = { searches: number; steps: string[]; beforeSearch?: () => Promise<void>; excluded?: Set<string> };

/** Saved results (Firestore on the server, a Map in tests): by the question and by the topic. */
export type VisualStore = {
  get(keys: string[]): Promise<{ visual: Visual; at: number; excluded?: string[] } | null>;
  set(keys: string[], visual: Visual, excluded?: string[]): Promise<void>;
};
export const mapStore = (m = new Map<string, any>()): VisualStore => ({
  async get(keys) { return keys.map((k) => m.get(k)).find(Boolean) || null; },
  async set(keys, visual, excluded) { for (const k of keys) m.set(k, { visual, at: Date.now(), excluded }); },
});

export const visualId = (v: Visual) => (v.kind === 'video' ? v.videoId : v.kind === 'picture' ? v.url : '');

export async function visualFor(ai: Gen, o: {
  game: string; gameKey: string; question: string; answer: string; youtubeKey: string;
  wiki: { fextralife?: string; fandom?: string }; store?: VisualStore; log?: Cost['log'];
  beforeSearch?: () => Promise<void>;
  /** The question is about another game than the app's (asked from another game's compendium): its guide and wikis. */
  otherGame?: (name: string) => Promise<{ gameKey: string; wiki: { fextralife?: string; fandom?: string } } | null>;
}): Promise<VisualResult & { keys: string[]; game: string }> {
  const t0 = Date.now();
  const cost: Cost = { d: 0, log: o.log };
  const out: VideoOut = { searches: 0, steps: [], beforeSearch: o.beforeSearch };
  const c = await choose(ai, cost, o.game, o.question, o.answer);
  // Owner, Nov 14 2026: "how do I get the Nagakiba in Elden Ring" asked from a Baldur's Gate 3 compendium was looked for
  // in BG3's pictures and wikis. The game the question names wins.
  let game = o.game, gameKey = o.gameKey, wiki = o.wiki;
  if (c.game && sameGameName(c.game, o.game) === false && o.otherGame) {
    const other = await o.otherGame(c.game).catch(() => null);
    if (other) { game = c.game; gameKey = other.gameKey; wiki = other.wiki; out.steps.push(`about another game: ${game} (${gameKey})`); }
  }
  out.steps.push(`choose: ${c.kind} (${c.confidence}) subject "${c.subject}"${c.place ? `, place "${c.place}"` : ''}${c.search ? `, search "${c.search}"` : ''}: ${c.why}`);
  // Saved results: under the question itself and under the topic (the same thing asked in other words), with the rules'
  // version, so a "nothing found" saved under older rules is looked for again.
  const keys = c.kind === 'none' ? [] : [topicKey(gameKey, `${RULES_V} q ${o.question}`), topicKey(gameKey, `${RULES_V} ${c.kind} ${c.subject || c.search}`)];
  const done = (visual: Visual, cached = false, extra: Partial<VisualResult> = {}) => ({ visual, cost: cost.d, ms: Date.now() - t0, cached, steps: out.steps, youtubeSearches: out.searches, keys, game, kindChosen: c.kind, ...extra });
  if (c.kind === 'none') return done({ kind: 'none', why: c.why });
  const hit = o.store ? await o.store.get(keys) : null;
  // A saved visual is used until a player marks it "Not right" (then it's dropped and its id excluded); a saved
  // "nothing found" for a week.
  if (hit && (hit.visual.kind !== 'none' || Date.now() - hit.at < WEEK)) { out.steps.push('saved result reused'); return done(hit.visual, true); }
  const excluded = new Set(hit?.excluded || []);
  out.excluded = excluded;
  let visual: Visual | null = null;
  try {
    if (c.kind === 'video') visual = await findVideo(ai, cost, o.youtubeKey, game, o.question, o.answer, c.search || `${game} ${c.subject}`, out);
    else {
      // Pictures come from the game's wikis only, checked (owner, Nov 14 2026: not from our own guides, whose pictures
      // aren't good enough for this): the thing itself first, then for a where-question the place it's in.
      for (const name of [c.subject, c.place].filter(Boolean)) if (!visual) visual = await wikiPicture(ai, cost, wiki, game, o.question, name, out.steps, !!c.place);
      if (visual && excluded.has(visualId(visual))) { out.steps.push('the picture found was marked "Not right" before'); visual = null; }
    }
  } catch (e: any) {
    // The day's free YouTube searches are used up: no video this time, and nothing saved (it's looked for again later).
    if (e instanceof YouTubeQuotaOut) { out.steps.push('YouTube searches used up for today: no video'); return done({ kind: 'none', why: 'YouTube searches used up for today' }, false, { quotaOut: true }); }
    out.steps.push(`error: ${e?.message || e}`);
    return done({ kind: 'none', why: 'error' }); // an error is never saved
  }
  const final: Visual = visual || { kind: 'none', why: `no confident ${c.kind} found` };
  await o.store?.set(keys, final, [...excluded]);
  return done(final);
}
