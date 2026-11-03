/**
 * Search titles, nightly (owner, Nov 3 2026): up to 5 pages a night, 20 on trial at a time, get a clearer title and
 * description from what the page really has; each is compared with itself after 28 days and stays only if clicks didn't
 * drop (searchTitleRules.ts). The changes live in system/searchTitles, apart from the pages, so a rebuild can't lose one
 * and putting one back is removing it: publish.ts uses them on the English pages.
 *
 *   npx tsx scripts/pipeline/searchTitles.ts           the pipeline runs it (Search Console's token: Cloud Run only)
 *   options: --dry      change nothing and only print the rewrites
 *            --stored   with --dry: last week's saved figures, so it also runs on a PC (top 50 pages, all languages)
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson } from '../guides/common';
import { shortGame, searchName } from '../guides/siteText';
import { token, findSite, pullRows, pageRefOf, summarise } from './searchConsole';
import {
  TRIAL_PAGES, NEW_A_NIGHT, TITLE_MAX, DESCRIPTION_MAX, BRAND, trialId, addDays, latestData, beforeWindow, afterWindow, isDue, pickPages, sumRange, verdict, pageWords, rewriteProblems,
  type Trial, type PageNumbers,
} from './searchTitleRules';

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'https://questcompendium.com';
const dry = arg('dry') === 'true';
const stored = dry && arg('stored') === 'true';
const ref = () => db().collection('system').doc('searchTitles');

/** Each English guide page's numbers by day. */
async function pullDays(tok: string, site: string, start: string, end: string) {
  const out: { day: string; id: string; clicks: number; impressions: number; position: number }[] = [];
  for (let startRow = 0; startRow < 500_000; startRow += 25_000) {
    const r = await fetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date', 'page'], rowLimit: 25_000, startRow, dataState: 'final' }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Search Console query: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const rows: any[] = j.rows || [];
    for (const x of rows) {
      const p = pageRefOf(String(x.keys[1]));
      if (p?.slug && p.lang === 'en') out.push({ day: String(x.keys[0]), id: `${p.key}/${p.slug}`, clicks: x.clicks || 0, impressions: x.impressions || 0, position: x.position || 0 });
    }
    if (rows.length < 25_000) break;
  }
  return out;
}

/** The title and description the page shows now; null unless it's really there (a held page redirects). */
async function liveMeta(key: string, slug: string) {
  const r = await fetch(`${SITE}/guides/${key}/${slug}/`, { redirect: 'manual' }).catch(() => null);
  if (!r || r.status !== 200) return null;
  const html = await r.text();
  const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1], description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  return title ? { title: unescape(title), description: unescape(description || '') } : null;
}

/** The page's stored data, as publish.ts would show it. */
async function pageDoc(key: string, slug: string): Promise<{ doc: any; name: string } | null> {
  const area: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
  if (area?.status === 'published') return { doc: area, name: String(area.name || slug) };
  const ent: any = (await db().collection('guideCompendium').doc(key).collection('entities').doc(slug).get()).data();
  return ent?.status === 'published' ? { doc: ent, name: searchName(ent) } : null;
}

const facts = (doc: any) => JSON.stringify(doc, (k, v) => (['sources', 'images', 'picture', 'flagship', 'review', 'claims', 'evidence', 'seoTitle', 'seoDescription'].includes(k) ? undefined : v)).slice(0, 9000);

