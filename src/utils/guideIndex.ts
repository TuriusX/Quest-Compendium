import { useCallback, useEffect, useState } from 'react';
import { guideApi } from './guideApi';

/**
 * The guide list (all games with a Quest Compendium guide), from the website's guides/index.json (a few KB published
 * with the site by scripts/guides/publish.ts), so the first load never waits on the server; the server's /api/guides
 * is the fallback. Kept on this computer and shown at once, then refreshed in the background.
 */
export type GuideIndexGame = { key: string; game: string; areas: number; art?: string; checked?: number; players?: number };
export type GuideSort = 'az' | 'popular';

export const GUIDE_INDEX_URL = 'https://questcompendium.com/guides/index.json';
const CACHE_KEY = 'qc-guide-index';
const RECENT_KEY = 'qc-guide-recent';
const RECENT_MAX = 5;

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

/** The games from either source (the website's index or the server's list), or null if it isn't one. */
export function normalizeIndex(j: any): GuideIndexGame[] | null {
  const list = Array.isArray(j?.games) ? j.games : null;
  if (!list) return null;
  return list
    .filter((g: any) => g && typeof g.key === 'string' && typeof g.game === 'string')
    .map((g: any) => ({
      key: g.key, game: g.game, areas: Number(g.areas) || 0,
      ...(g.art ? { art: String(g.art) } : {}),
      ...(g.checked != null ? { checked: Number(g.checked) || 0 } : {}),
      ...(g.players != null ? { players: Number(g.players) || 0 } : {}),
    }));
}

const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const sortName = (n: string) => n.replace(/^(the|a|an)\s+/i, '').toLowerCase();

/**
 * The list in the order players want it: the running game's guide first, then the guides they opened recently (most
 * recent first), then the rest A–Z or by popularity. A search filters it, keeping that order.
 */
export function orderGuides(games: GuideIndexGame[], o: { current?: string; recent?: string[]; sort?: GuideSort; q?: string } = {}): GuideIndexGame[] {
  const recent = (o.recent || []).filter((k) => k !== o.current);
  const rank = (g: GuideIndexGame) => (g.key === o.current ? 0 : recent.includes(g.key) ? 1 + recent.indexOf(g.key) : 1000);
  const rest = (a: GuideIndexGame, b: GuideIndexGame) =>
    (o.sort === 'popular' ? (b.players || 0) - (a.players || 0) : 0) || sortName(a.game).localeCompare(sortName(b.game));
  const needle = fold(String(o.q || '').trim());
  return games
    .filter((g) => !needle || fold(g.game).includes(needle))
    .sort((a, b) => rank(a) - rank(b) || rest(a, b));
}

export function readRecentGuides(): string[] {
  try {
    const v = JSON.parse(lsGet(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
export function rememberGuideOpened(key: string): void {
  lsSet(RECENT_KEY, JSON.stringify([key, ...readRecentGuides().filter((k) => k !== key)].slice(0, RECENT_MAX)));
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** The website's index (15 s), else the server's list (45 s); each tried twice before giving up. */
export async function fetchGuideIndex(): Promise<GuideIndexGame[]> {
  const sources = [
    () => withTimeout(fetch(GUIDE_INDEX_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))), 15_000),
    () => withTimeout(guideApi('/api/guides'), 45_000),
  ];
  for (const source of sources) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const games = normalizeIndex(await source());
        if (games?.length) return games;
      } catch {
        /* the next try, or the next source */
      }
    }
  }
  throw new Error('guides unavailable');
}

/** The guide list: the copy on this computer at once (if any), refreshed in the background; retry() after a failure. */
export function useGuideIndex() {
  const [games, setGames] = useState<GuideIndexGame[] | null>(() => {
    try {
      return normalizeIndex(JSON.parse(lsGet(CACHE_KEY) || 'null'));
    } catch {
      return null;
    }
  });
  const [state, setState] = useState<{ loading: boolean; error: boolean }>({ loading: true, error: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false });
    fetchGuideIndex()
      .then((g) => {
        if (!alive) return;
        setGames(g);
        lsSet(CACHE_KEY, JSON.stringify({ games: g }));
        setState({ loading: false, error: false });
      })
      .catch(() => alive && setState({ loading: false, error: true }));
    return () => {
      alive = false;
    };
  }, [n]);
  const retry = useCallback(() => setN((x) => x + 1), []);
  return { games, ...state, retry };
}
