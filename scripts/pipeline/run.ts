/**
 * The guide pipeline: finds games worth a guide, builds, upgrades and translates guides within a monthly budget,
 * publishes the website, and posts a summary. Meant to run on a schedule as a Cloud Run job (see DEPLOY notes in
 * scripts/pipeline/README.md), but it also runs on your PC:   npx tsx scripts/pipeline/run.ts [--dry-run]
 *
 * Each run:
 *   1. Finds candidates: games players ask about (gameStats, from the server) and popular RPG/adventure releases on
 *      Steam (new releases and top sellers).
 *   2. Plans a few actions, most valuable first:
 *        - a guide for a game players use that has none (quick mode for older games; a game the AI barely knows, or a
 *          new release, gets the careful search-backed mode)
 *        - a guide for a trending new release (careful mode, since the AI doesn't know new games)
 *        - a second pass on new-release guides 3+ weeks later, when wikis have filled in
 *        - upgrading quick pages of games players use to checked pages
 *        - an achievement guide and roadmap for games players use and the featured guides
 *        - translating guides of games players use into the languages they play in, then into the other languages
 *   3. Runs them with the existing scripts, inside the budget, then publishes the site and deploys it to Netlify.
 *   4. Posts a summary to Discord (if DISCORD_WEBHOOK_URL is set) and saves the month's totals in system/pipeline.
 *      The summary starts with yesterday's activity: questions, signed-in players vs guests, which apps, and sign-ups.
 *
 * Settings (environment variables; all optional):
 *   PIPELINE_MONTHLY_AI_DOLLARS   AI spending cap per month (default 10)
 *   PIPELINE_MONTHLY_SEARCHES     searches the pipeline may use per month (default 1500)
 *   PIPELINE_PLAYER_RESERVE       searches always left for players under MONTHLY_SEARCH_CAP (default 2000)
 *   MONTHLY_SEARCH_CAP            the app's whole monthly search cap (default 5000; same setting as the server)
 *   PIPELINE_MAX_ACTIONS          actions per run (default 6)
 *   PIPELINE_WISHLIST_SLOTS       of those, kept for wish-list guides while the wish list has games (default 2)
 *   PIPELINE_FEATURED_LANGS       languages for the featured guides before players ask (default es,pt)
 *   PIPELINE_MIN_PLAYERS          players before a game counts as in demand (default 3)
 *   PIPELINE_LANGS                languages to translate into (default es,pt,de,fr,ru,ja,ko,zh)
 *   PIPELINE_FEATURED             guides to translate into every language even before players ask, separated by |
 *                                 (default: the five checked guides: FF VI, Chrono Trigger, DQ XI, BG3, The Witcher 3)
 *   NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID   to deploy the website (skipped if missing)
 *   DISCORD_WEBHOOK_URL           where the summary goes (skipped if missing)
 * Off switch: set `enabled: false` on system/pipeline in Firestore (or PIPELINE_ENABLED=false).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db, gameKey } from '../guides/common';
import { getAuth } from 'firebase-admin/auth';
import { deployToNetlify } from './netlify';
import { steamCandidates } from './steam';

const env = (k: string, d: number) => (Number.isFinite(Number(process.env[k])) && process.env[k] !== '' ? Number(process.env[k]) : d);
const DRY = process.argv.includes('--dry-run');
const AI_CAP = env('PIPELINE_MONTHLY_AI_DOLLARS', 10);
const SEARCH_CAP = env('PIPELINE_MONTHLY_SEARCHES', 1500);
const RESERVE = env('PIPELINE_PLAYER_RESERVE', 2000);
const APP_CAP = env('MONTHLY_SEARCH_CAP', 5000);
const MAX_ACTIONS = env('PIPELINE_MAX_ACTIONS', 6); // most actions are cheap now (see the plan order below)
const WISH_SLOTS = Math.min(env('PIPELINE_WISHLIST_SLOTS', 2), MAX_ACTIONS);
const MIN_PLAYERS = env('PIPELINE_MIN_PLAYERS', 3);
const LANGS = (process.env.PIPELINE_LANGS || 'es,pt,de,fr,ru,ja,ko,zh').split(',').map((s) => s.trim()).filter(Boolean);
const LANG_BY_NAME: Record<string, string> = {
  Spanish: 'es', 'Brazilian Portuguese': 'pt', German: 'de', French: 'fr', Russian: 'ru', Japanese: 'ja', Korean: 'ko', 'Simplified Chinese': 'zh',
};
const DAY = 86_400_000;
/** Languages the featured guides go into before players ask (the biggest non-English audiences; others on demand). */
const FEATURED_LANGS = (process.env.PIPELINE_FEATURED_LANGS || 'es,pt').split(',').map((s) => s.trim()).filter(Boolean);
/** Games to add as quick guides, a couple per run (scripts/pipeline/wishlist.txt, one Steam name per line). */
function wishlist(): string[] {
  try {
    return fs
      .readFileSync(path.resolve('scripts/pipeline/wishlist.txt'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
const FEATURED = (process.env.PIPELINE_FEATURED ||
  'FINAL FANTASY VI|CHRONO TRIGGER®|DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition|Baldur\'s Gate 3|The Witcher 3: Wild Hunt - Complete Edition')
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean);

type Action = { kind: 'build' | 'build-checked' | 'revisit' | 'upgrade' | 'translate' | 'achievements'; game: string; key: string; lang?: string; searches: number; why: string; wish?: boolean };

/** Run one of the guide scripts and read what it spent from its summary line. */
function runScript(args: string[]): { ok: boolean; searches: number; dollars: number; summary: string } {
  console.log(`$ npx tsx ${args.join(' ')}`);
  const r = spawnSync('npx', ['tsx', ...args], { encoding: 'utf8', timeout: 45 * 60_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  process.stdout.write(out.slice(-4000));
  const searches = Number((out.match(/(\d+) searches used/) || [])[1] || 0);
  // The number ends at its last digit ("≈ $0.178." must not read as "0.178.", which would make the total NaN).
  const dollars = Number((out.match(/cost ≈ \$(\d+(?:\.\d+)?)/i) || [])[1] || 0);
  // The script's "Done" line, without the "Done." prefix and its "Next: …" hint.
  const summary = (out.match(/^Done[^\n]*$/m) || [''])[0].replace(/^Done[.:]?\s*/, '').replace(/\s*Next:.*$/, '').slice(0, 300);
  return { ok: r.status === 0, searches, dollars, summary };
}

async function appSearchesThisMonth(month: string): Promise<number> {
  const d = (await db().collection('system').doc('searchBudget').get()).data();
  return d?.month === month ? Number(d.count || 0) : 0;
}

async function main() {
  const month = new Date().toISOString().slice(0, 7);
  const stateRef = db().collection('system').doc('pipeline');
  const state: any = (await stateRef.get()).data() || {};
  if (state.month !== month) Object.assign(state, { month, dollars: 0, searches: 0 });
  // A total that isn't a number (an earlier bad read) would switch the budget check off, so it counts as 0.
  if (!Number.isFinite(state.dollars)) state.dollars = 0;
  if (!Number.isFinite(state.searches)) state.searches = 0;
  const enabled = state.enabled !== false && process.env.PIPELINE_ENABLED !== 'false';
  const report: string[] = [];
  if (!enabled) {
    console.log('The guide pipeline is switched off (system/pipeline.enabled is false). Nothing to do.');
    process.exit(0);
  }

  // ---- 1. candidates ----
  const stats = (await db().collection('gameStats').get()).docs.map((d) => ({ key: d.id, ...(d.data() as any) }));
  // A name gameKey can't turn into a key (no Latin letters or digits, e.g. a game listed only in Chinese) is skipped.
  const demand = stats
    .filter((s) => s.game && gameKey(String(s.game)))
    .map((s) => ({ ...s, playerCount: Array.isArray(s.players) ? s.players.length : 0 }))
    .filter((s) => s.playerCount >= MIN_PLAYERS)
    .sort((a, b) => b.playerCount - a.playerCount || (b.questions || 0) - (a.questions || 0));
  let trending: { name: string; released: number; isNew: boolean }[] = [];
  try {
    trending = (await steamCandidates()).filter((t) => gameKey(t.name));
  } catch (e: any) {
    console.warn(`Steam lists unavailable: ${e?.message}`);
  }

  // What each candidate's guide looks like now.
  const guideCache = new Map<string, any>();
  const guideInfo = async (game: string) => {
    const key = gameKey(game);
    if (guideCache.has(key)) return guideCache.get(key);
    const ref = db().collection('guides').doc(key);
    const info = (await ref.get()).data();
    let published = 0, quick = 0;
    if (info) {
      const snap = await ref.collection('areas').where('status', '==', 'published').get();
      published = snap.size;
      quick = snap.docs.filter((d) => d.data().verified === false && !d.data().upgradeTried).length;
    }
    const g = { key, info, published, quick, languages: (info?.languages || []) as string[], pipeline: info?.pipeline || {}, hasAch: !!info?.hasAchievements };
    guideCache.set(key, g);
    return g;
  };

  // ---- 2. plan ----
  const plan: Action[] = [];
  const planned = new Set<string>();
  const add = (a: Action) => {
    const id = `${a.kind}:${a.key}:${a.lang || ''}`;
    if (planned.has(id)) return;
    planned.add(id);
    plan.push(a);
  };
  for (const s of demand) {
    const g = await guideInfo(s.game);
    if (!g.published) {
      // A game the AI barely knew in quick mode (few pages came out) gets the careful mode next.
      if (g.pipeline.quickTried) add({ kind: 'build-checked', game: s.game, key: g.key, searches: 400, why: `${s.playerCount} players use it; the quick guide came out thin` });
      else add({ kind: 'build', game: s.game, key: g.key, searches: 0, why: `${s.playerCount} players use it and it has no guide` });
    }
  }
  for (const t of trending) {
    const g = await guideInfo(t.name);
    if (!g.published && t.isNew) add({ kind: 'build-checked', game: t.name, key: g.key, searches: 400, why: 'a popular new release on Steam' });
    else if (!g.published) add({ kind: 'build', game: t.name, key: g.key, searches: 0, why: 'a popular game on Steam with no guide' });
    else if (g.pipeline.newRelease && !g.pipeline.revisited && Date.now() - (g.pipeline.builtAt || 0) > 21 * DAY)
      add({ kind: 'revisit', game: t.name, key: g.key, searches: 300, why: 'a new-release guide, 3 weeks on: more is known now' });
  }
  // The rest, most content per dollar first:
  //   achievement guides (a couple of cents each, popular searches) -> quick guides for wish-list games (a few cents,
  //   no searches) -> upgrades for games players use (searches) -> translations players actually need -> featured
  //   guides in the biggest languages.
  const allGuides = (await db().collection('guides').get()).docs;
  const demandFirst = [...demand.map((d) => gameKey(d.game)), ...FEATURED.map((f) => gameKey(f))];
  const byPriority = allGuides.slice().sort((a, b) => {
    const ia = demandFirst.indexOf(a.id), ib = demandFirst.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  for (const d of byPriority) {
    const info = d.data();
    if (info.appId && !info.hasAchievements && !info.pipeline?.achTried)
      add({ kind: 'achievements', game: String(info.game || d.id), key: d.id, searches: 40, why: 'an achievement guide and roadmap' });
  }
  const have = new Set(allGuides.map((d) => d.id));
  let wished = 0;
  for (const name of wishlist()) {
    if (wished >= WISH_SLOTS) break;
    if (have.has(gameKey(name))) continue;
    add({ kind: 'build', game: name, key: gameKey(name), searches: 0, why: 'from the wish list', wish: true });
    wished++;
  }
  for (const s of demand) {
    const g = await guideInfo(s.game);
    if (g.quick > 0) add({ kind: 'upgrade', game: s.game, key: g.key, searches: Math.min(400, g.quick * 6), why: `${s.playerCount} players use it; ${g.quick} quick pages to check` });
  }
  // Translations only where they're wanted: the languages players use for that game.
  for (const s of demand) {
    const g = await guideInfo(s.game);
    if (!g.published) continue;
    const used = Object.entries((s.languages || {}) as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => LANG_BY_NAME[name])
      .filter((c): c is string => !!c && LANGS.includes(c));
    for (const lang of used) if (!g.languages.includes(lang)) add({ kind: 'translate', game: s.game, key: g.key, lang, searches: 0, why: 'players use this game in this language' });
  }
  // Featured guides in the biggest languages (PIPELINE_FEATURED_LANGS), for people searching in their own language.
  for (const name of FEATURED) {
    const g = await guideInfo(name);
    if (!g.published) continue;
    for (const lang of FEATURED_LANGS) if (!g.languages.includes(lang)) add({ kind: 'translate', game: g.info?.game || name, key: g.key, lang, searches: 0, why: 'a featured guide, for people searching in this language' });
  }

  // ---- 3. run, inside the budget ----
  const appUsed = await appSearchesThisMonth(month);
  let searchRoom = Math.min(SEARCH_CAP - (state.searches || 0), APP_CAP - RESERVE - appUsed);
  let aiRoom = AI_CAP - (state.dollars || 0);
  console.log(`Budget: ${Math.max(0, searchRoom)} searches and $${Math.max(0, aiRoom).toFixed(2)} of AI left for the pipeline this month. ${plan.length} candidate action(s).`);
  let changed = false, done = 0;
  // Wish-list guides have their own slots, so the long queue of achievement guides doesn't hold them back; slots the
  // wish list can't fill (it ran out) go to everything else.
  const otherSlots = MAX_ACTIONS - Math.min(WISH_SLOTS, plan.filter((a) => a.wish).length);
  let others = 0;
  for (const a of plan) {
    if (done >= MAX_ACTIONS) break;
    if (!a.wish && others >= otherSlots) continue;
    if (aiRoom < 0.25) {
      report.push('Stopped: the monthly AI budget is used up.');
      break;
    }
    if (a.searches > 0 && a.searches > searchRoom) continue; // try cheaper actions instead
    console.log(`\n▶ ${a.kind} ${a.game}${a.lang ? ` (${a.lang})` : ''}: ${a.why}`);
    if (DRY) {
      report.push(`(dry run) would ${a.kind} ${a.game}${a.lang ? ` → ${a.lang}` : ''}: ${a.why}`);
      done++;
      if (!a.wish) others++;
      continue;
    }
    let r = { ok: false, searches: 0, dollars: 0, summary: '' };
    const g = await guideInfo(a.game);
    const guideRef = db().collection('guides').doc(g.key);
    if (a.kind === 'build') {
      r = runScript(['scripts/guides/build.ts', '--game', a.game, '--part', 'the whole game, in story order', '--areas', '40', '--quick', '--auto-publish']);
      const after = await db().collection('guides').doc(g.key).collection('areas').where('status', '==', 'published').get();
      await guideRef.set({ pipeline: { ...g.pipeline, quickTried: true, builtAt: Date.now() } }, { merge: true });
      if (after.size < 5) report.push(`${a.game}: the quick guide came out thin (${after.size} pages); it gets the careful mode next time.`);
    } else if (a.kind === 'build-checked' || a.kind === 'revisit') {
      const cap = Math.min(a.searches, Math.max(50, searchRoom));
      r = runScript(['scripts/guides/build.ts', '--game', a.game, '--part', a.kind === 'revisit' ? 'the whole game, especially areas not covered yet' : 'the main story, in order', '--areas', '25', '--max-searches', String(cap), '--auto-publish']);
      await guideRef.set({ pipeline: { ...g.pipeline, newRelease: g.pipeline.newRelease || a.kind === 'build-checked', builtAt: g.pipeline.builtAt || Date.now(), ...(a.kind === 'revisit' ? { revisited: Date.now() } : {}) } }, { merge: true });
    } else if (a.kind === 'upgrade') {
      r = runScript(['scripts/guides/build.ts', '--game', a.game, '--upgrade', '--max-searches', String(Math.min(a.searches, Math.max(50, searchRoom)))]);
    } else if (a.kind === 'achievements') {
      r = runScript(['scripts/guides/achievements.ts', '--game', a.game, '--max-searches', String(Math.min(120, Math.max(30, searchRoom)))]);
      // Not every game has Steam achievements; don't keep retrying one that failed.
      if (!r.ok) await guideRef.set({ pipeline: { ...g.pipeline, achTried: Date.now() } }, { merge: true });
    } else if (a.kind === 'translate') {
      r = runScript(['scripts/guides/translate-guide.ts', '--game', a.game, '--lang', a.lang!]);
    }
    state.searches = (state.searches || 0) + r.searches;
    state.dollars = (state.dollars || 0) + r.dollars;
    searchRoom -= r.searches;
    aiRoom -= r.dollars;
    changed = changed || r.ok;
    done++;
    if (!a.wish) others++;
    report.push(`${r.ok ? '✅' : '⚠️'} ${a.kind} **${a.game}**${a.lang ? ` → ${a.lang}` : ''}: ${a.why}. ${r.summary || (r.ok ? '' : 'failed (see the job log)')}`.trim());
    guideCache.delete(g.key);
  }
  if (!done) report.push('Nothing to do within the budget this run.');

  // ---- 4. publish and deploy ----
  if (changed && !DRY) {
    runScript(['scripts/guides/steam-ids.ts']); // new guides get their Steam id (for game art); no AI, no cost
    const p = runScript(['scripts/guides/publish.ts']);
    report.push(p.ok ? '🌐 Website rebuilt.' : '⚠️ Rebuilding the website failed (see the job log).');
    if (p.ok && process.env.NETLIFY_AUTH_TOKEN && process.env.NETLIFY_SITE_ID) {
      try {
        const n = await deployToNetlify('Marketing_Website_Files', process.env.NETLIFY_SITE_ID, process.env.NETLIFY_AUTH_TOKEN);
        report.push(`🚀 Deployed to Netlify (${n.uploaded} changed file(s) uploaded).`);
      } catch (e: any) {
        report.push(`⚠️ Netlify deploy failed: ${e?.message}`);
      }
    } else if (p.ok) report.push('(Netlify settings missing, so the site was rebuilt but not deployed.)');
  }

  // ---- 5. yesterday's activity (stats/{day} from the server) and sign-ups (Firebase Auth) ----
  try {
    const day = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const st: any = (await db().collection('stats').doc(day).get()).data() || {};
    const players = Array.isArray(st.players) ? st.players.length : 0;
    const guests = Array.isArray(st.guests) ? st.guests.length : 0;
    const apps = Object.entries((st.apps || {}) as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    let accounts = 0, newAccounts = 0, pageToken: string | undefined;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      accounts += page.users.length;
      newAccounts += page.users.filter((u) => Date.now() - Date.parse(u.metadata.creationTime) < 86_400_000).length;
      pageToken = page.pageToken;
    } while (pageToken);
    report.unshift(
      `📊 Yesterday: ${st.questions || 0} question(s) from ${players + guests} player(s) (${players} signed in, ${guests} guest${guests === 1 ? '' : 's'})${apps ? ` · ${apps}` : ''} · ${newAccounts} new sign-up(s), ${accounts} accounts in total`,
    );
  } catch (e: any) {
    console.warn(`Activity summary skipped: ${e?.message}`);
  }

  state.lastRun = Date.now();
  state.lastReport = report;
  if (!DRY) await stateRef.set(state, { merge: true });
  const footer = `This month: ${state.searches || 0}/${SEARCH_CAP} pipeline searches, $${(state.dollars || 0).toFixed(2)}/$${AI_CAP} AI.`;
  const text = `**Quest Compendium guide pipeline**${DRY ? ' (dry run)' : ''}\n${report.map((l) => `• ${l}`).join('\n')}\n${footer}`;
  console.log(`\n${text}`);
  if (process.env.DISCORD_WEBHOOK_URL && !DRY) {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    }).catch((e) => console.warn(`Discord post failed: ${e?.message}`));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Pipeline failed:', e?.message || e);
  process.exit(1);
});
