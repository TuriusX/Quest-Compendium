/**
 * The owner's editor, as it runs on questcompendium.com guide pages (served by ownerEditor.ts as
 * "(qcEditorClient)(cfg)"; it must stay self-contained: no imports, nothing from outside this function).
 *
 * In edit mode (the amber owner bar's switch), a tap or click on the page picks what to change:
 *   - a picture: Recrop (focal point), Another picture (the page's other pictures, or find a new one), Remove, the
 *     page's review queue;
 *   - text: the guide fields it shows (from the page's own page.json), then Fix now (edit it; a selected sentence on
 *     desktop, or one picked from the field), Send to pipeline, or Add a missing item.
 * Nothing changes for players until the next daily publish. Owner controls are amber, never the site's purple.
 */
/* eslint-disable */
export function qcEditorClient(cfg: { api: string; site: string }): void {
  // Loaded early (async, from the page's head): start once the page is there.
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => qcEditorClient(cfg)); return; }
  const w: any = window;
  if (w.__qcEditor) return;
  w.__qcEditor = true;
  let KEY = '';
  try { KEY = localStorage.getItem('qc_editor') || ''; } catch { return; }
  if (!KEY) return;

  // ---- The page --------------------------------------------------------------------------------------------------
  const m = location.pathname.match(/^\/(?:([a-z]{2})\/)?guides\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?(?:index\.html)?$/);
  // Just connected (/editor/connect sent the key here): say so, on any page.
  let fresh = false;
  try { fresh = sessionStorage.getItem('qc_editor_new') === '1'; sessionStorage.removeItem('qc_editor_new'); } catch { /* */ }
  if (fresh) {
    const t = document.createElement('div');
    t.setAttribute('style', 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483002;background:#1a1408;border:1px solid #f5b942;color:#f7e7c2;border-radius:12px;padding:10px 16px;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px #000a;max-width:calc(100vw - 24px);text-align:center');
    t.textContent = m ? '✓ This device can edit the guides now. Tap anything on the page to change it.' : '✓ This device can edit the guides now. Open any guide page: the amber Owner bar is at the bottom.';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }
  const LANG = (m && m[1]) || 'en', GAME = m ? m[2] : '', SLUG = (m && m[3]) || '';
  const TEXT_OK = !!SLUG && SLUG !== 'achievements';
  const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  const norm = (s: any) => String(s ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const narrow = () => innerWidth < 640;
  let ON = true;
  try { ON = localStorage.getItem('qc_editor_on') !== '0'; } catch { /* */ }

  async function api(path: string, body?: any): Promise<any> {
    const r = await fetch(cfg.api + path, { method: body ? 'POST' : 'GET', headers: { 'X-QC-Editor': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { LOST = true; drawBar(); throw new Error(j.error || 'Not connected.'); }
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  // ---- Look ------------------------------------------------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
  .qe-ui, .qe-ui * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  .qe-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 2147483000; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; white-space: nowrap;
    background: #1a1408f2; border: 1px solid #f5b942; color: #f7e7c2; border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 600; box-shadow: 0 8px 30px #000a; max-width: calc(100vw - 16px); }
  .qe-bar b { color: #f5b942; } .qe-bar .qe-sep { opacity: .4; } .qe-bar button { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; color: #f7e7c2; }
  .qe-bar .qe-tog { text-decoration: none; display: inline-flex; gap: 6px; align-items: center; }
  .qe-tog i { width: 30px; height: 17px; border-radius: 9px; background: #5a4a28; position: relative; display: inline-block; transition: background .15s; }
  .qe-tog i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 13px; height: 13px; border-radius: 50%; background: #1a1408; transition: left .15s; }
  .qe-tog.on i { background: #f5b942; } .qe-tog.on i::after { left: 15px; }
  body.qe-on article p, body.qe-on article li, body.qe-on article label.qc-check, body.qe-on article dd, body.qe-on article td, body.qe-on article h1, body.qe-on article h3, body.qe-on article blockquote { cursor: pointer; }
  body.qe-on article p:hover, body.qe-on article li:hover, body.qe-on article label.qc-check:hover, body.qe-on article dd:hover, body.qe-on article td:hover, body.qe-on article h1:hover, body.qe-on article h3:hover { outline: 1px dashed #f5b94299; outline-offset: 2px; border-radius: 4px; }
  body.qe-on article img[src*="/img/g/"] { cursor: pointer; outline: 2px dashed #f5b942; outline-offset: 2px; }
  .qe-hl { outline: 2px dashed #f5b942 !important; outline-offset: 3px; border-radius: 4px; background: #f5b94214; }
  body.qe-on .qe-edited { text-decoration: underline dotted #f5b942; text-decoration-thickness: 2px; text-underline-offset: 4px; }
  .qe-panel { position: absolute; z-index: 2147483001; width: 420px; max-width: calc(100vw - 16px); background: #17130b; border: 1px solid #f5b942; border-radius: 12px; padding: 14px; color: #eadfc8; font-size: 14px; line-height: 1.45; box-shadow: 0 12px 40px #000c; text-align: left; }
  .qe-panel.qe-sheet { position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-width: none; max-height: 78vh; overflow: auto; border-radius: 16px 16px 0 0; padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }
  .qe-panel.qe-wide:not(.qe-sheet) { width: 640px; }
  .qe-grip { width: 40px; height: 4px; border-radius: 2px; background: #5a4a28; margin: 0 auto 10px; }
  .qe-panel h4 { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #f5b942; }
  .qe-dim { color: #a99d86; font-size: 12.5px; } .qe-warn { color: #fbbf24; font-size: 12.5px; } .qe-ok { color: #86efac; font-size: 12.5px; }
  .qe-panel textarea, .qe-panel input, .qe-panel select { width: 100%; background: #0d0b07; color: #fff; border: 1px solid #5a4a28; border-radius: 8px; padding: 8px; font-size: 15px; line-height: 1.45; margin: 4px 0 8px; }
  .qe-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
  .qe-btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 7px 12px; border-radius: 8px; border: 1px solid #5a4a28; font-weight: 700; font-size: 13.5px; color: #f7e7c2; text-align: center; }
  .qe-btn.p { background: #f5b942; color: #1a1408; border-color: #f5b942; } .qe-btn.bad { border-color: #f87171; color: #fca5a5; } .qe-btn[disabled] { opacity: .5; pointer-events: none; }
  .qe-sheet .qe-row .qe-btn { flex: 1; }
  .qe-chip { all: unset; cursor: pointer; display: inline-block; padding: 3px 10px; border-radius: 999px; border: 1px solid #5a4a28; margin: 0 4px 6px 0; font-size: 12.5px; color: #eadfc8; }
  .qe-chip.on { border-color: #f5b942; color: #f5b942; }
  .qe-field { border: 1px solid #3a2f18; border-radius: 9px; padding: 8px 10px; margin: 6px 0; }
  .qe-field .qe-k { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #a99d86; }
  .qe-field .qe-v { margin: 2px 0 6px; color: #fff; max-height: 7.5em; overflow: auto; }
  .qe-sent { all: unset; cursor: pointer; display: block; padding: 4px 6px; border-radius: 6px; margin: 2px 0; color: #eadfc8; }
  .qe-sent:hover, .qe-sent.on { background: #f5b94226; color: #fff; }
  .qe-whole { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
  .qe-whole img { max-width: 100%; max-height: 300px; cursor: crosshair; display: block; }
  .qe-dot { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 2px #000a; pointer-events: none; }
  .qe-prev { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin-top: 8px; } .qe-prev img { object-fit: cover; border-radius: 6px; display: block; }
  .qe-prev span { display: block; font-size: 11px; color: #a99d86; margin-top: 2px; }
  .qe-cands { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 8px 0; }
  .qe-cands figure { margin: 0; } .qe-cands img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; display: block; background: #0d0b07; }
  .qe-cands figcaption { font-size: 11.5px; color: #a99d86; margin: 3px 0; }
  .qe-list { width: 100%; border-collapse: collapse; font-size: 13px; } .qe-list td { padding: 7px 6px; border-top: 1px solid #2a2618; vertical-align: top; }
  .qe-list a { color: #f5b942; } .qe-tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 5px; border: 1px solid #5a4a28; white-space: nowrap; }
  `;
  document.head.appendChild(css);

  // ---- Owner bar ---------------------------------------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.className = 'qe-ui qe-bar';
  document.body.appendChild(bar);
  let me: any = null, LOST = false;
  const RECONNECT = `${cfg.site}/_qc/connect`;
  function drawBar() {
    if (LOST) { bar.innerHTML = `<b>Owner</b><span class="qe-sep">·</span><span>This device isn't connected any more.</span><span class="qe-sep">·</span><a href="${RECONNECT}?to=${encodeURIComponent(location.href.split('#')[0])}" style="color:#f5b942">Reconnect</a>`; document.body.classList.remove('qe-on'); return; }
    const waiting = me ? me.edits.waiting : 0, q = me ? me.queue.waiting + me.queue.held : 0;
    bar.innerHTML = `<button class="qe-tog ${ON ? 'on' : ''}" data-qe="toggle"><i></i><b>Owner</b>${narrow() ? '' : ' editing'}</button>`
      + (narrow() ? '' : `<span class="qe-sep">·</span><span>${waiting ? `${waiting} waiting for the next publish` : TEXT_OK ? 'Tap anything to change it' : GAME ? 'Open a page of this guide to edit it' : 'Open any guide page to edit it'}</span>`)
      + `<span class="qe-sep">·</span><button data-qe="mine">Your edits${me && me.edits.stale ? ` (${me.edits.stale} ⚠)` : ''}</button>`
      + `<span class="qe-sep">·</span><button data-qe="queue">Pipeline${q ? ` (${q})` : ''}</button>`
      + (TEXT_OK && DATA && DATA.kind === 'area' ? `<span class="qe-sep">·</span><button data-qe="add">＋ Missing item</button>` : '');
  }
  bar.addEventListener('click', (e: any) => {
    const b = e.target.closest('[data-qe]');
    if (!b) return;
    const a = b.dataset.qe;
    if (a === 'toggle') { ON = !ON; try { localStorage.setItem('qc_editor_on', ON ? '1' : '0'); } catch { /* */ } document.body.classList.toggle('qe-on', ON); close(); drawBar(); }
    else if (a === 'mine') openMine('edits');
    else if (a === 'queue') openMine('queue');
    else if (a === 'add') openMissing(null);
  });
  function teardown() { bar.remove(); close(); document.body.classList.remove('qe-on'); document.removeEventListener('click', onClick, true); }

  // ---- The panel (beside what was picked on wide screens, a bottom sheet on phones) ---------------------------------
  let panel: any = null, picked: any = null;
  function close() {
    if (panel) panel.remove();
    panel = null;
    if (picked) picked.classList.remove('qe-hl');
    picked = null;
  }
  function open(html: string, near: any, wide = false): any {
    close();
    panel = document.createElement('div');
    panel.className = 'qe-ui qe-panel' + (narrow() ? ' qe-sheet' : '') + (wide ? ' qe-wide' : '');
    panel.innerHTML = (narrow() ? '<div class="qe-grip"></div>' : '') + html;
    document.body.appendChild(panel);
    if (near && near.classList && near !== bar) { picked = near; near.classList.add('qe-hl'); }
    if (!narrow()) {
      const r = near && near.getBoundingClientRect ? near.getBoundingClientRect() : { left: innerWidth / 2 - 210, bottom: 120, top: 120 };
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      let top = r.bottom + 10;
      if (top + ph > innerHeight - 70 && r.top - ph - 10 > 10) top = r.top - ph - 10;
      panel.style.left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - pw - 12)) + scrollX + 'px';
      panel.style.top = Math.max(8, top) + scrollY + 'px';
      // A tall panel (Fix now with a long field) scrolls into view, buttons included; and again whenever it grows.
      reveal();
      if ((window as any).ResizeObserver) new (window as any).ResizeObserver(() => reveal()).observe(panel);
    }
    panel.addEventListener('click', (e: any) => { if (e.target.closest('[data-x]')) close(); });
    return panel;
  }
  let revealT: any = 0;
  function reveal() { clearTimeout(revealT); revealT = setTimeout(() => { if (panel && !narrow() && panel.style.position !== 'fixed') panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60); }
  const note = (p: any, text: string, cls = 'qe-dim') => { const n = p.querySelector('[data-note]'); if (n) { n.className = cls; n.textContent = text; } };

  // ---- The page's data (page.json): its text fields, by path ----------------------------------------------------------
  let DATA: any = null, EN: any = null;
  const getAt = (o: any, path: string) => { for (const seg of path.split('/')) { if (o == null) return undefined; o = seg.startsWith('#') ? (Array.isArray(o) ? o.find((x: any) => x && String(x.id) === seg.slice(1)) : undefined) : /^\d+$/.test(seg) ? (Array.isArray(o) ? o[Number(seg)] : undefined) : o[seg]; } return typeof o === 'string' ? o : undefined; };
  type Leaf = { path: string; value: string; n: string; key: string };
  const SKIP = new Set(['v', 'kind', 'key', 'slug', 'picture', 'route', 'groups', 'verified', 'incomplete', 'type', 'fullName', 'id', 'missable', 'lang', 'game', 'href', 'thumb', 'w300', 'w600', 'big', 'focus', 'w', 'h']);
  const ID_OK = /^[A-Za-z0-9_.:-]{1,80}$/;
  function leavesOf(data: any): Leaf[] {
    const out: Leaf[] = [];
    const walk = (o: any, path: string, k: string) => {
      if (typeof o === 'string') { if (o.trim().length >= 2 && (!['entries', 'fights'].includes(k) || /\s/.test(o))) out.push({ path, value: o, n: norm(o), key: k }); return; }
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, path + '/' + (x && typeof x === 'object' && x.id != null && ID_OK.test(String(x.id)) ? '#' + x.id : i), k)); return; }
      if (o && typeof o === 'object') for (const kk of Object.keys(o)) { if (SKIP.has(kk) || (data.kind === 'entity' && kk === 'name' && !path)) continue; walk(o[kk], path ? path + '/' + kk : kk, kk); }
    };
    walk(data, '', '');
    return out;
  }
  const LABEL: any = { overview: 'Overview', name: 'Name', where: 'Where', how: 'How', text: 'Text', title: 'Title', tip: 'Tip', warn: 'Watch out', story: 'Story', note: 'Note', when: 'When', outcome: 'Outcome', label: 'Option', recommended: 'Recommended' };
  const pretty = (l: Leaf) => {
    const top = l.path.split('/')[0];
    const T: any = { walkthrough: 'Walkthrough step', items: 'Item', secrets: 'Secret', enemies: 'Enemy', shops: 'Shop', fights: 'Fight', tips: 'Tip', sections: 'Checklist', choices: 'Choice', advice: 'Advice', info: 'Info', gameplay: 'Gameplay', summary: 'Summary', story: 'Story' };
    return (T[top] ? T[top] + ' · ' : '') + (LABEL[l.key] || l.key || top);
  };
  const anchorsOf = (el: any): string[] => { const ids: string[] = []; for (let n = el; n && n !== document.body; n = n.parentElement) { if (n.dataset && n.dataset.check) ids.push(n.dataset.check); if (n.id) ids.push(n.id.replace(/^(e|s|step)-/, '')); } return ids; };
  const sentences = (s: string) => s.split(/(?<=[.!?。！？])\s+/).map((x) => x.trim()).filter(Boolean);

  function fieldsFor(el: any, sel: string): Leaf[] {
    if (!DATA) return [];
    const leaves = leavesOf(DATA), elN = norm(el.textContent), selN = norm(sel);
    let c = selN ? leaves.filter((l) => l.n.includes(selN)) : leaves.filter((l) => l.n.length >= 3 && elN.includes(l.n));
    if (!c.length && elN.length >= 12) c = leaves.filter((l) => l.n.includes(elN));
    const ids = anchorsOf(el);
    const score = (l: Leaf) => (ids.some((id) => l.path.includes('#' + id + '/') || l.path.endsWith('#' + id)) ? 1e6 : 0) + l.n.length;
    // A row with its own entry id: that entry's fields only (a short field elsewhere can share its words).
    const own = c.filter((l) => ids.some((id) => l.path.includes('#' + id + '/') || l.path.endsWith('#' + id)));
    if (own.length) c = own;
    const seen = new Set<string>();
    return c.sort((a, b) => score(b) - score(a)).filter((l) => !seen.has(l.path) && seen.add(l.path)).slice(0, 4);
  }

  // ---- Clicks in edit mode ------------------------------------------------------------------------------------------
  let READY = false;
  function onClick(e: any) {
    if (!READY || !ON || e.target.closest('.qe-ui')) return;
    const art = e.target.closest('article');
    if (!art) { if (panel && !e.target.closest('.qe-ui')) close(); return; }
    const img = e.target.closest('img');
    const pic = img && String(img.currentSrc || img.src).match(/\/img\/g\/([A-Za-z0-9]+)\//);
    if (pic) { e.preventDefault(); e.stopPropagation(); openPicture(pic[1], img); return; }
    if (!TEXT_OK) return;
    const block = e.target.closest('label.qc-check, li, p, dd, td, h1, h3, blockquote');
    if (!block) return;
    e.preventDefault();
    e.stopPropagation();
    const s = getSelection();
    const sel = s && !s.isCollapsed && block.contains(s.anchorNode) ? String(s).trim() : '';
    openText(block, sel);
  }
  document.addEventListener('click', onClick, true);

  // ---- Text: the fields here, then Fix now / Send to pipeline / Add a missing item -------------------------------------
  function openText(block: any, sel: string) {
    const fields = fieldsFor(block, sel);
    const about = norm(sel || block.textContent).slice(0, 160);
    const head = `<h4>${esc(about.length > 70 ? about.slice(0, 70) + '…' : about)}</h4>`;
    const acts = `<div class="qe-row"><button class="qe-btn" data-a="pipe">⚑ Send to pipeline</button>${DATA && DATA.kind === 'area' ? '<button class="qe-btn" data-a="add">＋ Add a missing item here</button>' : ''}<button class="qe-btn" data-x>Cancel</button></div>`;
    const body = fields.length
      ? fields.map((l, i) => `<div class="qe-field"><div class="qe-k">${esc(pretty(l))}</div><div class="qe-v">${esc(l.value)}</div><button class="qe-btn p" data-fix="${i}">✎ Fix now</button></div>`).join('')
      : '<p class="qe-dim">This part is put together from other data, so it can\'t be edited here. Send it to the pipeline instead.</p>';
    const p = open(head + body + acts, block);
    p.addEventListener('click', (e: any) => {
      const f = e.target.closest('[data-fix]');
      if (f) return openFix(block, fields[Number(f.dataset.fix)], sel);
      const a = e.target.closest('[data-a]');
      if (a && a.dataset.a === 'pipe') return openPipeline(block, about);
      if (a && a.dataset.a === 'add') return openMissing(block);
    });
  }

  function openFix(block: any, l: Leaf, sel: string) {
    // On a translated page, a line the translation doesn't have yet (shown in English) is fixed in English.
    const lang = LANG !== 'en' && EN && getAt(EN, l.path) === l.value ? 'en' : LANG;
    // The part to change: a selected sentence, or one picked here, or the whole field.
    const parts = sentences(l.value);
    let part = sel && l.value.includes(sel) ? sel : sel ? (parts.find((x) => norm(x).includes(norm(sel))) || l.value) : (parts.length > 1 ? '' : l.value);
    const pick = parts.length > 1 ? `<div class="qe-dim">Which part?</div>${parts.map((x, i) => `<button class="qe-sent ${x === part ? 'on' : ''}" data-s="${i}">${esc(x)}</button>`).join('')}<button class="qe-sent ${part === l.value ? 'on' : ''}" data-s="all"><i>The whole ${esc((LABEL[l.key] || 'field').toLowerCase())}</i></button>` : '';
    const p = open(`<h4>✎ Fix now · ${esc(pretty(l))}</h4>${pick}<textarea rows="${narrow() ? 4 : 3}" data-t ${part ? '' : 'disabled'}>${esc(part)}</textarea>`
      + `<div class="qe-dim">Goes live with the next daily publish. Marked as yours: rebuilds keep it.${lang === 'en' ? (LANG === 'en' ? ' Translated pages get it translated.' : ' This line is still in English here, so the fix goes into the English page and every language.') : ' This changes this language only.'}</div>`
      + `<div class="qe-row"><button class="qe-btn p" data-save ${part ? '' : 'disabled'}>Save</button><button class="qe-btn" data-x>Cancel</button></div><div data-note></div>`, block, true);
    const ta = p.querySelector('[data-t]'), save = p.querySelector('[data-save]');
    if (part) setTimeout(() => ta.focus(), 30);
    p.addEventListener('click', async (e: any) => {
      const s = e.target.closest('[data-s]');
      if (s) {
        part = s.dataset.s === 'all' ? l.value : parts[Number(s.dataset.s)];
        p.querySelectorAll('[data-s]').forEach((x: any) => x.classList.toggle('on', x === s));
        ta.value = part; ta.disabled = false; save.removeAttribute('disabled'); ta.focus();
        return;
      }
      if (!e.target.closest('[data-save]')) return;
      const after = String(ta.value).trim();
      if (!part || after === part.trim()) { note(p, 'Nothing changed.', 'qe-warn'); return; }
      save.setAttribute('disabled', '');
      try {
        await api('/api/editor/edits', { key: GAME, slug: SLUG, page: DATA.kind, lang, path: l.path, before: part, after, label: norm(block.textContent).slice(0, 160) });
        showEdited(block, part, after);
        close();
        refresh();
      } catch (err: any) { note(p, err.message, 'qe-warn'); save.removeAttribute('disabled'); }
    });
  }
  // The page shows the new text at once (for the owner; players see it after the publish).
  function showEdited(block: any, before: string, after: string) {
    const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n: any, done = false;
    while ((n = tw.nextNode())) if (n.nodeValue.includes(before)) { n.nodeValue = n.nodeValue.replace(before, after); done = true; break; }
    if (!done && block.childElementCount === 0) block.textContent = after;
    block.classList.add('qe-edited');
    block.title = 'Edited by you: live with the next publish';
  }

  const KINDS = ['Wrong place', 'Wrong steps', 'Wrong name', 'Missing detail', 'Other'];
  function openPipeline(block: any, about: string) {
    let kind = KINDS[0];
    const p = open(`<h4>⚑ Send to pipeline</h4><div class="qe-dim">About: “${esc(about)}”</div>`
      + `<div style="margin-top:8px">${KINDS.map((k, i) => `<button class="qe-chip ${i ? '' : 'on'}" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>`
      + `<textarea rows="3" data-t placeholder="What's wrong, and what's right?"></textarea>`
      + `<div class="qe-dim">Checked against sources in the next daily run, ahead of everything else. Confirmed: it goes on the page. Not confirmed: it waits for you under Pipeline. About $0.02.</div>`
      + `<div class="qe-row"><button class="qe-btn p" data-send>Queue it</button><button class="qe-btn" data-x>Cancel</button></div><div data-note></div>`, block);
    const ta = p.querySelector('[data-t]');
    setTimeout(() => ta.focus(), 30);
    p.addEventListener('click', async (e: any) => {
      const c = e.target.closest('[data-k]');
      if (c) { kind = c.dataset.k; p.querySelectorAll('[data-k]').forEach((x: any) => x.classList.toggle('on', x === c)); return; }
      if (!e.target.closest('[data-send]')) return;
      const text = String(ta.value).trim();
      if (text.length < 10) { note(p, 'Say a little more (a few words at least).', 'qe-warn'); return; }
      const b = e.target.closest('[data-send]'); b.setAttribute('disabled', '');
      try {
        await api('/api/editor/queue', { key: GAME, slug: SLUG, page: DATA ? DATA.kind : 'area', lang: LANG, anchor: block ? anchorsOf(block)[0] || '' : '', label: about, kind: 'correction', text: `${kind}: ${text} (About: "${about}")` });
        p.innerHTML = '<h4>⚑ Queued</h4><p class="qe-ok">It\'s first in the next daily run. You\'ll see the result under Pipeline and in the Discord summary.</p><div class="qe-row"><button class="qe-btn" data-x>Close</button></div>';
        refresh();
      } catch (err: any) { note(p, err.message, 'qe-warn'); b.removeAttribute('disabled'); }
    });
  }

  const MISSING = ['Chest / item', 'Secret', 'Quest step', 'Enemy / boss'];
  function openMissing(block: any) {
    let kind = MISSING[0];
    const steps = (DATA && DATA.walkthrough) || [];
    const near = block ? anchorsOf(block).map((id) => steps.findIndex((s: any) => s.id === id)).find((i: number) => i >= 0) : -1;
    const p = open(`<h4>＋ Add a missing item</h4><div>${MISSING.map((k, i) => `<button class="qe-chip ${i ? '' : 'on'}" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>`
      + `<input data-n placeholder="What is it? (e.g. Locked chest behind the waterfall)"><textarea rows="2" data-w placeholder="Where, and how to get it"></textarea>`
      + (steps.length ? `<select data-after><option value="">Anywhere on this page</option>${steps.map((s: any, i: number) => `<option value="${esc(s.id)}" ${i === near ? 'selected' : ''}>After step ${i + 1}: ${esc(String(s.title).slice(0, 60))}</option>`).join('')}</select>` : '')
      + `<div class="qe-dim">Checked against sources in the next daily run, then put at its spot on the page. Not confirmed: it waits for you under Pipeline. About $0.02.</div>`
      + `<div class="qe-row"><button class="qe-btn p" data-send>Send</button><button class="qe-btn" data-x>Cancel</button></div><div data-note></div>`, block || bar);
    setTimeout(() => p.querySelector('[data-n]').focus(), 30);
    p.addEventListener('click', async (e: any) => {
      const c = e.target.closest('[data-k]');
      if (c) { kind = c.dataset.k; p.querySelectorAll('[data-k]').forEach((x: any) => x.classList.toggle('on', x === c)); return; }
      if (!e.target.closest('[data-send]')) return;
      const name = String(p.querySelector('[data-n]').value).trim(), where = String(p.querySelector('[data-w]').value).trim();
      const sel = p.querySelector('[data-after]'), after = sel ? sel.value : '';
      const afterLabel = sel && after ? sel.options[sel.selectedIndex].text : '';
      if (name.length < 3) { note(p, 'Name what is missing.', 'qe-warn'); return; }
      const b = e.target.closest('[data-send]'); b.setAttribute('disabled', '');
      try {
        await api('/api/editor/queue', { key: GAME, slug: SLUG, page: 'area', lang: LANG, anchor: after, label: `Missing ${kind.toLowerCase()}: ${name}`, kind: 'missing', text: `${kind}: ${name}.${where ? ' ' + where : ''}${afterLabel ? ` (${afterLabel})` : ''}` });
        p.innerHTML = '<h4>＋ Sent</h4><p class="qe-ok">The next daily run checks it and puts it on the page. You\'ll see the result under Pipeline and in the Discord summary.</p><div class="qe-row"><button class="qe-btn" data-x>Close</button></div>';
        refresh();
      } catch (err: any) { note(p, err.message, 'qe-warn'); b.removeAttribute('disabled'); }
    });
  }

  // ---- Pictures -------------------------------------------------------------------------------------------------------
  const coverPos = (w: number, h: number, f: any, bw: number, bh: number) => {
    if (!w || !h || !f) return '50% 50%';
    const s = Math.max(bw / w, bh / h);
    const ax = (len: number, box: number, c: number, at: number) => { const over = len * s - box; return over <= 0.5 ? 0.5 : Math.min(1, Math.max(0, (c * len * s - box * at) / over)); };
    const pc = (n: number) => Math.round(n * 1000) / 10 + '%';
    return pc(ax(w, bw, f.x, 0.5)) + ' ' + pc(ax(h, bh, f.y, f.face ? 0.4 : 0.5));
  };
  const blobs = new Map<string, string>();
  async function fileUrl(id: string, size: string): Promise<string> {
    const k = id + '/' + size;
    if (blobs.has(k)) return blobs.get(k)!;
    const r = await fetch(cfg.api + '/api/admin/images/' + encodeURIComponent(id) + '/file/' + size, { headers: { 'X-QC-Editor': KEY } });
    const u = r.ok ? URL.createObjectURL(await r.blob()) : '';
    blobs.set(k, u);
    return u;
  }
  let IMGS: any[] | null = null;
  async function images(): Promise<any[]> {
    if (IMGS) return IMGS;
    const all = await Promise.all(['approved', 'suggested', 'waiting'].map((s) => api('/api/admin/images?status=' + s + '&game=' + encodeURIComponent(GAME)).then((j) => j.items).catch(() => [])));
    IMGS = ([] as any[]).concat(...all);
    return IMGS;
  }
  const sameTarget = (a: any, b: any) => a.target && b.target && a.target.kind === b.target.kind && a.target.slug === b.target.slug && (a.target.id || '') === (b.target.id || '');

  async function openPicture(id: string, img: any) {
    const p = open(`<h4>Picture</h4><div class="qe-dim" data-what>Loading…</div><div class="qe-row"><button class="qe-btn" data-a="crop">⤧ Recrop</button><button class="qe-btn" data-a="swap">↻ Another picture</button><button class="qe-btn bad" data-a="remove">✕ Remove</button><a class="qe-btn" target="_blank" rel="noopener" href="${esc(cfg.site)}/admin/images?game=${encodeURIComponent(GAME)}">☰ Review queue</a></div><div data-body></div><div data-note></div>`, img.closest('figure') || img);
    let x: any = null;
    try { x = (await images()).find((i) => i.id === id) || null; } catch (err: any) { note(p, err.message, 'qe-warn'); }
    const what = p.querySelector('[data-what]');
    if (what) what.textContent = x ? `${x.target.name} · ${x.target.label}${x.caption && x.caption !== x.target.name ? ` · “${x.caption}”` : ''}` : 'This picture isn\'t in the approved list (it may have just changed).';
    const body = p.querySelector('[data-body]');
    p.addEventListener('click', async (e: any) => {
      const a = e.target.closest('[data-a]');
      if (!a || !x) return;
      if (a.dataset.a === 'crop') return recrop(p, body, x, img);
      if (a.dataset.a === 'swap') return swap(p, body, x, img);
      if (a.dataset.a === 'remove') {
        body.innerHTML = '<p>Take this picture off the page? You can bring it back from /admin/images → Deleted.</p><div class="qe-row"><button class="qe-btn bad" data-rm>Remove it</button><button class="qe-btn" data-x>Keep it</button></div>';
        body.querySelector('[data-rm]').onclick = async () => {
          try {
            await api('/api/admin/images/' + encodeURIComponent(x.id), { action: 'delete' });
            IMGS = null;
            (img.closest('figure') || img).style.opacity = '.3';
            body.innerHTML = '<p class="qe-ok">Removed. It leaves the page with the next daily publish.</p>';
          } catch (err: any) { note(p, err.message, 'qe-warn'); }
        };
      }
    });
  }

  function recrop(p: any, body: any, x: any, img: any) {
    const src = cfg.site + '/img/g/' + x.id + '/w1280.webp';
    const CUTS = [[150, 150, 'Phone'], [200, 150, 'Guide page'], [160, 90, 'Thumbnail'], [240, 126, 'Share image']];
    let f = x.focus || x.autoFocus || null;
    body.innerHTML = `<p class="qe-dim">Tap where the picture must stay in frame (a face, the tower).</p><div class="qe-whole"><img src="${src}" alt=""><span class="qe-dot" hidden></span></div>`
      + `<div class="qe-prev">${CUTS.map((c) => `<div><img src="${src}" style="width:${c[0]}px;height:${c[1]}px" alt=""><span>${c[2]}</span></div>`).join('')}</div>`
      + `<div class="qe-row"><button class="qe-btn p" data-save>Save crop</button>${x.focus ? '<button class="qe-btn" data-auto>Use automatic</button>' : ''}</div>`;
    const whole = body.querySelector('.qe-whole img'), dot = body.querySelector('.qe-dot');
    const draw = () => {
      dot.hidden = !f;
      if (f) { dot.style.left = f.x * whole.clientWidth + 'px'; dot.style.top = f.y * whole.clientHeight + 'px'; }
      body.querySelectorAll('.qe-prev img').forEach((im: any, i: number) => { im.style.objectPosition = coverPos(whole.naturalWidth, whole.naturalHeight, f, CUTS[i][0] as number, CUTS[i][1] as number); });
    };
    whole.onload = draw;
    if (whole.complete) draw();
    whole.onclick = (e: any) => {
      const r = whole.getBoundingClientRect();
      f = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), ...(x.autoFocus && x.autoFocus.face ? { face: true } : {}) };
      draw();
    };
    const save = async (focus: any) => {
      try {
        const j = await api('/api/admin/images/' + encodeURIComponent(x.id), { action: 'update', focus });
        x.focus = j.image.focus || null;
        const use = x.focus || x.autoFocus;
        if (use && whole.naturalWidth) img.style.objectPosition = coverPos(whole.naturalWidth, whole.naturalHeight, use, img.clientWidth, img.clientHeight);
        body.innerHTML = `<p class="qe-ok">${focus ? 'Crop saved' : 'Back to the automatic crop'}: on the page here now, for everyone with the next daily publish.</p>`;
      } catch (err: any) { note(p, err.message, 'qe-warn'); }
    };
    body.querySelector('[data-save]').onclick = () => (f ? save({ x: f.x, y: f.y, ...(f.face ? { face: true } : {}) }) : note(p, 'Tap the picture first.', 'qe-warn'));
    const auto = body.querySelector('[data-auto]');
    if (auto) auto.onclick = () => save(null);
  }

  async function swap(p: any, body: any, x: any, img: any) {
    body.innerHTML = '<p class="qe-dim">Looking for this page\'s other pictures…</p>';
    const cands = (await images()).filter((i) => i.id !== x.id && sameTarget(i, x));
    body.innerHTML = (cands.length
      ? `<p class="qe-dim">Other pictures for this ${esc(x.target.label.toLowerCase())}:</p><div class="qe-cands">${cands.map((c) => `<figure><img data-c="${c.id}" alt=""><figcaption>${esc(c.status)} · ${esc(c.sourceName || c.source)}</figcaption><button class="qe-btn p" data-use="${c.id}">Use this</button></figure>`).join('')}</div>`
      : '<p class="qe-dim">No other pictures for this page yet.</p>')
      + '<div class="qe-row"><button class="qe-btn" data-find>Find a new one (up to $0.10)</button></div>';
    for (const c of cands) fileUrl(c.id, 'w300.webp').then((u) => { const im = body.querySelector(`img[data-c="${c.id}"]`); if (im) im.src = u; });
    body.onclick = async (e: any) => {
      const u = e.target.closest('[data-use]');
      if (u) {
        const c = cands.find((i) => i.id === u.dataset.use);
        u.setAttribute('disabled', '');
        try {
          if (c.status !== 'approved') await api('/api/admin/images/' + encodeURIComponent(c.id), { action: 'approve' });
          await api('/api/admin/images/' + encodeURIComponent(c.id), { action: 'update', placement: x.placement || { page: true } });
          await api('/api/admin/images/' + encodeURIComponent(x.id), { action: 'delete' });
          IMGS = null;
          const nu = await fileUrl(c.id, 'w600.webp');
          if (nu) { img.removeAttribute('srcset'); const ps = img.closest('picture'); if (ps) ps.querySelectorAll('source').forEach((s: any) => s.remove()); img.src = nu; }
          body.innerHTML = '<p class="qe-ok">Swapped. Shown here now; on the page for everyone with the next daily publish.</p>';
        } catch (err: any) { note(p, err.message, 'qe-warn'); u.removeAttribute('disabled'); }
        return;
      }
      const fnd = e.target.closest('[data-find]');
      if (fnd) {
        fnd.setAttribute('disabled', '');
        note(p, 'Looking (this can take a minute)…');
        try {
          const r = await api('/api/admin/images/' + encodeURIComponent(x.id) + '/find-another', { keep: true });
          note(p, r.message, r.found ? 'qe-ok' : 'qe-warn');
          IMGS = null;
          if (r.found) swap(p, body, x, img);
        } catch (err: any) { note(p, err.message, 'qe-warn'); fnd.removeAttribute('disabled'); }
      }
    };
  }

  // ---- Your edits and the pipeline items ------------------------------------------------------------------------------
  const STATE: any = { applied: 'Live', kept: 'Live (the page says it now)', stale: '⚠ No longer fits its page' };
  const pageLink = (key: string, slug: string, lang?: string) => `<a href="${cfg.site}/${lang && lang !== 'en' ? lang + '/' : ''}guides/${esc(key)}/${esc(slug)}/">${esc(slug.replace(/-/g, ' '))}</a>`;
  async function openMine(tab: 'edits' | 'queue') {
    const p = open(`<h4>${tab === 'edits' ? 'Your edits' : 'Pipeline items'}</h4><div class="qe-row"><button class="qe-chip ${tab === 'edits' ? 'on' : ''}" data-tab="edits">Fix now edits</button><button class="qe-chip ${tab === 'queue' ? 'on' : ''}" data-tab="queue">Pipeline items</button><button class="qe-chip" data-tab="device">This device</button></div><div data-list class="qe-dim">Loading…</div><div data-note></div><div class="qe-row"><button class="qe-btn" data-x>Close</button></div>`, bar, true);
    if (!narrow()) { p.style.position = 'fixed'; p.style.left = '50%'; p.style.transform = 'translateX(-50%)'; p.style.top = '60px'; p.style.maxHeight = 'calc(100vh - 140px)'; p.style.overflow = 'auto'; }
    const list = p.querySelector('[data-list]');
    const draw = async (t: string) => {
      p.querySelectorAll('[data-tab]').forEach((x: any) => x.classList.toggle('on', x.dataset.tab === t));
      list.textContent = 'Loading…';
      try {
        if (t === 'edits') {
          const j = await api('/api/editor/edits');
          list.innerHTML = j.edits.length ? `<table class="qe-list">${j.edits.map((e: any) => `<tr><td>${pageLink(e.key, e.slug, e.lang)}${e.lang !== 'en' ? ` <span class="qe-tag">${esc(e.lang)}</span>` : ''}<div class="qe-dim">${new Date(e.createdAt).toLocaleDateString()}</div></td><td><s class="qe-dim">${esc(String(e.before).slice(0, 140))}</s><br>${esc(String(e.after).slice(0, 140))}</td><td>${e.status === 'undone' ? '<span class="qe-dim">Undone</span>' : esc(STATE[e.state] || 'Waiting for the next publish')}</td><td><button class="qe-btn" data-e="${e.id}" data-do="${e.status === 'undone' ? 'restore' : 'undo'}">${e.status === 'undone' ? 'Redo' : 'Undo'}</button></td></tr>`).join('')}</table>` : '<p class="qe-dim">No edits yet.</p>';
        } else if (t === 'queue') {
          const j = await api('/api/editor/queue');
          const st = (c: any) => c.status === 'pending' ? 'Checking in the next daily run' : c.status === 'checked' ? `Held for you: ${esc((c.check && c.check.reason) || 'not confirmed')}` : c.status === 'approved' ? (c.decided && /sources agree/.test(c.decided.by || '') ? 'Confirmed by sources · on the page' : 'Applied by you · on the page') : 'Dropped';
          list.innerHTML = j.items.length ? `<table class="qe-list">${j.items.map((c: any) => `<tr><td>${pageLink(c.key, c.slug, c.lang)}<div class="qe-dim">${c.kind === 'missing' ? 'Missing item' : 'Correction'}</div></td><td>${esc(String(c.text).slice(0, 220))}${c.check && c.check.proposal && c.status === 'checked' ? `<div class="qe-dim">Would say: ${esc(String(c.check.proposal).slice(0, 220))}</div>` : ''}</td><td>${st(c)}</td><td>${c.status === 'checked' ? `<button class="qe-btn p" data-q="${c.id}" data-do="apply">Apply anyway</button> <button class="qe-btn" data-q="${c.id}" data-do="drop">Drop</button>` : c.status === 'pending' ? `<button class="qe-btn" data-q="${c.id}" data-do="drop">Cancel</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="qe-dim">Nothing sent to the pipeline yet.</p>';
        } else {
          list.innerHTML = `<p>Signed in as ${esc(me && me.email)}; ${me ? me.devices : '?'} device(s) connected.</p><div class="qe-row"><button class="qe-btn bad" data-off="this">Turn off editing on this device</button><button class="qe-btn bad" data-off="all">Disconnect every device</button></div>`;
        }
      } catch (err: any) { list.innerHTML = `<p class="qe-warn">${esc(err.message)}</p>`; }
    };
    p.addEventListener('click', async (e: any) => {
      const t = e.target.closest('[data-tab]');
      if (t) return draw(t.dataset.tab);
      const ed = e.target.closest('[data-e]'), q = e.target.closest('[data-q]'), off = e.target.closest('[data-off]');
      try {
        if (ed) { await api('/api/editor/edits/' + ed.dataset.e, { action: ed.dataset.do }); refresh(); return draw('edits'); }
        if (q) { await api('/api/editor/queue/' + q.dataset.q, { action: q.dataset.do }); refresh(); return draw('queue'); }
        if (off) { await api('/api/editor/disconnect', off.dataset.off === 'all' ? { all: true } : {}); try { localStorage.removeItem('qc_editor'); document.cookie = 'qc_editor=; Max-Age=0; Path=/; Secure; SameSite=Lax'; } catch { /* */ } teardown(); }
      } catch (err: any) { note(p, err.message, 'qe-warn'); }
    });
    draw(tab);
  }

  // ---- Start ---------------------------------------------------------------------------------------------------------
  async function refresh() { try { me = await api('/api/editor/me'); drawBar(); } catch { /* not connected: torn down */ } }
  async function markEdits() {
    if (!TEXT_OK) return;
    try {
      const j = await api('/api/editor/edits?key=' + encodeURIComponent(GAME) + '&slug=' + encodeURIComponent(SLUG));
      const blocks = Array.from(document.querySelectorAll('article p, article li, article label.qc-check, article dd, article td, article h1, article h3')) as any[];
      for (const e of j.edits) {
        if (e.status !== 'live' || (e.lang || 'en') !== LANG || !e.after) continue;
        const a = norm(e.after);
        const hit = blocks.filter((b) => norm(b.textContent).includes(a)).sort((x, y) => x.textContent.length - y.textContent.length)[0];
        if (hit) { hit.classList.add('qe-edited'); hit.title = 'Edited by you'; }
      }
    } catch { /* */ }
  }
  (async () => {
    drawBar();
    for (let i = 0; i < 4 && !me; i++) {
      try { me = await api('/api/editor/me'); } catch { if (LOST) return; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
    if (!me) return;
    if (TEXT_OK) DATA = await fetch('page.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    // A translated page: the English page too, to tell a line still shown in English (fixed in English, for every language).
    if (TEXT_OK && LANG !== 'en') EN = await fetch(`/guides/${GAME}/${SLUG}/page.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    document.body.classList.toggle('qe-on', ON);
    READY = true;
    drawBar();
    markEdits();
    addEventListener('resize', () => drawBar());
    document.addEventListener('keydown', (e: any) => { if (e.key === 'Escape') close(); });
  })();
}
