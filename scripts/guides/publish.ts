/**
 * Guide publisher: turns guide pages from the database into website pages in Marketing_Website_Files/guides.
 *
 *   npx tsx scripts/guides/publish.ts --drafts                  preview: include drafts (marked DRAFT) so you can look them over
 *   npx tsx scripts/guides/publish.ts --approve "Final Fantasy VI"   publish that game's drafts, then build
 *   npx tsx scripts/guides/publish.ts                           build published pages only (what goes live)
 *   npx tsx scripts/guides/publish.ts --preview scratchpad/flagship-site --only baldur-s-gate-3
 *                                   a local preview of one game, with its flagship prototypes (guidePrototypes) on
 *                                   their pages, written to that folder only (the website files are not touched)
 *
 * Then upload Marketing_Website_Files to Netlify as usual. Writes one page per area, a page per game, a guides index,
 * sitemap.xml and robots.txt. Pages that were held back by the checks are never published.
 */
import fs from 'fs';
import path from 'path';
import { landscapeOf, wideSet, coverSet, ogImageOf, platformList, type IgdbInfo } from './igdbArt';
import { db, gameKey, arg, cleanEntry, type GuideArea, type GuideEntry } from './common';
import { GUIDE_UI_EN } from './guide-ui';
import { mergeSameSpot } from '../../src/utils/trackerPayload';
import { entityKind, shortGame, relatedQuests, achFlags, ACH_FLAGS, finalLinks, redirectLines, entitySegments, fuzzyScore, chapterPage, coveringPage, singularLabel, type AchFlag } from './siteText';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { GENERATED as GUIDE_UI_GEN } from './guide-ui.generated';
import { waitForGuideLock, isRefusal, lockedLine, releaseGuideLocks, SITE_LOCK } from './guideLock';

// ---- languages ----
// English pages live at /guides/…; a game translated with translate-guide.ts also gets /<lang>/guides/… pages, with
// the page's own words (headings, buttons) from guide-ui.ts / guide-ui.generated.ts.
const LANG_TAG: Record<string, string> = { en: 'en', es: 'es', pt: 'pt-BR', de: 'de', fr: 'fr', ru: 'ru', ja: 'ja', ko: 'ko', zh: 'zh-CN' };
const LANG_LABEL: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português', de: 'Deutsch', fr: 'Français', ru: 'Русский', ja: '日本語', ko: '한국어', zh: '简体中文' };
let LANG = 'en';
let LP = ''; // the language folder for links ("" or "pt/")
let U: Record<string, string> = GUIDE_UI_EN;
function setLang(l: string) {
  LANG = l;
  LP = l === 'en' ? '' : `${l}/`;
  U = { ...GUIDE_UI_EN, ...(GUIDE_UI_GEN[l] || {}) };
}
const ui = (k: string, vars: Record<string, string | number> = {}) => {
  let s = U[k] ?? GUIDE_UI_EN[k] ?? k;
  for (const [n, v] of Object.entries(vars)) s = s.split(`{${n}}`).join(String(v));
  return s;
};
const langPath = (code: string) => (code === 'en' ? '' : `${code}/`);

// ---- game art ----
// Official store art, loaded straight from Steam's image servers (nothing is copied or hosted here). Games not on
// Steam, or whose image fails to load, get a placeholder tile with the game's initials in the site's colors.
// Newer store apps keep their art under a hashed path, so the url steam-ids.ts saved (art) wins when it's for this id.
const ART = new Map<number, string>();
const steamArt = (appId?: number) => (appId ? ART.get(appId) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg` : '');
const initials = (game: string) =>
  game
    .replace(/[™®©]/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .split(/[\s:–—-]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !/^(of|the|and|a|an|to|in|on|for)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
/** Each guide's IGDB data (guides/{key}.igdb, scripts/pipeline/igdb.ts): key art, cover, release, platforms, genres. */
const IGDB = new Map<string, IgdbInfo>();
/** IGDB art and credit on the site: on when config/igdb.site is true, or for a local look (QC_IGDB=1). */
let IGDB_ON = process.env.QC_IGDB === '1';
/** The social share image for a guide's pages: IGDB key art, else Steam's header, else the site icon. */
const ogImageFor = (key?: string, appId?: number) => (key && ogImageOf(IGDB.get(key))) || (appId ? steamArt(appId) : '') || `${SITE}/icon.png`;
const GUIDE_APP = new Map<string, number>();

/**
 * The art for a game, at a fixed shape (460×215, the guide cards' shape), with the placeholder underneath: IGDB's key
 * art (or widest screenshot) at the size the spot needs, else Steam's header art; if an image fails, the next one.
 * hero: the guide front page's header (wider, loaded first).
 */
function artBox(game: string, appId: number | undefined, extra = '', key?: string, hero = false) {
  const placeholder = `<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#a87ffb]/30 via-[#1a1530] to-[#0c0d14]"><span class="text-2xl font-bold text-white/80 tracking-wide">${esc(initials(game))}</span></div>`;
  const ig = key ? landscapeOf(IGDB.get(key)) : null;
  const steam = appId ? steamArt(appId) : '';
  const load = hero ? 'fetchpriority="high"' : 'loading="lazy"';
  const fallback = `onerror="if(this.dataset.fb){this.removeAttribute('srcset');this.src=this.dataset.fb;this.removeAttribute('data-fb')}else this.remove()"`;
  let img = '';
  if (ig) {
    const set = wideSet(ig, hero ? 1920 : 1280);
    img = `<img src="${set.src}" srcset="${set.srcset}" sizes="${hero ? '(min-width: 800px) 768px, 100vw' : '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 92vw'}" alt="${esc(ui('artAlt', { game }))}" ${load} decoding="async" width="460" height="215" class="absolute inset-0 w-full h-full object-cover"${steam ? ` data-fb="${steam}"` : ''} ${fallback}>`;
  } else if (steam) {
    img = `<img src="${steam}" alt="${esc(ui('artAlt', { game }))}" ${load} decoding="async" width="460" height="215" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">`;
  }
  return `<div class="relative aspect-[460/215] overflow-hidden bg-[#0c0d14] ${extra}">${placeholder}${img}</div>`;
}

/**
 * Guide card art (the guides list). QC_CARDS picks a style for a look before choosing:
 *   A  portrait: IGDB's cover (box art, up to 528 px wide), else Steam's portrait library art (600×900, 1200×1800 for
 *      sharp screens)
 *   B  landscape: Steam's large capsule with the logo (616×353), else IGDB's cover on a blurred copy of itself
 * Unset: the key art (artBox). The site's choice is config/igdb.cards ("A" chosen on 2026-10-12); QC_CARDS overrides it.
 */
let CARD_MODE = (process.env.QC_CARDS || '').toUpperCase();
/** Each guide's Steam store art paths (guides/{key}.steamArt, scripts/pipeline/steamArt.ts): capsule, library art, header. */
const STEAM_ART = new Map<string, Record<string, string>>();
/** A Steam store image for an app, from the same folder as its saved art (newer apps keep theirs under a hashed path). */
const steamAsset = (appId: number, file: string) => (ART.get(appId) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`).replace(/header\.jpg(\?.*)?$/, file);
function cardArt(game: string, appId: number | undefined, key: string): string {
  if (CARD_MODE !== 'A' && CARD_MODE !== 'B') return artBox(game, appId, '', key);
  const placeholder = `<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#a87ffb]/30 via-[#1a1530] to-[#0c0d14]"><span class="text-2xl font-bold text-white/80 tracking-wide">${esc(initials(game))}</span></div>`;
  const g = IGDB.get(key);
  const cover = g && !g.missing && g.cover ? coverSet(g.cover) : null;
  const alt = esc(ui('coverAlt', { game }));
  const next = `onerror="if(this.dataset.fb){this.removeAttribute('srcset');this.src=this.dataset.fb;this.removeAttribute('data-fb')}else this.remove()"`;
  if (CARD_MODE === 'A') {
    const sa = STEAM_ART.get(key) || {};
    const steam = sa.library || (appId ? steamAsset(appId, 'library_600x900.jpg') : '');
    const steam2x = sa.library2x || (appId ? steamAsset(appId, 'library_600x900_2x.jpg') : '') || steam;
    const img = cover
      ? `<img src="${cover.src}" srcset="${cover.srcset}" sizes="(min-width: 1024px) 180px, (min-width: 640px) 24vw, 48vw" alt="${alt}" loading="lazy" decoding="async" width="264" height="374" class="absolute inset-0 w-full h-full object-cover"${steam ? ` data-fb="${steam}"` : ''} ${next}>`
      : steam ? `<img src="${steam}" srcset="${steam} 600w, ${steam2x} 1200w" sizes="(min-width: 1024px) 180px, (min-width: 640px) 24vw, 48vw" alt="${alt}" loading="lazy" decoding="async" width="600" height="900" class="absolute inset-0 w-full h-full object-cover" onerror="if(this.srcset){this.removeAttribute('srcset')}else this.remove()">` : '';
    return `<div class="relative aspect-[2/3] overflow-hidden bg-[#0c0d14]">${placeholder}${img}</div>`;
  }
  // B: the cover on a blurred copy of itself (non-Steam games, and under the capsule in case it fails).
  const coverLayer = cover ? `<div class="absolute inset-0"><img src="${cover.src}" alt="" aria-hidden="true" loading="lazy" decoding="async" class="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60"><img src="${cover.src}" srcset="${cover.srcset}" sizes="140px" alt="${alt}" loading="lazy" decoding="async" class="relative mx-auto h-full w-auto py-2 object-contain drop-shadow-lg"></div>` : '';
  const sa = STEAM_ART.get(key) || {};
  const cap = sa.capsule || (appId ? steamAsset(appId, 'capsule_616x353.jpg') : '');
  const capsule = cap ? `<img src="${cap}"${sa.capsule2x ? ` srcset="${cap} 616w, ${sa.capsule2x} 1232w" sizes="(min-width: 1024px) 280px, (min-width: 640px) 45vw, 50vw"` : ''} alt="${alt}" loading="lazy" decoding="async" width="616" height="353" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">` : '';
  return `<div class="relative aspect-[616/353] overflow-hidden bg-[#0c0d14]">${placeholder}${coverLayer}${capsule}</div>`;
}

/** A guide front page's IGDB line: the cover, release year, platforms and genres, and the credit. */
function igdbFacts(key: string, game: string): string {
  const g = IGDB.get(key);
  if (!g || g.missing) return '';
  const year = g.released ? g.released.slice(0, 4) : '';
  const facts = [year, platformList(g.platforms).slice(0, 7).join(', '), (g.genres || []).slice(0, 3).join(', ')].filter(Boolean);
  const cover = g.cover ? (() => { const c = coverSet(g.cover!); return `<img src="${c.src}" srcset="${c.srcset}" sizes="88px" alt="${esc(ui('coverAlt', { game }))}" loading="lazy" decoding="async" width="88" height="125" class="w-[88px] h-[125px] shrink-0 rounded-lg border border-white/10 object-cover">`; })() : '';
  if (!facts.length && !cover) return '';
  return `<div class="mt-4 flex items-start gap-4">${cover}<div class="min-w-0 text-sm text-zinc-400 space-y-1">${facts.map((f) => `<div>${esc(f)}</div>`).join('')}<div class="text-xs text-zinc-500">${igdbCredit()}</div></div></div>`;
}
const igdbCredit = () => !IGDB_ON ? '' : esc(ui('igdbCredit')).replace('{igdb}', '<a href="https://www.igdb.com" class="text-[#a87ffb] hover:underline" rel="noopener">IGDB</a>');

/** Time to beat (IGDB players' submissions): shown only with at least this many submissions (config/igdb.ttbMinCount). */
let TTB_MIN = 5;
/** Time to beat on the site: on when config/igdb.ttbSite is true, or for a local look (QC_TTB=1). */
let TTB_ON = process.env.QC_TTB === '1';
type Ttb = { main: number; extras: number; complete: number; count: number };
/** The game's IGDB time to beat in whole hours (0 = not given), or null when IGDB is off or has too few submissions. */
function ttbOf(key: string): Ttb | null {
  // A local look with sample numbers (QC_TTB_SAMPLE="main,extras,complete,count"), never set on the live site.
  const sample = process.env.QC_TTB_SAMPLE ? process.env.QC_TTB_SAMPLE.split(',').map(Number) : null;
  const t: any = sample ? { main: sample[0], extras: sample[1], complete: sample[2], count: sample[3] } : IGDB_ON && TTB_ON ? IGDB.get(key)?.ttb : null;
  if (!t || (t.count || 0) < TTB_MIN) return null;
  const h = (v: unknown) => (Number(v) >= 1 && Number(v) <= 1000 ? Math.round(Number(v)) : 0);
  const out = { main: h(t.main), extras: h(t.extras), complete: h(t.complete), count: Number(t.count) || 0 };
  // Players' averages can be thrown off by a few wild entries (Baldur's Gate 3: 5,650 h completionist next to 132 h
  // main + extras): a longer category must be at least the shorter one and at most 5 times it, or it's left out.
  const fits = (longer: number, shorter: number) => !shorter || (longer >= shorter && longer <= shorter * 5);
  if (out.extras && !fits(out.extras, out.main)) out.extras = 0;
  if (out.complete && !fits(out.complete, out.extras || out.main)) out.complete = 0;
  return out.main || out.extras || out.complete ? out : null;
}
const hoursLabel = (h: number) => ui(h === 1 ? 'ttbHour' : 'ttbHours', { h });
/** One time-to-beat tile (guide front pages only): a colored bar, the label, the hours. */
const ttbTile = (label: string, h: number, bar: string) =>
  `<div class="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-center"><div class="${bar} whitespace-nowrap px-1 py-1 text-[10px] font-semibold uppercase tracking-normal text-white sm:px-2 sm:text-[11px] sm:tracking-wide">${esc(label)}</div><div class="px-2 py-2.5 text-lg font-bold text-white">${esc(hoursLabel(h))}</div></div>`;
/**
 * A guide front page's time to beat, from IGDB players: Main Story, Main + Extras and Completionist side by side (the
 * ones IGDB has), with how many players' times they come from. Nothing when IGDB has too few submissions.
 */
function ttbFront(key: string): string {
  const t = ttbOf(key);
  if (!t) return '';
  const tiles = [
    t.main ? ttbTile(ui('ttbMain'), t.main, 'bg-[#a87ffb]/45') : '',
    t.extras ? ttbTile(ui('ttbExtras'), t.extras, 'bg-[#a87ffb]/30') : '',
    t.complete ? ttbTile(ui('ttbComplete'), t.complete, 'bg-amber-500/35') : '',
  ].filter(Boolean);
  return `<section class="mt-5" aria-label="${esc(ui('ttbTitle'))}"><h2 class="mb-2 text-sm font-semibold text-zinc-300">${esc(ui('ttbTitle'))}</h2><div class="grid grid-cols-${tiles.length} gap-2">${tiles.join('')}</div><p class="mt-1.5 text-[11px] text-zinc-500">${esc(ui('ttbSource', { n: t.count }))}</p></section>`;
}

/** The achievement guide with a translation merged in: Steam's official names, translated tips and roadmap. */
function localizeAch(ach: any, t: any) {
  const tr = t?.achievements;
  if (!ach || !tr) return null;
  const items = tr.items || {};
  return {
    ...ach,
    list: (ach.list || []).map((a: any) => ({ ...a, ...(items[a.name]?.name ? { name: items[a.name].name } : {}), desc: items[a.name]?.desc ?? a.desc, how: items[a.name]?.how || a.how })),
    roadmap: tr.roadmap ? { ...(ach.roadmap || {}), ...tr.roadmap } : ach.roadmap,
  };
}

/** A page with its translation merged in (ids, flags and order stay from the original). */
function localize(a: GuideArea, t?: any): GuideArea {
  if (!t) return a;
  const merge = (list: any[], tl: any[] | undefined) => list.map((e) => ({ ...e, ...((tl || []).find((x: any) => x?.id === e.id) || {}), id: e.id, missable: e.missable }));
  return {
    ...a,
    name: t.name || a.name,
    story: t.story ?? a.story,
    overview: t.overview ?? a.overview,
    items: merge(a.items, t.items),
    secrets: merge(a.secrets, t.secrets),
    enemies: merge(a.enemies, t.enemies),
    shops: merge(a.shops, t.shops),
    fights: merge(a.fights || [], t.fights),
    ...(a.info && t.info ? { info: { ...a.info, ...t.info, levels: a.info.levels, coords: a.info.coords } } : {}),
    tips: Array.isArray(t.tips) && t.tips.length === (a.tips || []).length ? t.tips : a.tips,
    // Flagship pages: translated words, with the original's ids, entries and fights (by id, options by position).
    ...(a.walkthrough?.length
      ? {
          walkthrough: a.walkthrough.map((st) => {
            const x = (t.walkthrough || []).find((y: any) => y?.id === st.id) || {};
            return { ...st, title: x.title || st.title, text: x.text || st.text, ...(st.tip ? { tip: x.tip || st.tip } : {}), ...(st.warn ? { warn: x.warn || st.warn } : {}) };
          }),
          choices: (a.choices || []).map((c) => {
            const x = (t.choices || []).find((y: any) => y?.id === c.id) || {};
            return { ...c, title: x.title || c.title, when: x.when || c.when, recommended: x.recommended || c.recommended, note: x.note || c.note, options: c.options.map((o, i) => ({ label: x.options?.[i]?.label || o.label, outcome: x.options?.[i]?.outcome || o.outcome })) };
          }),
          ...(a.advice ? { advice: { matters: t.advice?.matters?.length === a.advice.matters.length ? t.advice.matters : a.advice.matters, skip: t.advice?.skip?.length === a.advice.skip.length ? t.advice.skip : a.advice.skip, mistakes: t.advice?.mistakes?.length === a.advice.mistakes.length ? t.advice.mistakes : a.advice.mistakes } } : {}),
        }
      : {}),
    sections: (a.sections || []).map((x, i) => ({
      ...x,
      orig: x.title, // kept for recognizing the "Don't miss" section
      title: t.sections?.[i]?.title || x.title,
      entries: x.entries.map((e) => ({ ...e, ...((t.sections?.[i]?.entries || []).find((y: any) => y?.id === e.id) || {}), id: e.id })),
    })) as any,
  };
}

const SITE = 'https://questcompendium.com';
/** Old page -> the page that replaced it, per guide (pages merged or replaced by rebuilds): 301s in _redirects. */
const SITE_REDIRECTS: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'site-redirects.json'), 'utf8'));
/** --preview <dir>: a local preview of one game (--only key) with its flagship prototypes, outside the website files. */
const PREVIEW = arg('preview') && arg('preview') !== 'true' ? String(arg('preview')) : '';
const ONLY = arg('only') && arg('only') !== 'true' ? String(arg('only')) : '';
const OUT = path.resolve(PREVIEW || 'Marketing_Website_Files');
/** The site's stylesheet, built from the pages' Tailwind classes at the end of a publish (buildSiteCss). */
const CSS_HREF = '/assets/site.css';

/** "Items, Secrets & Missables". */
const joinAnd = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`);
/** Cut at a word boundary to fit a search snippet. */
const snippet = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
/** Structured data: the breadcrumb trail (search results show it instead of the bare URL). */
const breadcrumb = (items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.url })),
});
/** Structured data: a guide page about a game. */
const guideArticle = (o: { headline: string; description: string; url: string; game: string; modified?: number }) => ({
  '@context': 'https://schema.org', '@type': 'Article', headline: o.headline.slice(0, 110), description: o.description,
  mainEntityOfPage: o.url, inLanguage: LANG_TAG[LANG], about: { '@type': 'VideoGame', name: o.game },
  publisher: { '@type': 'Organization', name: 'Quest Compendium', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/icon.png` } },
  ...(o.modified ? { dateModified: new Date(o.modified).toISOString() } : {}),
});


const withDrafts = arg('drafts') === 'true';
const approve = arg('approve');

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type AreaLink = { slug: string; name: string; story?: string; group?: string; total: number; search?: string };

/** Words to find a page by: its item and secret names (so searching "Viper" finds the area with that gear). */
const searchWords = (a: GuideArea) => [...a.items.map((e) => e.name), ...a.secrets.map((e) => e.text), ...a.enemies.map((e) => e.name)].filter(Boolean).join(' ').slice(0, 600);

/** Checklist entries on a page (items, secrets and checklist sections), for progress like "3/8". */
const totalOf = (a: GuideArea) =>
  a.items.length + a.secrets.length + (a.sections || []).filter((x) => x.check).reduce((n, x) => n + x.entries.length, 0);

