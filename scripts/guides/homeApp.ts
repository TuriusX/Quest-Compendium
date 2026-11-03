/**
 * The homepage's own small app, in place of the spellbook logo (owner, Nov 3 2026; mockups: Desktop\QC-homepage-app): pick a game,
 * ask, get the answer as it's written, sign in for more and take Premium, all without leaving the page. publish.ts puts it
 * between the QC-HOMEAPP markers, one copy per language, when config/siteAsk.homeApp is on; off, the logo stays and the page is
 * as it was. Switched off while live (the reCAPTCHA safety net, or the server can't be reached), the script brings the logo
 * back. The server side is siteAsk.ts (surface "home"), with the guide box's limits, App Check and $1 a day.
 */

export type HomeTile = { key: string; name: string; art: string };
export type HomeExample = { p?: string; a?: 1; b?: 1 };

/** A game's fitting example questions: only what its guide really has (owner, Nov 3 2026), so some games show two. */
export function pickExample(g: { hasAchievements?: boolean; missablesByArea: { name: string; n: number }[]; sectionNames: string[] }): HomeExample {
  const top = g.missablesByArea.filter((a) => a.n > 0).sort((a, b) => b.n - a.n)[0];
  const builds = g.sectionNames.some((s) => /\b(class(es)?|builds?|skills?|perks?|talents?|spells?|weapons?|loadouts?|cyberware|ashes of war|stats?)\b/i.test(s));
  return { ...(top ? { p: top.name } : {}), ...(g.hasAchievements ? { a: 1 as const } : {}), ...(builds ? { b: 1 as const } : {}) };
}

