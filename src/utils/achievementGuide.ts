import { useEffect, useState } from 'react';
import { getApiBaseUrl } from './api';
import { nameKey, samePlace } from './placeName';

/**
 * A game's achievement guide (how to get each achievement, whether it can be missed, the guide area it belongs to, and
 * a roadmap), from the guides feed. Shared by the achievements drawer and the Guide.
 */
export type AchievementTip = { name: string; englishName?: string; desc: string; rarity: number | null; icon: string; hidden: boolean; missable?: boolean; how?: string; area?: string; areaName?: string };
export type AchievementGuide = {
  key: string;
  verified?: boolean;
  list: AchievementTip[];
  roadmap?: { time?: string; difficulty?: string; playthroughs?: string; missables?: string; steps?: string[]; noReturn?: { point: string; lost: string }[] } | null;
};

export const achKey = nameKey;
/** Does a tip belong to this achievement? (By name, or by its English name when the guide is translated.) */
export const tipMatches = (tip: AchievementTip, name: string) => {
  const k = achKey(name);
  return !!k && (achKey(tip.name) === k || (!!tip.englishName && achKey(tip.englishName) === k));
};
const cache = new Map<string, Promise<AchievementGuide | null>>();
const load = (url: string): Promise<AchievementGuide | null> => {
  if (!cache.has(url)) {
    const p = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.key && Array.isArray(d.list) ? (d as AchievementGuide) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return cache.get(url)!;
};
const langParam = (lang?: string) => (lang && lang !== 'en' ? `&lang=${lang}` : '');

/** The achievement guide for a running game: by Steam app id first (renamed games still match), then by name. */
export function useAchievementGuide(gameName?: string | null, appId?: number | null, lang?: string): AchievementGuide | null {
  const [g, setG] = useState<AchievementGuide | null>(null);
  useEffect(() => {
    setG(null);
    if (!gameName && !appId) return;
    let alive = true;
    load(`${getApiBaseUrl()}/api/achievements?game=${encodeURIComponent(gameName || '')}${appId ? `&appid=${appId}` : ''}${langParam(lang)}`).then((d) => alive && setG(d));
    return () => {
      alive = false;
    };
  }, [gameName, appId, lang]);
  return g;
}

/** The achievement guide for a guide you're reading (by its key), whether or not that game is running. */
export function useAchievementGuideByKey(key?: string | null, lang?: string): AchievementGuide | null {
  const [g, setG] = useState<AchievementGuide | null>(null);
  useEffect(() => {
    setG(null);
    if (!key) return;
    let alive = true;
    load(`${getApiBaseUrl()}/api/guides/${encodeURIComponent(key)}/achievements?x=1${langParam(lang)}`).then((d) => alive && setG(d));
    return () => {
      alive = false;
    };
  }, [key, lang]);
  return g;
}

/** Ask the main window to open the Guide at an area (the achievements drawer uses this for "In the guide"). */
export function openGuideArea(slug: string) {
  window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug } }));
}

export { samePlace };