/** Where "Report it here" sends mistake reports: the app server's review queue (reviewQueue.ts). */
const SERVER_URL = process.env.QC_SERVER_URL || 'https://quest-compendium-890629309063.us-east1.run.app';
const REPORT_API = `${SERVER_URL}/api/guides/report`;

/**
 * Small script for guide pages: remembers ticked items and the last page per game in the visitor's browser, keeps the
 * progress counts up to date, and fills in "Continue where you left off". Nothing is sent anywhere, except a mistake
 * report the visitor writes and sends (to the server's review queue).
 */
const SCRIPT = `
(function(){
  function load(k){try{return new Set(JSON.parse(localStorage.getItem(k)||'[]'))}catch(e){return new Set()}}
  function save(k,v){try{localStorage.setItem(k,JSON.stringify(Array.from(v)))}catch(e){}}
  var b=document.body, K=b.getAttribute('data-guide'), S=b.getAttribute('data-area');
  if(K&&S){
    try{localStorage.setItem('qcw-last:'+K,S)}catch(e){}
    var key='qcw:'+K+':'+S, done=load(key);
    var counts=function(){document.querySelectorAll('[data-count]').forEach(function(c){var ids=c.getAttribute('data-count').split(',');c.textContent=ids.filter(function(i){return done.has(i)}).length+'/'+ids.length;});};
    // The same entry can appear twice (a flagship page's walkthrough and its checklist): every copy follows a tick.
    var refresh=function(){document.querySelectorAll('[data-check]').forEach(function(el){var ids=el.getAttribute('data-check').split('+'), box=el.querySelector('input');box.checked=ids.every(function(i){return done.has(i)}); el.classList.toggle('is-done',box.checked);});};
    document.querySelectorAll('[data-check]').forEach(function(el){
      var ids=el.getAttribute('data-check').split('+'), box=el.querySelector('input');
      box.addEventListener('change',function(){ ids.forEach(function(i){ if(box.checked) done.add(i); else done.delete(i); }); save(key,done); refresh(); counts(); progress(); });
    });
    refresh();
    counts();
  }
  var progress=function(){document.querySelectorAll('[data-progress]').forEach(function(el){
    var p=el.getAttribute('data-progress').split('|'), n=load('qcw:'+p[0]+':'+p[1]).size, t=+p[2];
    if(!t){el.textContent='';return}
    el.textContent=n>=t?'\u2713':(n?n+'/'+t:''); el.classList.toggle('is-complete',n>=t);
  });};
  progress();
  // Achievement labels filter (one at a time; "To do" = not ticked yet).
  var ff=document.querySelector('[data-flag-filter]');
  if(ff){ff.addEventListener('click',function(e){var b=e.target.closest('button[data-flag]');if(!b)return;var f=b.getAttribute('data-flag');
    ff.querySelectorAll('button[data-flag]').forEach(function(x){var on=x===b;x.classList.toggle('bg-[#a87ffb]/15',on);x.classList.toggle('border-[#a87ffb]/50',on);x.classList.toggle('text-white',on);});
    var dk=K?'qcw:'+K+':achievements':'',dn=dk?load(dk):new Set();
    document.querySelectorAll('[data-flags]').forEach(function(r){var show=!f||(f==='todo'?!dn.has(r.getAttribute('data-ach')):(' '+r.getAttribute('data-flags')+' ').indexOf(' '+f+' ')>=0);r.classList.toggle('qc-off',!show);});});}
  // "On this page" links: a section that's folded opens when its link is used (or the page opens at it).
  // A link or a text fragment (#:~:text=) to something inside a folded section opens it, and the target
  // gets a short accent highlight. Browsers keep text fragments out of location.hash, so they're read from the
  // navigation entry; beforematch covers content hidden with hidden="until-found".
  var reveal=function(el){for(var n=el;n&&n!==document.body;n=n.parentElement){if(n.tagName==='DETAILS')n.open=true;}};
  var flash=function(el){el.classList.remove('qc-hit');void el.offsetWidth;el.classList.add('qc-hit');setTimeout(function(){el.classList.remove('qc-hit');},2600);};
  var land=function(el){reveal(el);flash(el);setTimeout(function(){el.scrollIntoView({block:'center'});},0);};
  var openAt=function(){var id=location.hash.slice(1);if(!id||id.indexOf(':~:')===0)return;var el=null;try{el=document.getElementById(decodeURIComponent(id));}catch(e){}if(el)land(el);};
  var squash=function(s){return (s||'').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g,' ').trim();};
  var textTarget=function(){var nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||null;var url=(nav&&nav.name)||location.href;var at=url.indexOf(':~:');if(at<0)return;
    url.slice(at+3).split('&').forEach(function(d){if(d.indexOf('text=')!==0)return;var parts=d.slice(5).split(',').map(function(x){try{return decodeURIComponent(x);}catch(e){return x;}}).filter(function(x){return x.slice(-1)!=='-'&&x.charAt(0)!=='-';});var want=squash(parts[0]);if(!want)return;
      var hit=null;document.querySelectorAll('main [data-check], main li, main p, main h2, main h3, main dd, main [id]').forEach(function(el){if(!hit&&squash(el.textContent).indexOf(want)>=0&&!Array.prototype.some.call(el.children,function(c){return squash(c.textContent).indexOf(want)>=0;}))hit=el;});
      if(hit)land(hit.closest('[data-check],li,[id]')||hit);});};
  document.addEventListener('beforematch',function(e){reveal(e.target);flash(e.target);});
  window.addEventListener('hashchange',openAt);openAt();textTarget();
  // Search boxes: hide entries that don't match, and section headings left with nothing under them.
  var norm=function(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');};
  document.querySelectorAll('[data-filter]').forEach(function(inp){
    var list=document.querySelector(inp.getAttribute('data-filter')), empty=document.querySelector(inp.getAttribute('data-empty')||'#_');
    if(!list) return;
    inp.addEventListener('input',function(){
      var q=norm(inp.value.trim()), shown=0;
      list.querySelectorAll('[data-search]').forEach(function(el){var ok=!q||norm(el.getAttribute('data-search')).indexOf(q)>=0; el.hidden=!ok; if(ok) shown++;});
      list.querySelectorAll('[data-head]').forEach(function(h){var g=h.getAttribute('data-head'),any=false;list.querySelectorAll('[data-group="'+g+'"]').forEach(function(el){if(!el.hidden)any=true;});h.hidden=!any;});
      document.querySelectorAll('[data-hide-when-searching]').forEach(function(el){el.hidden=!!q;});
      if(empty) empty.hidden=shown>0;
    });
  });
  // Sorting and the A–Z bar on the guides page.
  var grid=document.querySelector('[data-games]');
  var sortSel=document.querySelector('[data-sort]');
  if(grid&&sortSel){sortSel.addEventListener('change',function(){
    var k=sortSel.value, cards=Array.prototype.slice.call(grid.children);
    cards.sort(function(a,b){ if(k==='az') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name')); return (+b.getAttribute('data-'+k))-(+a.getAttribute('data-'+k)) || a.getAttribute('data-name').localeCompare(b.getAttribute('data-name')); });
    cards.forEach(function(c){grid.appendChild(c);});
  });}
  document.querySelectorAll('[data-letter]').forEach(function(btn){btn.addEventListener('click',function(){
    if(sortSel&&sortSel.value!=='az'){sortSel.value='az';sortSel.dispatchEvent(new Event('change'));}
    var L=btn.getAttribute('data-letter'), t=grid&&grid.querySelector('[data-first="'+L+'"]'); if(t) t.scrollIntoView({behavior:'smooth',block:'center'});
  });});
  var c=document.querySelector('[data-continue]');
  if(c){var s=null;try{s=localStorage.getItem('qcw-last:'+c.getAttribute('data-continue'))}catch(e){}
    var a=s&&document.querySelector('[data-area-link="'+s+'"]');
    if(a){c.setAttribute('href',a.getAttribute('href'));c.querySelector('[data-continue-name]').textContent=a.getAttribute('data-name');c.hidden=false;}}
  // "Spot a mistake?": a short report about this page, sent to the review queue (the only thing this script sends).
  var dlg=document.getElementById('qc-report');
  if(dlg&&dlg.showModal){
    var ta=dlg.querySelector('textarea'), st=dlg.querySelector('[data-report-status]'), send=dlg.querySelector('[data-report-send]');
    var pick=document.getElementById('qc-report-entry'), fix=document.getElementById('qc-report-correct');
    document.querySelectorAll('[data-report]').forEach(function(btn){btn.addEventListener('click',function(){st.hidden=true;ta.value='';if(pick)pick.value='';if(fix)fix.value='';send.disabled=false;dlg.showModal();});});
    dlg.querySelector('form').addEventListener('submit',function(e){
      if(e.submitter&&e.submitter.value==='cancel')return;
      e.preventDefault();
      var t=ta.value.trim(); if(t.length<5)return;
      send.disabled=true;
      fetch(dlg.getAttribute('data-api'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:K||'',page:S||'',text:t,entry:pick?pick.value:'',correct:fix?fix.value.trim():'',lang:dlg.getAttribute('data-lang')||'en',path:location.pathname})})
        .then(function(r){if(!r.ok)throw 0;st.textContent=dlg.getAttribute('data-thanks');st.hidden=false;setTimeout(function(){dlg.close();},1800);})
        .catch(function(){st.textContent=dlg.getAttribute('data-error');st.hidden=false;send.disabled=false;});
    });
  }
})();`;

/**
 * guides/index.json: the apps' guide list (the Deck plugin and the desktop app), a few KB, served by Netlify so the first
 * load never waits on the server. _headers lets the apps fetch it from anywhere and caches it for 5 minutes.
 */
/**
 * The site's own "Page not found" (Netlify serves /404.html for any missing address, at that address, so every link
 * is from the site root): a search over the guides (guides/index.json), and links to the guides and the home page.
 */
function write404() {
  setLang('en');
  const body = `<div class="max-w-2xl">
    <h1 class="text-3xl font-bold text-white">Page not found</h1>
    <p class="mt-3 text-zinc-300">This page doesn't exist, or it moved. Search for your game, or open the guides.</p>
    <input type="search" id="qc-404-q" autocomplete="off" placeholder="Search for a game…" class="mt-5 w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-[#a87ffb]/40 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]">
    <ul id="qc-404-r" class="mt-2 space-y-1"></ul>
    <p class="mt-6 flex flex-wrap gap-4"><a href="/guides/" class="text-[#a87ffb] hover:text-white font-semibold">All guides &rarr;</a><a href="/" class="text-[#a87ffb] hover:text-white font-semibold">Home &rarr;</a></p>
  </div>
  <script>(function(){var __name=function(f){return f;};var fuzzyScore=${fuzzyScore.toString()};var q=document.getElementById('qc-404-q'),out=document.getElementById('qc-404-r'),games=null;
  function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function load(){return games?Promise.resolve(games):fetch('/guides/index.json').then(function(r){return r.json();}).then(function(j){games=j.games||[];return games;}).catch(function(){games=[];return games;});}
  // The words of the address that failed ("/guides/red-dead-redemption-2/x/" -> "red dead redemption 2") start the search.
  var guess=(location.pathname.match(/\\/guides\\/([^/]+)/)||[])[1];if(guess){q.value=guess.replace(/-/g,' ');}
  function run(){var v=q.value.trim();if(!v){out.innerHTML='';return;}load().then(function(gs){var r=gs.map(function(g){return{g:g,s:fuzzyScore(v,g.game)};}).filter(function(x){return x.s>0;}).sort(function(a,b){return b.s-a.s;}).slice(0,8);
    out.innerHTML=r.length?r.map(function(x){return '<li><a class="block rounded-lg px-3 py-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-white font-semibold" href="/guides/'+e(x.g.key)+'/">'+e(x.g.game)+'</a></li>';}).join(''):'<li class="text-sm text-zinc-500 px-1">No guide matches. <a class="text-[#a87ffb]" href="/guides/">See every guide</a>.</li>';});}
  q.addEventListener('input',run);if(q.value)run();})();</script>`;
  // Served at the missing address itself: the base makes the page's own links and stylesheet work from any depth.
  const html = page({ title: 'Page not found – Quest Compendium', description: 'This page does not exist.', depth: 0, canonical: `${SITE}/404.html`, body, draft: true })
    .replace('<head>', '<head>\n  <base href="/">')
    // noindex (from draft) without the draft banner.
    .replace('<div class="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-sm text-center py-2">DRAFT preview: not public yet</div>', '');
  fs.writeFileSync(path.join(OUT, '404.html'), html);
}

function writeGuideIndex(games: { key: string; game: string; areas: number; art?: string; checked: number; players: number; langs: string[] }[]) {
  const list = games.slice().sort((a, b) => a.game.localeCompare(b.game));
  fs.writeFileSync(path.join(OUT, 'guides', 'index.json'), JSON.stringify({ v: 1, updated: Date.now(), games: list }));
  fs.writeFileSync(path.join(OUT, '_headers'), '# Made by scripts/guides/publish.ts\n/guides/index.json\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n/guides/*/search.json\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n/:lang/guides/*/search.json\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n');
  console.log(`Guide index: ${list.length} game(s) in guides/index.json.`);
}

/**
 * Redirects for a guide's held pages (taken down by a rebuild, repair or outline change), each to its replacement: an
 * entity page or a live page with its name, else the first live page (in guide order) whose text mentions it; failing
 * those, rather than the guide's front page: an entity page whose name matches loosely, else the chapter page its own
 * chapter note names ("Epilogue Chapter 2, ..." -> "Epilogue Part 2: ..."); the front page (to '') only when nothing fits. Pages held because the whole guide was unpublished get none while the guide is down
 * (publish skips guides with no live pages).
 */
export let heldRedirectCount = 0;
/** The live page closest to a held one in the guide's play order: the one just before it, else the one after. */
function nearestInOrder(d: any, docs: any[], live: Set<string>): string {
  const at = Number(d.order);
  if (!Number.isFinite(at)) return '';
  const ordered = docs.filter((x) => live.has(x.slug) && Number.isFinite(Number(x.order)));
  const before = ordered.filter((x) => Number(x.order) < at).sort((a, b) => Number(b.order) - Number(a.order))[0];
  const after = ordered.filter((x) => Number(x.order) > at).sort((a, b) => Number(a.order) - Number(b.order))[0];
  return (before || after)?.slug || '';
}

function heldRedirects(key: string, docs: any[], visible: { slug: string; name: string }[], byslug: Map<string, GuideArea>, entities: { slug: string; name: string }[]) {
  const live = new Set(visible.map((o) => o.slug));
  const norm = (x: string) => String(x || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const text = (a: GuideArea) => [a.name, a.overview, ...(a.walkthrough || []).flatMap((s) => [s.title, s.text]), ...(a.items || []).map((e) => `${e.name} ${e.where || ''}`)].filter(Boolean).join(' ');
  const fullText = (a: GuideArea) => [text(a), ...(a.secrets || []).map((e: any) => e.text), ...(a.shops || []).map((e: any) => e.name), ...(a.enemies || []).map((e: any) => e.name), ...(a.fights || []).map((f: any) => f.name)].filter(Boolean).join(' ');
  const entryNames = (d: any) => [...(d.items || []), ...(d.shops || []), ...(d.enemies || []), ...(d.fights || [])].map((e: any) => String(e?.name || ''));
  const out: { key: string; from: string; to: string }[] = [];
  for (const d of docs) {
    if (d.status !== 'held' || live.has(d.slug) || entities.some((e) => e.slug === d.slug)) continue;
    const name = String(d.name || d.slug);
    const ent = entities.find((e) => norm(e.name) === norm(name));
    const same = visible.find((o) => norm(byslug.get(o.slug)?.name || o.name) === norm(name))
      // A page named after it ("Chapter 4: Saint Denis" for Saint Denis) before one that only mentions it.
      || (name.length >= 4 ? visible.find((o) => entitySegments(byslug.get(o.slug)?.name || o.name, [{ name, slug: 'x' }]).some((sg) => sg.slug)) : undefined);
    const mention = name.length >= 4 ? visible.find((o) => entitySegments(text(byslug.get(o.slug)!), [{ name, slug: 'x' }]).some((sg) => sg.slug)) : undefined;
    let to = ent?.slug || same?.slug || mention?.slug || '';
    // Never the front page when something fits better: a loosely matching entity page, else the page's own chapter.
    if (!to) to = entities.find((e) => fuzzyScore(name, e.name) > 0 && fuzzyScore(e.name, name) > 0)?.slug
      || chapterPage(String(d.story || ''), visible.map((o) => ({ slug: o.slug, name: byslug.get(o.slug)?.name || o.name })))
      // else the live page that covers most of its named entries (items, secrets, shops, enemies, fights)
      || coveringPage(entryNames(d), visible.map((o) => ({ slug: o.slug, name: byslug.get(o.slug)?.name || o.name, text: fullText(byslug.get(o.slug)!) })), 3, `${name} ${d.story || ''}`)
      // else the nearest live page in play order (the one just before it, or after it), never the front page
      || nearestInOrder(d, docs, live)
      || '';
    out.push({ key, from: d.slug, to });
  }
  heldRedirectCount += out.length;
  return out;
}

/** Players' suggestions on the site (contributions.ts): on when config/contrib.enabled is true, or for a local look (QC_CONTRIB=1). */
let CONTRIB_ON = process.env.QC_CONTRIB === '1';
/** The suggest form served on questcompendium.com (proxied, sign-in on the site): config/contrib.siteAuth, set once
 * Firebase allows questcompendium.com and Google's sign-in accepts its /__/auth/handler. */
let CONTRIB_SITE_AUTH = false;
/** Approved, not yet absorbed suggestions, by "key/slug". */
const CONTRIBS = new Map<string, { anchor: string; text: string; credit: boolean; displayName?: string; lang: string }[]>();

/** The note an approved suggestion shows at its spot, with the contributor's credit. */
const contribNote = (c: { text: string; credit: boolean; displayName?: string }) => `<div class="qc-contrib mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm text-zinc-200"><span class="mr-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">${esc(ui('contribLabel'))}</span>${esc(c.text)} <span class="text-xs text-zinc-500">· ${esc(c.credit && c.displayName ? ui('contribBy', { name: c.displayName }) : ui('contribByPlayer'))}</span></div>`;

/**
 * A page's approved suggestions placed in its HTML: after the element with the suggestion's anchor id (after a
 * heading's paragraph), or in a "From players" box at the end when the anchor isn't on the page.
 */
function withContributions(html: string, key: string, slug: string): string {
  const mine = (CONTRIBS.get(`${key}/${slug}`) || []).filter((c) => c.lang === LANG || LANG === 'en');
  if (!mine.length) return html;
  const loose: string[] = [];
  for (const c of mine) {
    const at = c.anchor ? html.indexOf(` id="${c.anchor}"`) : -1;
    if (at < 0) { loose.push(contribNote(c)); continue; }
    const open = html.lastIndexOf('<', at);
    const tag = (html.slice(open + 1).match(/^[a-z0-9]+/i) || [''])[0].toLowerCase();
    let end = -1;
    if (/^h[1-6]$/.test(tag)) { const p = html.indexOf('</p>', at); end = p < 0 ? -1 : p + 4; }
    else {
      const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
      re.lastIndex = open;
      let depth = 0, m: RegExpExecArray | null;
      while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (depth === 0) { end = m.index + m[0].length; break; } }
    }
    if (end < 0) { loose.push(contribNote(c)); continue; }
    html = html.slice(0, end) + contribNote(c) + html.slice(end);
  }
  return loose.length ? html + `<section class="mt-8"><h2 class="text-sm font-bold uppercase tracking-wide text-emerald-300">${esc(ui('contribFromPlayers'))}</h2>${loose.join('')}</section>` : html;
}

/**
 * The "Suggest an edit" links: one on each walkthrough step, checklist entry, choice, compendium section and question,
 * opening the form on the app server (/suggest) for that spot. Added in the browser from the page's anchors.
 */
