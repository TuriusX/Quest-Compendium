import type { GuideAreaInfo, GuidePage } from './guideApi';
import { nameKey, placeKey, samePlace } from './placeName';

/**
 * Which guide area the player is in, for the objectives tracker. Tried in order:
 *   1. name:  an area with the place's name ("South Figaro", "South Figaro, Relic Shop")
 *   2. sub:   the area whose page mentions the place as a sub-location: its entries' "where" fields, section headings
 *             and shop names ("Dank Crypt" is in the Overgrown Ruins' entries). The area with the most mentions wins.
 *   3. story: an area whose story beat is the place's story beat, else the area the story beat names ("Early game:
 *             Terra, Edgar and Locke heading to Mt. Kolts" -> Mt. Kolts)
 * 2 and 3 are the "closest match" (the tracker says so). pages: the guide's area pages by slug, for step 2 (without
 * them step 2 is skipped).
 */
export type AreaMatch = { index: number; via: 'name' | 'sub' | 'story' };

/** Does `text` contain `phrase` as whole words (letters and digits from any script)? */
const hasPhrase = (text: string | undefined, phrase: string) => !!phrase && ` ${nameKey(text)} `.includes(` ${phrase} `);

export function matchGuideArea(
  areas: GuideAreaInfo[],
  place: string | undefined,
  story: string | undefined,
  pages?: Record<string, GuidePage | null | undefined>,
): AreaMatch | null {
  if (!areas.length) return null;
  if (place) {
    const byName = areas.findIndex((a) => samePlace(a.name, place));
    if (byName >= 0) return { index: byName, via: 'name' };
  }

  // A sub-location of an area: count the page's mentions of the place.
  const phrase = nameKey(place);
  if (pages && phrase.length >= 3) {
    let best = -1, bestScore = 0;
    areas.forEach((a, i) => {
      const p = pages[a.slug];
      if (!p) return;
      const fields = [
        ...[...p.items, ...p.secrets, ...p.enemies, ...p.shops].map((e) => e.where),
        ...p.shops.map((e) => e.name),
        ...(p.sections || []).map((x) => x.title),
      ];
      const score = fields.filter((f) => hasPhrase(f, phrase)).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (best >= 0) return { index: best, via: 'sub' };
  }

  // The story beat: the same story beat as an area's, else an area it names.
  const s = placeKey(story);
  if (s) {
    const sameStory = areas.findIndex((a) => {
      const k = placeKey(a.story);
      return !!k && (k === s || (k.split(' ').length >= 3 && (s.includes(k) || k.includes(s))));
    });
    if (sameStory >= 0) return { index: sameStory, via: 'story' };
    const named = areas.findIndex((a) => nameKey(a.name).length >= 4 && hasPhrase(story, nameKey(a.name)));
    if (named >= 0) return { index: named, via: 'story' };
  }
  return null;
}
