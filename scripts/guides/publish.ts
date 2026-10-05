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
import { db, gameKey, arg, cleanEntry, type GuideArea, type GuideEntry } from './common';
import { GUIDE_UI_EN } from './guide-ui';
import { mergeSameSpot } from '../../src/utils/trackerPayload';
import { shortGame, relatedQuests, achFlags, ACH_FLAGS, type AchFlag } from './siteText';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { GENERATED as GUIDE_UI_GEN } from './guide-ui.generated';

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
/** The art for a game, at a fixed shape (Steam's header art is 460×215), with the placeholder underneath. */
function artBox(game: string, appId: number | undefined, extra = '') {
  const placeholder = `<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#a87ffb]/30 via-[#1a1530] to-[#0c0d14]"><span class="text-2xl font-bold text-white/80 tracking-wide">${esc(initials(game))}</span></div>`;
  const img = appId
    ? `<img src="${steamArt(appId)}" alt="${esc(game)}" loading="lazy" decoding="async" width="460" height="215" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">`
    : '';
  return `<div class="relative aspect-[460/215] overflow-hidden bg-[#0c0d14] ${extra}">${placeholder}${img}</div>`;
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
    sections: (a.sections || []).map((x, i) => ({
      ...x,
      orig: x.title, // kept for recognizing the "Don't miss" section
      title: t.sections?.[i]?.title || x.title,
      entries: x.entries.map((e) => ({ ...e, ...((t.sections?.[i]?.entries || []).find((y: any) => y?.id === e.id) || {}), id: e.id })),
    })) as any,
  };
}

const SITE = 'https://questcompendium.com';
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
const REPORT_API = `${process.env.QC_SERVER_URL || 'https://quest-compendium-890629309063.us-east1.run.app'}/api/guides/report`;

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
  // Achievement labels filter (one at a time; "To do" = not ticked yet), and the spoiler switch / tap-to-reveal.
  var ff=document.querySelector('[data-flag-filter]');
  if(ff){ff.addEventListener('click',function(e){var b=e.target.closest('button[data-flag]');if(!b)return;var f=b.getAttribute('data-flag');
    ff.querySelectorAll('button[data-flag]').forEach(function(x){var on=x===b;x.classList.toggle('bg-[#a87ffb]/15',on);x.classList.toggle('border-[#a87ffb]/50',on);x.classList.toggle('text-white',on);});
    var dk=K?'qcw:'+K+':achievements':'',dn=dk?load(dk):new Set();
    document.querySelectorAll('[data-flags]').forEach(function(r){var show=!f||(f==='todo'?!dn.has(r.getAttribute('data-ach')):(' '+r.getAttribute('data-flags')+' ').indexOf(' '+f+' ')>=0);r.classList.toggle('qc-off',!show);});});}
  var sp=document.querySelector('[data-spoilers]');if(sp)sp.addEventListener('change',function(){b.classList.toggle('qc-spoilers',sp.checked);});
  document.addEventListener('click',function(e){var s=e.target.closest('.qc-spoiler');if(s){s.classList.add('is-shown');e.preventDefault();}});
  // "On this page" links: a section that's folded opens when its link is used (or the page opens at it).
  var openAt=function(){var id=location.hash.slice(1);if(!id)return;var el=document.getElementById(id);if(el&&el.tagName==='DETAILS')el.open=true;};
  window.addEventListener('hashchange',openAt);openAt();
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