function suggestScript(key: string, slug: string, page: 'area' | 'entity'): string {
  const base = `/suggest?key=${encodeURIComponent(key)}&slug=${encodeURIComponent(slug)}&page=${page}&lang=${LANG}`;
  return `<script>(function(){var base=${JSON.stringify(base)},label=${JSON.stringify(ui('suggestEdit'))},skip=/^(qc-|walkthrough$|compendium$|roadmap$|people$|choices$)/;
  var link=function(el,text,after){var a=document.createElement('a');a.href=base+'&anchor='+encodeURIComponent(el.id)+'&label='+encodeURIComponent((text||'').trim().slice(0,120));a.target='_blank';a.rel='noopener';a.className='qc-suggest ml-2 text-[11px] text-zinc-500 hover:text-[#a87ffb] whitespace-nowrap';a.textContent='\u270e '+label;(after||el).appendChild(a);};
  document.querySelectorAll('main [id]').forEach(function(el){if(skip.test(el.id)||el.closest('nav,dialog,header,footer'))return;var t=el.tagName;
    if(/^H[23]$/.test(t)){link(el,el.textContent);return;}
    if(t==='LI'||t==='DIV'||t==='SECTION'){var h=el.querySelector('h2,h3,strong,.font-semibold');if(!h)return;link(el,h.textContent,h.parentElement===el?el:h.parentElement);}
  });
  var top=document.querySelector('main h1');if(top){var a=document.createElement('a');a.href=base+'&label='+encodeURIComponent(top.textContent.trim().slice(0,120));a.target='_blank';a.rel='noopener';a.className='qc-suggest block mt-1 text-xs text-zinc-500 hover:text-[#a87ffb]';a.textContent='\u270e '+label;top.insertAdjacentElement('afterend',a);}
})();</script>`;
}

/** Netlify's _redirects: the moved pages' old URLs, 301 to the pages that replaced them. */
function writeRedirects(moved: { key: string; from: string; to: string }[], live: Set<string>) {
  const lines = redirectLines(moved, live, Object.keys(LANG_TAG), SITE);
  // The admin pages live on the app server: the website's /admin addresses lead there.
  const suggest = CONTRIB_SITE_AUTH
    ? [`/suggest ${SERVER_URL}/suggest 200!`, `/api/contributions ${SERVER_URL}/api/contributions 200!`, `/__/auth/* https://quest-compendium-1bccf.firebaseapp.com/__/auth/:splat 200!`, `/__/firebase/* https://quest-compendium-1bccf.firebaseapp.com/__/firebase/:splat 200!`]
    : [`/suggest ${SERVER_URL}/suggest 302`];
  const admin = [`/admin ${SERVER_URL}/admin/reviews 302`, `/admin/* ${SERVER_URL}/admin/:splat 302`, ...suggest];
  fs.writeFileSync(path.join(OUT, '_redirects'), `# Made by scripts/guides/publish.ts: pages that moved (scripts/guides/site-redirects.json, guide aliases).\n${[...admin, ...lines].join('\n')}\n`);
  console.log(`Redirects: ${lines.length} old URL(s) to the pages that replaced them.`);
}

function page(opts: { title: string; description: string; depth: number; canonical: string; body: string; draft?: boolean; guide?: string; area?: string; langs?: string[]; path?: string; entries?: { id: string; label: string }[]; ld?: object[] }) {
  // A guide or compendium page (/guides/{key}/{slug}/): its approved player suggestions, and the "Suggest an edit" links.
  const at = opts.guide ? (opts.canonical.match(/\/guides\/([a-z0-9-]+)\/([a-z0-9-]+)\/$/) || []) : [];
  if (at[1] && at[2] && at[2] !== 'achievements') {
    const isEntity = !!COMP?.entities.some((e) => e.slug === at[2]);
    opts = { ...opts, body: withContributions(opts.body, at[1], at[2]) + (CONTRIB_ON ? suggestScript(at[1], at[2], isEntity ? 'entity' : 'area') : '') };
  }
  // "Spot a mistake?": on an area page, the form can say which entry is wrong (its id goes to the server).
  const entryPicker = opts.entries && opts.entries.length
    ? `<label class="block text-sm text-zinc-400" for="qc-report-entry">${esc(ui('reportEntry'))}</label>
      <select id="qc-report-entry" class="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-zinc-100"><option value="">${esc(ui('reportEntryNone'))}</option>${opts.entries.map((e) => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join('')}</select>`
    : '';
  const up = '../'.repeat(opts.depth);
  // Other languages of this same page: a menu in the top bar and hreflang tags for search engines.
  const langs = opts.langs && opts.langs.length > 1 && opts.path !== undefined ? opts.langs : [];
  // Every language version (this one included), and x-default: the English page.
  const hreflang = [...langs.map((c) => `<link rel="alternate" hreflang="${LANG_TAG[c]}" href="${SITE}/${langPath(c)}${opts.path}">`), ...(langs.includes('en') ? [`<link rel="alternate" hreflang="x-default" href="${SITE}/${opts.path}">`] : [])].join('\n  ');
  const menu = langs.length
    ? `<details class="relative"><summary class="list-none cursor-pointer select-none hover:text-white" aria-label="${esc(ui('language'))}">${esc(LANG_LABEL[LANG])} &#9662;</summary><div class="absolute right-0 mt-2 w-40 rounded-xl border border-white/10 bg-[#0c0d14] p-1 shadow-xl z-50">${langs
        .map((c) => `<a href="${up}${langPath(c)}${opts.path}index.html" hreflang="${LANG_TAG[c]}" lang="${LANG_TAG[c]}" class="block px-3 py-1.5 rounded-lg ${c === LANG ? 'text-white bg-white/10' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}">${esc(LANG_LABEL[c])}</a>`)
        .join('')}</div></details>`
    : '';
  return `<!doctype html>
<html lang="${LANG_TAG[LANG]}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${esc(opts.canonical)}">
  ${hreflang}
  ${opts.draft ? '<meta name="robots" content="noindex, follow">' : ''}
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${esc(ogImageFor(opts.guide, opts.guide ? GUIDE_APP.get(opts.guide) : undefined))}">
  <link rel="icon" type="image/png" sizes="192x192" href="${up}favicon-192.png">
  <link rel="icon" type="image/png" sizes="96x96" href="${up}favicon-96.png">
  <link rel="icon" href="${up}favicon.ico" sizes="16x16 32x32 48x48">
  <link rel="icon" type="image/svg+xml" href="${up}icon.svg">
  ${(opts.ld || []).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n  ')}
  <link rel="stylesheet" href="${CSS_HREF}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, system-ui, sans-serif; background: #07070a; color: #e4e4e7; }
    .qc-pixel { image-rendering: pixelated; }
    .qc-check input { accent-color: #a87ffb; width: 1rem; height: 1rem; flex-shrink: 0; margin-top: .2rem; cursor: pointer; }
    .qc-check.is-done span { text-decoration: line-through; opacity: .5; }
    details.qc-fold > summary { list-style: none; cursor: pointer; }
    details.qc-fold > summary::-webkit-details-marker { display: none; }
    details.qc-fold > summary .qc-caret { transition: transform .15s; }
    details.qc-fold[open] > summary .qc-caret { transform: rotate(90deg); }
    [data-progress] { font-size: 11px; font-weight: 700; color: #a87ffb; }
    [data-progress].is-complete { color: #34d399; }
    .qc-scroll { scrollbar-width: thin; scrollbar-color: #2a2a35 transparent; }
    /* The achievement filter hides rows with this class (the search box uses the hidden attribute: both apply). */
    .qc-off { display: none !important; }
    /* Search hides entries with the hidden attribute; layout classes like "flex" would otherwise keep them showing. */
    [hidden] { display: none !important; }
    /* The entry a link or text fragment points at: a short accent highlight that fades (no layout change). */
    .qc-hit { animation: qc-hit 2.4s ease-out; border-radius: .5rem; }
    @keyframes qc-hit { from { background-color: rgba(168, 127, 251, .2); box-shadow: 0 0 0 1px rgba(168, 127, 251, .55); } to { background-color: transparent; box-shadow: 0 0 0 1px transparent; } }
    ::target-text { background-color: rgba(168, 127, 251, .35); color: inherit; }
  </style>
</head>
<body class="min-h-screen"${opts.guide ? ` data-guide="${esc(opts.guide)}"` : ''}${opts.area ? ` data-area="${esc(opts.area)}"` : ''}>
  <nav class="sticky top-0 z-40 bg-[#07070a]/85 backdrop-blur border-b border-white/5">
    <div class="max-w-6xl mx-auto px-5 sm:px-6 h-14 flex items-center justify-between">
      <a href="${up}${LP}index.html" class="flex shrink-0 items-center gap-2 font-bold text-white whitespace-nowrap text-sm sm:text-base"><img src="${up}icon.svg" alt="" class="w-7 h-7 qc-pixel"><span class="max-[419px]:sr-only">Quest Compendium</span></a>
      <div class="flex items-center gap-3 sm:gap-5 text-sm text-zinc-400 whitespace-nowrap">
        <a href="${up}${LP}guides/index.html" class="hover:text-white">${esc(ui('navGuides'))}</a>
        <a href="${up}${LP}index.html?from=guide#download" class="text-[#a87ffb] hover:text-white font-semibold">${esc(ui('navGetApp'))}</a>
        ${menu}
      </div>
    </div>
  </nav>
  ${opts.draft ? '<div class="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-sm text-center py-2">DRAFT preview: not public yet</div>' : ''}
  <main class="max-w-6xl mx-auto px-5 sm:px-6 py-8">${opts.body}</main>
  <footer class="max-w-6xl mx-auto px-5 sm:px-6 py-10 text-xs text-zinc-500 border-t border-white/5">
    ${esc(ui('footerReport'))
      .replace('{report}', `<button type="button" data-report class="text-[#a87ffb] hover:underline">${esc(ui('reportLink'))}</button>`)
      .replace('{discord}', '<a href="https://discord.gg/WxdgNMXWyg" class="text-[#a87ffb]">Discord</a>')} ${esc(ui('imagesNote'))} ${igdbCredit()}
  </footer>
  <dialog id="qc-report" class="rounded-2xl bg-[#121218] text-zinc-200 border border-white/10 p-0 w-[min(92vw,28rem)] backdrop:bg-black/60" data-api="${REPORT_API}" data-lang="${LANG}" data-thanks="${esc(ui('reportThanks'))}" data-error="${esc(ui('reportError'))}">
    <form method="dialog" class="p-5 space-y-3">
      <h2 class="text-base font-bold text-white">${esc(ui('reportTitle'))}</h2>
      <label class="block text-sm text-zinc-400" for="qc-report-text">${esc(ui('reportHint'))}</label>
      <textarea id="qc-report-text" rows="4" minlength="5" maxlength="1000" required class="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-zinc-100"></textarea>
      ${entryPicker}
      <label class="block text-sm text-zinc-400" for="qc-report-correct">${esc(ui('reportCorrect'))}</label>
      <input id="qc-report-correct" maxlength="300" placeholder="${esc(ui('reportCorrectHint'))}" class="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-zinc-100">
      <p data-report-status class="text-sm text-zinc-300" hidden></p>
      <div class="flex justify-end gap-2">
        <button value="cancel" formnovalidate class="px-3 py-1.5 text-sm text-zinc-400 hover:text-white">${esc(ui('reportCancel'))}</button>
        <button value="send" data-report-send class="px-3 py-1.5 text-sm rounded-lg bg-[#a87ffb] text-black font-semibold">${esc(ui('reportSend'))}</button>
      </div>
    </form>
  </dialog>
  <script>${SCRIPT}</script>
</body>
</html>
`;
}

const cta = (up: string, game: string) => `
  <div class="mt-10 rounded-2xl border border-[#a87ffb]/30 bg-gradient-to-br from-[#a87ffb]/15 to-transparent p-6">
    <h2 class="text-lg font-bold text-white mb-1">${esc(ui('ctaTitle', { game }))}</h2>
    <p class="text-zinc-300 text-sm mb-4">${esc(ui('ctaBody'))}</p>
    <a href="${up}${LP}index.html?from=guide#download" class="inline-block bg-[#a87ffb] text-black font-bold px-5 py-2 rounded-full hover:bg-white">${esc(ui('ctaButton'))}</a>
  </div>`;