const CSS = String.raw`
#qc-app{--p:#0e0f17;--p2:#171824;--p3:#20212f;--l:rgba(255,255,255,.1);--l2:rgba(255,255,255,.18);--s:#fff;--t1:#e4e4e7;--t2:#c4c4cc;--t3:#a1a1aa;--t4:#85858f;--a:#a87ffb;--a2:#c4b0ff;--on:#0b0814;--as:rgba(168,127,251,.14);--al:rgba(168,127,251,.45);--g:#f4c534;--pg1:#d6cfa6;--pg2:#a59e70;--ok:#6ee7b7;--oks:rgba(16,185,129,.14);--off:#2a2b3a;--glow:0 0 70px rgba(168,127,251,.2)}
html.qc-light #qc-app{--p:#fff;--p2:#f3f1f8;--p3:#e8e5f0;--l:rgba(23,21,29,.12);--l2:rgba(23,21,29,.22);--s:#17151d;--t1:#221f2a;--t2:#36323f;--t3:#4a4555;--t4:#5c5768;--a:#5f33c4;--a2:#4f2aa8;--on:#fff;--as:rgba(95,51,196,.09);--al:rgba(95,51,196,.4);--g:#c9920c;--pg1:#d9d2ab;--pg2:#b4ad80;--ok:#05664a;--oks:rgba(5,102,74,.1);--off:#dcd8e6;--glow:0 18px 50px rgba(62,38,130,.14)}
[data-qc-hero]:not(.qa-off){max-width:75rem;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,36rem);column-gap:3.25rem;text-align:left;align-content:start}
[data-qc-hero]:not(.qa-off)>*{grid-column:1}
[data-qc-hero]:not(.qa-off)>#qc-app{grid-column:2;grid-row:1/span 7;align-self:start}
[data-qc-hero]:not(.qa-off)>figure{grid-column:1/-1}
[data-qc-hero]:not(.qa-off)>h1{font-size:3.25rem;line-height:1.08;padding-top:1.75rem}
[data-qc-hero]:not(.qa-off)>p{margin-left:0!important;margin-right:0!important}
[data-qc-hero]:not(.qa-off)>div{flex-direction:row;flex-wrap:wrap;justify-content:flex-start;gap:.625rem}
[data-qc-hero]:not(.qa-off)>div a{width:auto;padding:.5rem 1.1rem;font-size:.875rem;order:0!important}
[data-qc-hero]:not(.qa-off)>div a:first-child{padding:0}
[data-qc-hero]:not(.qa-off)>.qa-logo,[data-qc-hero].qa-off>#qc-app{display:none}
@media (max-width:68.75rem){[data-qc-hero]:not(.qa-off){grid-template-columns:minmax(0,1fr);padding-top:1.5rem;text-align:center}
[data-qc-hero]:not(.qa-off)>#qc-app{grid-column:1;grid-row:auto;order:1;max-width:40rem;width:100%;margin:0 auto 1.5rem}
[data-qc-hero]:not(.qa-off)>h1{order:0;font-size:1.875rem;padding-top:0;margin-bottom:1rem}
[data-qc-hero]:not(.qa-off)>h1 span{font-size:1.125rem;margin-top:.375rem}
[data-qc-hero]:not(.qa-off)>p,[data-qc-hero]:not(.qa-off)>div,[data-qc-hero]:not(.qa-off)>figure{order:2}
[data-qc-hero]:not(.qa-off)>p{margin-left:auto!important;margin-right:auto!important}
[data-qc-hero]:not(.qa-off)>div{justify-content:center}}
#qc-app{position:relative;background:var(--p);border:1px solid var(--l2);border-radius:6px;box-shadow:var(--glow);padding:1.375rem 1.875rem 1.25rem 1.375rem;display:grid;gap:1rem;color:var(--t1);font-size:1rem;line-height:1.5;text-align:left;min-width:0}
#qc-app *{box-sizing:border-box}
#qc-app button,#qc-app input,#qc-app textarea{font:inherit;color:inherit}
#qc-app button{cursor:pointer;background:none;border:0;padding:0}
#qc-app :focus-visible{outline:2px solid var(--a);outline-offset:2px}
#qc-app::after{content:"";position:absolute;top:10px;bottom:10px;right:0;width:9px;background:repeating-linear-gradient(180deg,var(--pg1) 0 9px,var(--pg2) 9px 18px);border-left:1px solid rgba(0,0,0,.25)}
.qa-c{position:absolute;right:15px;width:14px;height:14px;pointer-events:none;--c:var(--g)}
.qa-c.t{top:9px;background:linear-gradient(var(--c),var(--c)) 0 0/100% 5px no-repeat,linear-gradient(var(--c),var(--c)) 100% 0/5px 100% no-repeat}
.qa-c.b{bottom:9px;background:linear-gradient(var(--c),var(--c)) 0 100%/100% 5px no-repeat,linear-gradient(var(--c),var(--c)) 100% 0/5px 100% no-repeat}
.qa-body{display:grid;gap:1rem;min-width:0}
.qa-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.875rem;padding-right:.75rem}
.qa-head h2{margin:0;font-size:1.3125rem;line-height:1.2;font-weight:700;color:var(--s);letter-spacing:-.01em}
.qa-head p{margin:.1875rem 0 0;font-size:.84rem;color:var(--t3)}
.qa-left{flex:none;display:flex;align-items:center;gap:.4375rem;font-size:.78rem;color:var(--t3);white-space:nowrap;padding-top:.25rem}
.qa-pips{display:flex;gap:3px}.qa-pips i{width:9px;height:9px;background:var(--a);display:block}.qa-pips i.o{background:var(--off)}
.qa-lbl{display:block;font-size:.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--t3);margin:0 0 .5rem}
.qa-find{position:relative}.qa-find svg{position:absolute;left:.8rem;top:50%;transform:translateY(-50%);color:var(--t4)}
.qa-find input{width:100%;min-height:2.875rem;padding:0 .875rem 0 2.5rem;background:var(--p2);border:1px solid var(--l);border-radius:8px;outline:0;font-size:1rem}
#qc-app input::placeholder,#qc-app textarea::placeholder{color:var(--t4)}
.qa-find input:focus{border-color:var(--a);box-shadow:0 0 0 3px var(--as)}
.qa-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}
#qc-app .qa-tile{display:flex;align-items:center;gap:.5625rem;min-height:3.125rem;padding:.3125rem .5rem .3125rem .3125rem;background:var(--p2);border:1px solid var(--l);border-radius:8px;text-align:left;font-size:.8125rem;line-height:1.2;font-weight:600;color:var(--t1);min-width:0}
#qc-app .qa-tile:hover{border-color:var(--al)}
.qa-tile img,.qa-game img,.qa-res img{width:2.375rem;height:2.375rem;border-radius:5px;object-fit:cover;flex:none;background:var(--p3)}
.qa-tile span{min-width:0;overflow-wrap:anywhere}
.qa-results{margin-top:.375rem;border:1px solid var(--l);border-radius:8px;overflow:hidden}
#qc-app .qa-res{display:flex;align-items:center;gap:.6875rem;width:100%;min-height:3.375rem;padding:.4375rem .6875rem;text-align:left;border-top:1px solid var(--l)}
#qc-app .qa-res:first-child{border-top:0}#qc-app .qa-res:hover{background:var(--as)}
.qa-res b{display:block;font-size:.906rem;font-weight:600;color:var(--s);line-height:1.25}.qa-res small{display:block;font-size:.78rem;color:var(--t3);line-height:1.3}
.qa-noart{width:2.375rem;height:2.375rem;flex:none;border-radius:5px;border:1px dashed var(--l2);display:grid;place-items:center;color:var(--t4)}
.qa-game{display:flex;align-items:center;gap:.625rem;padding:.375rem .625rem .375rem .375rem;background:var(--p2);border:1px solid var(--l);border-radius:8px}
.qa-game b{font-size:.906rem;color:var(--s);font-weight:600;line-height:1.2;min-width:0}
#qc-app .qa-game button{margin-left:auto;flex:none;font-size:.8125rem;font-weight:600;color:var(--a);min-height:2.25rem;padding:0 .375rem}
.qa-chips{display:grid;gap:.4375rem}
#qc-app .qa-chip{display:flex;align-items:center;gap:.625rem;min-height:2.75rem;width:100%;padding:.4375rem .75rem;border:1px solid var(--l);border-radius:8px;text-align:left;font-size:.875rem;line-height:1.3;color:var(--t1)}
#qc-app .qa-chip:hover{border-color:var(--al);background:var(--as)}
.qa-chip em{flex:none;width:5.75rem;font-style:normal;font-size:.6875rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--a)}
.qa-ask{position:relative;border:1px solid var(--l2);border-radius:8px;background:var(--p2)}
.qa-ask.off{opacity:.6;border-color:var(--l)}.qa-ask:focus-within{border-color:var(--a);box-shadow:0 0 0 3px var(--as)}
.qa-ask textarea{display:block;width:100%;height:3.625rem;resize:none;padding:.6875rem .8125rem 0;border:0;background:none;outline:0;line-height:1.4;font-size:1rem}
.qa-bar{display:flex;align-items:center;gap:.5rem;padding:.375rem .4375rem .4375rem}
#qc-app .qa-clip{display:flex;align-items:center;gap:.4375rem;min-height:2.375rem;padding:0 .5625rem;border-radius:6px;font-size:.8125rem;font-weight:500;color:var(--t3)}
#qc-app .qa-clip:hover{background:var(--p3);color:var(--t1)}#qc-app .qa-clip[disabled]{cursor:default;background:none;color:var(--t3)}
#qc-app .qa-send{margin-left:auto;min-height:2.375rem;padding:0 1.125rem;border-radius:6px;background:var(--a);color:var(--on);font-weight:700;font-size:.875rem;white-space:nowrap}
#qc-app .qa-send[disabled]{background:var(--p3);color:var(--t4);cursor:default}
.qa-thumb{display:flex;align-items:center;gap:.6875rem;margin:.5625rem .5625rem 0;padding:.375rem;border:1px solid var(--l);border-radius:7px;background:var(--p)}
.qa-thumb img,.qa-q img{display:block;border-radius:4px;object-fit:cover}.qa-thumb img{flex:none;width:5.25rem;height:3.25rem}
.qa-thumb div{min-width:0;font-size:.8125rem;line-height:1.35}.qa-thumb b{display:block;color:var(--s);font-weight:600}.qa-thumb small{display:block;color:var(--t3);font-size:.78rem}
#qc-app .qa-thumb button{margin-left:auto;flex:none;width:2.125rem;height:2.125rem;display:grid;place-items:center;color:var(--t3)}
.qa-drop{position:absolute;inset:0;z-index:2;display:grid;place-content:center;justify-items:center;text-align:center;gap:.4375rem;padding:1.25rem;margin:.5rem 1.375rem .5rem .5rem;background:color-mix(in srgb,var(--p) 97%,transparent);border:2px dashed var(--a);border-radius:6px}
.qa-drop b{font-size:1.125rem;color:var(--s)}.qa-drop span{font-size:.84rem;color:var(--t3);max-width:30em}.qa-drop svg{color:var(--a)}
.qa-q{font-size:.875rem;color:var(--t3);padding-left:.6875rem;border-left:3px solid var(--al);line-height:1.4;overflow-wrap:anywhere}.qa-q img{width:7.75rem;height:4.75rem;margin-bottom:.4375rem}
.qa-a{font-size:.97rem;line-height:1.55;color:var(--t1);white-space:pre-line;overflow-wrap:anywhere}
.qa-note{font-size:.8125rem;color:var(--t3)}
.qa-src{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem}.qa-src span{font-size:.78rem;color:var(--t3);margin-right:.125rem}
#qc-app .qa-src a{display:inline-flex;align-items:center;min-height:2rem;padding:.25rem .625rem;border-radius:6px;background:var(--as);color:var(--a);font-size:.8125rem;font-weight:600;line-height:1.2}
.qa-more{font-size:.84rem;color:var(--t3);padding-top:.75rem;border-top:1px solid var(--l)}#qc-app .qa-more a,#qc-app .qa-alt a,#qc-app .qa-alt button{color:var(--a);font-weight:600}
.qa-gate{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--al);border-radius:8px;background:var(--as)}
.qa-gate h3{margin:0;font-size:1.1875rem;line-height:1.25;font-weight:700;color:var(--s);letter-spacing:-.01em}.qa-gate p{margin:0;font-size:.875rem;color:var(--t2)}
#qc-app .qa-google{display:flex;align-items:center;justify-content:center;gap:.6875rem;min-height:2.875rem;width:100%;border-radius:6px;background:#fff;color:#1f1f1f;font-weight:600;font-size:.94rem;border:1px solid #c9c7d1}
.qa-alt{font-size:.8125rem;color:var(--t3);text-align:center}
.qa-wait{display:grid;gap:.5625rem}.qa-wait i{display:block;height:11px;border-radius:2px;background:var(--p3)}
.qa-status{display:flex;align-items:center;gap:.5625rem;font-size:.84rem;color:var(--ok);padding:.5625rem .6875rem;border-radius:7px;background:var(--oks);font-weight:500}.qa-status svg{flex:none}
.qa-look{font-size:.875rem;color:var(--t3)}
.qa-plans{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
#qc-app .qa-plan{display:block;text-align:left;padding:.6875rem .8125rem;border:1px solid var(--l2);border-radius:8px;background:var(--p);min-width:0}
#qc-app .qa-plan.sel{border:2px solid var(--a);padding:.625rem .75rem}
.qa-plan small{display:block;font-size:.78rem;color:var(--t3)}.qa-plan b{display:block;font-size:1.3125rem;color:var(--s);line-height:1.25;letter-spacing:-.01em}.qa-plan b i{font-style:normal;font-size:.8125rem;font-weight:500;color:var(--t3);letter-spacing:0}
.qa-save{display:inline-block;margin-left:.25rem;padding:0 .3125rem;font-size:.6875rem;font-weight:700;color:var(--ok);background:var(--oks);border-radius:3px}
.qa-gets{margin:0;padding:0;list-style:none;display:grid;gap:.375rem;font-size:.875rem;color:var(--t2)}.qa-gets li{display:flex;gap:.5625rem;line-height:1.35}.qa-gets svg{flex:none;margin-top:3px;color:var(--a)}
#qc-app .qa-pay{display:flex;align-items:center;justify-content:center;min-height:2.875rem;width:100%;border-radius:6px;background:var(--a);color:var(--on);font-weight:700;font-size:.94rem}
#qc-app .qa-back{display:flex;align-items:center;gap:.375rem;font-size:.8125rem;font-weight:600;color:var(--a);min-height:1.875rem}
.qa-stripe{background:#fff;border-radius:8px;min-height:20rem;overflow:hidden}
.qa-one{display:flex;gap:.5rem}.qa-one input{flex:1;min-width:0;min-height:2.75rem;padding:0 .75rem;border:1px solid var(--l2);border-radius:8px;background:var(--p2);outline:0;font-size:1rem}
#qc-app .qa-one .qa-send{margin:0;min-height:2.75rem}#qc-app .qa-one .qa-clip{padding:0 .625rem;min-height:2.75rem;border:1px solid var(--l2);border-radius:8px;background:var(--p2)}
.qa-s{display:none}
@media (max-width:35rem){#qc-app{padding:1rem 1.5rem 1rem .875rem;gap:.875rem}.qa-body{gap:.875rem}.qa-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.qa-head h2{font-size:1.1875rem}
#qc-app .qa-chip{display:block;min-height:3rem}.qa-chip em{display:block;width:auto;margin-bottom:1px}.qa-c{right:12px}.qa-g{display:none}.qa-s{display:inline}.qa-plan b{font-size:1.1875rem}.qa-drop{margin-right:1.125rem}#qc-app .qa-clip,#qc-app .qa-send{min-height:2.75rem}}
`;

