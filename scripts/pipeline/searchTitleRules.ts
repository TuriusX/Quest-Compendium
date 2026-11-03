/**
 * The search title trials' rules (owner, Nov 3 2026), pure so tests can replay them; searchTitles.ts does the work.
 *
 * Pages with many impressions and few clicks get a clearer title and description, each compared with itself: the 28 days
 * before the change against 28 days after it. A change stays only if clicks didn't drop. English pages only: translated
 * pages keep their own titles, so their numbers are left out.
 */
export const TRIAL_PAGES = 20;
export const NEW_A_NIGHT = 5;
export const MIN_IMPRESSIONS = 100;
export const MAX_CTR = 0.01;
export const MAX_POSITION = 20;
/** Search Console's final data ends about this many days ago. */
export const DATA_LAG_DAYS = 3;
/** Days for Google to pick up a new title: left out of the comparison. */
export const SETTLE_DAYS = 3;
export const WINDOW_DAYS = 28;
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 158;
export const BRAND = ' | Quest Compendium';

export type Numbers = { impressions: number; clicks: number; position: number };
export type Range = { start: string; end: string };
export type Trial = {
  key: string; slug: string; name: string; game: string;
  title: string; description: string; oldTitle: string; oldDescription: string;
  queries: string[]; day: string; before: Numbers & Range;
  after?: Numbers & Range & { days: number };
  status: 'testing' | 'kept' | 'put back'; decidedAt?: number;
};
export type PageNumbers = Numbers & { key: string; slug: string; ctr: number };

export const trialId = (t: { key: string; slug: string }) => `${t.key}/${t.slug}`;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const ctrOf = (n: { impressions: number; clicks: number }) => (n.impressions ? n.clicks / n.impressions : 0);
export const latestData = (today: string) => addDays(today, -DATA_LAG_DAYS);

/** The 28 days before a change made today: the newest data there is. */
export function beforeWindow(today: string): Range {
  const end = latestData(today);
  return { start: addDays(end, 1 - WINDOW_DAYS), end };
}
export function afterWindow(day: string): Range {
  const start = addDays(day, SETTLE_DAYS);
  return { start, end: addDays(start, WINDOW_DAYS - 1) };
}
/** The whole after window has final data. */
export const isDue = (day: string, today: string) => afterWindow(day).end <= latestData(today);

/** The pages with the most impressions among those people rarely click; a page is tried once. */
export function pickPages<T extends PageNumbers>(pages: T[], tried: Set<string>, slots: number): T[] {
  return pages
    .filter((p) => p.impressions >= MIN_IMPRESSIONS && p.ctr <= MAX_CTR && p.position <= MAX_POSITION && !tried.has(trialId(p)))
    .sort((a, b) => b.impressions - a.impressions || a.ctr - b.ctr)
    .slice(0, Math.max(0, slots));
}

/** Rows by day and page, added up over a range (position weighted by impressions). */
export function sumRange(rows: { day: string; id: string; clicks: number; impressions: number; position: number }[], id: string, range: Range): Numbers {
  let impressions = 0, clicks = 0, weighted = 0;
  for (const r of rows) {
    if (r.id !== id || r.day < range.start || r.day > range.end) continue;
    impressions += r.impressions; clicks += r.clicks; weighted += r.position * r.impressions;
  }
  return { impressions, clicks, position: impressions ? Math.round((weighted / impressions) * 10) / 10 : 0 };
}

/** The owner's rule: a change stays only if clicks didn't drop. */
export const verdict = (before: { clicks: number }, after: { clicks: number }): 'kept' | 'put back' => (after.clicks < before.clicks ? 'put back' : 'kept');

/** What publish.ts uses: the changes on trial or kept, by page. */
export function liveTitles(trials: Record<string, Trial> | undefined): Record<string, { title: string; description: string }> {
  const out: Record<string, { title: string; description: string }> = {};
  for (const [id, t] of Object.entries(trials || {})) if (t.status !== 'put back') out[id] = { title: t.title, description: t.description };
  return out;
}
export const withBrand = (title: string) => (title.length + BRAND.length <= TITLE_MAX ? `${title}${BRAND}` : title);

// ---------------------------------------------------------------- accuracy

const OVERSELLS = /!|…|\.\.\.|#1|\b(best|ultimate|complete|definitive|everything|every|all|amazing|must|easy|easily|quick|quickly|fast|free|shocking|insane|perfect|guaranteed|exclusive)\b/i;
/** Words that claim nothing about the page. */
const PLAIN = new Set('a an and the of in on at to for from with by or as is are it its how where what who when which this that these those you your find get reach guide location located see plus their them they his her he she about also both can into page covers explains lists shows including'.split(' '));
const SKIP_KEYS = new Set(['sources', 'source', 'images', 'image', 'picture', 'pictures', 'flagship', 'review', 'claims', 'evidence', 'updatedFrom', 'status', 'slug', 'id', 'seoTitle', 'seoDescription']);
/** What a page can promise in plain lower case: a description's other lower-case words are ordinary verbs and links. */
const PROMISES = /^(walkthrough|step|steps|shop|shops|merchant|merchants|vendor|vendors|boss|bosses|loot|treasure|map|maps|collectible|collectibles|missable|missables|romance|ending|endings|fate|weapon|weapons|armor|quest|quests|mission|missions|choice|choices|reward|rewards|achievement|achievements|trophy|trophies|recipe|recipes|puzzle|puzzles)$/;
const wordsIn = (s: string): string[] => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const stem = (w: string) => w.replace(/(ies|es|s)$/, '');

