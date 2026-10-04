/**
 * Comparing place and achievement names in any language. Letters and digits from every script count (Japanese,
 * Russian, accented Latin…), so a name never shrinks to nothing and matches everything. Shared by the app and the
 * server, so "the same place" means the same thing everywhere.
 */

/** A place name reduced to lower-case letters, digits and the commas that separate detail ("South Figaro, Relic Shop"). */
export function placeKey(x: string | null | undefined, keep = ','): string {
  const kept = keep.replace(/[\\\]^-]/g, '\\$&');
  return (x || '')
    .normalize('NFKC') // full-width letters and commas become plain ones
    .replace(/、/g, ',') // the Japanese comma separates detail too
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(new RegExp(`[^\\p{L}\\p{M}\\p{N}${kept}]+`, 'gu'), ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same place, allowing extra detail on either side ("South Figaro" vs "South Figaro, Relic Shop"). */
export function samePlace(a?: string | null, b?: string | null): boolean {
  const x = placeKey(a), y = placeKey(b);
  return !!x && !!y && (x === y || x.startsWith(`${y},`) || y.startsWith(`${x},`));
}

/** An achievement name for comparing (no punctuation at all). */
export const nameKey = (s: string | null | undefined) => placeKey(s, '').trim();

/**
 * A story beat as a short quest-log phrase: "The player is exploring the crash site of the Nautiloid." becomes
 * "Exploring the crash site of the Nautiloid". The AI is asked for phrases; this tidies older beats (and slips) when
 * they're shown: a leading "The player is/has…" (or "You are…") goes, the first letter is capitalised, and a final
 * full stop is dropped.
 */
export function storyPhrase(story: string | null | undefined): string {
  let t = String(story ?? '').trim();
  const stripped = t.replace(/^(the\s+)?(player|party|you)(\s+(is|are|has|have|was|were)|['’](s|re|ve))?\s+(currently\s+|now\s+|just\s+|still\s+)*/i, '');
  if (stripped !== t && stripped) t = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return t.replace(/\.$/, '').trim();
}