function page(opts: { title: string; description: string; depth: number; canonical: string; body: string; draft?: boolean; guide?: string; area?: string; langs?: string[]; path?: string; entries?: { id: string; label: string }[]; ld?: object[] }) {
  // "Spot a mistake?": on an area page, the form can say which entry is wrong (its id goes to the server).
  const entryPicker = opts.entries && opts.entries.length
    ? `<label class="block text-sm text-zinc-400" for="qc-report-entry">${esc(ui('reportEntry'))}</label>
      <select id="qc-report-entry" class="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-zinc-100"><option value="">${esc(ui('reportEntryNone'))}</option>${opts.entries.map((e) => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join('')}</select>`
    : '';
  const up = '../'.repeat(opts.depth);
  // Other languages of this same page: a menu in the top bar and hreflang tags for search engines.
  const langs = opts.langs && opts.langs.length > 1 && opts.path !== undefined ? opts.langs : [];
  const hreflang = langs.map((c) => `<link rel="alternate" hreflang="${LANG_TAG[c]}" href="${SITE}/${langPath(c)}${opts.path}">`).join('\n  ');
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
  ${opts.draft ? '<meta name="robots" content="noindex">' : ''}
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${SITE}/icon.png">
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
    /* Hidden achievements: blurred until tapped, or all shown with the page's spoiler switch. */
    .qc-spoiler { filter: blur(5px); cursor: pointer; transition: filter .15s; }
    .qc-spoiler.is-shown, body.qc-spoilers .qc-spoiler { filter: none; }
    /* The achievement filter hides rows with this class (the search box uses the hidden attribute: both apply). */
    .qc-off { display: none !important; }
    /* Search hides entries with the hidden attribute; layout classes like "flex" would otherwise keep them showing. */
    [hidden] { display: none !important; }
  </style>
</head>
<body class="min-h-screen"${opts.guide ? ` data-guide="${esc(opts.guide)}"` : ''}${opts.area ? ` data-area="${esc(opts.area)}"` : ''}>
  <nav class="sticky top-0 z-40 bg-[#07070a]/85 backdrop-blur border-b border-white/5">
    <div class="max-w-6xl mx-auto px-5 sm:px-6 h-14 flex items-center justify-between">
      <a href="${up}${LP}index.html" class="flex items-center gap-2 font-bold text-white whitespace-nowrap text-sm sm:text-base"><img src="${up}icon.svg" alt="" class="w-7 h-7 qc-pixel"> Quest Compendium</a>
      <div class="flex items-center gap-4 sm:gap-5 text-sm text-zinc-400 whitespace-nowrap">
        <a href="${up}${LP}guides/index.html" class="hover:text-white">${esc(ui('navGuides'))}</a>
        <a href="${up}${LP}index.html#download" class="text-[#a87ffb] hover:text-white font-semibold">${esc(ui('navGetApp'))}</a>
        ${menu}
      </div>
    </div>
  </nav>
  ${opts.draft ? '<div class="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-sm text-center py-2">DRAFT preview: not public yet</div>' : ''}
  <main class="max-w-6xl mx-auto px-5 sm:px-6 py-8">${opts.body}</main>
  <footer class="max-w-6xl mx-auto px-5 sm:px-6 py-10 text-xs text-zinc-500 border-t border-white/5">
    ${esc(ui('footerReport'))
      .replace('{report}', `<button type="button" data-report class="text-[#a87ffb] hover:underline">${esc(ui('reportLink'))}</button>`)
      .replace('{discord}', '<a href="https://discord.gg/WxdgNMXWyg" class="text-[#a87ffb]">Discord</a>')} ${esc(ui('imagesNote'))}
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
    <a href="${up}${LP}index.html#download" class="inline-block bg-[#a87ffb] text-black font-bold px-5 py-2 rounded-full hover:bg-white">${esc(ui('ctaButton'))}</a>
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

const checkRow = (id: string, html: string) =>
  `<label class="qc-check flex gap-3 items-start px-3 py-2 rounded-lg hover:bg-white/[0.04] cursor-pointer" data-check="${esc(id)}"><input type="checkbox" aria-label="${esc(ui('gotIt'))}"><span class="text-sm leading-snug text-zinc-300">${html}</span></label>`;

/** A folding section: the header shows its progress; content stays in the page for search engines. */
function fold(title: string, icon: string, body: string, opts: { ids?: string[]; open?: boolean; id?: string } = {}) {
  if (!body) return '';
  return `<details class="qc-fold mt-3 scroll-mt-20"${opts.id ? ` id="${esc(opts.id)}"` : ''}${opts.open ? ' open' : ''}>
    <summary class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10">${ICON.caret}${icon}<h2 class="flex-1 text-sm sm:text-base font-bold text-white">${esc(title)}</h2>${opts.ids?.length ? `<span class="text-xs text-zinc-500" data-count="${esc(opts.ids.join(','))}">0/${opts.ids.length}</span>` : ''}</summary>
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
        info.services?.length && infoRow(ui('infoServices'), info.services.map(esc).join(' · ')),
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
        ${missGroups.map((g) => checkRow(g.ids.join('+'), groupHtml(g))).join('')}${miss.map((e) => checkRow(e.id, itemHtml(e))).join('')}${missSec.flatMap((x) => x.entries.map((e) => checkRow(e.id, esc(e.text)))).join('')}
      </section>`
    : '';
  const foes = a.enemies.map(cleanEntry);
  const chip = (label: string, v?: string) => (v ? `<span class="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-300"><span class="text-zinc-500">${label}</span> ${esc(v)}</span>` : '');
  const enemies = foes.length
    ? `<div class="grid sm:grid-cols-2 gap-2">${foes
        .map((e) => `<div class="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5"><div class="font-semibold text-white text-sm">${esc(e.name)}</div><div class="mt-1.5 flex flex-wrap gap-1.5">${chip(ui('weakTo'), e.weakness)}${chip(ui('stealDrop'), e.steal)}</div>${e.notes ? `<p class="mt-1.5 text-xs text-zinc-400">${esc(e.notes)}</p>` : ''}</div>`)
        .join('')}</div>`
    : '';
  // Key fights: one card per boss or set-piece battle, its details as labelled lines.
  const fightRow = (label: string, v?: string) => (v ? `<p class="mt-1 text-sm text-zinc-300"><span class="text-zinc-500">${esc(label)}:</span> ${esc(v)}</p>` : '');
  const fights = (a.fights || []).length
    ? `<div class="space-y-2">${(a.fights || [])
        .map((f) => `<div id="${esc(f.id)}" class="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5"><div class="font-semibold text-white">${esc(f.name)}</div>${fightRow(ui('fightEnemies'), f.enemies)}${fightRow(ui('fightThreats'), f.threats)}${fightRow(ui('fightWeak'), f.weaknesses)}${fightRow(ui('fightTactics'), f.tactics)}${fightRow(ui('fightRewards'), f.rewards)}</div>`)
        .join('')}</div>`
    : '';
  const shops = a.shops.length ? `<ul class="space-y-1.5 px-3">${a.shops.map(cleanEntry).map((e) => `<li class="text-sm"><strong class="text-white">${esc(e.name)}</strong>${e.sells ? `<span class="text-zinc-400">: ${esc(e.sells)}</span>` : ''}</li>`).join('')}</ul>` : '';
  const tips = a.tips.length ? `<ul class="list-disc pl-8 space-y-1 text-sm text-zinc-300">${a.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const navCard = (x: AreaLink | undefined, dir: 'prev' | 'next') =>
    x
      ? `<a href="../${esc(x.slug)}/index.html" class="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/[0.03] hover:border-[#a87ffb]/40 hover:bg-white/[0.06] px-4 py-3 ${dir === 'next' ? 'text-right' : ''}"><div class="text-[11px] uppercase tracking-wide text-zinc-500">${dir === 'prev' ? `&larr; ${esc(ui('previous'))}` : `${esc(ui('next'))} &rarr;`}</div><div class="text-sm font-semibold text-white truncate">${esc(x.name)}</div></a>`
      : '<span class="flex-1"></span>';
  // Flagship pages: the short version, the walkthrough (entries ticked where you meet them) and the choices (spoilers).
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
        <h2 class="text-xl font-bold text-white">${esc(ui('walkthrough'))}</h2>
        <p class="mt-1 text-sm text-zinc-500">${esc(ui('walkthroughIntro'))}</p>
        <ol class="mt-4 space-y-5">${(a.walkthrough || [])
          .map((st, i) => `<li id="${esc(st.id)}" class="relative pl-10 scroll-mt-20">
            <span class="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-[#a87ffb]/40 bg-[#a87ffb]/10 text-sm font-bold text-[#c4b0ff]">${i + 1}</span>
            <h3 class="font-semibold text-white leading-7">${esc(st.title)}</h3>
            <p class="mt-1 text-[15px] leading-relaxed text-zinc-300">${esc(st.text)}</p>
            ${(st.fights || []).map((fid) => fightById.get(fid)).filter(Boolean).map((f) => `<a href="#${esc(f!.id)}" class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200 hover:border-rose-400/60">${ICON.enemies}<span class="text-rose-300/80">${esc(ui('keyFight'))}:</span> ${esc(f!.name)}</a>`).join(' ')}
            ${(st.entries || []).length ? `<div class="mt-2 rounded-xl border border-white/5 bg-white/[0.02] py-1">${(st.entries || []).map(entryRow).join('')}</div>` : ''}
            ${st.tip ? `<p class="mt-2 text-sm text-emerald-200/90"><span class="font-semibold text-emerald-300">${esc(ui('stepTip'))}:</span> ${esc(st.tip)}</p>` : ''}
            ${st.warn ? `<p class="mt-1.5 text-sm text-amber-200/90"><span class="font-semibold text-amber-300">${esc(ui('stepWarn'))}:</span> ${esc(st.warn)}</p>` : ''}
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
        <div class="flex items-center gap-3"><h2 class="flex-1 text-xl font-bold text-white">${esc(ui('choicesHere'))}</h2><label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer"><input type="checkbox" data-spoilers class="accent-[#a87ffb]"> ${esc(ui('showSpoilers'))}</label></div>
        <p class="mt-1 text-sm text-zinc-500">${esc(ui('choicesIntro'))}</p>
        <div class="mt-4 space-y-3">${(a.choices || [])
          .map((c) => `<div id="${esc(c.id)}" class="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <h3 class="font-semibold text-white">${esc(c.title)}</h3>
            ${c.when ? `<p class="text-xs text-zinc-500 mt-0.5">${esc(c.when)}</p>` : ''}
            <ul class="mt-2.5 space-y-2">${c.options.map((o) => `<li class="text-sm"><span class="font-semibold text-zinc-100">${esc(o.label)}</span><span class="qc-spoiler block mt-0.5 text-zinc-400" title="${esc(ui('choicesIntro'))}">&rarr; ${esc(o.outcome)}</span></li>`).join('')}</ul>
            ${c.recommended ? `<p class="qc-spoiler mt-2.5 text-xs text-emerald-200/90"><span class="font-semibold text-emerald-300">${esc(ui('recommended'))}:</span> ${esc(c.recommended)}</p>` : ''}
            ${c.note ? `<p class="qc-spoiler mt-1 text-xs text-amber-200/90">${esc(c.note)}</p>` : ''}
          </div>`)
          .join('')}</div>
      </section>`
    : '';
  const box = (id: string) => `<input type="search" data-filter="#${id}" placeholder="${esc(ui('searchAreas'))}" class="w-full mb-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]/60">`;
  const sidebar = (id: string) => `<nav aria-label="${esc(game)}" class="qc-scroll">${`<a href="../index.html" class="block px-2.5 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-400 hover:text-white">${esc(game)}</a>`}${box(id)}<ul id="${id}" class="space-y-0.5">${areaList(gameKey, areas, a.slug, '../')}</ul></nav>`;

  return `
  <div class="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8">
    <aside class="hidden lg:block"><div class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto qc-scroll pr-1">${sidebar('qc-areas-side')}</div></aside>
    <article class="min-w-0 max-w-3xl">
      <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="${up}${LP}guides/index.html">${esc(ui('navGuides'))}</a> / <a class="hover:text-white" href="../index.html">${esc(game)}</a></p>
      <h1 class="text-3xl font-bold text-white leading-tight">${esc(a.name)}</h1>
      <div class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
        <span>${esc(ui('guideOf', { game }))}${a.story ? ` · ${esc(a.story)}` : ''}</span>
        ${a.verified !== false ? `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">&#10003; ${esc(ui('checkedBadge'))}</span>` : ''}
      </div>
      <a href="../index.html" class="lg:hidden mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm font-semibold text-white hover:bg-white/[0.06]"><span class="text-zinc-400">&larr;</span> ${esc(ui('allAreas'))}</a>
      ${a.overview ? `<p class="mt-5 text-zinc-300 leading-relaxed">${esc(a.overview)}</p>` : ''}
      ${infoBox}
      ${shortVersion}
      ${jump}
      ${quests.length ? `<p class="mt-3 text-sm text-zinc-400"><span class="text-zinc-500">${esc(ui('relatedQuests'))}:</span> ${quests.map((q) => `<span class="inline-block rounded-md bg-white/[0.05] px-2 py-0.5 text-zinc-200 mr-1 mb-1">${esc(q)}</span>`).join('')}</p>` : ''}
      ${walk}
      ${choices}
      ${walk ? `<h2 class="mt-10 text-xl font-bold text-white">${esc(ui('checklists'))}</h2>` : ''}
      ${dontMiss}
      ${otherSec
        .map((x) =>
          fold(x.title, ICON.list, x.check ? x.entries.map((e) => checkRow(e.id, esc(e.text))).join('') : `<ul class="list-disc pl-8 space-y-1 text-sm text-zinc-300">${x.entries.map((e) => `<li>${esc(e.text)}</li>`).join('')}</ul>`, {
            ids: x.check ? x.entries.map((e) => e.id) : undefined,
            open: true,
            id: `sec-${otherSec.indexOf(x) + 1}`,
          }),
        )
        .join('')}
      ${achs.length ? fold(ui('achHere'), ICON.list, achs.slice().sort((x, y) => Number(!!y.missable) - Number(!!x.missable)).map((x) => `<div class="px-3 py-2 text-sm text-zinc-300"><strong class="text-white">${esc(x.name)}</strong>${x.missable ? ` <span class="text-amber-400 text-[11px] font-bold uppercase">${esc(ui('achMissable'))}</span>` : ''}${x.how ? `<span class="block text-zinc-400 text-xs mt-0.5">${esc(x.how)}</span>` : ''}</div>`).join('') + `<p class="px-3 pt-1 text-xs"><a class="text-[#a87ffb] hover:text-white" href="../achievements/index.html">${esc(ui('achLink'))} &rarr;</a></p>`, { open: achs.some((x) => x.missable), id: 'achievements' }) : ''}
      ${fold(ui('items'), ICON.items, restGroups.map((g) => checkRow(g.ids.join('+'), groupHtml(g))).join('') + rest.map((e) => checkRow(e.id, itemHtml(e))).join(''), { ids: [...restGroups.flatMap((g) => g.ids), ...rest.map((e) => e.id)], open: true, id: 'items' })}
      ${fold(ui('secrets'), ICON.secrets, secretsLeft.map((e) => checkRow(e.id, esc(e.text))).join(''), { ids: secretsLeft.map((e) => e.id), open: true, id: 'secrets' })}
      ${fold(ui('fights'), ICON.enemies, fights, { open: true, id: 'fights' })}
      ${fold(ui('enemies'), ICON.enemies, enemies, { id: 'enemies' })}
      ${fold(ui('shops'), ICON.shops, shops, { id: 'shops' })}
      ${fold(ui('tips'), ICON.tips, tips, { open: true, id: 'tips' })}
      ${notListed}
      ${prev || next ? `<div class="mt-8 flex gap-3">${navCard(prev, 'prev')}${navCard(next, 'next')}</div>` : ''}
      ${cta(up, game)}
      ${a.sources.length ? `<p class="mt-6 text-xs text-zinc-500">${esc(ui('sourcesChecked', { list: a.sources.join(', ') }))}</p>` : ''}
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
          artBox(g.game, g.appId) +
          `<div class="p-4"><div class="text-white font-bold leading-snug">${esc(g.game)}</div>` +
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
          '      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">',
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
        canonical: url,
        ld,
        body: areaBody(gameName, key, a, links, links[i - 1], links[i + 1], '../'.repeat(3 + extra), achHere ? (achHere.list || []).filter((x: any) => x.area === o.slug) : []),
        draft,
        guide: key,
        area: o.slug,
        // The page's entries, for the report form's "which entry?" picker.
        entries: [
          ...a.items.map((e) => ({ id: e.id, label: String(e.name || '') })),
          ...a.secrets.map((e) => ({ id: e.id, label: String(e.text || e.name || '').slice(0, 70) })),
          ...(a.sections || []).filter((x) => x.check).flatMap((x) => x.entries.map((e) => ({ id: e.id, label: String(e.text || '').slice(0, 70) }))),
        ].filter((e) => e.id && e.label),
        langs: pageLangs(o.slug),
        path: `guides/${key}/${o.slug}/`,
      }),
    );
    if (!draft) sitemap.push(`${SITE}/${LP}guides/${key}/${o.slug}/`);
  });
  const checked = visible.filter((o) => byslug.get(o.slug)!.verified !== false).length;
  const totalChecks = links.reduce((n, l) => n + l.total, 0);
  const missables = visible.reduce((n, o) => n + byslug.get(o.slug)!.items.filter((e) => e.missable).length, 0);
  // "1 area" / "2 areas": the singular label when the number is 1.
  const one = (n: number, key: string) => ui(n === 1 ? `${key}One` : key);
  const stat = (v: number | string, label: string) => `<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><div class="text-xl font-bold text-white">${v}</div><div class="text-xs text-zinc-500">${esc(label)}</div></div>`;
  let lastGroup = '';
  const rows = links
    .map((l) => {
      const head = l.group && l.group !== lastGroup ? `<h2 data-head="${esc(l.group)}" class="pt-6 pb-2 text-sm font-bold uppercase tracking-wide text-zinc-400">${esc(l.group)}</h2>` : '';
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
          ${artBox(gameName, appId, 'rounded-2xl border border-white/10 mb-5')}
          <h1 class="text-3xl font-bold text-white">${esc(ui('gameH1', { game: gameName }))}</h1>
          <p class="text-zinc-400 mt-2">${esc(ui('gameIntro'))}</p>
          <div class="mt-5 grid grid-cols-2 ${checked ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-2">${stat(links.length, one(links.length, 'statAreas'))}${stat(totalChecks, one(totalChecks, 'statThings'))}${stat(missables, one(missables, 'statMissables'))}${checked ? stat(checked === links.length ? ui('statAll') : checked, one(checked, 'statChecked')) : ''}</div>
          ${achHere ? `<a href="achievements/index.html" class="mt-5 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] hover:bg-amber-500/[0.12]"><span class="text-amber-300">&#9733;</span><span class="flex-1 min-w-0"><span class="block font-semibold text-white">${esc(ui('achLink'))}</span><span class="block text-xs text-zinc-400">${(achHere.list || []).length} · ${(achHere.list || []).filter((x: any) => x.missable).length} ${esc(ui('achMissable').toLowerCase())}</span></span></a>` : ''}
          <a hidden data-continue="${esc(key)}" href="#" class="mt-5 flex items-center gap-3 px-4 py-3 rounded-xl border border-[#a87ffb]/40 bg-[#a87ffb]/10 hover:bg-[#a87ffb]/15"><span class="text-[#a87ffb]">&#9654;</span><span class="flex-1 min-w-0"><span class="block text-xs uppercase tracking-wide text-zinc-400">${esc(ui('continue'))}</span><span class="block font-semibold text-white truncate" data-continue-name></span></span></a>
          <input type="search" data-filter="#qc-area-rows" data-empty="#qc-area-empty" placeholder="${esc(ui('searchAreas'))}" class="mt-6 w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#a87ffb]/60">
          <div id="qc-area-rows" class="mt-3">${rows}</div>
          <p id="qc-area-empty" hidden class="mt-3 text-sm text-zinc-500">${esc(ui('noMatches'))}</p>
          ${cta('../'.repeat(2 + extra), gameName)}
        </div>`,
      draft: visible.some((o) => byslug.get(o.slug)!.status !== 'published'),
    }),
  );
  if (visible.some((o) => byslug.get(o.slug)!.status === 'published')) sitemap.push(`${SITE}/${LP}guides/${key}/`);
  if (achHere?.list?.length) renderAchievements(key, gameName, achHere, links, sitemap, achLangs);
}

/** The achievement guide page: roadmap, then every achievement (missable first), with ticks saved in the browser. */
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
          ${miss.length ? `<div class="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-sm"><div class="flex items-center gap-1.5 font-semibold text-amber-200">${ICON.warn} ${esc(ui('rmMissHere'))}</div><ul class="mt-1 space-y-1 text-zinc-200">${miss.map((x) => `<li>${link(x)}${x.how && !x.hidden ? `<span class="text-zinc-400">: ${esc(String(x.how).split(/(?<=[.!?])\s/)[0])}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
          ${mine.length > miss.length ? `<p class="mt-2 text-xs text-zinc-500">${esc(ui('rmAlsoHere'))}: ${mine.filter((x) => !x.missable).map(link).join(', ')}</p>` : ''}
        </li>`;
      }).join('')}</ol></section>`
    : '';
  const flagLabel = (f: AchFlag) => ui(`achFlag_${f}`);
  const flagChips = ACH_FLAGS.filter((f) => flagCount(f) > 0);
  const filterHtml = flagChips.length
    ? `<div class="mb-2 flex flex-wrap items-center gap-1.5 text-xs" data-flag-filter><button type="button" data-flag="" class="qc-flag rounded-md border border-[#a87ffb]/50 bg-[#a87ffb]/15 px-2 py-1 text-white">${esc(ui('achFilterAll'))}</button>${flagChips.map((f) => `<button type="button" data-flag="${f}" class="qc-flag rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300">${esc(flagLabel(f))} <span class="text-zinc-500">${flagCount(f)}</span></button>`).join('')}<button type="button" data-flag="todo" class="qc-flag rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-zinc-300">${esc(ui('achFilterTodo'))}</button>${list.some((x) => x.hidden) ? `<label class="ml-auto flex items-center gap-1.5 text-zinc-400"><input type="checkbox" data-spoilers class="accent-[#a87ffb]"> ${esc(ui('achSpoilers'))}</label>` : ''}</div>`
    : '';
  const row = (x: any) => {
    const where = x.area && areaName(x.area) ? `<a class="text-[#a87ffb] hover:text-white" href="../${esc(x.area)}/index.html">${esc(ui('achInArea', { area: areaName(x.area)! }))}</a>` : '';
    const flags = flagsOf.get(x)!;
    const tags = flags.filter((f) => f !== 'missable').map((f) => ` <span class="rounded bg-white/[0.06] px-1.5 text-[10px] font-semibold uppercase text-zinc-400">${esc(flagLabel(f))}</span>`).join('');
    const step = stepOf.has(x) ? `<a class="text-zinc-500 hover:text-white" href="#step-${stepOf.get(x)! + 1}">${esc(ui('rmStep', { n: stepOf.get(x)! + 1 }))}</a>` : '';
    const body = `<strong class="text-white">${esc(x.name)}</strong>${x.missable ? ` <span class="text-amber-400 text-[11px] font-bold uppercase">${esc(ui('achMissable'))}</span>` : ''}${tags}${x.rarity != null ? ` <span class="text-zinc-500 text-xs">${esc(ui('achRarity', { n: x.rarity }))}</span>` : ''}
      ${x.hidden ? (x.how ? `<span class="block text-[11px] uppercase tracking-wide text-zinc-500 mt-0.5">${esc(ui('achHiddenTag'))}</span>` : '') : x.desc ? `<span class="block text-zinc-400 text-xs mt-0.5">${esc(x.desc)}</span>` : ''}
      ${x.how ? (x.hidden ? `<span class="qc-spoiler block text-zinc-300 text-sm mt-1" title="${esc(ui('achHidden'))}">${esc(x.how)}</span>` : `<span class="block text-zinc-300 text-sm mt-1">${esc(x.how)}</span>`) : ''}
      ${where || step ? `<span class="block text-xs mt-1">${[where, step].filter(Boolean).join(' · ')}</span>` : ''}`;
    return `<div id="${achId(x.name)}" class="scroll-mt-20" data-flags="${esc(flags.join(' '))}" data-ach="${esc(`ach:${x.name}`)}" data-search="${esc(`${x.name} ${x.hidden ? '' : x.desc || ''} ${areaName(x.area) || ''}`)}">${checkRow(`ach:${x.name}`, body)}</div>`;
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
    return `<a href="${esc(g.key)}/index.html"${tags ? ` data-search="${esc(g.game)}" data-name="${esc(sortName(g.game))}" data-popular="${g.players || 0}" data-new="${g.created || 0}" data-l="${letter}"` : ''} class="block rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:border-[#a87ffb]/50 hover:bg-white/[0.06] transition-colors">${artBox(g.game, g.appId)}<div class="p-4"><div class="font-bold text-white leading-snug">${esc(g.game)}</div><div class="mt-1 text-sm text-zinc-400">${esc(g.count === 1 ? ui('areasCountOne') : ui('areasCount', { n: g.count }))}</div></div></a>`;
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
  const popular = list.filter((g) => (g.players || 0) > 0).sort((a, b) => (b.players || 0) - (a.players || 0)).slice(0, 4);
  const fresh = list.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 4);
  const row = (title: string, items: typeof list) =>
    items.length ? `<section data-hide-when-searching class="mb-8"><h2 class="text-lg font-bold text-white mb-3">${esc(title)}</h2><div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">${items.map((g) => card(g, false)).join('')}</div></section>` : '';
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
    <div data-games class="grid grid-cols-2 lg:grid-cols-4 gap-3">${cards}</div>
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
  // Staged rebuilds (guides/{key}--next) are never part of the site; review.ts --gate promotes them.
  const guides = { docs: (await db().collection('guides').get()).docs.filter((d) => !d.id.endsWith('--next') && (!ONLY || d.id === ONLY)) };
  // A preview carries the game's flagship prototypes (guidePrototypes/{key}__{slug}) on their pages.
  const protos = new Map<string, any>();
  if (PREVIEW) for (const d of (await db().collection('guidePrototypes').get()).docs) protos.set(d.id, d.data());
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
    const visible = order.filter((o) => byslug.has(o.slug) && show(byslug.get(o.slug)!.status));
    if (!visible.length) continue;
    // Languages this game's guide is translated into (translate-guide.ts), published pages only.
    const trs: Record<string, any> = {};
    for (const code of Array.isArray(info.languages) ? info.languages : []) {
      if (!LANG_TAG[code] || code === 'en') continue;
      const t = (await g.ref.collection('i18n').doc(code).get()).data();
      if (t?.areas && Object.keys(t.areas).length) trs[code] = t;
    }
    const langs = ['en', ...Object.keys(trs)];
    const ach = info.hasAchievements ? (await g.ref.collection('achievements').doc('main').get()).data() || null : null;
    games.push({
      key: g.id, game: String(info.game || g.id), count: visible.length,
      published: visible.filter((o) => byslug.get(o.slug)!.status === 'published').length, langs,
      players: playersBy.get(g.id) || 0, created: Number(info.createdAt || info.updatedAt || 0),
      appId: Number(info.appId) || undefined,
    });
    if (info.appId && String(info.art || '').includes(`/apps/${info.appId}/`)) ART.set(Number(info.appId), String(info.art));
    for (const code of langs) {
      setLang(code);
      const t = trs[code];
      // Drafts are English-only previews.
      const pages = code === 'en' ? visible : visible.filter((o) => byslug.get(o.slug)!.status === 'published');
      renderGame(g.id, String(info.game || g.id), pages, byslug, t, langs, sitemap, trs, ach, Number(info.appId) || undefined);
    }
    setLang('en');
  }

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
  updateVersion();
  await buildSiteCss();
  console.log(`Built ${games.reduce((n, g) => n + g.count, 0)} guide page(s) for ${games.length} game(s)${withDrafts ? ' (drafts included, marked DRAFT and hidden from search)' : ''}.`);
  console.log(`Open ${path.join(OUT, 'guides', 'index.html')} in your browser to look them over.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Publishing failed:', e?.message || e);
  process.exit(1);
});