/** The block between the markers: the logo for when it's off, the app's frame, and everything its script needs. */
export function homeAppBlock(o: { logoAlt: string; logoSrc: string; api: string; lang: string; T: Record<string, string>; tiles: HomeTile[]; up: string }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<style>${CSS.replace(/\s*\n\s*/g, '')}</style>
      <img src="${esc(o.logoSrc)}" alt="${esc(o.logoAlt)}" class="qa-logo w-24 h-24 mx-auto mb-6 drop-shadow-[0_0_30px_rgba(168,127,251,0.4)]" style="image-rendering: pixelated;">
      <section id="qc-app" aria-label="${esc(o.T.title)}" data-api="${esc(o.api)}" data-lang="${esc(o.lang)}" data-up="${esc(o.up)}" data-t="${esc(JSON.stringify(o.T))}" data-tiles="${esc(JSON.stringify(o.tiles))}"><i class="qa-c t"></i><i class="qa-c b"></i><div class="qa-body" data-body></div></section>
      <script src="${esc(o.up)}assets/home-app.js" defer></script>`;
}

export const HOME_APP_JS = String.raw`// The homepage's app (scripts/guides/homeApp.ts; the server's siteAsk.ts, surface "home").
(function(){
  var root=document.getElementById('qc-app'); if(!root) return;
  var hero=root.closest('[data-qc-hero]'), body=root.querySelector('[data-body]');
  var d=root.dataset, T=JSON.parse(d.t), tiles=JSON.parse(d.tiles), api=d.api, lang=d.lang, up=d.up||'';
  var GS='https://www.gstatic.com/firebasejs/10.13.0/';
  var cfg=null, ac=null, games=null, examples=null;
  var S={view:'pick',game:null,q:'',img:null,find:'',left:null,asked:null,plan:'month',note:''};
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){return null;}}
  function ss(k,v){try{if(v===undefined)return sessionStorage.getItem(k);if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v);return true;}catch(e){return false;}}
  var dev=ls('qc-ask-device')||'';
  if(!/^[a-f0-9]{24}$/.test(dev)){dev=Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)),function(b){return('0'+b.toString(16)).slice(-2);}).join('');ls('qc-ask-device',dev);}
  var IC={search:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>',
    pic:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m21 16-5-5L6 20"/></svg>',
    picL:'<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m21 16-5-5L6 20"/></svg>',
    x:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    ok:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>',
    back:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    g:'<svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 7.1-10.3 7.1-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.8 24c0-1.6.3-3.1.8-4.6l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l8-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.4-10l-8 6.2C6.5 42.6 14.6 48 24 48z"/></svg>'};
  function h(tag,a){var e=document.createElement(tag);a=a||{};Object.keys(a).forEach(function(k){if(k==='on'){Object.keys(a.on).forEach(function(n){e.addEventListener(n,a.on[n]);});}else if(k==='html'){e.innerHTML=a.html;}else if(k==='text'){e.textContent=a.text;}else if(a[k]!==false&&a[k]!=null){e.setAttribute(k,a[k]===true?'':a[k]);}});for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c);}return e;}
  function off(){if(hero)hero.classList.add('qa-off');}
  function user(){return window.QC_AUTH&&window.QC_AUTH.state.user;}
  function premium(){return window.QC_AUTH&&window.QC_AUTH.state.premium;}
  function pips(n,of){var w=h('span',{class:'qa-pips','aria-hidden':'true'});for(var i=0;i<of;i++)w.appendChild(h('i',{class:i<n?'':'o'}));return w;}
  function perDevice(){return (cfg&&cfg.perDevice)||2;}
  function saved(){try{var j=JSON.parse(ls('qc-home-left')||'{}');return j.day===new Date().toISOString().slice(0,10)?j.left:null;}catch(e){return null;}}
  function save(n){ls('qc-home-left',JSON.stringify({day:new Date().toISOString().slice(0,10),left:n}));}
  function leftText(){
    if(user()){return S.left==null?null:h('span',{text:T[premium()?'leftPremium':'leftAccount'].replace('{n}',S.left)});}
    var n=S.left==null?(saved()==null?perDevice():saved()):S.left;
    return h('span',{style:'display:flex;align-items:center;gap:.4375rem'},pips(n,perDevice()),n===0?T.left0:n===1?T.left1:T.leftN.replace('{n}',n));
  }
  function head(){return h('div',{class:'qa-head'},h('div',{},h('h2',{text:T.title}),user()?null:h('p',{text:T.tag})),h('div',{class:'qa-left','aria-live':'polite'},leftText()));}
  function gameCard(){var g=S.game;return h('div',{class:'qa-game'},g.art?h('img',{src:g.art,alt:''}):h('span',{class:'qa-noart',html:IC.search}),h('b',{text:g.name}),h('button',{type:'button',text:T.change,on:{click:function(){S.game=null;S.view='pick';S.find='';S.img=null;S.q='';draw();}}}));}
  function clipBtn(label){return h('button',{type:'button',class:'qa-clip','aria-label':T.clip,html:IC.pic+(label?'<span class="qa-g">'+esc(T.clip)+'</span><span class="qa-s">'+esc(T.clipShort)+'</span>':''),on:{click:pickFile}});}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function askBox(ph,disabled){
    var ta=h('textarea',{placeholder:ph,'aria-label':ph,maxlength:'300',disabled:disabled,on:{input:function(){S.q=ta.value;},keydown:function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}});ta.value=S.q||'';
    var bar=h('div',{class:'qa-bar'},disabled?h('button',{type:'button',class:'qa-clip',disabled:true,html:IC.pic+'<span class="qa-g">'+esc(T.clip)+'</span><span class="qa-s">'+esc(T.clipShort)+'</span>'}):clipBtn(true),h('button',{type:'button',class:'qa-send',disabled:disabled,text:T.ask,on:{click:send}}));
    return h('div',{class:'qa-ask'+(disabled?' off':'')},S.img?h('div',{class:'qa-thumb'},h('img',{src:S.img,alt:T.attached}),h('div',{},h('b',{text:T.attached}),h('small',{text:T.kept})),h('button',{type:'button','aria-label':T.remove,html:IC.x,on:{click:function(){S.img=null;draw();}}})):null,ta,bar);
  }
  function send(){var q=(S.q||'').trim();if(q.length<3&&!S.img)return;ask(q,S.img);}
  function exampleList(){
    if(!S.game||S.game.noGuide)return [];
    var x=(examples||{})[S.game.key]||{},out=[],n=S.game.name;
    if(x.p)out.push([T.catMiss,lang==='en'?T.qMissPlace.replace('{place}',x.p):T.qMissGame.replace('{game}',n)]);
    if(x.a)out.push([T.catAch,T.qAch.replace('{game}',n)]);
    if(x.b)out.push([T.catBuild,T.qBuild.replace('{game}',n)]);
    return out;
  }
  function norm(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/['’™®:]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
  function clean(n){return String(n||'').replace(/[™®]/g,'').trim();}
  function results(){
    var f=norm(S.find);if(f.length<2||!games)return [];
    var ws=f.split(' ');
    return games.filter(function(g){var n=norm(g.game);return ws.every(function(w){return n.indexOf(w)>=0;});}).slice(0,4);
  }
  function loadGames(){if(games)return;games=[];fetch(up+'guides/index.json').then(function(r){return r.json();}).then(function(j){games=j.games||[];if(S.view==='pick'&&S.find)drawResults();}).catch(function(){});}
  function choose(g){S.game=g;S.view='game';S.q='';S.img=null;draw();var t=body.querySelector('textarea');if(t)t.focus();}
  var resBox=null;
  function drawResults(){
    if(!resBox)return;
    resBox.replaceChildren();
    var f=S.find.trim();
    if(norm(f).length<2){resBox.hidden=false;resBox.appendChild(popular());return;}
    var list=h('div',{class:'qa-results'}),rs=results();
    rs.forEach(function(g){var n=clean(g.game);list.appendChild(h('button',{type:'button',class:'qa-res',on:{click:function(){choose({key:g.key,name:n,art:g.art});}}},h('img',{src:g.art||'',alt:''}),h('span',{},h('b',{text:n}),h('small',{text:T.hasGuide}))));});
    var exact=rs.some(function(g){return norm(g.game)===norm(f);});
    if(!exact)list.appendChild(h('button',{type:'button',class:'qa-res',on:{click:function(){choose({key:'',name:f.slice(0,80),noGuide:true});}}},h('span',{class:'qa-noart',html:IC.search}),h('span',{},h('b',{text:f}),h('small',{text:T.noGuide}))));
    resBox.appendChild(list);
  }
  function popular(){var w=h('div',{class:'qa-tiles'});tiles.forEach(function(t){w.appendChild(h('button',{type:'button',class:'qa-tile',on:{click:function(){choose(t);}}},h('img',{src:t.art,alt:''}),h('span',{text:t.name})));});return h('div',{},h('span',{class:'qa-lbl',text:T.popular}),w);}
  function viewPick(){
    var inp=h('input',{placeholder:T.find,'aria-label':T.find,autocomplete:'off',on:{focus:loadGames,input:function(){S.find=inp.value;loadGames();drawResults();}}});inp.value=S.find;
    resBox=h('div',{});drawResults();
    return [head(),h('div',{class:'qa-find',html:IC.search},inp),resBox,askBox(T.askPh,true)];
  }
  function viewGame(){
    var ex=exampleList();
    return [head(),gameCard(),askBox(T.askGame.replace('{game}',S.game.name),false),ex.length?h('div',{},h('span',{class:'qa-lbl',text:T.tryThese}),(function(){var w=h('div',{class:'qa-chips'});ex.forEach(function(x){w.appendChild(h('button',{type:'button',class:'qa-chip',on:{click:function(){ask(x[1],null);}}},h('em',{text:x[0]}),x[1]));});return w;})()):null];
  }
  function questionBlock(a){return h('div',{class:'qa-q'},a.img?h('img',{src:a.img,alt:T.attached}):null,a.q||'');}
  function viewAnswer(){
    var a=S.asked,box=h('div',{class:'qa-a','aria-live':'polite',text:a.text||''});a.el=box;
    var one=h('input',{placeholder:T.another,'aria-label':T.another,maxlength:'300',on:{keydown:function(e){if(e.key==='Enter'){e.preventDefault();S.q=one.value;send();}}}});
    return [head(),gameCard(),S.note?h('div',{class:'qa-status',html:IC.ok+'<span>'+esc(S.note)+'</span>'}):null,questionBlock(a),
      a.done?null:(a.el2=h('div',{class:'qa-look',text:a.status||T.looking})),box,
      a.note?h('div',{class:'qa-note',text:a.note}):null,
      a.sources&&a.sources.length?(function(){var w=h('div',{class:'qa-src'},h('span',{text:T.fromGuide}));a.sources.forEach(function(s){w.appendChild(h('a',{href:s.href,text:s.label}));});return w;})():null,
      a.done?h('div',{class:'qa-more'},T.beside+' ',h('a',{href:'#download',text:T.win}),' · ',h('a',{href:'#steam-deck',text:T.deck})):null,
      a.done?h('div',{class:'qa-one'},clipBtn(false),one,h('button',{type:'button',class:'qa-send',text:T.ask,on:{click:function(){S.q=one.value;send();}}})):null];
  }
  function pendingBlock(){var a=S.asked;return a?h('div',{},h('span',{class:'qa-lbl',text:T.yourQ}),questionBlock(a)):null;}
  function inApp(){return /FBAN|FBAV|Instagram|Line\/|Discord|Reddit|Snapchat|; wv\)/i.test(navigator.userAgent);}
  function viewLimit(){
    return [head(),gameCard(),pendingBlock(),h('div',{class:'qa-gate'},h('h3',{text:T.limitT.replace('{n}',perDevice())}),h('p',{text:T.limitP.replace('{n}',S.perSignedIn||10)}),
      inApp()?h('p',{text:T.openBrowser}):h('button',{type:'button',class:'qa-google',html:IC.g+'<span>'+esc(T.google)+'</span>',on:{click:signIn}}),
      S.note?h('p',{text:S.note}):null,h('div',{class:'qa-alt',text:T.limitAlt+' '+T.tomorrow}))];
  }
  function viewCapped(){
    return [head(),S.game?gameCard():null,pendingBlock(),h('div',{class:'qa-gate'},h('h3',{text:T.cappedT}),h('p',{text:user()?T.cappedPUser:T.cappedP}),
      user()&&!premium()?h('button',{type:'button',class:'qa-pay',text:T.seePremium,on:{click:function(){S.view='premium';draw();}}}):null,
      h('div',{class:'qa-alt'},h('a',{href:'#download',text:T.getApp})))];
  }
  function viewOut(){return [head(),gameCard(),pendingBlock(),h('div',{class:'qa-gate'},h('h3',{text:T.outT.replace('{n}',S.premiumPerDay||50)}),h('p',{text:T.outP}))];}
  function planBtn(id,small,price,per,save){return h('button',{type:'button',class:'qa-plan'+(S.plan===id?' sel':''),on:{click:function(){S.plan=id;draw();}}},h('small',{},small,save?h('span',{class:'qa-save',text:save}):null),h('b',{},price,h('i',{text:per})));}
  function viewPremium(){
    var gets=h('ul',{class:'qa-gets'});[T.get1.replace('{n}',S.premiumPerDay||50),T.get2,T.get3].forEach(function(x){gets.appendChild(h('li',{html:IC.ok+'<span>'+esc(x)+'</span>'}));});
    return [head(),S.game?gameCard():null,pendingBlock(),h('div',{class:'qa-gate'},h('h3',{text:T.premT.replace('{n}',S.perSignedIn||10)}),h('p',{text:T.premP}),
      h('div',{class:'qa-plans'},planBtn('month',T.month,'$4.99',T.perMonth),planBtn('year',T.year,'$39.99',T.perYear,T.save)),gets,
      h('button',{type:'button',class:'qa-pay',text:T.cont,on:{click:checkout}}),S.note?h('p',{text:S.note}):null,
      h('div',{class:'qa-alt',text:T.cancel+' '+T.premAlt.replace('{n}',S.perSignedIn||10)}))];
  }
  function viewCheckout(){
    var mount=h('div',{class:'qa-stripe',id:'qa-stripe'});
    return [head(),h('button',{type:'button',class:'qa-back',html:IC.back+'<span>'+esc(T.back)+'</span>',on:{click:function(){if(S.stripe){S.stripe.destroy();S.stripe=null;}S.view='premium';draw();}}}),mount];
  }
  var VIEWS={pick:viewPick,game:viewGame,answer:viewAnswer,limit:viewLimit,capped:viewCapped,out:viewOut,premium:viewPremium,checkout:viewCheckout};
  function draw(){
    var kids=VIEWS[S.view]();
    body.replaceChildren();
    kids.forEach(function(k){if(k)body.appendChild(k);});
    if(S.dragging&&S.game)body.appendChild(dropOverlay());
    root.dataset.view=S.view;
  }
  function dropOverlay(){return h('div',{class:'qa-drop',html:IC.picL+'<b>'+esc(T.drop)+'</b><span>'+esc(T.dropWhy)+'</span>'});}
  // A screenshot: made small here (1600 px wide at most), checked again on the server, and never saved.
  var file=h('input',{type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true,on:{change:function(){if(file.files[0])takeFile(file.files[0]);file.value='';}}});root.appendChild(file);
  function pickFile(){file.click();}
  function takeFile(f){
    if(!S.game||!/^image\/(png|jpeg|webp)$/.test(f.type)){if(S.game){S.note='';}return;}
    var u=URL.createObjectURL(f),im=new Image();
    im.onload=function(){var s=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);S.img=c.toDataURL('image/jpeg',.85);URL.revokeObjectURL(u);S.view='game';S.dragging=false;draw();};
    im.onerror=function(){URL.revokeObjectURL(u);};im.src=u;
  }
  root.addEventListener('dragover',function(e){if(!S.game)return;e.preventDefault();if(!S.dragging){S.dragging=true;draw();}});
  root.addEventListener('dragleave',function(e){if(S.dragging&&!root.contains(e.relatedTarget)){S.dragging=false;draw();}});
  root.addEventListener('drop',function(e){if(!S.game)return;e.preventDefault();S.dragging=false;var f=e.dataTransfer&&e.dataTransfer.files[0];if(f)takeFile(f);else draw();});
  document.addEventListener('paste',function(e){if(!S.game||S.view==='checkout')return;var it=e.clipboardData&&[].slice.call(e.clipboardData.items||[]).find(function(x){return /^image\//.test(x.type);});if(it){var f=it.getAsFile();if(f){e.preventDefault();takeFile(f);}}});
  // App Check, as on the guide pages: loaded only when someone asks.
  function acToken(){
    if(!cfg||!cfg.appCheck)return Promise.resolve('');
    if(!ac)ac=Promise.all([import(GS+'firebase-app.js'),import(GS+'firebase-app-check.js')]).then(function(m){var app=m[0].initializeApp(cfg.appCheck.firebase,'qc-home');return{m:m[1],a:m[1].initializeAppCheck(app,{provider:new m[1].ReCaptchaEnterpriseProvider(cfg.appCheck.key),isTokenAutoRefreshEnabled:false})};});
    return ac.then(function(x){return x.m.getToken(x.a,false);}).then(function(t){return t.token;}).catch(function(){return'';});
  }
  function ask(q,img){
    S.asked={q:q,img:img,game:S.game,text:'',done:false};S.view='answer';S.q='';S.img=null;var kept=S.note;draw();
    var signed=user(),a=S.asked;
    Promise.all([acToken(),signed&&window.QC_AUTH?window.QC_AUTH.token():'']).then(function(t){
      var hd={'Content-Type':'application/json','X-Firebase-AppCheck':t[0],'X-QC-From':'homepage'};if(t[1])hd.Authorization='Bearer '+t[1];
      var pv=ls('qc-preview');if(pv)hd['X-QC-Preview']=pv;
      return fetch(api+'/api/site/ask',{method:'POST',headers:hd,body:JSON.stringify({surface:'home',stream:true,key:a.game.key||'',slug:'',kind:'front',game:a.game.name,lang:lang,q:q,device:dev,image:img||undefined})});
    }).then(function(r){
      if(!/ndjson/.test(r.headers.get('content-type')||''))return r.json().catch(function(){return{};}).then(finish);
      var dec=new TextDecoder(),buf='',rd=r.body.getReader();
      function pump(){return rd.read().then(function(x){
        if(x.done)return;
        buf+=dec.decode(x.value,{stream:true});
        var i;while((i=buf.indexOf('\n'))>=0){var l=buf.slice(0,i);buf=buf.slice(i+1);if(l.trim())onEvent(JSON.parse(l));}
        return pump();
      });}
      return pump();
    }).catch(function(){finish({error:'failed'});});
    function onEvent(e){
      if(e.t==='text'){if(e.replace!==undefined)a.text=e.replace;else a.text+=e.add;if(a.el2){a.el2.remove();a.el2=null;}if(a.el)a.el.textContent=a.text;}
      else if(e.t==='reset'){a.text='';if(a.el)a.el.textContent='';}
      else if(e.t==='searching'){a.status=T.searching;if(a.el2)a.el2.textContent=T.searching;}
      else if(e.t==='done')finish(e);
    }
    function finish(j){
      if(j.perSignedIn||j.freePerDay)S.perSignedIn=j.freePerDay;
      if(j.premiumPerDay)S.premiumPerDay=j.premiumPerDay;
      S.note='';
      if(j.off){off();return;}
      if(j.limit){
        if(j.limit==='site')S.view='capped';
        else if(j.limit==='account')S.view=j.premium?'out':'premium';
        else S.view='limit';
        if(j.limit==='account')S.left=0;
        draw();return;
      }
      if(j.error||!j.answer){a.text=T.error;a.done=true;a.failed=true;S.q=q;if(!a.text)a.text=T.error;draw();return;}
      a.text=j.answer;a.sources=j.sources||[];a.done=true;a.note=j.noGuide?(j.searched?T.noGuideSearched:T.noGuideKnown):'';
      if(typeof j.left==='number'){S.left=j.left;if(!j.account)save(j.left);}
      S.note=kept;draw();S.note='';
    }
  }
  // Signing in right here; a phone that blocks the popup goes by redirect, and the question waits in this tab.
  function keep(){var a=S.asked;if(!a)return;var o={q:a.q,game:a.game,img:a.img||null};if(!ss('qc-home-pending',JSON.stringify(o))){o.img=null;ss('qc-home-pending',JSON.stringify(o));}}
  window.addEventListener('qc-before-redirect',keep);
  function signIn(){
    if(!window.QC_AUTH)return;
    S.note='';keep();
    window.QC_AUTH.signIn().then(function(u){if(!u)return;ss('qc-home-pending',null);resume();}).catch(function(e){S.note=e&&/popup-closed|cancelled-popup/.test(String(e.code))?'':T.signInFailed;draw();});
  }
  function resume(){var a=S.asked;if(!a)return;S.left=null;S.note=T.signedIn.replace('{name}',(user()&&(user().displayName||user().email))||'');ask(a.q,a.img);}
  function checkout(){
    if(!user()){S.view='limit';draw();return;}
    S.note='';keep();
    window.QC_AUTH.token().then(function(t){return fetch(api+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t,'X-QC-From':'homepage'},body:JSON.stringify({interval:S.plan,embedded:true,from:'homepage'})});}).then(function(r){return r.json();}).then(function(j){
      if(j.url&&!j.clientSecret){location.assign(j.url);return;}
      if(!j.clientSecret||!cfg||!cfg.stripeKey)throw new Error('no checkout');
      S.view='checkout';draw();
      return loadStripe().then(function(){return window.Stripe(cfg.stripeKey).initEmbeddedCheckout({fetchClientSecret:function(){return Promise.resolve(j.clientSecret);},onComplete:paid});}).then(function(c){S.stripe=c;c.mount('#qa-stripe');});
    }).catch(function(){S.note=T.checkoutFailed;S.view='premium';draw();});
  }
  function loadStripe(){return window.Stripe?Promise.resolve():new Promise(function(ok,no){var s=document.createElement('script');s.src='https://js.stripe.com/v3/';s.onload=ok;s.onerror=no;document.head.appendChild(s);});}
  function paid(){if(S.stripe){S.stripe.destroy();S.stripe=null;}waitPremium(0);}
  function waitPremium(n){
    window.QC_AUTH.token().then(function(t){return fetch(api+'/api/user/status?fresh=1',{headers:{Authorization:'Bearer '+t,'x-qc-app':'site','x-qc-from':'homepage'}});}).then(function(r){return r.json();}).then(function(j){
      var on=!!(j&&(j.isPremium||(j.userData&&j.userData.isPremium)));
      if(!on&&n<12){setTimeout(function(){waitPremium(n+1);},1500);return;}
      if(window.QC_AUTH.state)window.QC_AUTH.state.premium=on;
      ss('qc-home-pending',null);S.left=null;S.note=T.premiumOn;
      if(S.asked)ask(S.asked.q,S.asked.img);else{S.view=S.game?'game':'pick';draw();}
    }).catch(function(){S.view='premium';S.note=T.checkoutFailed;draw();});
  }
  function start(){
    if(window.QC_AUTH&&window.QC_AUTH.onChange)window.QC_AUTH.onChange(function(){if(S.view==='pick'||S.view==='game')draw();});
    var p=null;try{p=JSON.parse(ss('qc-home-pending')||'null');}catch(e){}
    var back=/[?&]upgrade=success/.test(location.search);
    if(p&&p.game){
      S.game=p.game;S.asked={q:p.q,img:p.img,game:p.game,text:'',done:false};ss('qc-home-pending',null);
      var tries=0;(function wait(){
        if(user()){if(back)waitPremium(0);else resume();return;}
        if(tries++<40){setTimeout(wait,250);return;}
        S.view='limit';draw();
      })();
      S.view='limit';draw();return;
    }
    draw();
  }
  fetch(api+'/api/site/ask/config').then(function(r){return r.json();}).then(function(c){
    cfg=c;
    if(!c||!c.on||!(c.home||ls('qc-preview'))){off();return;}
    fetch(up+'guides/home-examples.json').then(function(r){return r.json();}).then(function(x){examples=x;if(S.view==='game')draw();}).catch(function(){examples={};});
    start();
  }).catch(off);
  // Drawn at once, so the page doesn't shift; the check above takes it away if it's switched off.
  S.left=saved();draw();
  window.QC_HOME={state:S,draw:draw};
})();
`;
