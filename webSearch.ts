/**
 * Web search for the Steam Deck plugin's Browser tab: POST /api/web-search  { q: string }
 *
 * Why this exists: Google no longer serves search results to clients without JavaScript, and the Custom Search JSON
 * API is closed to new customers. The server already uses Gemini with the Google Search tool for chat, so searches
 * run the same way: Gemini searches Google, and we return the pages it found (grounding sources) plus a short
 * overview. Result links are resolved to the real page URL and page title here, so the plugin can show and open them.
 *
 * Cost control (each uncached search is one grounded Gemini Flash call):
 *   - identical searches are cached for 15 minutes
 *   - per signed-in user and per guest IP hourly limits, plus a global daily ceiling
 * Tunable via environment variables:
 *   WEB_SEARCH_MODEL (default gemini-3.8-flash), WEB_SEARCH_PER_USER_HOURLY (60),
 *   WEB_SEARCH_PER_GUEST_HOURLY (20), WEB_SEARCH_GLOBAL_DAILY (2000), GUEST_PROXY_HOPS (1)
 * Searches do not use the user's Pro/Fast chat queries.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';
import { clientIp } from './guestGuard';

export interface WebSearchDeps {
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown;
  getGeminiClient: () => GoogleGenAI;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface WebResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  /** The page answered with a bot check / captcha when we looked at it, so it may not open in the plugin. */
  blocked?: boolean;
}

interface SearchBody {
  ok: true;
  query: string;
  summary: string;
  results: WebResult[];
  searchQueries: string[];
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 300;
const MAX_RESULTS = 10;

const envNum = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return clean(decodeEntities(t)).slice(0, 160);
}

/** Bot checks (Cloudflare and similar) that a plain page fetch can't get past. */
export function looksBlocked(title: string, html: string): boolean {
  return (
    /just a moment|attention required|security check|access denied|verify you are human|are you a robot/i.test(title) ||
    /cf-browser-verification|challenge-platform|cf_chl_|g-recaptcha|hcaptcha/i.test(html.slice(0, 20000))
  );
}

async function readPrefix(res: globalThis.Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/** Follow Gemini's grounding redirect to the real page and read its title. Never throws. */
async function resolveResult(
  raw: { uri: string; title: string; snippet: string },
  fetchImpl: typeof fetch,
): Promise<WebResult> {
  let url = raw.uri;
  let title = '';
  let blocked = false;
  try {
    const res = await fetchImpl(raw.uri, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.8' },
      signal: AbortSignal.timeout(5000),
    });
    url = res.url || raw.uri;
    if ((res.headers.get('content-type') || '').includes('html')) {
      const html = await readPrefix(res, 200_000);
      title = extractTitle(html);
      blocked = res.status === 403 || res.status === 503 ? true : looksBlocked(title, html);
    } else {
      res.body?.cancel().catch(() => {});
    }
  } catch {
    /* keep the redirect link; the plugin can still follow it */
  }
  const domain = hostOf(url) || raw.title;
  // Grounding titles are usually just the site name; prefer the real page title.
  if (!title || (blocked && /just a moment|security check|attention required/i.test(title))) title = raw.title || domain;
  return { title, url, domain, snippet: raw.snippet, ...(blocked ? { blocked } : {}) };
}

export function registerWebSearch(app: Express, deps: WebSearchDeps): void {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const model = env.WEB_SEARCH_MODEL || 'gemini-3.8-flash';
  const perUserHourly = envNum(env.WEB_SEARCH_PER_USER_HOURLY, 60);
  const perGuestHourly = envNum(env.WEB_SEARCH_PER_GUEST_HOURLY, 20);
  const globalDaily = envNum(env.WEB_SEARCH_GLOBAL_DAILY, 2000);
  const proxyHops = envNum(env.GUEST_PROXY_HOPS, 1);

  const cache = new Map<string, { at: number; body: SearchBody }>();
  const hourly = new Map<string, { n: number; reset: number }>();
  let global = { day: '', n: 0 };

  setInterval(() => {
    const t = now();
    for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k);
    for (const [k, v] of cache) if (t - v.at > CACHE_TTL_MS) cache.delete(k);
  }, 60_000).unref();

  app.post('/api/web-search', deps.requireAuth as any, async (req: Request, res: Response) => {
    const q = clean(String(req.body?.q ?? '')).slice(0, 200);
    if (!q) return res.status(400).json({ error: 'Type something to search for.' });

    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return res.json(hit.body);

    const user = (req as any).user ?? {};
    const uid = String(user.uid ?? '');
    const isGuest = !!user.isGuest || uid.startsWith('guest_');
    // Guest IDs are made up by the client, so limit guests by IP.
    const limiterKey = isGuest ? `ip:${clientIp(req, proxyHops)}` : `uid:${uid}`;
    const limit = isGuest ? perGuestHourly : perUserHourly;
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (global.day !== day) global = { day, n: 0 };
    let w = hourly.get(limiterKey);
    if (!w || t >= w.reset) {
      w = { n: 0, reset: t + 60 * 60 * 1000 };
      hourly.set(limiterKey, w);
    }
    if (w.n >= limit || global.n >= globalDaily) {
      return res.status(429).json({ error: 'Too many searches right now. Try again in a little while.' });
    }
    w.n++;
    global.n++;

    try {
      const ai = deps.getGeminiClient();
      const response: any = await timeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    `A video game player searched the web for: "${q}".\n` +
                    'Use Google Search to find the most useful pages (wikis, guides, walkthroughs, forum threads). ' +
                    'Then answer in 2 or 3 short sentences of plain text (no markdown) summarizing what those pages say.',
                },
              ],
            },
          ],
          config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
        }),
        20000,
        'Web search',
      );

      const gm = response?.candidates?.[0]?.groundingMetadata ?? {};
      const chunks: any[] = gm.groundingChunks ?? [];
      const snippets: string[] = [];
      for (const s of gm.groundingSupports ?? []) {
        const text = clean(String(s?.segment?.text ?? ''));
        for (const i of s?.groundingChunkIndices ?? []) if (text && !snippets[i]) snippets[i] = text;
      }
      const raw = chunks
        .map((c, i) => ({ uri: String(c?.web?.uri ?? ''), title: clean(String(c?.web?.title ?? '')), snippet: snippets[i] ?? '' }))
        .filter((r) => /^https?:\/\//.test(r.uri))
        .slice(0, MAX_RESULTS);

      const resolved = await Promise.all(raw.map((r) => resolveResult(r, fetchImpl)));
      const seen = new Set<string>();
      const results = resolved
        .filter((r) => {
          const k = r.url.split('#')[0];
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        // Pages behind bot checks go last: they usually can't be read in the plugin.
        .sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked));

      const body: SearchBody = {
        ok: true,
        query: q,
        summary: clean(String(response?.text ?? '')).slice(0, 1200),
        results,
        searchQueries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.slice(0, 5) : [],
      };
      if (results.length) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now(), body });
      }
      return res.json(body);
    } catch (err: any) {
      console.error('[web-search] failed:', err?.message || err);
      w.n = Math.max(0, w.n - 1); // don't charge the user for our failure
      return res.status(502).json({ error: 'Search is unavailable right now.' });
    }
  });
}