const ICON = {
  items: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>',
  secrets: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/></svg>',
  enemies: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/></svg>',
  shops: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  tips: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  list: '<svg class="w-4 h-4 text-[#a87ffb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
  warn: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  caret: '<svg class="qc-caret w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};

/**
 * A tickable row. anchor: the entry's canonical row (in its checklist) carries its stable id, "e-" + the entry id (rows
 * ticked together carry one id each), so links and text fragments can land on it; copies (a flagship walkthrough's)
 * don't, so ids stay unique.
 */
const checkRow = (id: string, html: string, anchor = false) => {
  const ids = id.split('+');
  const extra = anchor ? ids.slice(1).map((x) => `<span id="e-${esc(x)}"></span>`).join('') : '';
  return `<label${anchor ? ` id="e-${esc(ids[0])}"` : ''} class="qc-check flex gap-3 items-start px-3 py-2 rounded-lg hover:bg-white/[0.04] cursor-pointer${anchor ? ' scroll-mt-20' : ''}" data-check="${esc(id)}"><input type="checkbox" aria-label="${esc(ui('gotIt'))}">${extra}<span class="text-sm leading-snug text-zinc-300">${html}</span></label>`;
};

/** A folding section: the header shows its progress; content stays in the page for search engines. */
/** "May be incomplete" next to a section the sources couldn't fully cover. */
const incompleteTag = () => ` <span class="ml-1 align-middle rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200" title="${esc(ui('mayBeIncompleteHint'))}">${esc(ui('mayBeIncomplete'))}</span>`;

function fold(title: string, icon: string, body: string, opts: { ids?: string[]; open?: boolean; id?: string; incomplete?: boolean } = {}) {
  if (!body) return '';
  return `<details class="qc-fold mt-3 scroll-mt-20"${opts.id ? ` id="${esc(opts.id)}"` : ''}${opts.open ? ' open' : ''}>
    <summary class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10">${ICON.caret}${icon}<h2 class="flex-1 text-sm sm:text-base font-bold text-white">${esc(title)}${opts.incomplete ? incompleteTag() : ''}</h2>${opts.ids?.length ? `<span class="text-xs text-zinc-500" data-count="${esc(opts.ids.join(','))}">0/${opts.ids.length}</span>` : ''}</summary>
    <div class="mt-2">${body}</div>
  </details>`;
}

/** The area list: the sidebar on area pages and the main list on a game's page. */
function areaList(gameKey: string, areas: AreaLink[], current: string | null, base: string) {
  let lastGroup = '';
  return areas
    .map((a) => {
      const head = a.group && a.group !== lastGroup ? `<li data-head="${esc(a.group)}" class="pt-4 pb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">${esc(a.group)}</li>` : '';
      lastGroup = a.group || lastGroup;
      const here = a.slug === current;
      return `${head}<li data-search="${esc(`${a.name} ${a.search || ''}`)}"${a.group ? ` data-group="${esc(a.group)}"` : ''}><a href="${base}${esc(a.slug)}/index.html" data-area-link="${esc(a.slug)}" data-name="${esc(a.name)}" class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm ${
        here ? 'bg-[#a87ffb]/15 text-white font-semibold border border-[#a87ffb]/30' : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white border border-transparent'
      }"><span class="flex-1 min-w-0 truncate">${esc(a.name)}</span><span data-progress="${esc(gameKey)}|${esc(a.slug)}|${a.total}"></span></a></li>`;
    })
    .join('');
}

// ---- The compendium (scripts/guides/compendium.ts) ----
// Entity pages next to the guide (published ones; a preview shows all), links from every mention in the guide's text
// (with a hover preview), a forgiving search over every entity, page, step and entry, and "Services and people" as
// grouped cards. COMP is the guide being rendered (set per guide in main).
type CompEntity = { name: string; slug: string; type: string; typeLabel: string; title: string; description: string; overview: string; summary: any; sources: string[]; review?: any; cost?: any; kind?: string; quest?: any; ref?: any; qa?: { q: string; a: string }[]; displayName?: string; story?: { heading: string; text: string }[]; gameplay?: { heading: string; text: string }[]; alsoAsked?: { q: string; a: string }[]; qaArrangedAt?: number };
const COMPS = new Map<string, NonNullable<typeof COMP>>();
/** Approved guide blueprints (guideBlueprints/{key}): their quest plans give the quests' play order and chapters. */
const BLUEPRINTS = new Map<string, any>();
const QUEST_TYPES: Record<string, { unit: string; label: string }> = { 'story-missions': { unit: 'quest-short', label: 'Story Missions' }, 'stranger-missions': { unit: 'quest-full', label: 'Stranger Missions' } };

/**
 * A quest type's missions grouped by chapter, in play order: the blueprint's plan (play order, each mission's chapter)
 * with the built quest pages. A planned mission not tried yet is "coming soon"; one that was tried and isn't published
 * (failed its review) is left out. Built pages not in the plan go after, by their own chapter. Groups follow the
 * guide's chapter order; a mission whose chapter matches no page goes under "Other".
 */
function questGroups(typeId: string, pages: { slug: string; name: string }[]): { slug: string; name: string; items: { name: string; slug?: string }[] }[] {
  const qt = QUEST_TYPES[typeId];
  if (!qt) return [];
  const bp = BLUEPRINTS.get(COMP_KEY);
  const sec = bp?.status === 'approved' ? (bp.sections || []).find((x: any) => x.unit === qt.unit) : null;
  const prog = sec ? bp.progress?.[sec.id] || {} : {};
  const plan: string[] = prog.plan || [];
  const planCh: Record<string, string> = prog.planChapters || {};
  const tried = new Set<string>((prog.built || []).map((b: any) => String(b.name).toLowerCase()));
  const built = (COMP?.entities || []).filter((e) => e.type === typeId);
  const builtBy = new Map(built.map((e) => [e.name.toLowerCase(), e]));
  const items = [
    ...plan.map((name, i) => { const e = builtBy.get(name.toLowerCase()); return { name, i, e, chapter: String(e?.quest?.chapter || e?.quest?.parts?.[0]?.chapter || planCh[name] || '') }; }),
    ...built.filter((e) => !plan.some((n) => n.toLowerCase() === e.name.toLowerCase())).map((e, j) => ({ name: e.name, i: 10_000 + j, e, chapter: String(e.quest?.chapter || e.quest?.parts?.[0]?.chapter || '') })),
  ].filter((x) => x.e || !tried.has(x.name.toLowerCase()));
  const groups = new Map<string, { slug: string; name: string; at: number; items: { name: string; slug?: string; i: number }[] }>();
  for (const x of items) {
    const slug = (x.chapter && chapterPage(x.chapter, pages)) || '';
    const at = slug ? pages.findIndex((p) => p.slug === slug) : 9_999;
    const g = groups.get(slug) || { slug, name: slug ? pages[at].name : 'Other', at, items: [] };
    g.items.push({ name: x.name, slug: x.e?.slug, i: x.i });
    groups.set(slug, g);
  }
  return [...groups.values()].sort((a, b) => a.at - b.at).map((g) => ({ slug: g.slug, name: g.name, items: g.items.sort((a, b) => a.i - b.i).map(({ name, slug }) => ({ name, slug })) }));
}

/** An area page's "Missions in this chapter": the built quest pages whose chapter is this page, in play order. */
function missionsHere(slug: string, pages: { slug: string; name: string }[]): string {
  const rows = Object.keys(QUEST_TYPES).flatMap((t) => questGroups(t, pages).filter((g) => g.slug === slug).flatMap((g) => g.items.filter((x) => x.slug).map((x) => ({ ...x, type: QUEST_TYPES[t].label }))));
  if (!rows.length) return '';
  return `<section class="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><h2 class="text-sm font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(ui('missionsHere'))}</h2>
    <ul class="mt-2 space-y-1 text-sm">${rows.map((x) => `<li><a class="text-[#a87ffb] hover:text-white font-semibold" href="${esc(entHref(x.slug!))}">${esc(x.name)}</a> <span class="text-zinc-500 text-xs">· ${esc(x.type)}</span></li>`).join('')}</ul></section>`;
}
let COMP: { taxonomy: any[]; entities: CompEntity[]; people: Record<string, { groups: { group: string; people: { name: string; role: string; where?: string }[] }[] }> } | null = null;
const compLinkable = () => (COMP?.entities || []).flatMap((e) => [{ name: e.name, slug: e.slug }, ...(e.displayName && e.displayName.length >= 4 ? [{ name: e.displayName, slug: e.slug }] : [])]);
let COMP_KEY = '';
/** An entity page's URL (root-relative: entity pages are English-only, so translated pages link there too). */
const entHref = (slug: string) => `/guides/${COMP_KEY}/${slug}/`;
/** Guide text with entity mentions linked to their pages (prefix: the path from this page to the guide's folder). */
function rich(text: string | undefined, _prefix = '../', self = ''): string {
  const t = String(text || '');
  if (!COMP?.entities.length) return esc(t);
  return entitySegments(t, compLinkable().filter((e) => e.slug !== self))
    .map((sg) => (sg.slug ? `<a class="qc-ent text-[#c4b0ff] underline decoration-[#a87ffb]/40 underline-offset-2 hover:text-white" data-ent="${esc(sg.slug)}" href="${esc(entHref(sg.slug))}">${esc(sg.text)}</a>` : esc(sg.text)))
    .join('');
}
/** The hover preview: each linked entity's type, region and first line, and a small popover. */
function entPreview(): string {
  if (!COMP?.entities.length) return '';
  const data = Object.fromEntries(COMP.entities.map((e) => [e.slug, { name: e.displayName || e.name, type: singularLabel(e.typeLabel), region: e.summary?.region || '', line: String(e.overview || '').split(/(?<=[.!?])\s/)[0] || '' }]));
  return `<script type="application/json" id="qc-ents">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<div id="qc-ent-pop" hidden class="fixed z-50 max-w-xs rounded-xl border border-[#a87ffb]/40 bg-[#0c0d14] p-3 text-sm shadow-xl pointer-events-none"></div>
<script>(function(){var d=JSON.parse(document.getElementById('qc-ents').textContent),p=document.getElementById('qc-ent-pop');
function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
document.addEventListener('mouseover',function(ev){var a=ev.target.closest&&ev.target.closest('a.qc-ent');if(!a){p.hidden=true;return;}var x=d[a.getAttribute('data-ent')];if(!x)return;
p.innerHTML='<div class="text-[11px] uppercase tracking-wide text-[#c4b0ff]">'+e(x.type)+(x.region?' · '+e(x.region):'')+'</div><div class="mt-0.5 font-semibold text-white">'+e(x.name)+'</div><div class="mt-1 text-zinc-300">'+e(x.line)+'</div>';
var r=a.getBoundingClientRect();p.style.left=Math.min(window.innerWidth-330,Math.max(8,r.left))+'px';p.style.top=(r.bottom+8)+'px';p.hidden=false;});})();</script>`;
}
/** "Services and people" as grouped cards (Merchants, Quest NPCs, Invaders and enemies, Services). */
function peopleCards(slug: string, own?: { groups?: any[] }): string {
  const pp = own?.groups?.length ? own : COMP?.people?.[slug];
  if (!pp?.groups?.length) return '';
  const card = (g: { group: string; people: { name: string; role: string; where?: string }[] }) => `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 class="text-xs font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(g.group)} <span class="text-zinc-500 font-normal">${g.people.length}</span></h3>
      <ul class="mt-2 space-y-2">${g.people.map((x) => `<li class="text-sm"><span class="font-semibold text-white">${rich(x.name)}</span> <span class="text-zinc-400">· ${esc(x.role)}</span>${x.where ? `<span class="block text-xs text-zinc-500 mt-0.5">${esc(x.where)}</span>` : ''}</li>`).join('')}</ul>
    </div>`;
  return `<section id="people" class="mt-6 scroll-mt-20"><h2 class="text-base font-bold text-white">${esc(ui('infoServices'))}</h2><div class="mt-3 grid gap-3 sm:grid-cols-2">${pp.groups.map(card).join('')}</div></section>`;
}

function areaBody(game: string, gameKey: string, a: GuideArea, areas: AreaLink[], prev?: AreaLink, next?: AreaLink, up = '../../../', achs: any[] = []) {
  const items = a.items.map(cleanEntry);
  // Entries in the same container or spot are one line ("Ornate Chest under the Scuffed Rock: Harper's Map, Harper's
  // Notebook"), ticked together (the row's id joins theirs with "+"), as in the app. A secret about that spot joins it.
  const merged = mergeSameSpot({ items, secrets: a.secrets });
  const mergedIds = new Set(merged.flatMap((g) => g.ids));
  const miss = items.filter((e) => e.missable && !mergedIds.has(e.id));
  const rest = items.filter((e) => !e.missable && !mergedIds.has(e.id));
  const secretsLeft = a.secrets.filter((e) => !mergedIds.has(e.id));
  const missSec = (a.sections || []).filter((x: any) => x.check && /miss/i.test(x.orig || x.title));
  const otherSec = (a.sections || []).filter((x) => !missSec.includes(x));
  // The exact final step and what locks a missable out, under the item.
  const extra = (how?: string, lockout?: string) =>
    `${how ? `<span class="block text-xs text-zinc-400 mt-0.5"><span class="text-zinc-500">${esc(ui('itemHow'))}:</span> ${esc(how)}</span>` : ''}` +
    `${lockout ? `<span class="block text-xs text-amber-300/90 mt-0.5"><span class="text-amber-200/70">${esc(ui('itemLockout'))}:</span> ${esc(lockout)}</span>` : ''}`;
  const itemHtml = (e: GuideEntry) => `<strong class="text-white">${esc(e.name)}</strong>${e.where ? `<span class="text-zinc-400">: ${esc(e.where)}</span>` : ''}${extra(e.how, e.lockout)}`;
  const groupItems = (g: (typeof merged)[number]) => items.filter((e) => g.ids.includes(e.id));
  const groupHtml = (g: (typeof merged)[number]) => {
    const parts = groupItems(g);
    const [spot, ...names] = g.label.split(': ');
    return `<strong class="text-white">${esc(spot)}</strong><span class="text-zinc-300">: ${esc(names.join(': '))}</span>${g.where ? `<span class="block text-xs text-zinc-400 mt-0.5">${esc(g.where)}</span>` : ''}${extra(parts.find((e) => e.how)?.how, parts.find((e) => e.lockout)?.lockout)}`;
  };
  const missGroups = merged.filter((g) => g.missable);
  const restGroups = merged.filter((g) => !g.missable);
  const missIds = [...missGroups.flatMap((g) => g.ids), ...miss.map((e) => e.id), ...missSec.flatMap((x) => x.entries.map((e) => e.id))];
  // On this page: links to each section that has something (a closed section opens when its link is used).
  const sectionLinks: [string, string][] = [
    ...((a.walkthrough || []).length ? [['walkthrough', ui('walkthrough')] as [string, string]] : []),
    ...((a.choices || []).length ? [['choices', ui('choicesHere')] as [string, string]] : []),
    ...(missIds.length ? [['dont-miss', ui('dontMiss')] as [string, string]] : []),
    ...otherSec.map((x, i) => [`sec-${i + 1}`, x.title] as [string, string]),
    ...((a.fights || []).length ? [['fights', ui('fights')] as [string, string]] : []),
    ...(achs.length ? [['achievements', ui('achHere')] as [string, string]] : []),
    ...(rest.length || restGroups.length ? [['items', ui('items')] as [string, string]] : []),
    ...(secretsLeft.length ? [['secrets', ui('secrets')] as [string, string]] : []),
    ...(a.enemies.length ? [['enemies', ui('enemies')] as [string, string]] : []),
    ...(a.shops.length ? [['shops', ui('shops')] as [string, string]] : []),
    ...(a.tips.length ? [['tips', ui('tips')] as [string, string]] : []),
  ];
  const jump = sectionLinks.length > 2
    ? `<nav aria-label="${esc(ui('onThisPage'))}" class="mt-4 flex flex-wrap items-center gap-1.5 text-xs"><span class="text-zinc-500 mr-1">${esc(ui('onThisPage'))}:</span>${sectionLinks.map(([id, label]) => `<a href="#${id}" class="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300 hover:text-white hover:border-[#a87ffb]/40">${esc(label)}</a>`).join('')}</nav>`
    : '';
  // Prefer the page's own quest list (its summary box) over names found in the entries.
  const quests = a.info?.quests?.length ? [] : relatedQuests(a);
  // The summary box: what this place is and how to get there. Connected areas link to their guide pages.
  const info = a.info;
  const areaLink = (name: string) => {
    const l = areas.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return l ? `<a class="text-[#a87ffb] hover:text-white" href="../${esc(l.slug)}/index.html">${esc(name)}</a>` : esc(name);
  };
  const infoRow = (label: string, html: string) => `<div class="flex gap-2 py-1"><dt class="w-32 shrink-0 text-zinc-500">${esc(label)}</dt><dd class="min-w-0 text-zinc-200">${html}</dd></div>`;
  const infoBox = info && (info.region || info.levels || info.quests?.length || info.services?.length || info.enemyTypes?.length || info.directions || info.connected?.length || info.coords)
    ? `<dl class="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">${[
        info.region && infoRow(ui('infoRegion'), esc(info.region)),
        info.levels && infoRow(ui('infoLevels'), esc(info.levels)),
        info.directions && infoRow(ui('infoWay'), `${esc(info.directions)}${info.coords ? ` <span class="text-zinc-500">(${esc(info.coords)})</span>` : ''}`),
        !info.directions && info.coords && infoRow(ui('infoCoords'), esc(info.coords)),
        info.connected?.length && infoRow(ui('infoConnected'), info.connected.map(areaLink).join(', ')),
        info.quests?.length && infoRow(ui('relatedQuests'), info.quests.map(esc).join(' · ')),
        info.services?.length && !(a as any).people?.groups?.length && !COMP?.people?.[a.slug] && infoRow(ui('infoServices'), info.services.map(esc).join(' · ') + ((a.incomplete || []).includes('services') ? incompleteTag() : '')),
        info.enemyTypes?.length && infoRow(ui('infoEnemies'), info.enemyTypes.map(esc).join(' · ')),
      ].filter(Boolean).join('')}</dl>`
    : '';
  // What this page doesn't list, said plainly (a section that's simply missing reads as an oversight).
  const empty = [!a.items.length && ui('items'), !a.secrets.length && ui('secrets'), !a.enemies.length && ui('enemies'), !a.shops.length && ui('shops')].filter(Boolean) as string[];
  const notListed = empty.length && a.items.length + a.secrets.length + a.enemies.length + a.shops.length > 0
    ? `<p class="mt-4 text-xs text-zinc-500">${esc(ui('notListed', { list: empty.map((x) => x.toLowerCase()).join(', ') }))}</p>`
    : '';
  const dontMiss = missIds.length
    ? `<section id="dont-miss" class="mt-6 scroll-mt-20 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
        <h2 class="flex items-center gap-2 px-1 pb-1 text-base font-bold text-amber-200">${ICON.warn} ${esc(ui('dontMiss'))} <span class="text-xs font-normal text-amber-200/70" data-count="${esc(missIds.join(','))}">0/${missIds.length}</span></h2>
        ${missGroups.map((g) => checkRow(g.ids.join('+'), groupHtml(g), true)).join('')}${miss.map((e) => checkRow(e.id, itemHtml(e), true)).join('')}${missSec.flatMap((x) => x.entries.map((e) => checkRow(e.id, esc(e.text), true))).join('')}
      </section>`
    : '';
  const foes = a.enemies.map(cleanEntry);
  const chip = (label: string, v?: string) => (v ? `<span class="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-300"><span class="text-zinc-500">${label}</span> ${esc(v)}</span>` : '');
  const enemies = foes.length
    ? `<div class="grid sm:grid-cols-2 gap-2">${foes
        .map((e) => `<div id="e-${esc(e.id)}" class="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 scroll-mt-20"><div class="font-semibold text-white text-sm">${esc(e.name)}</div><div class="mt-1.5 flex flex-wrap gap-1.5">${chip(ui('weakTo'), e.weakness)}${chip(ui('stealDrop'), e.steal)}</div>${e.notes ? `<p class="mt-1.5 text-xs text-zinc-400">${esc(e.notes)}</p>` : ''}</div>`)
        .join('')}</div>`
    : '';
  // Key fights: one card per boss or set-piece battle, its details as labelled lines.
  const fightRow = (label: string, v?: string) => (v ? `<p class="mt-1 text-sm text-zinc-300"><span class="text-zinc-500">${esc(label)}:</span> ${esc(v)}</p>` : '');
  const fights = (a.fights || []).length
    ? `<div class="space-y-2">${(a.fights || [])
        .map((f) => `<div id="${esc(f.id)}" class="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5"><div class="font-semibold text-white">${esc(f.name)}</div>${fightRow(ui('fightEnemies'), f.enemies)}${fightRow(ui('fightThreats'), f.threats)}${fightRow(ui('fightWeak'), f.weaknesses)}${fightRow(ui('fightTactics'), f.tactics)}${fightRow(ui('fightRewards'), f.rewards)}</div>`)
        .join('')}</div>`
    : '';
  const shops = a.shops.length ? `<ul class="space-y-1.5 px-3">${a.shops.map(cleanEntry).map((e) => `<li id="e-${esc(e.id)}" class="text-sm scroll-mt-20"><strong class="text-white">${esc(e.name)}</strong>${e.sells ? `<span class="text-zinc-400">: ${esc(e.sells)}</span>` : ''}</li>`).join('')}</ul>` : '';
  const tips = a.tips.length ? `<ul class="list-disc pl-8 space-y-1 text-sm text-zinc-300">${a.tips.map((t, i) => `<li id="tip-${i + 1}" class="scroll-mt-20">${esc(t)}</li>`).join('')}</ul>` : '';
  const navCard = (x: AreaLink | undefined, dir: 'prev' | 'next') =>
    x
      ? `<a href="../${esc(x.slug)}/index.html" class="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/[0.03] hover:border-[#a87ffb]/40 hover:bg-white/[0.06] px-4 py-3 ${dir === 'next' ? 'text-right' : ''}"><div class="text-[11px] uppercase tracking-wide text-zinc-500">${dir === 'prev' ? `&larr; ${esc(ui('previous'))}` : `${esc(ui('next'))} &rarr;`}</div><div class="text-sm font-semibold text-white truncate">${esc(x.name)}</div></a>`
      : '<span class="flex-1"></span>';
  // Flagship pages: the short version, the walkthrough (entries ticked where you meet them) and the choices.
  const fightById = new Map((a.fights || []).map((f) => [f.id, f]));
  const entryRow = (id: string) => {
    const it = items.find((e) => e.id === id);
    const isNew = /^fl\d+$/.test(id) ? ` <span class="ml-1 rounded bg-[#a87ffb]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#c4b0ff]">${esc(ui('newEntry'))}</span>` : '';
    const miss = (m?: boolean) => (m ? ` <span class="text-[10px] font-bold uppercase text-amber-300">${esc(ui('dontMiss'))}</span>` : '');
    if (it) return checkRow(it.id, itemHtml(it) + miss(it.missable) + isNew);
    const se = a.secrets.find((e) => e.id === id);
    if (se) return checkRow(se.id, `<span class="text-zinc-300">${esc(se.text)}</span>${isNew}`);
    const ce = (a.sections || []).flatMap((x) => x.entries).find((e) => e.id === id);
    return ce ? checkRow(ce.id, esc(ce.text)) : '';
  };
  const walk = (a.walkthrough || []).length
    ? `<section id="walkthrough" class="mt-8 scroll-mt-20">
        <h2 class="text-xl font-bold text-white">${esc(ui('walkthrough'))}${(a.incomplete || []).includes('walkthrough') ? incompleteTag() : ''}</h2>
        <p class="mt-1 text-sm text-zinc-500">${esc(ui('walkthroughIntro'))}</p>
        <ol class="mt-4 space-y-5">${(a.walkthrough || [])
          .map((st, i) => `<li id="${esc(st.id)}" class="relative pl-10 scroll-mt-20">
            <span class="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-[#a87ffb]/40 bg-[#a87ffb]/10 text-sm font-bold text-[#c4b0ff]">${i + 1}</span>
            <h3 class="font-semibold text-white leading-7">${esc(st.title)}</h3>
            <p class="mt-1 text-[15px] leading-relaxed text-zinc-300">${rich(st.text)}</p>
            ${(st.fights || []).map((fid) => fightById.get(fid)).filter(Boolean).map((f) => `<a href="#${esc(f!.id)}" class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200 hover:border-rose-400/60">${ICON.enemies}<span class="text-rose-300/80">${esc(ui('keyFight'))}:</span> ${esc(f!.name)}</a>`).join(' ')}
            ${(st.entries || []).length ? `<div class="mt-2 rounded-xl border border-white/5 bg-white/[0.02] py-1">${(st.entries || []).map(entryRow).join('')}</div>` : ''}
            ${st.tip ? `<p class="mt-2 text-sm text-emerald-200/90"><span class="font-semibold text-emerald-300">${esc(ui('stepTip'))}:</span> ${rich(st.tip)}</p>` : ''}
            ${st.warn ? `<p class="mt-1.5 text-sm text-amber-200/90"><span class="font-semibold text-amber-300">${esc(ui('stepWarn'))}:</span> ${rich(st.warn)}</p>` : ''}
          </li>`)
          .join('')}</ol>
      </section>`
    : '';
  const adv = a.advice;
  const adviceList = (title: string, list: string[], tone: string) => (list.length ? `<div><h3 class="text-xs font-bold uppercase tracking-wide ${tone}">${esc(title)}</h3><ul class="mt-1.5 space-y-1.5 text-sm text-zinc-300">${list.map((x) => `<li class="flex gap-2"><span class="${tone}">&bull;</span><span>${esc(x)}</span></li>`).join('')}</ul></div>` : '');
  const shortVersion = adv && (adv.matters.length || adv.mistakes.length)
    ? `<section class="mt-6 rounded-2xl border border-[#a87ffb]/25 bg-gradient-to-br from-[#a87ffb]/[0.08] to-transparent p-4">
        <h2 class="text-base font-bold text-white">${esc(ui('shortVersion'))}</h2>
        <div class="mt-3 grid gap-4 sm:grid-cols-2">${adviceList(ui('adviceMatters'), adv.matters, 'text-[#c4b0ff]')}${adviceList(ui('adviceMistakes'), adv.mistakes, 'text-amber-300')}${adviceList(ui('adviceSkip'), adv.skip, 'text-zinc-400')}</div>
      </section>`
    : '';
  const choices = (a.choices || []).length
    ? `<section id="choices" class="mt-8 scroll-mt-20">
        <div class="flex items-center gap-3"><h2 class="flex-1 text-xl font-bold text-white">${esc(ui('choicesHere'))}${(a.incomplete || []).includes('choices') ? incompleteTag() : ''}</h2></div>
        <p class="mt-1 text-sm text-zinc-500">${esc(ui('choicesIntro'))}</p>
        <div class="mt-4 space-y-3">${(a.choices || [])
          .map((c) => `<div id="${esc(c.id)}" class="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <h3 class="font-semibold text-white">${esc(c.title)}</h3>
            ${c.when ? `<p class="text-xs text-zinc-500 mt-0.5">${esc(c.when)}</p>` : ''}
            <ul class="mt-2.5 space-y-2">${c.options.map((o) => `<li class="text-sm"><span class="font-semibold text-zinc-100">${esc(o.label)}</span><span class="block mt-0.5 text-zinc-400">&rarr; ${esc(o.outcome)}</span></li>`).join('')}</ul>
            ${c.recommended ? `<p class="mt-2.5 text-xs text-emerald-200/90"><span class="font-semibold text-emerald-300">${esc(ui('recommended'))}:</span> ${esc(c.recommended)}</p>` : ''}
            ${c.note ? `<p class="mt-1 text-xs text-amber-200/90">${esc(c.note)}</p>` : ''}
          </div>`)
          .join('')}</div>
      </section>`
    : '';
  const box = (id: string) => `<input type="search" data-filter="#${id}" placeholder="${esc(ui('searchAreas'))}" class="w-full mb-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]/60">`;
  const sidebar = (id: string) => `<nav aria-label="${esc(game)}" class="qc-scroll">${`<a href="../index.html" class="block px-2.5 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-400 hover:text-white">${esc(game)}</a>`}${guideSearchBox(gameKey, `#${id}`, 'mb-2')}<ul id="${id}" class="space-y-0.5">${areaList(gameKey, areas, a.slug, '../')}</ul></nav>`;

  return `
  <div class="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8">
    <aside class="hidden lg:block"><div class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto qc-scroll pr-1">${sidebar('qc-areas-side')}</div></aside>
    <article class="min-w-0 max-w-3xl">
      <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="${up}${LP}guides/index.html">${esc(ui('navGuides'))}</a> / <a class="hover:text-white" href="../index.html">${esc(game)}</a></p>
      <h1 class="text-3xl font-bold text-white leading-tight">${esc(a.name)}</h1>
      <div class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
        <span>${esc(ui('guideOf', { game }))}${a.story ? ` · ${esc(a.story)}` : ''}</span>
        ${a.verified === true ? `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">&#10003; ${esc(ui('checkedBadge'))}</span>` : ''}
      </div>
      <a href="../index.html" class="lg:hidden mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm font-semibold text-white hover:bg-white/[0.06]"><span class="text-zinc-400">&larr;</span> ${esc(ui('allAreas'))}</a>
      ${a.overview ? `<p class="mt-5 text-zinc-300 leading-relaxed">${rich(a.overview)}</p>` : ''}
      ${missionsHere(a.slug, areas)}
      ${infoBox}
      ${peopleCards(a.slug, (a as any).people)}
      ${shortVersion}
      ${jump}
      ${quests.length ? `<p class="mt-3 text-sm text-zinc-400"><span class="text-zinc-500">${esc(ui('relatedQuests'))}:</span> ${quests.map((q) => `<span class="inline-block rounded-md bg-white/[0.05] px-2 py-0.5 text-zinc-200 mr-1 mb-1">${esc(q)}</span>`).join('')}</p>` : ''}
      ${walk}
      ${choices}
      ${walk ? `<h2 class="mt-10 text-xl font-bold text-white">${esc(ui('checklists'))}</h2>` : ''}
      ${dontMiss}
      ${otherSec
        .map((x) =>
          fold(x.title, ICON.list, x.check ? x.entries.map((e) => checkRow(e.id, esc(e.text), true)).join('') : `<ul class="list-disc pl-8 space-y-1 text-sm text-zinc-300">${x.entries.map((e) => `<li id="e-${esc(e.id)}" class="scroll-mt-20">${esc(e.text)}</li>`).join('')}</ul>`, {
            ids: x.check ? x.entries.map((e) => e.id) : undefined,
            open: true,
            id: `sec-${otherSec.indexOf(x) + 1}`,
          }),
        )
        .join('')}
      ${achs.length ? fold(ui('achHere'), ICON.list, achs.slice().sort((x, y) => Number(!!y.missable) - Number(!!x.missable)).map((x) => `<div class="px-3 py-2 text-sm text-zinc-300"><strong class="text-white">${esc(x.name)}</strong>${x.missable ? ` <span class="text-amber-400 text-[11px] font-bold uppercase">${esc(ui('achMissable'))}</span>` : ''}${x.how ? `<span class="block text-zinc-400 text-xs mt-0.5">${esc(x.how)}</span>` : ''}</div>`).join('') + `<p class="px-3 pt-1 text-xs"><a class="text-[#a87ffb] hover:text-white" href="../achievements/index.html">${esc(ui('achLink'))} &rarr;</a></p>`, { open: achs.some((x) => x.missable), id: 'achievements' }) : ''}
      ${fold(ui('items'), ICON.items, restGroups.map((g) => checkRow(g.ids.join('+'), groupHtml(g), true)).join('') + rest.map((e) => checkRow(e.id, itemHtml(e), true)).join(''), { ids: [...restGroups.flatMap((g) => g.ids), ...rest.map((e) => e.id)], open: true, id: 'items', incomplete: (a.incomplete || []).includes('items') })}
      ${fold(ui('secrets'), ICON.secrets, secretsLeft.map((e) => checkRow(e.id, esc(e.text), true)).join(''), { ids: secretsLeft.map((e) => e.id), open: true, id: 'secrets', incomplete: (a.incomplete || []).includes('secrets') })}
      ${fold(ui('fights'), ICON.enemies, fights, { open: true, id: 'fights', incomplete: (a.incomplete || []).includes('fights') })}
      ${fold(ui('enemies'), ICON.enemies, enemies, { id: 'enemies' })}
      ${fold(ui('shops'), ICON.shops, shops, { id: 'shops' })}
      ${fold(ui('tips'), ICON.tips, tips, { open: true, id: 'tips' })}
      ${notListed}
      ${prev || next ? `<div class="mt-8 flex gap-3">${navCard(prev, 'prev')}${navCard(next, 'next')}</div>` : ''}
      ${cta(up, game)}
      ${a.sourceLinks?.pages?.length
        ? // A flagship page written from a source pack: the wiki's articles, linked, and its licence.
          `<p class="mt-6 text-xs text-zinc-500">${ui('sourcesFrom', { wiki: esc(a.sourceLinks.wiki), pages: a.sourceLinks.pages.map((x) => (x.url ? `<a class="text-zinc-400 underline hover:text-white" href="${esc(x.url)}" rel="nofollow noopener" target="_blank">${esc(x.title)}</a>` : esc(x.title))).join(', ') })}${a.sourceLinks.license ? ` ${ui('sourcesLicence', { licence: a.sourceLinks.licenseUrl ? `<a class="text-zinc-400 underline hover:text-white" href="${esc(a.sourceLinks.licenseUrl)}" rel="nofollow noopener" target="_blank">${esc(a.sourceLinks.license)}</a>` : esc(a.sourceLinks.license) })}` : ''}</p>`
        : a.sources.length ? `<p class="mt-6 text-xs text-zinc-500">${esc(ui('sourcesChecked', { list: a.sources.join(', ') }))}</p>` : ''}
    </article>
  </div>`;
}

/**
 * The homepage's "Free guides" section, between the QC-GUIDES markers in Marketing_Website_Files/index.html: a tile per
 * game with published pages, rewritten on every run so it grows with the guides. Draft-only games are left out.
 */
/** The homepage guides section's own words, per language version of the main page. */
const HOME_GUIDES: Record<string, { h: string; p: string; all: string; areas: (n: number) => string }> = {
  en: { h: 'Free guides: what not to miss', p: 'Area-by-area checklists of items, secrets, missables and enemy weaknesses, so you never walk past the good stuff.', all: 'See all guides', areas: (n) => `${n} area${n === 1 ? '' : 's'}` },
  es: { h: 'Guías gratis: lo que no te puedes perder', p: 'Listas por zona de objetos, secretos, cosas que se pueden perder y debilidades de enemigos, para que nunca pases de largo lo bueno.', all: 'Ver todas las guías', areas: (n) => `${n} ${n === 1 ? 'zona' : 'zonas'}` },
  pt: { h: 'Guias grátis: o que não perder', p: 'Listas por área de itens, segredos, perdíveis e fraquezas dos inimigos, para você nunca passar batido pelo que importa.', all: 'Ver todos os guias', areas: (n) => `${n} ${n === 1 ? 'área' : 'áreas'}` },
  de: { h: 'Kostenlose Guides: Was du nicht verpassen solltest', p: 'Checklisten für jedes Gebiet mit Gegenständen, Geheimnissen, verpassbaren Dingen und Gegnerschwächen, damit dir nichts Gutes entgeht.', all: 'Alle Guides ansehen', areas: (n) => `${n} ${n === 1 ? 'Gebiet' : 'Gebiete'}` },
  fr: { h: 'Guides gratuits : ce qu’il ne faut pas manquer', p: 'Des listes zone par zone d’objets, de secrets, d’éléments manquables et de faiblesses des ennemis, pour ne jamais passer à côté de l’essentiel.', all: 'Voir tous les guides', areas: (n) => `${n} ${n === 1 ? 'zone' : 'zones'}` },
  ru: {
    h: 'Бесплатные гайды: что нельзя пропустить',
    p: 'Чек-листы по локациям: предметы, секреты, то, что легко пропустить, и слабости врагов, чтобы вы ничего не упустили.',
    all: 'Все гайды',
    areas: (n) => {
      const m10 = n % 10, m100 = n % 100;
      return `${n} ${m10 === 1 && m100 !== 11 ? 'локация' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'локации' : 'локаций'}`;
    },
  },
  ja: { h: '無料ガイド：見逃せないもの', p: 'エリアごとのアイテム、秘密、取り逃し要素、敵の弱点をチェックリストで。大事なものを見逃しません。', all: 'すべてのガイドを見る', areas: (n) => `${n}エリア` },
  ko: { h: '무료 가이드: 놓치면 안 되는 것들', p: '지역별 아이템, 비밀, 놓치기 쉬운 요소, 적의 약점 체크리스트로 중요한 것을 놓치지 마세요.', all: '모든 가이드 보기', areas: (n) => `${n}개 지역` },
  zh: { h: '免费攻略：不容错过的内容', p: '按区域整理的物品、秘密、可错过要素和敌人弱点清单，让你不再错过任何好东西。', all: '查看全部攻略', areas: (n) => `${n} 个区域` },
};

/**
 * The version under the homepage's download buttons ("Version 0.4.0 beta, 64-bit Windows…") follows package.json, in
 * the English page and every language version. The paragraph is found by its tag; only the number inside it changes.
 * The site translation cache (scripts/i18n/site/<lang>.json) is updated the same way, so translate-site.ts doesn't
 * see "new" text and translate it again.
 */
function updateVersion() {
  const version = String(JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return;
  const LINE = /(<p class="text-sm text-zinc-500 mt-4">[^<]*?)\b\d+\.\d+\.\d+\b/;
  let pages = 0;
  for (const code of Object.keys(HOME_GUIDES)) {
    const file = code === 'en' ? path.join(OUT, 'index.html') : path.join(OUT, code, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const next = html.replace(LINE, `$1${version}`);
    if (next !== html) fs.writeFileSync(file, next);
    if (LINE.test(html)) pages++;
  }
  // The cache's English key and its translation, for the same line.
  const cacheDir = path.resolve('scripts/i18n/site');
  if (fs.existsSync(cacheDir)) {
    for (const f of fs.readdirSync(cacheDir).filter((x) => x.endsWith('.json'))) {
      const file = path.join(cacheDir, f);
      const raw = fs.readFileSync(file, 'utf8');
      const cache: Record<string, string> = JSON.parse(raw);
      let changed = false;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(cache)) {
        if (/^Version \d+\.\d+\.\d+ beta, 64-bit Windows\./.test(k)) {
          const nk = k.replace(/\d+\.\d+\.\d+/, version);
          out[nk] = v.replace(/\b\d+\.\d+\.\d+\b/, version);
          changed = changed || nk !== k;
        } else out[k] = v;
      }
      if (changed) fs.writeFileSync(file, JSON.stringify(out, null, 2).replace(/\n/g, raw.includes('\r\n') ? '\r\n' : '\n'));
    }
  }
  console.log(`Homepage version text: ${version} (${pages} page(s)).`);
}

/** The app's releases for "Recent updates" (system/changelog, kept by scripts/pipeline/changelog.ts), newest first. */
let CHANGELOG: { v: string; date: string; text: string; tr?: Record<string, string> }[] = [];
const releaseText = (e: (typeof CHANGELOG)[number], code: string) => (code !== 'en' && e.tr?.[code]) || e.text;

/** The /updates/ page, in each language, with the site's header: every release, newest first. */
function renderUpdates(sitemap: string[]) {
  if (!CHANGELOG.length) return;
  for (const code of Object.keys(LANG_TAG)) {
    setLang(code);
    const dir = path.join(OUT, langPath(code), 'updates');
    fs.mkdirSync(dir, { recursive: true });
    const body = `<div class="max-w-3xl">
      <h1 class="text-3xl font-bold text-white">${esc(ui('updatesTitle'))}</h1>
      <p class="text-zinc-400 mt-2">${esc(ui('updatesIntro'))}</p>
      <ol class="mt-6 space-y-3">${CHANGELOG.map((e) => `<li id="v${esc(e.v.replace(/\./g, '-'))}" class="scroll-mt-20 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><div class="flex flex-wrap items-baseline gap-x-3"><span class="font-bold text-white">${esc(e.v)}</span><span class="text-xs text-zinc-500">${esc(e.date)}</span></div><p class="mt-1 text-zinc-300 leading-relaxed">${esc(releaseText(e, code))}</p></li>`).join('')}</ol>
    </div>`;
    fs.writeFileSync(path.join(dir, 'index.html'), page({ title: ui('updatesTitle') + ' – Quest Compendium', description: ui('updatesIntro'), depth: code === 'en' ? 1 : 2, canonical: `${SITE}/${langPath(code)}updates/`, langs: Object.keys(LANG_TAG), path: 'updates/', body }));
    sitemap.push(`${SITE}/${langPath(code)}updates/`);
  }
  setLang('en');
  console.log(`Updates page: ${CHANGELOG.length} release(s), ${Object.keys(LANG_TAG).length} language(s).`);
}

/** The homepage's "Recent updates" section (id="whats-new"), in each language: the latest releases and a link to all. */
function updateHomepageUpdates() {
  if (!CHANGELOG.length) return;
  let done = 0;
  for (const code of Object.keys(LANG_TAG)) {
    const file = path.join(OUT, langPath(code), 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const a = html.indexOf('<section id="whats-new"');
    const b = a < 0 ? -1 : html.indexOf('</section>', a);
    if (a < 0 || b < 0) continue;
    setLang(code);
    const nl = html.includes('\r\n') ? '\r\n' : '\n';
    const items = CHANGELOG.slice(0, 6).map((e) => `          <li class="flex gap-3"><i data-lucide="sparkles" class="w-5 h-5 text-[#a87ffb] shrink-0 mt-0.5"></i><span><strong class="text-white">${esc(e.v)}:</strong> ${esc(releaseText(e, code))}</span></li>`).join(nl);
    const section = [
      '<section id="whats-new" class="max-w-6xl mx-auto px-6 pb-12">',
      '      <div class="border border-white/10 rounded-2xl p-6 sm:p-8">',
      `        <div class="flex flex-wrap items-baseline justify-between gap-3 mb-4"><h2 class="text-xl font-bold text-white">${esc(ui('updatesTitle'))}</h2><a href="${code === 'en' ? '' : '../'}${langPath(code)}updates/" class="text-[#a87ffb] hover:text-white font-semibold whitespace-nowrap">${esc(ui('allUpdates'))} &rarr;</a></div>`,
      '        <ul class="space-y-2 text-zinc-400">', items, '        </ul>', '      </div>', '    ',
    ].join(nl);
    fs.writeFileSync(file, html.slice(0, a) + section + html.slice(b));
    done++;
  }
  setLang('en');
  console.log(`Homepage "Recent updates" updated on ${done} page(s).`);
}

/**
 * The homepage's "Free guides" section, between the QC-GUIDES markers: a tile per game with published pages,
 * rewritten on every run so it grows with the guides. Done for the English main page and every language version
 * (Marketing_Website_Files/<lang>/index.html, made by scripts/i18n/translate-site.ts), each in its own language.
 */
function updateHomepage(games: { key: string; game: string; published: number; langs?: string[]; appId?: number }[]) {
  const pages = [{ code: 'en', file: path.join(OUT, 'index.html'), up: '' }].concat(
    Object.keys(HOME_GUIDES)
      .filter((c) => c !== 'en')
      .map((c) => ({ code: c, file: path.join(OUT, c, 'index.html'), up: '../' })),
  );
  let done = 0;
  for (const pg of pages) {
    if (!fs.existsSync(pg.file)) continue;
    const L = HOME_GUIDES[pg.code];
    const html = fs.readFileSync(pg.file, 'utf8');
    const nl = html.includes('\r\n') ? '\r\n' : '\n';
    const start = '<!-- QC-GUIDES:START -->';
    const end = '<!-- QC-GUIDES:END -->';
    const a = html.indexOf(start);
    const b = html.indexOf(end);
    if (a < 0 || b < a) {
      console.log(`Homepage guides section not found in ${path.relative(OUT, pg.file)} (no QC-GUIDES markers); skipped.`);
      continue;
    }
    const tiles = games
      .slice()
      .sort((x, y) => y.published - x.published)
      .slice(0, 8)
      .map(
        (g) =>
          `        <a href="${g.langs?.includes(pg.code) && pg.code !== 'en' ? '' : pg.up}guides/${esc(g.key)}/index.html" class="block rounded-2xl overflow-hidden border border-white/10 bg-white/5 hover:border-[#a87ffb]/50 hover:bg-white/[0.07] transition-colors">` +
          cardArt(g.game, g.appId, g.key) +
          `<div class="${CARD_MODE === 'A' ? 'p-3' : 'p-4'}"><div class="text-white font-bold leading-snug${CARD_MODE === 'A' ? ' text-sm break-words' : ''}">${esc(g.game)}</div>` +
          `<div class="text-sm text-zinc-400 mt-1">${esc(L.areas(g.published))}</div></div></a>`,
      )
      .join(nl);
    const block = games.length
      ? [
          start,
          '      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">',
          '        <div>',
          `          <h2 class="text-2xl sm:text-3xl font-bold text-white">${esc(L.h)}</h2>`,
          `          <p class="text-zinc-400 mt-2 max-w-2xl">${esc(L.p)}</p>`,
          '        </div>',
          `        <a href="${games.some((g) => g.langs?.includes(pg.code)) && pg.code !== 'en' ? '' : pg.up}guides/index.html" class="text-[#a87ffb] hover:text-white font-semibold whitespace-nowrap">${esc(L.all)} &rarr;</a>`,
          '      </div>',
          `      <div class="grid ${CARD_MODE === 'A' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'}">`,
          tiles,
          '      </div>',
          end,
        ].join(nl)
      : `${start}${nl}${end}`;
    fs.writeFileSync(pg.file, html.slice(0, a) + block + html.slice(b + end.length));
    done++;
  }
  console.log(`Homepage guides section updated on ${done} page(s): ${Math.min(games.length, 8)} game(s) shown.`);
}

/** One game's pages (area pages and the game page) in the current language (setLang). */
function renderGame(key: string, gameName: string, visible: { slug: string; name: string }[], byslug: Map<string, GuideArea>, t: any, langs: string[], sitemap: string[], allTr: Record<string, any> = {}, ach: any = null, appId?: number) {
  const dir = path.join(OUT, LP, 'guides', key);
  fs.mkdirSync(dir, { recursive: true });
  const extra = LANG === 'en' ? 0 : 1; // the language folder adds a level
  // The achievement guide in this language (English, or a translation from translate-guide.ts).
  const achHere = LANG === 'en' ? ach : localizeAch(ach, t);
  const achLangs = ach ? langs.filter((c) => c === 'en' || allTr[c]?.achievements) : [];
  const pageOf = (slug: string) => localize(byslug.get(slug)!, t?.areas?.[slug]);
  const groupName = (g: string) => (g && t?.groups?.[g]) || g;
  const groupOf = (o: any) => String(o.group || byslug.get(o.slug)?.group || '');
  const links: AreaLink[] = visible.map((o: any) => {
    const a = pageOf(o.slug);
    return { slug: o.slug, name: a.name, story: a.story, group: groupName(groupOf(o)) || undefined, total: totalOf(a), search: searchWords(a) };
  });
  // Only languages that have this page (an untranslated page is English-only).
  const pageLangs = (slug: string) => langs.filter((c) => c === 'en' || allTr[c]?.areas?.[slug]);
  visible.forEach((o, i) => {
    const a = pageOf(o.slug);
    // A local preview is always marked DRAFT (and kept out of search).
    const draft = a.status !== 'published' || !!PREVIEW;
    const adir = path.join(dir, o.slug);
    fs.mkdirSync(adir, { recursive: true });
    let title: string, description: string;
    const sg = shortGame(gameName);
    if (LANG === 'en') {
      // Place first, then what the page has (search results cut titles at about 60 characters).
      const missN = a.items.filter((e) => e.missable).length + (a.sections || []).filter((x) => x.check && /miss/i.test(x.title)).reduce((n, x) => n + x.entries.length, 0);
      const has = [a.items.length && 'Items', a.secrets.length && 'Secrets', missN ? 'Missables' : (a.fights || []).length ? 'Key Fights' : a.enemies.length ? 'Enemies' : ''].filter(Boolean) as string[];
      const base = `${a.name} – ${sg}${has.length ? `: ${joinAnd(has)}` : ' Guide'}`;
      title = a.seoTitle ? `${a.seoTitle} | Quest Compendium` : base.length + 19 <= 70 ? `${base} | Quest Compendium` : base;
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      const counts = [a.items.length && plural(a.items.length, 'item'), missN && plural(missN, 'missable'), a.secrets.length && plural(a.secrets.length, 'secret'), (a.fights || []).length && `key fights (${(a.fights || []).slice(0, 2).map((f) => f.name).join(', ')})`].filter(Boolean).join(', ');
      const lead = String(a.overview || '').split(/(?<=[.!?])\s+/)[0] || '';
      description = snippet(a.seoDescription || `Where to find everything in ${a.name} (${sg})${counts ? `: ${counts}` : ''}. ${lead}`.trim(), 158);
    } else {
      title = ui('areaTitle', { area: a.name, game: sg });
      description = ui('areaDesc', { area: a.name, game: sg }).slice(0, 158);
    }
    const url = `${SITE}/${LP}guides/${key}/${o.slug}/`;
    // A page not translated yet shows the English text in this language's folder: it names the English page as
    // canonical and stays out of the sitemap and the hreflang set until its translation is published.
    const untranslated = LANG !== 'en' && !t?.areas?.[o.slug];
    const ld = [
      breadcrumb([{ name: ui('navGuides'), url: `${SITE}/${LP}guides/` }, { name: sg, url: `${SITE}/${LP}guides/${key}/` }, { name: a.name, url }]),
      guideArticle({ headline: title.replace(/ \| Quest Compendium$/, ''), description, url, game: gameName, modified: Number((a as any).updatedAt) || undefined }),
    ];
    fs.writeFileSync(
      path.join(adir, 'index.html'),
      page({
        title,
        description,
        depth: 3 + extra,
        canonical: untranslated ? `${SITE}/guides/${key}/${o.slug}/` : url,
        ld,
        body: areaBody(gameName, key, a, links, links[i - 1], links[i + 1], '../'.repeat(3 + extra), achHere ? (achHere.list || []).filter((x: any) => x.area === o.slug) : []) + entPreview(),
        draft,
        guide: key,
        area: o.slug,
        // The page's entries, for the report form's "which entry?" picker.
        entries: [
          ...a.items.map((e) => ({ id: e.id, label: String(e.name || '') })),
          ...a.secrets.map((e) => ({ id: e.id, label: String(e.text || e.name || '').slice(0, 70) })),
          ...(a.sections || []).filter((x) => x.check).flatMap((x) => x.entries.map((e) => ({ id: e.id, label: String(e.text || '').slice(0, 70) }))),
        ].filter((e) => e.id && e.label),
        langs: untranslated ? [] : pageLangs(o.slug),
        path: `guides/${key}/${o.slug}/`,
      }),
    );
    if (!draft && !untranslated) sitemap.push(`${SITE}/${LP}guides/${key}/${o.slug}/`);
  });
  // Checked against sources: walkthrough pages that passed their check, and compendium pages whose review passed (one
  // held back by a later rebuild, or whose rewrite failed, doesn't count). "All" only when every one passed.
  const ents = COMP?.entities || [];
  const checkedTotal = visible.length + ents.length;
  const checked = visible.filter((o) => byslug.get(o.slug)!.verified === true).length + ents.filter((e: any) => e.review?.status === 'passed' && !e.v2Held && !e.rewriteFailed).length;
  const totalChecks = links.reduce((n, l) => n + l.total, 0);
  const missables = visible.reduce((n, o) => n + byslug.get(o.slug)!.items.filter((e) => e.missable).length, 0);
  // "1 area" / "2 areas": the singular label when the number is 1.
  const one = (n: number, key: string) => ui(n === 1 ? `${key}One` : key);
  const stat = (v: number | string, label: string) => `<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><div class="text-xl font-bold text-white">${v}</div><div class="text-xs text-zinc-500">${esc(label)}</div></div>`;
  let lastGroup = '';
  const rows = links
    .map((l) => {
      const head = l.group && l.group !== lastGroup ? `<h3 data-head="${esc(l.group)}" class="flex items-center gap-3 pt-6 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500"><span>${esc(l.group)}</span><span class="h-px flex-1 bg-white/10"></span></h3>` : '';
      lastGroup = l.group || lastGroup;
      return `${head}<a data-search="${esc(`${l.name} ${l.story || ''} ${l.search || ''}`)}"${l.group ? ` data-group="${esc(l.group)}"` : ''} href="${esc(l.slug)}/index.html" data-area-link="${esc(l.slug)}" data-name="${esc(l.name)}" class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-[#a87ffb]/40 mb-2">
          <span class="flex-1 min-w-0"><span class="block font-semibold text-white">${esc(l.name)}</span>${l.story ? `<span class="block text-sm text-zinc-500 truncate">${esc(l.story)}</span>` : ''}</span>
          <span data-progress="${esc(key)}|${esc(l.slug)}|${l.total}"></span>
          <svg class="w-4 h-4 text-zinc-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </a>`;
    })
    .join('');
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    page({
      title: ui('gameTitle', { game: shortGame(gameName) }),
      description: ui('gameDesc', { game: shortGame(gameName) }),
      depth: 2 + extra,
      canonical: `${SITE}/${LP}guides/${key}/`,
      ld: [
        breadcrumb([{ name: ui('navGuides'), url: `${SITE}/${LP}guides/` }, { name: shortGame(gameName), url: `${SITE}/${LP}guides/${key}/` }]),
        { '@context': 'https://schema.org', '@type': 'CollectionPage', name: ui('gameTitle', { game: shortGame(gameName) }), url: `${SITE}/${LP}guides/${key}/`, inLanguage: LANG_TAG[LANG], about: { '@type': 'VideoGame', name: gameName } },
      ],
      guide: key,
      langs,
      path: `guides/${key}/`,
      body: `<div class="max-w-3xl">
          <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="../index.html">${esc(ui('navGuides'))}</a></p>
          ${artBox(gameName, appId, 'rounded-2xl border border-white/10 mb-5', key, true)}
          <h1 class="text-3xl font-bold text-white">${esc(ui('gameH1', { game: gameName }))}</h1>
          ${igdbFacts(key, gameName)}
          ${ttbFront(key)}
          <p class="text-zinc-400 mt-2">${esc(ui('gameIntro'))}</p>
          <div class="mt-5 grid grid-cols-2 ${checked ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-2">${stat(links.length, one(links.length, 'statAreas'))}${stat(totalChecks, one(totalChecks, 'statThings'))}${stat(missables, one(missables, 'statMissables'))}${checked ? stat(checked === checkedTotal ? ui('statAll') : ui('statOf', { n: checked, total: checkedTotal }), one(checkedTotal, 'statChecked')) : ''}</div>
          ${achHere ? `<a href="achievements/index.html" class="mt-5 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] hover:bg-amber-500/[0.12]"><span class="text-amber-300">&#9733;</span><span class="flex-1 min-w-0"><span class="block font-semibold text-white">${esc(ui('achLink'))}</span><span class="block text-xs text-zinc-400">${esc(ui('achCount', { n: (achHere.list || []).length }))} · ${(achHere.list || []).filter((x: any) => x.missable).length} ${esc(ui('achMissable').toLowerCase())}</span></span></a>` : ''}
          <a hidden data-continue="${esc(key)}" href="#" class="mt-5 flex items-center gap-3 px-4 py-3 rounded-xl border border-[#a87ffb]/40 bg-[#a87ffb]/10 hover:bg-[#a87ffb]/15"><span class="text-[#a87ffb]">&#9654;</span><span class="flex-1 min-w-0"><span class="block text-xs uppercase tracking-wide text-zinc-400">${esc(ui('continue'))}</span><span class="block font-semibold text-white truncate" data-continue-name></span></span></a>
          ${guideSearchBox(key, '#qc-area-list')}
          ${jumpBar(links.length, !!achHere)}
          <div id="qc-area-list">
          <section id="walkthrough" class="mt-10 scroll-mt-20">${sectionHead(ui('walkthrough'), ui('walkthroughSub'), `${links.length} ${one(links.length, 'statAreas')}`)}
          <div id="qc-area-rows" class="mt-2">${rows}</div></section>
          ${compSearch(key, visible, byslug)}
          </div>
          ${cta('../'.repeat(2 + extra), gameName)}
        </div>`,
      draft: visible.some((o) => byslug.get(o.slug)!.status !== 'published'),
    }),
  );
  if (visible.some((o) => byslug.get(o.slug)!.status === 'published')) sitemap.push(`${SITE}/${LP}guides/${key}/`);
  // The guide's search index, read by every guide page's search box and the apps.
  fs.writeFileSync(path.join(dir, 'search.json'), JSON.stringify(guideSearchIndex(key, visible, byslug)));
  if (achHere?.list?.length) renderAchievements(key, gameName, achHere, links, sitemap, achLangs);
  if (COMP?.entities.length && LANG === 'en') renderEntities(key, gameName, visible, byslug, sitemap);
}

/** The achievement guide page: roadmap, then every achievement (missable first), with ticks saved in the browser. */
/**
 * The game page's search (with the compendium): every entity, page, walkthrough step and entry, matched forgivingly
 * (fuzzyScore: apostrophes, plurals, one typo), each result a jump to its page and spot. And the compendium's entities by
 * type. Previews only.
 */
/**
 * The guide's search index (guides/{key}/search.json, per language): every chapter or area, walkthrough step, item,
 * secret, shop or NPC, enemy, key fight and entity page, each with its type, its chapter and a link to the exact spot
 * (the page's anchors; arriving there opens the section and highlights the entry). Read by the website's search box on
 * every guide page and by the apps.
 */
function guideSearchIndex(key: string, visible: { slug: string; name: string }[], byslug: Map<string, GuideArea>) {
  const idx: { l: string; k: string; c: string; h: string; p?: number; e?: number }[] = [];
  const base = `/${LP}guides/${key}/`;
  for (const e of COMP?.entities || []) idx.push({ l: e.name, k: singularLabel(e.typeLabel), c: e.summary?.region || '', h: entHref(e.slug), p: 1, e: 1 });
  for (const o of visible) {
    const a = byslug.get(o.slug)!;
    const isChapter = /^(chapter|prologue|epilogue|act|part|episode|day)\b/i.test(a.name);
    const at = (anchor = '') => `${base}${o.slug}/${anchor ? `#${anchor}` : ''}`;
    idx.push({ l: a.name, k: ui(isChapter ? 'kindChapter' : 'kindArea'), c: a.story || '', h: at(), p: 1 });
    for (const st of a.walkthrough || []) if (st.title) idx.push({ l: st.title, k: ui('kindStep'), c: a.name, h: at(st.id) });
    for (const e of a.items || []) if (e.name) idx.push({ l: e.name, k: ui('kindItem'), c: a.name, h: at(`e-${e.id}`) });
    for (const e of a.secrets || []) if (e.text) idx.push({ l: String(e.text).slice(0, 90), k: ui('kindSecret'), c: a.name, h: at(`e-${e.id}`) });
    for (const e of a.shops || []) if (e.name) idx.push({ l: e.name, k: ui('kindShop'), c: a.name, h: at(`e-${e.id}`) });
    for (const e of a.enemies || []) if (e.name) idx.push({ l: e.name, k: ui('kindEnemy'), c: a.name, h: at(`e-${e.id}`) });
    for (const f of a.fights || []) if (f.name) idx.push({ l: f.name, k: ui('kindFight'), c: a.name, h: at(f.id) });
    for (const x of a.sections || []) for (const e of x.entries || []) if (e.text) idx.push({ l: String(e.text).slice(0, 90), k: x.title, c: a.name, h: at(`e-${e.id}`) });
  }
  return idx;
}

/**
 * The guide-wide search box (one per page): loads the guide's search.json the first time it's used, matches forgivingly
 * (fuzzyScore: apostrophes, plurals, small typos; exact names first) and lists "Name · Type · Chapter", each a link to
 * the exact spot. While there's a query, the list under it (the chapter list) is hidden; empty, it's back.
 */
function guideSearchBox(key: string, listSel: string, cls = 'mt-6'): string {
  return `<div class="${cls}">
    <input type="search" id="qc-gsearch" autocomplete="off" placeholder="${esc(ui('searchAll'))}" class="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-[#a87ffb]/40 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]">
    <ul id="qc-gresults" class="mt-2 space-y-1"></ul>
  </div>
  <script>(function(){var __name=function(f){return f;};var fuzzyScore=${fuzzyScore.toString()};
  var q=document.getElementById('qc-gsearch'),out=document.getElementById('qc-gresults'),sel=${JSON.stringify(listSel)},idx=null,busy=null;
  function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function load(){if(idx)return Promise.resolve(idx);if(!busy)busy=fetch(${JSON.stringify(`/${LP}guides/${key}/search.json`)}).then(function(r){return r.json();}).then(function(j){idx=j;return j;}).catch(function(){idx=[];return idx;});return busy;}
  function run(){var v=q.value.trim(),list=document.querySelector(sel);if(list)list.hidden=!!v;if(!v){out.innerHTML='';return;}load().then(function(ix){if(q.value.trim()!==v)return;
    var r=ix.map(function(x){var b=fuzzyScore(v,x.l);return{x:x,s:b&&b+(x.p?0.5:0)};}).filter(function(y){return y.s>0;}).sort(function(a,b){return b.s-a.s;}).slice(0,15);
    out.innerHTML=r.length?r.map(function(y){return '<li><a class="block rounded-lg px-3 py-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/10" href="'+e(y.x.h)+'"><span class="font-semibold text-white">'+e(y.x.l)+'</span> <span class="text-xs text-[#c4b0ff]">· '+e(y.x.k)+'</span>'+(y.x.c?' <span class="text-xs text-zinc-500">· '+e(y.x.c)+'</span>':'')+'</a></li>';}).join(''):'<li class="text-sm text-zinc-500 px-1">'+e(${JSON.stringify(ui('noMatches'))})+'</li>';});}
  q.addEventListener('focus',load);q.addEventListener('input',run);})();</script>`;
}

function compSearch(key: string, visible: { slug: string; name: string }[], byslug: Map<string, GuideArea>): string {
  if (!COMP?.entities.length) return '';
  const chip = (href: string, text: string, title = '') => `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} class="rounded-md border border-[#a87ffb]/40 bg-[#a87ffb]/10 px-2 py-0.5 text-sm text-white hover:border-[#a87ffb]">${esc(text)}</a>`;
  const soon = (text: string) => `<span class="qc-soon rounded-md border border-dashed border-white/10 px-2 py-0.5 text-sm text-zinc-500 cursor-help select-none" tabindex="0" aria-disabled="true" title="${esc(ui('comingSoon'))}" data-soon="${esc(ui('comingSoon'))}">${esc(text)}</span>`;
  // An entry with no compendium page of its own links to the guide page or walkthrough step that covers it (a
  // place with a walkthrough page, a mission that is a step's title); only entries with nothing to link are greyed.
  const pages = visible.map((o) => ({ slug: o.slug, name: byslug.get(o.slug)?.name || o.name }));
  const steps = visible.flatMap((o) => (byslug.get(o.slug)!.walkthrough || []).filter((st: any) => st.id && st.title).map((st: any) => ({ slug: o.slug, id: String(st.id), title: String(st.title) })));
  const norm = (x: string) => String(x || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const covering = (name: string): string => {
    const n = norm(name);
    if (n.length < 3) return '';
    const page = pages.find((p) => norm(p.name) === n) || pages.find((p) => entitySegments(p.name, [{ name, slug: 'x' }]).some((sg) => sg.slug));
    if (page) return `/guides/${COMP_KEY}/${page.slug}/`;
    const st = steps.find((x) => norm(x.title) === n) || steps.find((x) => entitySegments(x.title, [{ name, slug: 'x' }]).some((sg) => sg.slug));
    return st ? `/guides/${COMP_KEY}/${st.slug}/#${st.id}` : '';
  };
  const named = (e: { name: string; displayName?: string }) => e.displayName || e.name;
  type Sec = { html: string; live: number };
  const out: Sec[] = [];
  for (const t of COMP.taxonomy || []) {
    const built = COMP.entities.filter((e) => e.type === t.id);
    const more = ((t.examples || []) as string[]).filter((x) => !built.some((e) => e.name.toLowerCase() === x.toLowerCase())).slice(0, 6).map((x) => ({ x, href: covering(x) }));
    const live = built.length + more.filter((m) => m.href).length;
    out.push({ live, html: `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div class="text-xs font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(t.label)}</div>
      <div class="mt-2 flex flex-wrap gap-1.5">${built.map((e) => chip(entHref(e.slug), named(e), e.displayName ? e.name : '')).join('')}${more.filter((m) => m.href).map((m) => chip(m.href, m.x)).join('')}${more.filter((m) => !m.href).map((m) => soon(m.x)).join('')}</div></div>` });
  }
  // Quest pages (story missions, Stranger strands): grouped by chapter in play order; a planned mission without its
  // page links to the walkthrough step that covers it, else it's "coming soon" (failed ones are left out).
  for (const ty of Object.keys(QUEST_TYPES)) {
    const groups = questGroups(ty, pages);
    if (!groups.length) continue;
    const items = groups.map((g) => ({ g, items: g.items.map((x) => ({ ...x, href: x.slug ? entHref(x.slug) : covering(x.name) })) }));
    const live = items.reduce((n, g) => n + g.items.filter((x) => x.href).length, 0);
    out.push({ live, html: `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:col-span-2"><div class="text-xs font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(QUEST_TYPES[ty].label)}</div>
      ${items.map(({ g, items: xs }) => `<div class="mt-2.5">${g.slug ? `<a href="${esc(`/guides/${COMP_KEY}/${g.slug}/`)}" class="text-[11px] font-semibold text-zinc-400 hover:text-white">${esc(g.name)}</a>` : `<span class="text-[11px] font-semibold text-zinc-400">${esc(g.name)}</span>`}
      <div class="mt-1 flex flex-wrap gap-1.5">${xs.filter((x) => x.href).map((x) => chip(x.href, x.name)).join('')}${xs.filter((x) => !x.href).map((x) => soon(x.name)).join('')}</div></div>`).join('')}</div>` });
  }
  // Built pages of other types outside the taxonomy: built ones only, never "coming soon".
  for (const ty of [...new Set(COMP.entities.map((e) => e.type))].filter((ty) => !QUEST_TYPES[ty] && !(COMP!.taxonomy || []).some((t: any) => t.id === ty))) {
    const built = COMP.entities.filter((e) => e.type === ty);
    out.push({ live: built.length, html: `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div class="text-xs font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(built[0].typeLabel)}</div>
      <div class="mt-2 flex flex-wrap gap-1.5">${built.map((e) => chip(entHref(e.slug), named(e), e.displayName ? e.name : '')).join('')}</div></div>` });
  }
  // Sections with live entries first (most first), sections with only "coming soon" after; the order otherwise kept.
  const types = out.map((x, i) => ({ ...x, i })).sort((a, b) => Number(b.live > 0) - Number(a.live > 0) || (b.live > 0 ? b.live - a.live : 0) || a.i - b.i).map((x) => x.html).join('');
  return `<section id="compendium" class="mt-14 scroll-mt-20">${sectionHead(ui('compendium'), ui('compendiumSub'), ui('pagesCount', { n: COMP.entities.length }))}
  ${types.includes('qc-soon') ? `<p class="mt-3 text-xs text-zinc-500">${esc(ui('comingSoonNote'))}</p>` : ''}
  <div class="mt-4 grid gap-3 sm:grid-cols-2">${types}</div></section>
  <script>document.querySelectorAll('.qc-soon').forEach(function(s){s.addEventListener('click',function(){var t=s.textContent;s.textContent=s.getAttribute('data-soon');setTimeout(function(){s.textContent=t;},1400);});});</script>`;
}

