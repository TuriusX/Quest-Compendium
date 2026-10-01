import { useEffect, useState } from 'react';
import { getApiBaseUrl } from './api';

/**
 * A game's achievement guide (how to get each achievement, whether it can be missed, the guide area it belongs to, and
 * a roadmap), from the guides feed. Shared by the achievements drawer and the Guide.
 */
export type AchievementTip = { name: string; desc: string; rarity: number | null; icon: string; hidden: boolean; missable?: boolean; how?: string; area?: string; areaName?: string };
export type AchievementGuide = {
  key: string;
  verified?: boolean;
  list: AchievementTip[];
  roadmap?: { time?: string; difficulty?: string; playthroughs?: string; missables?: string; steps?: string[]; noReturn?: { point: string; lost: string }[] } | null;
};

export const achKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cache = new Map<string, Promise<AchievementGuide | null>>();

export function loadAchievementGuide(gameName: string): Promise<AchievementGuide | null> {
  if (!cache.has(gameName)) {
    const p = fetch(`${getApiBaseUrl()}/api/achievements?game=${encodeURIComponent(gameName)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.key && Array.isArray(d.list) ? (d as AchievementGuide) : null))
      .catch(() => null);
    cache.set(gameName, p);
  }
  return cache.get(gameName)!;
}

export function useAchievementGuide(gameName?: string | null): AchievementGuide | null {
  const [g, setG] = useState<AchievementGuide | null>(null);
  useEffect(() => {
    setG(null);
    if (!gameName) return;
    let alive = true;
    loadAchievementGuide(gameName).then((d) => alive && setG(d));
    return () => {
      alive = false;
    };
  }, [gameName]);
  return g;
}

/** Ask the main window to open the Guide at an area (the achievements drawer uses this for "In the guide"). */
export function openGuideArea(slug: string) {
  window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug } }));
}