async function rewrite(p: { name: string; game: string; old: { title: string; description: string }; queries: { query: string; impressions: number }[]; doc: any }, problems: string[]) {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `A page of a player's guide on questcompendium.com, about "${p.name}" in "${p.game}". It shows up on Google but people rarely click it.`,
      'What they search for (impressions in 28 days):',
      ...p.queries.map((q) => `- "${q.query}" (${q.impressions})`),
      `Its title now: ${p.old.title}`,
      `Its description now: ${p.old.description}`,
      `The page's data: ${facts(p.doc)}`,
      '',
      'Write a search title and description that match what these people look for and say plainly what is on this page.',
      `Title: at most ${TITLE_MAX - 5} characters, the page's name exactly as "${p.name}" first, then the game (a short form they search is fine), then what the page answers in the plain words people search (such as Location, Walkthrough, Quests, Where to Find), not one small detail from it.`,
      `Description: at most ${DESCRIPTION_MAX - 18} characters, one or two plain sentences on what the page tells them, naming specifics from its data.`,
      'Only promise what the data above really has, in its own words; a search with no answer on the page is ignored. No hype, no superlatives ("best", "complete", "every"), no exclamation marks, no keyword lists, no site name.',
      ...(problems.length ? ['', `Your last try was refused: ${problems.join('; ')}.`] : []),
      'Reply with JSON only: {"title": "...", "description": "..."}',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseJson(String(res?.text || '')) || {};
  return { title: String(j.title || '').trim(), description: String(j.description || '').trim() };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const st: any = (await ref().get()).data() || {};
  const trials: Record<string, Trial> = st.trials || {};
  const testing = () => Object.values(trials).filter((t) => t.status === 'testing');
  let kept = 0, putBack = 0, written = 0, refused = 0;

  // The trials' numbers: on Mondays for the summary, and when one is due.
  const tok = stored ? '' : await token();
  const site = stored ? '' : await findSite(tok);
  const started = testing().filter((t) => afterWindow(t.day).start <= latestData(today));
  if (!stored && started.length && (new Date().getUTCDay() === 1 || started.some((t) => isDue(t.day, today)))) {
    const from = started.map((t) => afterWindow(t.day).start).sort()[0];
    const rows = await pullDays(tok, site, from, latestData(today));
    for (const t of started) {
      const w = afterWindow(t.day);
      const end = w.end < latestData(today) ? w.end : latestData(today);
      t.after = { ...sumRange(rows, trialId(t), { start: w.start, end }), start: w.start, end, days: Math.round((Date.parse(end) - Date.parse(w.start)) / 86_400_000) + 1 };
      if (isDue(t.day, today)) {
        t.status = verdict(t.before, t.after);
        t.decidedAt = Date.now();
        if (t.status === 'kept') kept++; else putBack++;
        console.log(`${t.status}: ${trialId(t)}: clicks ${t.before.clicks} → ${t.after.clicks}`);
      }
    }
  }

  // New pages for the free places.
  const slots = Math.min(NEW_A_NIGHT, TRIAL_PAGES - testing().length);
  const waiting: Record<string, string> = st.refused || {};
  if (slots > 0) {
    const window = beforeWindow(today);
    let pages: PageNumbers[], queriesOf: (id: string) => { query: string; impressions: number }[];
    if (stored) {
      const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
      pages = sc.topPages || [];
      queriesOf = (id) => { const p: any = pages.find((x) => trialId(x) === id); return p?.topQuery ? [{ query: p.topQuery, impressions: p.impressions }] : []; };
    } else {
      const sum = summarise((await pullRows(tok, site, window.start, window.end)).filter((r) => pageRefOf(r.page)?.lang === 'en'));
      pages = sum.pages;
      queriesOf = (id) => sum.pages.find((x) => trialId(x) === id)?.queries.slice(0, 8) || [];
    }
    // A rewrite refused twice comes back in a week. A page that isn't live is passed over without an AI call.
    const tried = new Set([...Object.keys(trials), ...Object.keys(waiting).filter((id) => waiting[id] > today)]);
    for (const p of pickPages(pages, tried, pages.length)) {
      if (written + refused >= slots) break;
      const id = trialId(p);
      const found = await pageDoc(p.key, p.slug);
      const old = found && (await liveMeta(p.key, p.slug));
      if (!found || !old) continue;
      const info: any = (await db().collection('guides').doc(p.key).get()).data() || {};
      const game = shortGame(String(info.game || p.key));
      const queries = queriesOf(id);
      const check = { name: found.name, game, oldTitle: old.title, queries: queries.map((q) => q.query), words: pageWords(found.doc) };
      let r = await rewrite({ name: found.name, game, old, queries, doc: found.doc }, []);
      let problems = rewriteProblems(r, check);
      if (problems.length) {
        r = await rewrite({ name: found.name, game, old, queries, doc: found.doc }, problems);
        problems = rewriteProblems(r, check);
      }
      if (problems.length) {
        refused++;
        waiting[id] = addDays(today, 7);
        console.log(`refused: ${id}: ${problems.join('; ')} (last try: ${r.title} | ${r.description})`);
        continue;
      }
      written++;
      console.log(`${id} (${p.impressions} impressions, ${p.clicks} clicks, position ${p.position})\n  was: ${old.title}\n       ${old.description}\n  now: ${r.title}\n       ${r.description}`);
      trials[id] = {
        key: p.key, slug: p.slug, name: found.name, game, title: r.title, description: r.description,
        oldTitle: old.title.replace(BRAND, ''), oldDescription: old.description, queries: check.queries, day: today,
        before: { impressions: p.impressions, clicks: p.clicks, position: p.position, ...window }, status: 'testing',
      };
    }
  }

  if (!dry) await ref().set(JSON.parse(JSON.stringify({ trials, refused: waiting, at: Date.now() })));
  console.log(`Done: search titles: ${written} rewritten, ${refused} refused, ${kept} kept, ${putBack} put back; ${testing().length} on trial.`);
  setTimeout(() => process.exit(0), 300);
}

if (/searchTitles\.ts$/.test(process.argv[1] || '')) {
  main().catch((e) => {
    console.error('Search titles failed:', e?.message || e);
    process.exit(1);
  });
}