/** A guide front page's jump bar: its walkthrough, its compendium and its achievements (shown with two or more). */
function jumpBar(areas: number, ach: boolean): string {
  // Small enough to sit on one line on a phone; the counts show from tablet width up.
  const jump = (href: string, label: string, n?: number) => `<a href="${href}" class="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-zinc-300 hover:border-[#a87ffb]/50 hover:text-white">${esc(label)}${n != null ? ` <span class="hidden sm:inline text-zinc-500">${n}</span>` : ''}</a>`;
  const parts = [jump('#walkthrough', ui('walkthrough'), areas), ...(COMP?.entities.length ? [jump('#compendium', ui('compendium'), COMP.entities.length)] : []), ...(ach ? [jump('achievements/index.html', ui('achShort'))] : [])];
  return parts.length > 1 ? `<nav aria-label="${esc(ui('onThisPage'))}" class="mt-4 flex flex-wrap items-center gap-1.5 text-[13px] sm:text-sm">${parts.join('')}</nav>` : '';
}

/** A guide front page's section header: accent bar, title, a line on what's in it, and its count. */
const sectionHead = (title: string, sub: string, count?: string) => `<div class="flex items-end justify-between gap-3 border-b border-white/10 pb-3">
    <div class="min-w-0"><h2 class="flex items-center gap-2.5 text-xl font-bold text-white"><span class="h-5 w-1 shrink-0 rounded-full bg-[#a87ffb]"></span>${esc(title)}</h2><p class="mt-1 text-sm text-zinc-500">${esc(sub)}</p></div>
    ${count ? `<span class="shrink-0 text-sm text-zinc-500 tabular-nums">${esc(count)}</span>` : ''}</div>`;

