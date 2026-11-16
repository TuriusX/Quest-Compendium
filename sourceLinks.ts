/**
 * Sources under an answer (owner, Nov 16 2026: link the sources that are best for players, the wikis and guides the
 * answer came from, not our own guide). Up to three links, each a real page with a readable name and its site:
 *   1. the pages the answer's search read (Google's grounding: its links redirect, so each is followed once to the page
 *      itself), one per site;
 *   2. without a search, the wiki pages of the things the answer used (the game's Fextralife or Fandom wiki, found for
 *      free: visualAnswer.ts wikiPage), or of the player's area for a question about the place.
 * Never our own site. Nothing found: no row. Free (no AI calls); a few seconds at most, in parallel.
 */
import { wikiPage } from './visualAnswer';
import { wikiFor } from './scripts/guides/itemCards';

export type SourceLink = { url: string; title: string; site: string };

const OWN = /questcompendium|quest-compendium|run\.app$/i;
// Videos come with the answer's video card (visual answers), not as sources.
const SKIP = /(^|\.)(youtube\.com|youtu\.be)$/i;
const SITE_NAMES: [RegExp, string][] = [
  [/fextralife\.com$/i, 'Fextralife'], [/fandom\.com$/i, 'Fandom'], [/ign\.com$/i, 'IGN'], [/gamerant\.com$/i, 'Game Rant'],
  [/reddit\.com$/i, 'Reddit'], [/steamcommunity\.com$/i, 'Steam Community'], [/gamefaqs\.gamespot\.com$/i, 'GameFAQs'],
  [/polygon\.com$/i, 'Polygon'], [/pcgamer\.com$/i, 'PC Gamer'], [/thegamer\.com$/i, 'TheGamer'], [/rockpapershotgun\.com$/i, 'Rock Paper Shotgun'],
  [/game8\.co$/i, 'Game8'], [/powerpyx\.com$/i, 'PowerPyx'], [/youtube\.com$/i, 'YouTube'], [/wikipedia\.org$/i, 'Wikipedia'],
];

/** "eldenring.wiki.fextralife.com" -> "Fextralife"; an unknown site by its address without "www.". */
export function siteName(host: string): string {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return SITE_NAMES.find(([re]) => re.test(h))?.[1] || h;
}

/** A page's readable name from its address ("/Stormveil+Castle" -> "Stormveil Castle"), else the given title. */
export function titleFromUrl(url: string, fallback = ''): string {
  try {
    const u = new URL(url);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.(html?|php|aspx?)$/i, '');
    const words = seg.replace(/[+_]/g, ' ').replace(/-(?=[a-z0-9])/gi, ' ').replace(/\s+/g, ' ').trim();
    // Ids, numbers and "index" aren't names (a single word mixing digits and letters, like a video id, isn't either).
    const oneWord = !/\s/.test(words);
    const capsInside = (words.slice(1).match(/[A-Z]/g) || []).length;
    const digits = words.replace(/\D/g, '').length / Math.max(1, words.replace(/\s/g, '').length);
    const idLike = (oneWord && ((/\d/.test(words) && /[a-z]/i.test(words)) || (words.length >= 8 && capsInside >= 2))) || digits > 0.5;
    if (words.length >= 3 && /[a-z]/i.test(words) && !idLike && !/^(index|default|home|wiki|guide|article|watch)$/i.test(words) && !/^[0-9a-f-]{8,}$/i.test(words)) {
      return words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
    }
  } catch { /* not an address */ }
  return String(fallback || '').slice(0, 80);
}

const withTimeout = <T,>(p: Promise<T>, ms: number, dflt: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(dflt), ms))]);

/** Where one of the grounding's redirect links leads (followed once, not loaded). */
async function realUrl(uri: string): Promise<string> {
  if (!/^https:\/\//.test(uri)) return '';
  if (!/vertexaisearch|grounding-api-redirect/.test(uri)) return uri;
  try {
    const r = await fetch(uri, { method: 'GET', redirect: 'manual' });
    return r.headers.get('location') || '';
  } catch { return ''; }
}

/** The grounding's links of a response: { uri, title } for each web source. */
export function groundingLinks(response: any): { uri: string; title: string }[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.map((c: any) => ({ uri: String(c?.web?.uri || ''), title: String(c?.web?.title || '') })).filter((c: any) => c.uri).slice(0, 12);
}

export async function answerSourceLinks(o: {
  read: { uri: string; title: string }[];
  game: string; gameKey?: string;
  /** What the answer used (its guide entries' names), for wiki pages when it didn't search. */
  names?: string[];
  /** The player's area, for a question about the place. */
  area?: string;
}): Promise<SourceLink[]> {
  const out: SourceLink[] = [];
  const add = (url: string, title: string) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { return; }
    if (OWN.test(host) || SKIP.test(host) || out.some((x) => x.url === url || x.site === siteName(host))) return;
    // A page without a readable name isn't shown (never an id or a bare site name).
    const name = titleFromUrl(url, title && !/\.[a-z]{2,}$/i.test(title) ? title : '');
    if (!name) return;
    out.push({ url, title: name, site: siteName(host) });
  };
  // 1. The pages the search read.
  const urls = await Promise.all(o.read.slice(0, 8).map((c) => withTimeout(realUrl(c.uri), 2500, '').then((u) => ({ u, t: c.title }))));
  for (const { u, t } of urls) if (u && out.length < 3) add(u, t);
  if (out.length) return out;
  // 2. Without a search: the wiki pages of what it used, or of the area.
  const names = [...new Set([...(o.names || []), ...(o.area ? [o.area] : [])].map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 3);
  if (!names.length || !o.game) return out;
  const key = o.gameKey || o.game.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const wiki = await withTimeout(wikiFor(key, o.game).catch(() => null), 2500, null);
  if (!wiki) return out;
  const pages = await Promise.all(names.map((n) => withTimeout(wikiPage(wiki, n).catch(() => null), 2500, null)));
  for (const p of pages) if (p && out.length < 3) out.push({ url: p.url, title: p.title, site: siteName(new URL(p.url).hostname) });
  return out;
}
