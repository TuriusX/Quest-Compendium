import { useEffect, useState } from 'react';
import { useAchievementGuideByKey, type AchievementGuide } from './achievementGuide';
import { guideApi, type GuideAreaInfo, type GuidePage } from './guideApi';
import { matchGuideArea } from './guideMatch';
import { GUIDE_DONE_EVENT, readDone } from './guideProgress';
import { samePlace } from './placeName';
import type { TrackerGuideArea } from './trackerPayload';

/**
 * The guide data the objectives tracker needs for where the player is: the game's guide (found by name, like the
 * Guide does), the area for the current place (by name, else the closest match: see guideMatch) with its page and
 * what's ticked there, the next area in the guide's order, and the achievement guide. Re-reads the ticks whenever
 * anything is ticked (on the tracker or a guide page). guideArea is null when the game has no guide or no area fits.
 */
export function useTrackerGuide(gameName: string | undefined, placeName: string | undefined, story: string | undefined, lang: string): {
  guideKey: string | null;
  guideArea: TrackerGuideArea | null;
  achievementGuide: AchievementGuide | null;
} {
  const [guide, setGuide] = useState<{ key: string; areas: GuideAreaInfo[] } | null>(null);
  const [page, setPage] = useState<{ slug: string; page: GuidePage } | null>(null);
  // Every area page of the guide, loaded only when the place isn't an area by name (for the sub-location match).
  const [allPages, setAllPages] = useState<{ key: string; pages: Record<string, GuidePage | null> } | null>(null);
  const [doneTick, setDoneTick] = useState(0);

  useEffect(() => {
    setGuide(null);
    if (!gameName) return;
    let alive = true;
    guideApi(`/api/guides/find?game=${encodeURIComponent(gameName)}`, lang)
      .then((g) => alive && setGuide(g?.key && Array.isArray(g.areas) ? { key: g.key, areas: g.areas } : null))
      .catch(() => alive && setGuide(null));
    return () => {
      alive = false;
    };
  }, [gameName, lang]);

  const byName = !!guide && !!placeName && guide.areas.some((a) => samePlace(a.name, placeName));
  const needPages = !!guide && !!placeName && !byName;
  useEffect(() => {
    if (!guide || !needPages || allPages?.key === guide.key) return;
    let alive = true;
    const pages: Record<string, GuidePage | null> = {};
    // A few at a time; each page is cached (utils/guideApi), so the Guide doesn't fetch them again.
    (async () => {
      const queue = [...guide.areas];
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          for (let a = queue.shift(); a; a = queue.shift()) {
            pages[a.slug] = await guideApi(`/api/guides/${encodeURIComponent(guide.key)}/${encodeURIComponent(a.slug)}`, lang).catch(() => null);
          }
        }),
      );
      if (alive) setAllPages({ key: guide.key, pages });
    })();
    return () => {
      alive = false;
    };
  }, [guide?.key, needPages, lang]);

  const match = guide ? matchGuideArea(guide.areas, placeName, story, allPages?.key === guide.key ? allPages.pages : undefined) : null;
  const index = match ? match.index : -1;
  const area = guide && index >= 0 ? guide.areas[index] : null;

  useEffect(() => {
    if (!guide || !area) {
      setPage(null);
      return;
    }
    let alive = true;
    guideApi(`/api/guides/${encodeURIComponent(guide.key)}/${encodeURIComponent(area.slug)}`, lang)
      .then((p) => alive && setPage(p?.slug ? { slug: area.slug, page: p } : null))
      .catch(() => alive && setPage(null));
    return () => {
      alive = false;
    };
  }, [guide?.key, area?.slug, lang]);

  useEffect(() => {
    const onDone = () => setDoneTick((n) => n + 1);
    window.addEventListener(GUIDE_DONE_EVENT, onDone);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, onDone);
  }, []);

  const achievementGuide = useAchievementGuideByKey(guide?.key || null, lang);
  void doneTick; // read below through readDone: a tick anywhere re-renders with the new set

  const next = guide && index >= 0 && index < guide.areas.length - 1 ? guide.areas[index + 1] : null;
  const guideArea: TrackerGuideArea | null =
    guide && area && match
      ? {
          key: guide.key,
          slug: area.slug,
          name: area.name,
          story: area.story || '',
          page: page && page.slug === area.slug ? page.page : null,
          next: next ? { slug: next.slug, name: next.name, story: next.story || '' } : null,
          done: readDone(guide.key, area.slug),
          via: match.via,
          areas: guide.areas.map((a) => ({ name: a.name, story: a.story || '' })),
          index,
        }
      : null;
  return { guideKey: guide?.key || null, guideArea, achievementGuide };
}