/** The compendium's entity pages (previews only): a summary box made for search, linked back to the guide. */
/**
 * A quest page's facts (scripts/guides/quests.ts): giver, chapter, where it starts, rewards, missables, choices, gold
 * medal goals; a Stranger strand's parts with their steps; and, for a story mission, the walkthrough for the
 * step-by-step (the page isn't repeated here).
 */
function questRows(q: any, row: (label: string, html: string) => string, list: (xs: string[]) => string): string {
  const parts = (q.parts || []).map((p: any) => `<div id="${esc(p.id)}" class="mt-1"><strong class="text-white">${esc(p.name)}</strong>${p.chapter ? `<span class="text-zinc-400"> · ${esc(p.chapter)}</span>` : ''}${p.where ? `<div class="text-zinc-400">${esc(p.where)}</div>` : ''}${(p.steps || []).length ? `<ol class="mt-1 list-decimal pl-5 space-y-0.5">${p.steps.map((st: any) => `<li id="${esc(st.id)}">${esc(st.text)}</li>`).join('')}</ol>` : ''}</div>`).join('');
  const walk = q.walkthrough ? `<a class="text-[#a87ffb] hover:text-white font-semibold" href="../${esc(q.walkthrough.slug)}/${q.walkthrough.anchor ? `#${esc(q.walkthrough.anchor)}` : ''}">${esc(q.walkthrough.name)}</a>` : '';
  return [
    row('Given by', esc(q.giver || '')),
    row('Chapter', esc(q.chapter || '')),
    row('Starts', esc(q.where || '')),
    row('Rewards', list((q.rewards || []).map(esc))),
    row('Missable', list((q.missables || []).map((m: string) => `<span class="text-amber-200">${esc(m)}</span>`))),
    row('Choices', list((q.choices || []).map((c: any) => `<strong class="text-white">${esc(c.choice)}</strong><span class="text-zinc-400"> → ${esc(c.outcome)}</span>`))),
    row('Gold medal', list((q.goldMedal || []).map(esc))),
    row('Parts', parts),
    row('Walkthrough', walk),
  ].join('');
}

