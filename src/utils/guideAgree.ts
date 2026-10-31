/**
 * The answer wins over the guide (owner, Oct 31 2026): FF6's South Figaro answer said to leave the outdoor barrels and
 * crates (their contents upgrade later) while the quest log listed "Get Potion" from those barrels. A guide entry the
 * answer advises against is hidden from the quest log and sent to the nightly corrections check (corrections.ts),
 * which settles it against sources. Used by the server (/api/chat) and its tests.
 */
import type { QuestStep } from '../types';

// Words that name no thing ("Do not open the outdoor barrels yet" → barrel, crate, outdoor).
const SKIP = new Set(('the and for with from into onto your you them they their this that these those there here then than '
  + 'are was were has have had will can not but all any some one two out off over under way about what when where who how '
  + 'why just yet now later until after before first open opening take taking grab loot looting pick picking use using get '
  + 'getting buy sell leave leaving skip avoid wait hold keep save ignore resist touch touching don dont never better best '
  + 'items item things thing stuff game time rare much more most very really upgrade upgrades upgraded transform transforms '
  + 'contents worth instead completely untouched unopened scattered around town area inside outside left right near').split(' '));

/** "Don't open…", "Leave…", "Skip…", "Hold off on…": an answer step that says not to do something (yet). */
const AVOID_RE = /^(?:do not|don't|dont|never|leave|skip|avoid|hold off|wait (?:on|before|to)|save|ignore|resist|not yet)\b/i;
// "Don't miss / skip / forget …" says to do it.
const DO_IT = /^(?:do not|don't|dont|never) (?:miss|skip|forget|leave without|pass up)\b/i;
const AVOID = { test: (s: string) => AVOID_RE.test(s) && !DO_IT.test(s) };

const singular = (w: string) => (w.length > 4 && /(?:ches|shes|xes|sses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const wordsOf = (s: string) => new Set(String(s || '').toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SKIP.has(w)).map(singular).filter((w) => !SKIP.has(w)));

/** What the answer advises against: its "don't / leave / skip" steps (warnings included), as the things they name. */
export function answerAvoids(steps: QuestStep[] | undefined): { advice: string; words: Set<string> }[] {
  const out: { advice: string; words: Set<string> }[] = [];
  for (const st of steps || []) {
    const lines = [st.label, st.text].filter(Boolean) as string[];
    if (!lines.some((l) => AVOID.test(l.trim()))) continue;
    const words = wordsOf(lines.filter((l) => AVOID.test(l.trim())).join(' '));
    if (words.size) out.push({ advice: (st.text || st.label || '').trim(), words });
  }
  return out;
}

/**
 * The guide entries an answer advises against: an entry whose name or place names a thing the advice is about ("Potion,
 * upper barrel left of the Chocobo Stables" against "Do not open outdoor barrels and crates"). With the advice it goes
 * against, for the corrections check.
 */
export function disagreeingEntries<E extends { id: string; name?: string; text?: string; where?: string }>(entries: E[], steps: QuestStep[] | undefined): { entry: E; advice: string }[] {
  const avoids = answerAvoids(steps);
  if (!avoids.length) return [];
  const out: { entry: E; advice: string }[] = [];
  for (const e of entries) {
    const w = wordsOf(`${e.name || e.text || ''} ${e.where || ''}`);
    const hit = avoids.find((a) => [...a.words].some((x) => w.has(x)));
    if (hit) out.push({ entry: e, advice: hit.advice });
  }
  return out;
}