/** Every word a page's stored text uses, and the names of the parts it really has ("whereToFind" counts only when filled). */
export function pageWords(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const w of wordsIn(v)) out.add(stem(w));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (SKIP_KEYS.has(k) || x === '' || x == null || (Array.isArray(x) && !x.length)) continue;
        for (const w of wordsIn(k.replace(/([a-z])([A-Z])/g, '$1 $2'))) out.add(stem(w));
        walk(x);
      }
    }
  };
  walk(doc);
  return out;
}

/** A game's short form people search ("rdr2", "bg3") isn't in the page's text: a query's word with a digit counts. */
const shortForms = (queries: string[]) => new Set(queries.flatMap((q) => wordsIn(q)).filter((w) => /\d/.test(w) && /[a-z]/.test(w)));

/**
 * What's wrong with a rewrite, empty when it may go live. The length, the page's name and game in the title, nothing
 * overselling, and no word the page, its game or its name doesn't back: a title can't promise what isn't there.
 */
export function rewriteProblems(r: { title: string; description: string }, p: { name: string; game: string; oldTitle: string; queries: string[]; words: Set<string> }): string[] {
  const out: string[] = [];
  const title = String(r.title || '').trim(), description = String(r.description || '').trim();
  if (title.length < 15 || title.length > TITLE_MAX) out.push(`the title must be 15-${TITLE_MAX} characters (it has ${title.length})`);
  if (description.length < 70 || description.length > DESCRIPTION_MAX) out.push(`the description must be 70-${DESCRIPTION_MAX} characters (it has ${description.length})`);
  if (title === p.oldTitle.replace(BRAND, '')) out.push('the title is the same as before');
  const flat = (s: string) => wordsIn(s).join(' ');
  const name = p.name.replace(/\s*\(.*?\)\s*/g, ' ');
  if (!` ${flat(title)} `.includes(` ${flat(name)} `)) out.push(`the title must contain the page's name, "${name.trim()}"`);
  const short = shortForms(p.queries);
  const gameWords = wordsIn(p.game);
  const nameWords = new Set(wordsIn(name));
  if (!wordsIn(title).some((w) => short.has(w) || (w.length >= 4 && gameWords.includes(w) && !nameWords.has(w)))) out.push('the title must name the game');
  const over = `${title} ${description}`.match(OVERSELLS);
  if (over) out.push(`no overselling ("${over[0]}")`);
  const backed = new Set([...gameWords, ...wordsIn(p.name)].map(stem));
  // The title's every word; in the description names, numbers and promises (a sentence's first word only as a promise).
  const claims = description.split(/(?<=[.?])\s+/).flatMap((s) => (s.match(/[\p{L}\p{N}]+/gu) || []).filter((w, i) => PROMISES.test(w.toLowerCase()) || (i > 0 && /^\p{Lu}|\p{N}/u.test(w)))).map((w) => w.toLowerCase());
  const unbacked = [...new Set([...wordsIn(title), ...claims])].filter((w) => !PLAIN.has(w) && !short.has(w) && !backed.has(stem(w)) && !p.words.has(stem(w)));
  if (unbacked.length) out.push(`not on the page: ${unbacked.slice(0, 8).join(', ')}`);
  return out;
}

// ---------------------------------------------------------------- Monday

const pct = (n: { impressions: number; clicks: number }) => `${(ctrOf(n) * 100).toFixed(2)}%`;

/** Monday's lines: every page on trial, and what was decided this week. */
export function trialLines(trials: Record<string, Trial> | undefined, now = Date.now()): string[] {
  const all = Object.values(trials || {});
  if (!all.length) return [];
  const testing = all.filter((t) => t.status === 'testing');
  const week = all.filter((t) => t.status !== 'testing' && Number(t.decidedAt || 0) > now - 7 * 86_400_000);
  const compare = (t: Trial) => t.after?.days
    ? `click rate ${pct(t.before)} → ${pct(t.after)}, clicks ${t.before.clicks} in ${WINDOW_DAYS} days → ${t.after.clicks} in ${t.after.days}, impressions ${t.before.impressions} → ${t.after.impressions}`
    : `click rate ${pct(t.before)}, ${t.before.clicks} clicks of ${t.before.impressions} before; no data after the change yet`;
  return [
    `🔤 Search titles: ${testing.length} page(s) on trial, ${all.filter((t) => t.status === 'kept').length} kept, ${all.filter((t) => t.status === 'put back').length} put back in all. A change stays if clicks don't drop after ${WINDOW_DAYS} days (English pages).`,
    ...testing.map((t) => `• ${t.name} (${t.game}): ${compare(t)}.`),
    ...week.map((t) => `${t.status === 'kept' ? '✅ Kept' : '↩️ Put back'}: ${t.name} (${t.game}): ${compare(t)}.`),
  ];
}