/** A list or reference page's body (refpages.ts): its sections, then its items as a table (name, where, notes). */
function refBlocks(r: any, self: string): string {
  const secs = (r.sections || []).map((x: any) => `<h2 class="mt-6 text-lg font-bold text-white">${esc(x.heading)}</h2><p class="mt-2 text-zinc-300 leading-relaxed">${rich(x.text, '../', self)}</p>`).join('');
  const items = (r.items || []).length
    ? `<div class="mt-6 overflow-x-auto"><table class="w-full text-sm border-collapse"><thead><tr class="text-left text-zinc-500"><th class="py-1.5 pr-3">Name</th><th class="py-1.5 pr-3">Where</th><th class="py-1.5">Notes</th></tr></thead><tbody>${r.items.map((it: any, i: number) => `<tr id="item-${i + 1}" class="border-t border-white/10 align-top"><td class="py-1.5 pr-3 font-semibold text-white">${esc(it.name)}</td><td class="py-1.5 pr-3 text-zinc-300">${rich(it.where || '', '../', self)}</td><td class="py-1.5 text-zinc-400">${esc(it.notes || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return secs + items;
}

function renderEntities(key: string, gameName: string, visible: { slug: string; name: string }[], byslug: Map<string, GuideArea>, sitemap: string[]) {
  const pageText = (a: GuideArea) => [a.overview, ...(a.walkthrough || []).flatMap((s) => [s.title, s.text, s.tip, s.warn]), ...(a.items || []).map((e) => `${e.name} ${e.where || ''}`), ...(a.tips || [])].filter(Boolean).join(' ');
  // Mission links: a mission whose name is a walkthrough step's title links to that step (exact title matches only;
  // missions only mentioned in a step's text wait for quest pages).
  const stepTitles = visible.flatMap((o) => (byslug.get(o.slug)!.walkthrough || []).filter((st: any) => st.id && st.title).map((st: any) => ({ slug: o.slug, id: String(st.id), title: String(st.title) })));
  const missionLink = (name: string) => stepTitles.find((st) => entitySegments(st.title, [{ name, slug: 'x' }]).some((sg) => sg.slug));
  for (const e of COMP!.entities) {
    const label = singularLabel(e.typeLabel);
    // Backlinks: the guide pages that mention it (found by the same linker), plus the chapters the page names.
    const named = new Set(((e.summary || {}).chapters || []).map((c: string) => c.toLowerCase()));
    const mentions = visible.filter((o) => named.has(String(byslug.get(o.slug)?.name || o.name).toLowerCase()) || entitySegments(pageText(byslug.get(o.slug)!), [{ name: e.name, slug: e.slug }]).some((sg) => sg.slug));
    const person = entityKind(e.typeLabel || e.type) === 'person';
    const sm = person ? { ...(e.summary || {}), region: '', where: '', gettingThere: '', places: [], collectibles: [] } : e.summary || {};
    const row = (label: string, html: string) => (html ? `<div class="flex gap-2 py-1.5 border-t border-white/5 first:border-0"><dt class="w-36 shrink-0 text-zinc-500">${esc(label)}</dt><dd class="min-w-0 text-zinc-200">${html}</dd></div>` : '');
    const list = (xs: string[]) => (xs.length ? `<ul class="space-y-1">${xs.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
    const dir = path.join(OUT, 'guides', key, e.slug);
    fs.mkdirSync(dir, { recursive: true });
    const body = `<article class="max-w-3xl">
      <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="../../index.html">${esc(ui('navGuides'))}</a> / <a class="hover:text-white" href="../index.html">${esc(gameName)}</a> / <span>${esc(label)}</span></p>
      <h1 class="text-3xl font-bold text-white leading-tight">${esc(e.displayName || e.name)}</h1>
      <div class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-400"><span class="rounded-md bg-[#a87ffb]/15 px-2 py-0.5 text-[#c4b0ff]">${esc(label)}</span><span>${esc(gameName)}</span>
        ${e.review ? `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">&#10003; ${esc(ui('checkedBadge'))} · ${e.review.supported}/${e.review.total}</span>` : ''}
        ${PREVIEW ? '<span class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">Preview</span>' : ''}</div>
      ${(() => {
        // The opening line carries the full name when the heading shows the common one ("Ciri" / Cirilla Fiona Elen Riannon).
        const ov = String(e.overview || '');
        const lead = e.displayName && !ov.toLowerCase().includes(e.name.toLowerCase()) ? `<strong class="text-white">${esc(e.name)}</strong>${ov ? '. ' : ''}` : '';
        return ov || lead ? `<p class="mt-5 text-zinc-300 leading-relaxed">${lead}${rich(ov, '../', e.slug)}</p>` : '';
      })()}
      ${(e.story || []).length ? `<section class="mt-6"><h2 class="text-sm font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(ui('entStory'))}</h2>${e.story!.map((x: any, i: number) => `<h3 id="story-${i + 1}" class="mt-4 scroll-mt-20 text-base font-semibold text-white">${esc(x.heading)}</h3><p class="mt-1 text-zinc-300 leading-relaxed">${rich(x.text, '../', e.slug)}</p>`).join('')}</section>` : ''}
      ${(e.gameplay || []).length ? `<section class="mt-6"><h2 class="text-sm font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(ui('entGameplay'))}</h2>${e.gameplay!.map((x: any, i: number) => `<h3 id="play-${i + 1}" class="mt-4 scroll-mt-20 text-base font-semibold text-white">${esc(x.heading)}</h3><p class="mt-1 text-zinc-300 leading-relaxed">${rich(x.text, '../', e.slug)}</p>`).join('')}</section>` : ''}
      ${(() => {
        // Answers to players' questions are worked into the sections above (qaArrange.ts); only those that fit none
        // show here. A page from before that step still shows its questions.
        const asked = e.qaArrangedAt ? e.alsoAsked || [] : e.qa || [];
        return asked.length ? `<section class="mt-6"><h2 class="text-sm font-bold uppercase tracking-wide text-[#c4b0ff]">${esc(ui(e.qaArrangedAt ? 'entAlsoAsked' : 'entQuestions'))}</h2>${asked.map((x: any, i: number) => `<h3 id="q-${i + 1}" class="mt-4 scroll-mt-20 text-base font-semibold text-white">${esc(x.q)}</h3><p class="mt-1 text-zinc-300 leading-relaxed">${rich(x.a, '../', e.slug)}</p>`).join('')}</section>` : '';
      })()}
      <dl class="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm">
        ${row('Type', esc(label))}
        ${e.quest ? questRows(e.quest, row, list) : ''}
        ${row('Region', esc(sm.region || ''))}
        ${row('Where', esc(sm.where || ''))}
        ${row('Where to find them', list((sm.whereToFind || []).map((w: any) => `${w.when ? `<strong class="text-white">${esc(w.when)}</strong>: ` : ''}${rich(w.where, '../', e.slug)}`)))}
        ${row('Getting there', rich(sm.gettingThere || '', '../', e.slug))}
        ${row('Shops', list((sm.shops || []).map((x: any) => `<strong class="text-white">${esc(x.name)}</strong>${x.what ? `<span class="text-zinc-400">: ${esc(x.what)}</span>` : ''}`)))}
        ${row('Services', esc((sm.services || []).join(' · ')))}
        ${row("What's there", list((sm.places || []).map((x: any) => `<strong class="text-white">${esc(x.name)}</strong>${x.what ? `<span class="text-zinc-400">: ${esc(x.what)}</span>` : ''}`)))}
        ${row('Collectibles', list((sm.collectibles || []).map((x: any) => `<strong class="text-white">${esc(x.name)}</strong>${x.where ? `<span class="text-zinc-400">: ${esc(x.where)}</span>` : ''}`)))}
        ${row('Missions', list((sm.quests || []).map((x: any) => { const st = missionLink(x.name); return `${st ? `<a class="font-semibold text-[#a87ffb] hover:text-white" href="../${esc(st.slug)}/#${esc(st.id)}">${esc(x.name)}</a>` : `<strong class="text-white">${esc(x.name)}</strong>`}<span class="text-zinc-400">${x.kind ? ` · ${esc(x.kind)}` : ''}${x.chapter ? ` · ${esc(x.chapter)}` : ''}</span>`; })))}
        ${row('In the guide', list(mentions.map((o) => `<a class="text-[#a87ffb] hover:text-white" href="../${esc(o.slug)}/index.html">${esc(o.name)}</a>`)))}
      </dl>
      ${e.ref ? refBlocks(e.ref, e.slug) : ''}
      ${(sm.notes || []).length ? `<ul class="mt-4 space-y-1.5 text-sm text-zinc-300">${sm.notes.map((x: string) => `<li class="flex gap-2"><span class="text-[#c4b0ff]">&bull;</span><span>${rich(x, '../', e.slug)}</span></li>`).join('')}</ul>` : ''}
      ${(e.sources || []).length ? `<p class="mt-6 text-xs text-zinc-500">Sources: ${e.sources.map(esc).join(', ')}</p>` : ''}
    </article>`;
    const url = `${SITE}/guides/${key}/${e.slug}/`;
    const ld = [breadcrumb([{ name: ui('navGuides'), url: `${SITE}/guides/` }, { name: shortGame(gameName), url: `${SITE}/guides/${key}/` }, { name: e.name, url }])];
    // A character's title never names location fields (collectibles, what's there): it says what the page has.
    const title = person && (!e.title || /collectible|what's there|location/i.test(e.title))
      ? `${e.displayName || e.name} – ${gameName}${(() => { const parts = [(e.story || []).length ? 'story' : '', (sm.whereToFind || []).length ? 'where to find' : '', (sm.quests || []).length ? 'missions' : ''].filter(Boolean); return parts.length ? `: ${parts.join(', ')}` : ''; })()}`
      : e.displayName && e.title ? e.title.replace(e.name, e.displayName) : e.title || `${e.displayName || e.name} – ${gameName}`;
    fs.writeFileSync(path.join(dir, 'index.html'), page({ title, description: e.description || '', depth: 3, canonical: url, ld, body: body + entPreview(), draft: !!PREVIEW, guide: key }));
    if (!PREVIEW) sitemap.push(url);
  }
  console.log(`Compendium: ${COMP!.entities.length} entity page(s) for ${gameName}.`);
}

function renderAchievements(key: string, gameName: string, ach: any, links: AreaLink[], sitemap: string[], langs: string[] = ['en']) {
  const dir = path.join(OUT, LP, 'guides', key, 'achievements');
  fs.mkdirSync(dir, { recursive: true });
  const list: any[] = ach.list.slice().sort((x: any, y: any) => Number(!!y.missable) - Number(!!x.missable) || (y.rarity ?? 0) - (x.rarity ?? 0));
  const r = ach.roadmap || {};
  const stat = (v: string, label: string) => (v ? `<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><div class="text-lg font-bold text-white">${esc(v)}</div><div class="text-xs text-zinc-500">${esc(label)}</div></div>` : '');
  const areaName = (slug?: string) => links.find((l) => l.slug === slug)?.name;
  // Labels per achievement (the builder's, plus what its text makes plain), their counts and the filter.
  const flagsOf = new Map<any, AchFlag[]>(list.map((x) => [x, achFlags(x)]));
  const flagCount = (f: AchFlag) => list.filter((x) => flagsOf.get(x)!.includes(f)).length;
  const achId = (name: string) => `ach-${String(name).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
  // The roadmap's steps, numbered; each step's achievements are the ones it names, or whose area it names ("Emerald
  // Grove & Hollow: …"). An achievement belongs to the first step that has it.
  const steps: string[] = Array.isArray(r.steps) ? r.steps : [];
  const lc = (s: string) => String(s || '').toLowerCase();
  const stepOf = new Map<any, number>();
  const stepAchs = steps.map((st, i) => {
    const head = st.includes(':') && st.indexOf(':') < 70 ? st.slice(0, st.indexOf(':')) : '';
    const mine = list.filter((x) => lc(st).includes(lc(x.name)) || (!!head && !!x.area && !!areaName(x.area) && lc(head).includes(lc(areaName(x.area)!))));
    for (const x of mine) if (!stepOf.has(x)) stepOf.set(x, i);
    return mine;
  });
  const stepsHtml = steps.length
    ? `<section id="roadmap" class="mt-6 scroll-mt-20"><h2 class="mb-2 text-lg font-bold text-white">${esc(ui('rmSteps'))}</h2><ol class="space-y-2">${steps.map((st, i) => {
        const colon = st.includes(':') && st.indexOf(':') < 70 ? st.indexOf(':') : -1;
        const head = colon > 0 ? st.slice(0, colon) : '';
        const text = colon > 0 ? st.slice(colon + 1).trim() : st;
        const mine = stepAchs[i].filter((x) => stepOf.get(x) === i);
        const miss = mine.filter((x) => x.missable);
        const link = (x: any) => `<a class="text-[#a87ffb] hover:text-white" href="#${achId(x.name)}">${esc(x.name)}</a>`;
        return `<li id="step-${i + 1}" class="scroll-mt-20 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div class="flex items-baseline gap-2"><span class="shrink-0 rounded-md bg-[#a87ffb]/20 px-1.5 text-xs font-bold text-[#a87ffb]">${esc(ui('rmStep', { n: i + 1 }))}</span>${head ? `<span class="font-semibold text-white">${esc(head)}</span>` : ''}</div>
          <p class="mt-1 text-sm text-zinc-300">${esc(text)}</p>
          ${miss.length ? `<div class="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-sm"><div class="flex items-center gap-1.5 font-semibold text-amber-200">${ICON.warn} ${esc(ui('rmMissHere'))}</div><ul class="mt-1 space-y-1 text-zinc-200">${miss.map((x) => `<li>${link(x)}${x.how ? `<span class="text-zinc-400">: ${esc(String(x.how).split(/(?<=[.!?])\s/)[0])}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
          ${mine.length > miss.length ? `<p class="mt-2 text-xs text-zinc-500">${esc(ui('rmAlsoHere'))}: ${mine.filter((x) => !x.missable).map(link).join(', ')}</p>` : ''}
        </li>`;
      }).join('')}</ol></section>`
    : '';
  const flagLabel = (f: AchFlag) => ui(`achFlag_${f}`);
  const flagChips = ACH_FLAGS.filter((f) => flagCount(f) > 0);
  const filterHtml = flagChips.length
    ? `<div class="mb-2 flex flex-wrap items-center gap-1.5 text-xs" data-flag-filter><button type="button" data-flag="" class="qc-flag rounded-md border border-[#a87ffb]/50 bg-[#a87ffb]/15 px-2 py-1 text-white">${esc(ui('achFilterAll'))}</button>${flagChips.map((f) => `<button type="button" data-flag="${f}" class="qc-flag rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300">${esc(flagLabel(f))} <span class="text-zinc-500">${flagCount(f)}</span></button>`).join('')}<button type="button" data-flag="todo" class="qc-flag rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300">${esc(ui('achFilterTodo'))}</button></div>`
    : '';
  const row = (x: any) => {
    const where = x.area && areaName(x.area) ? `<a class="text-[#a87ffb] hover:text-white" href="../${esc(x.area)}/index.html">${esc(ui('achInArea', { area: areaName(x.area)! }))}</a>` : '';
    const flags = flagsOf.get(x)!;
    const tags = flags.filter((f) => f !== 'missable').map((f) => ` <span class="rounded bg-white/[0.06] px-1.5 text-[10px] font-semibold uppercase text-zinc-400">${esc(flagLabel(f))}</span>`).join('');
    const step = stepOf.has(x) ? `<a class="text-zinc-500 hover:text-white" href="#step-${stepOf.get(x)! + 1}">${esc(ui('rmStep', { n: stepOf.get(x)! + 1 }))}</a>` : '';
    const body = `<strong class="text-white">${esc(x.name)}</strong>${x.missable ? ` <span class="text-amber-400 text-[11px] font-bold uppercase">${esc(ui('achMissable'))}</span>` : ''}${tags}${x.rarity != null ? ` <span class="text-zinc-500 text-xs">${esc(ui('achRarity', { n: x.rarity }))}</span>` : ''}
      ${x.hidden ? `<span class="block text-[11px] uppercase tracking-wide text-zinc-500 mt-0.5">${esc(ui('achHiddenTag'))}</span>` : ''}${x.desc ? `<span class="block text-zinc-400 text-xs mt-0.5">${esc(x.desc)}</span>` : ''}
      ${x.how ? `<span class="block text-zinc-300 text-sm mt-1">${esc(x.how)}</span>` : ''}
      ${where || step ? `<span class="block text-xs mt-1">${[where, step].filter(Boolean).join(' · ')}</span>` : ''}`;
    return `<div id="${achId(x.name)}" class="scroll-mt-20" data-flags="${esc(flags.join(' '))}" data-ach="${esc(`ach:${x.name}`)}" data-search="${esc(`${x.name} ${x.desc || ''} ${areaName(x.area) || ''}`)}">${checkRow(`ach:${x.name}`, body)}</div>`;
  };
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    page({
      title: ui('achTitle', { game: shortGame(gameName), n: list.length }),
      description: ui('achDesc', { game: shortGame(gameName), n: list.length }).slice(0, 158),
      depth: LANG === 'en' ? 3 : 4,
      canonical: `${SITE}/${LP}guides/${key}/achievements/`,
      ld: [
        breadcrumb([{ name: ui('navGuides'), url: `${SITE}/${LP}guides/` }, { name: shortGame(gameName), url: `${SITE}/${LP}guides/${key}/` }, { name: ui('achLink'), url: `${SITE}/${LP}guides/${key}/achievements/` }]),
        guideArticle({ headline: ui('achTitle', { game: shortGame(gameName), n: list.length }).replace(/ \| Quest Compendium$/, ''), description: ui('achDesc', { game: shortGame(gameName), n: list.length }).slice(0, 158), url: `${SITE}/${LP}guides/${key}/achievements/`, game: gameName }),
      ],
      guide: key,
      area: 'achievements',
      langs,
      path: `guides/${key}/achievements/`,
      body: `<div class="max-w-3xl">
        <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="../../index.html">${esc(ui('navGuides'))}</a> / <a class="hover:text-white" href="../index.html">${esc(gameName)}</a></p>
        <h1 class="text-3xl font-bold text-white">${esc(ui('achH1', { game: gameName }))}</h1>
        <p class="text-zinc-400 mt-2">${esc(ui('achIntro'))}</p>
        <div class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">${stat(r.time, ui('rmTime'))}${stat(r.difficulty, ui('rmDifficulty'))}${stat(r.playthroughs, ui('rmPlaythroughs'))}${stat(String(list.filter((x) => x.missable).length || r.missables || ''), ui('rmMissables'))}</div>
        ${flagChips.filter((f) => f !== 'missable').length ? `<p class="mt-2 text-xs text-zinc-400">${flagChips.filter((f) => f !== 'missable').map((f) => `<span class="mr-3"><strong class="text-zinc-200">${flagCount(f)}</strong> ${esc(flagLabel(f).toLowerCase())}</span>`).join('')}</p>` : ''}
        ${steps.length ? `<nav class="mt-4 flex flex-wrap gap-1.5 text-xs"><a href="#roadmap" class="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300 hover:text-white">${esc(ui('rmSteps'))}</a><a href="#all-achievements" class="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300 hover:text-white">${esc(ui('achAll'))}</a></nav>` : ''}
        ${r.noReturn?.length ? `<section class="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4"><h2 class="flex items-center gap-2 text-base font-bold text-amber-200">${ICON.warn} ${esc(ui('rmNoReturn'))}</h2><ul class="mt-2 space-y-1.5 text-sm text-zinc-200">${r.noReturn.map((n: any) => `<li><strong class="text-white">${esc(n.point)}</strong>: ${esc(n.lost)}</li>`).join('')}</ul></section>` : ''}
        ${stepsHtml}
        <h2 id="all-achievements" class="mt-8 mb-2 scroll-mt-20 text-lg font-bold text-white">${esc(ui('achAll'))} <span class="text-sm font-normal text-zinc-500" data-count="${esc(list.map((x) => `ach:${x.name}`).join(','))}">0/${list.length}</span></h2>
        ${filterHtml}
        <input type="search" data-filter="#qc-ach-rows" data-empty="#qc-ach-empty" placeholder="${esc(ui('searchAch'))}" class="w-full mb-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]/60">
        <div id="qc-ach-rows">${list.map(row).join('')}</div>
        <p id="qc-ach-empty" hidden class="mt-3 text-sm text-zinc-500">${esc(ui('noMatches'))}</p>
        ${cta(LANG === 'en' ? '../../../' : '../../../../', gameName)}
      </div>`,
    }),
  );
  sitemap.push(`${SITE}/${LP}guides/${key}/achievements/`);
}

/** The guides page: Popular and New rows, then every game with search, sorting and an A–Z bar. */
function indexBody(list: { key: string; game: string; count: number; players?: number; created?: number; appId?: number }[]) {
  // Sorted and lettered without a leading "The"/"A" ("The Witcher 3" goes under W).
  const sortName = (n: string) => n.replace(/^(the|a|an)\s+/i, '').toLowerCase();
  const card = (g: (typeof list)[number], tags = true) => {
    const letter = (sortName(g.game).match(/[a-z0-9]/)?.[0] || '#').toUpperCase().replace(/[0-9]/, '#');
    return `<a href="${esc(g.key)}/index.html"${tags ? ` data-search="${esc(g.game)}" data-name="${esc(sortName(g.game))}" data-popular="${g.players || 0}" data-new="${g.created || 0}" data-l="${letter}"` : ''} class="block rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:border-[#a87ffb]/50 hover:bg-white/[0.06] transition-colors">${cardArt(g.game, g.appId, g.key)}<div class="${CARD_MODE === 'A' ? 'p-3' : 'p-4'}"><div class="font-bold text-white leading-snug${CARD_MODE === 'A' ? ' text-sm break-words' : ''}">${esc(g.game)}</div><div class="mt-1 text-sm text-zinc-400">${esc(g.count === 1 ? ui('areasCountOne') : ui('areasCount', { n: g.count }))}</div></div></a>`;
  };
  const az = list.slice().sort((x, y) => sortName(x.game).localeCompare(sortName(y.game)));
  // Mark the first game of each letter, for the A–Z bar.
  const seen = new Set<string>();
  const cards = az
    .map((g) => {
      const html = card(g);
      const l = html.match(/data-l="([^"]+)"/)![1];
      if (seen.has(l)) return html;
      seen.add(l);
      return html.replace(' data-l=', ` data-first="${l}" data-l=`);
    })
    .join('');
  const perRow = CARD_MODE === 'A' ? 6 : 4;
  // Most played first; a row with room left is filled with the most complete guides.
  const played = list.filter((g) => (g.players || 0) > 0).sort((a, b) => (b.players || 0) - (a.players || 0));
  const popular = [...played, ...list.filter((g) => !played.includes(g)).sort((a, b) => b.count - a.count)].slice(0, played.length ? perRow : 0);
  const fresh = list.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, perRow);
  const row = (title: string, items: typeof list) =>
    items.length ? `<section data-hide-when-searching class="mb-8"><h2 class="text-lg font-bold text-white mb-3">${esc(title)}</h2><div class="grid ${CARD_MODE === 'A' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6' : 'sm:grid-cols-2 lg:grid-cols-4'} gap-3">${items.map((g) => card(g, false)).join('')}</div></section>` : '';
  const letters = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((l) => seen.has(l));
  return `<h1 class="text-3xl font-bold text-white">${esc(ui('indexH1'))}</h1><p class="text-zinc-400 mt-2 mb-6 max-w-2xl">${esc(ui('indexIntro', { n: list.length }))}</p>
    ${list.length > 8 ? row(ui('popular'), popular) + row(ui('newGuides'), fresh) : ''}
    <div class="flex flex-col sm:flex-row gap-3 sm:items-center mb-3">
      <h2 class="text-lg font-bold text-white sm:mr-auto">${esc(ui('allGames'))}</h2>
      <input type="search" data-filter="[data-games]" data-empty="#qc-games-empty" placeholder="${esc(ui('searchGames'))}" class="sm:w-72 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]/60">
      <label class="flex items-center gap-2 text-sm text-zinc-400">${esc(ui('sortLabel'))}
        <select data-sort class="px-3 py-2 rounded-xl bg-[#0c0d14] border border-white/10 text-white"><option value="az">${esc(ui('sortAZ'))}</option>${popular.length ? `<option value="popular">${esc(ui('sortPopular'))}</option>` : ''}<option value="new">${esc(ui('sortNew'))}</option></select>
      </label>
    </div>
    ${letters.length > 5 ? `<div data-hide-when-searching class="flex flex-wrap gap-1 mb-4">${letters.map((l) => `<button type="button" data-letter="${l}" class="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-[#a87ffb]/20 text-sm text-zinc-300 hover:text-white">${l}</button>`).join('')}</div>` : ''}
    <div data-games class="grid ${CARD_MODE === 'A' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6' : 'grid-cols-2 lg:grid-cols-4'} gap-3">${cards}</div>
    <p id="qc-games-empty" hidden class="mt-3 text-sm text-zinc-500">${esc(ui('noMatches'))}</p>`;
}

/**
 * The site's stylesheet: only the Tailwind classes its pages use, built once at publish time (about 30 KB), instead of
 * Tailwind's in-browser development script (which compiled the CSS on every page view). Pages written by hand or by
 * translate-site.ts (the home pages) get the same link in place of the old script. Kept from Tailwind 3, the site's
 * classes' first version: a light grey default border colour, grey placeholders and pointer buttons.
 */
async function buildSiteCss() {
  const input = `@import "tailwindcss";
@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button { border-color: var(--color-gray-200, currentColor); }
  input::placeholder, textarea::placeholder { color: var(--color-gray-400); }
  button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }
}`;
  const scanner = new Scanner({ sources: [{ base: OUT, pattern: '**/*.html', negated: false }] });
  const compiler = await compile(input, { base: path.resolve('.'), onDependency: () => {} });
  const css = optimize(compiler.build(scanner.scan()), { minify: true }).code;
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'assets', 'site.css'), css);
  // Any page still loading the development script (the home pages) gets the stylesheet instead.
  let fixed = 0;
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.html')) {
        const html = fs.readFileSync(p, 'utf8');
        if (!html.includes('cdn.tailwindcss.com')) continue;
        fs.writeFileSync(p, html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>/g, `<link rel="stylesheet" href="${CSS_HREF}">`));
        fixed++;
      }
    }
  };
  walk(OUT);
  console.log(`Stylesheet: assets/site.css (${Math.round(css.length / 1024)} KB)${fixed ? `; ${fixed} page(s) moved off the development script` : ''}.`);
}

async function main() {
  const igdbCfg: any = (await db().collection('config').doc('igdb').get()).data() || {};
  if (!IGDB_ON) IGDB_ON = igdbCfg.site === true;
  if (!CARD_MODE) CARD_MODE = String(igdbCfg.cards || '').toUpperCase();
  if (Number.isFinite(Number(igdbCfg.ttbMinCount)) && igdbCfg.ttbMinCount !== undefined) TTB_MIN = Math.max(1, Number(igdbCfg.ttbMinCount));
  if (!TTB_ON) TTB_ON = igdbCfg.ttbSite === true;
  const contribCfg: any = (await db().collection('config').doc('contrib').get()).data() || {};
  if (!CONTRIB_ON) CONTRIB_ON = contribCfg.enabled === true;
  CHANGELOG = (((await db().collection('system').doc('changelog').get()).data() || {}).entries || []) as any[];
  CONTRIB_SITE_AUTH = contribCfg.siteAuth === true;
  {
    const { approvedContributions } = await import('./contribEvidence');
    for (const c of await approvedContributions()) if (!c.absorbed) CONTRIBS.set(`${c.key}/${c.slug}`, [...(CONTRIBS.get(`${c.key}/${c.slug}`) || []), c]);
  }
  // One publish at a time (the pipeline, the flagship job and manual runs all write the site); re-entrant when the
  // caller already holds the site lock. A preview writes elsewhere and needs none.
  if (!PREVIEW) {
    const lk = await waitForGuideLock(SITE_LOCK, 'publish', 15 * 60_000);
    if (isRefusal(lk)) {
      console.log(lockedLine(lk, 'The website'));
      process.exit(0);
    }
  }
  // Approved guide blueprints: the quest plans (play order, chapters) for the compendium's mission lists.
  for (const d of (await db().collection('guideBlueprints').get()).docs) if ((d.data() as any).status === 'approved') BLUEPRINTS.set(d.id, d.data());
  // Staged rebuilds (guides/{key}--next) are never part of the site; review.ts --gate promotes them.
  const guides = { docs: (await db().collection('guides').get()).docs.filter((d) => !d.id.endsWith('--next') && (!ONLY || d.id === ONLY)) };
  // A preview carries the game's flagship prototypes (guidePrototypes/{key}__{slug}) on their pages.
  const protos = new Map<string, any>();
  if (PREVIEW) for (const d of (await db().collection('guidePrototypes').get()).docs) protos.set(d.id, d.data());
  // The compendium (scripts/guides/compendium.ts): each guide's published entity pages (a preview shows all of them).
  for (const cd of (await db().collection('guideCompendium').get()).docs) {
    if (ONLY && cd.id !== ONLY) continue;
    const c: any = cd.data();
    const entities = (await cd.ref.collection('entities').get()).docs.map((d) => d.data() as any).filter((e) => PREVIEW || e.status === 'published') as CompEntity[];
    const people = PREVIEW ? Object.fromEntries((await cd.ref.collection('people').get()).docs.map((d) => [d.id, d.data() as any])) : {};
    if (entities.length || Object.keys(people).length) COMPS.set(cd.id, { taxonomy: c?.taxonomy || [], entities, people });
  }
  if (COMPS.size) console.log(`Compendium: ${[...COMPS].map(([k, v]) => `${k} ${v.entities.length}`).join(', ')} entity page(s).`);
  if (approve) {
    const ref = db().collection('guides').doc(gameKey(approve));
    const drafts = await ref.collection('areas').where('status', '==', 'draft').get();
    for (const d of drafts.docs) await d.ref.update({ status: 'published', updatedAt: Date.now() });
    console.log(`Published ${drafts.size} draft page(s) for ${approve}.`);
  }
  // Start clean, so pages from an earlier preview (drafts) never get uploaded by accident.
  fs.rmSync(path.join(OUT, 'guides'), { recursive: true, force: true });
  const sitemap: string[] = [`${SITE}/`, `${SITE}/guides/`];
  // Language versions of the main page (made by scripts/i18n/translate-site.ts).
  for (const code of Object.keys(HOME_GUIDES)) if (code !== 'en' && fs.existsSync(path.join(OUT, code, 'index.html'))) sitemap.push(`${SITE}/${code}/`);
  const games: { key: string; game: string; count: number; published: number; langs: string[]; players?: number; created?: number; appId?: number }[] = [];
  // How many players use each game (gameStats, recorded by the server), for "Popular".
  const playersBy = new Map<string, number>();
  try {
    for (const d of (await db().collection('gameStats').get()).docs) playersBy.set(d.id, Array.isArray(d.data().players) ? d.data().players.length : 0);
  } catch {
    /* no popularity data */
  }
  const show = (s: string) => s === 'published' || (withDrafts && s === 'draft');
  // Pages that moved (merged into another page, or replaced by a rebuild): their old URLs get 301s in _redirects.
  // The apps' guide list (guides/index.json): one small line per game, read from the website instead of the server.
  const guideIndex: { key: string; game: string; areas: number; art?: string; checked: number; players: number; langs: string[] }[] = [];
  const restoredGuides: string[] = [];
  const moved: { key: string; from: string; to: string }[] = Object.entries(SITE_REDIRECTS).flatMap(([key, m]) => Object.entries(m).map(([from, to]) => ({ key, from, to })));
  // Translated guides are rebuilt from scratch too.
  for (const code of Object.keys(LANG_TAG)) if (code !== 'en') fs.rmSync(path.join(OUT, code, 'guides'), { recursive: true, force: true });

  for (const g of guides.docs) {
    const info = g.data();
    const order: { slug: string; name: string }[] = info.areas || [];
    const snap = await g.ref.collection('areas').get();
    const byslug = new Map(snap.docs.map((d) => {
      const pr = protos.get(`${g.id}__${d.id}`);
      const a = d.data() as GuideArea;
      return [d.id, pr ? { ...a, walkthrough: pr.walkthrough, choices: pr.choices, advice: pr.advice, items: pr.items, secrets: pr.secrets, fights: pr.fights, ...(pr.info ? { info: pr.info } : {}), sources: pr.sources || a.sources } : a];
    }));
    // An unpublished guide (taken down after a failing review: info.unpublished) keeps its addresses: its held pages are
    // published as noindex, follow pages (drafts), out of the sitemap, the guide list, the homepage and the apps' index,
    // so its URLs don't return 404 while it waits for a rebuild.
    const restored = !!info.unpublished && !order.some((o) => byslug.get(o.slug)?.status === 'published');
    const visible = restored
      ? order.filter((o) => byslug.get(o.slug)?.status === 'held')
      : order.filter((o) => byslug.has(o.slug) && show(byslug.get(o.slug)!.status));
    // A merged or renamed page (an alias saved on the guide): its old URL redirects to the page that has it now.
    for (const [from, to] of Object.entries((info.aliases || {}) as Record<string, string>)) moved.push({ key: g.id, from, to });
    if (!visible.length) continue;
    if (restored) restoredGuides.push(g.id);
    COMP = COMPS.get(g.id) || null;
    COMP_KEY = g.id;
    // Never a broken indexed URL: a page a rebuild, repair or outline change took down (held) redirects to what replaced
    // it: an entity page with its name, a page with the same name, the first page that mentions it, else the guide's
    // front page. (An entity page with the same URL brings the URL back, so it needs none.)
    if (!PREVIEW && !restored) moved.push(...heldRedirects(g.id, snap.docs.map((d) => ({ slug: d.id, ...(d.data() as any) })), visible, byslug, COMP?.entities || []));
    // Languages this game's guide is translated into (translate-guide.ts), published pages only.
    const trs: Record<string, any> = {};
    for (const code of Array.isArray(info.languages) ? info.languages : []) {
      if (!LANG_TAG[code] || code === 'en') continue;
      const t = (await g.ref.collection('i18n').doc(code).get()).data();
      if (t?.areas && Object.keys(t.areas).length) trs[code] = t;
    }
    const langs = ['en', ...Object.keys(trs)];
    const ach = info.hasAchievements && !restored ? (await g.ref.collection('achievements').doc('main').get()).data() || null : null;
    if (!restored) games.push({
      key: g.id, game: String(info.game || g.id), count: visible.length,
      published: visible.filter((o) => byslug.get(o.slug)!.status === 'published').length, langs,
      players: playersBy.get(g.id) || 0, created: Number(info.createdAt || info.updatedAt || 0),
      appId: Number(info.appId) || undefined,
    });
    if (info.appId && String(info.art || '').includes(`/apps/${info.appId}/`)) ART.set(Number(info.appId), String(info.art));
    if (info.igdb && IGDB_ON) IGDB.set(g.id, info.igdb);
    if (info.steamArt) STEAM_ART.set(g.id, info.steamArt);
    if (info.appId) GUIDE_APP.set(g.id, Number(info.appId));
    const live = visible.filter((o) => byslug.get(o.slug)!.status === 'published');
    if (live.length) {
      const igArt = IGDB_ON ? landscapeOf(info.igdb) : null;
      const art = (igArt ? wideSet(igArt, 889).src : '') || String(info.art || '') || (info.appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${info.appId}/header.jpg` : '');
      guideIndex.push({ key: g.id, game: String(info.game || g.id), areas: live.length, ...(art ? { art } : {}), checked: live.filter((o) => byslug.get(o.slug)!.verified === true).length, players: playersBy.get(g.id) || 0, langs });
    }
    for (const code of langs) {
      setLang(code);
      const t = trs[code];
      // Drafts are English-only previews; an unpublished guide's pages keep their translated addresses too (noindex).
      const pages = code === 'en' || restored ? visible : visible.filter((o) => byslug.get(o.slug)!.status === 'published');
      renderGame(g.id, String(info.game || g.id), pages, byslug, t, langs, sitemap, trs, ach, Number(info.appId) || undefined);
    }
    setLang('en');
    COMP = null;
  }

  if (restoredGuides.length) console.log(`Unpublished guides kept at their addresses as noindex pages: ${restoredGuides.join(', ')}.`);
  for (const code of Object.keys(LANG_TAG)) {
    const list = games.filter((g) => g.langs.includes(code));
    if (!list.length) continue;
    setLang(code);
    const base = path.join(OUT, langPath(code), 'guides');
    fs.mkdirSync(base, { recursive: true });
    const depth = code === 'en' ? 1 : 2;
    const langsWithGuides = Object.keys(LANG_TAG).filter((c) => games.some((g) => g.langs.includes(c)));
    fs.writeFileSync(
      path.join(base, 'index.html'),
      page({
        title: ui('indexTitle'),
        description: ui('indexDesc'),
        depth,
        canonical: `${SITE}/${langPath(code)}guides/`,
        langs: langsWithGuides,
        path: 'guides/',
        body: `${indexBody(list)}${code !== 'en' && list.length < games.length ? `<p class="mt-8"><a href="../../guides/index.html" class="text-[#a87ffb] hover:text-white font-semibold">${esc(ui('indexMore'))} &rarr;</a></p>` : ''}`,
      }),
    );
    if (code !== 'en') sitemap.push(`${SITE}/${code}/guides/`);
  }
  setLang('en');
  renderUpdates(sitemap);
  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  if (PREVIEW) {
    // A preview: the site's icons beside it, and its own stylesheet; the website files and the homepage are untouched.
    for (const f of ['icon.svg', 'favicon.ico', 'favicon-96.png', 'favicon-192.png']) if (fs.existsSync(path.resolve('Marketing_Website_Files', f))) fs.copyFileSync(path.resolve('Marketing_Website_Files', f), path.join(OUT, f));
    await buildSiteCss();
    console.log(`Preview: ${OUT}${protos.size ? ` (${protos.size} flagship prototype(s))` : ''}. Nothing published.`);
    process.exit(0);
  }
  updateHomepage(games.filter((g) => g.published > 0));
  updateHomepageUpdates();
  updateVersion();
  writeRedirects(moved, new Set(sitemap));
  writeGuideIndex(guideIndex);
  write404();
  // Links use the final URLs (/guides/x/, not /guides/x/index.html), so nothing a visitor or crawler follows redirects
  // or shows the same page under a second URL.
  let relinked = 0;
  const walkHtml = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkHtml(p);
      else if (e.name.endsWith('.html')) {
        const s = fs.readFileSync(p, 'utf8');
        const t = finalLinks(s);
        if (t !== s) { fs.writeFileSync(p, t); relinked++; }
      }
    }
  };
  walkHtml(OUT);
  console.log(`Links: final URLs in ${relinked} page(s).`);
  await buildSiteCss();
  console.log(`Built ${games.reduce((n, g) => n + g.count, 0)} guide page(s) for ${games.length} game(s)${withDrafts ? ' (drafts included, marked DRAFT and hidden from search)' : ''}.`);
  console.log(`Open ${path.join(OUT, 'guides', 'index.html')} in your browser to look them over.`);
  await releaseGuideLocks();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Publishing failed:', e?.message || e);
  await releaseGuideLocks();
  process.exit(1);
});
