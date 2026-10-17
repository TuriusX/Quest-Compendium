/**
 * Translation completeness (translate-guide.ts): how much of a translated page is still the English text. The
 * translation is laid onto the original's structure, and any field the reply left empty or mis-shaped silently keeps
 * its English, so a page can go out half translated. This counts it, for the log and the run's report; nothing is
 * retried automatically (that would be new spend).
 */

/** A page counts as incomplete above this share of its prose still in English. */
export const UNTRANSLATED_LIMIT = 0.1;

/** Keys whose values are names or ids, which may rightly stay as they are (official names kept in English). */
const NOT_PROSE = new Set(['id', 'name', 'group', 'label']);

/** Prose: a sentence or phrase of several words, not a name, number or code. */
const isProse = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 4;

/**
 * The prose fields of a page's source and how many came back identical in the translation. Walks both together (the
 * translation has the source's exact shape after fit()).
 */
export function untranslated(src: unknown, out: unknown): { prose: number; same: number; share: number } {
  let prose = 0, same = 0;
  const walk = (s: any, o: any, key: string) => {
    if (typeof s === 'string') {
      if (NOT_PROSE.has(key) || !isProse(s)) return;
      prose++;
      if (typeof o !== 'string' || o.trim() === s.trim()) same++;
      return;
    }
    if (Array.isArray(s)) { s.forEach((x, i) => walk(x, Array.isArray(o) ? o[i] : undefined, key)); return; }
    if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) walk(v, o?.[k], k);
  };
  walk(src, out, '');
  return { prose, same, share: prose ? same / prose : 0 };
}
