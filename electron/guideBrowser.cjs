/**
 * The Guides tab's web browser (owner, Nov 17 2026: "The browser should have tabs as well. Should be a good browser";
 * docs/proposals/guide-browser.md). Web tabs beside the app's own guide reader (the 📖 tab, drawn by the app).
 *
 * Each web tab is a WebContentsView owned by this process and laid over the Guides tab's page area; the app sends that
 * area's position ('gb:layout'). The pages are locked down: no Node, no preload, no bridge to the app, sandboxed, their
 * own storage (partition persist:qc-guides), every permission refused, only http(s), downloads handed to the system
 * browser on request. Ads and trackers are blocked on this partition (owner's call, Nov 17 2026; main.cjs).
 *
 * At most LIVE_MAX tabs keep a live page; older ones are put to sleep (their address kept) and reload when picked.
 * After SLEEP_AFTER_MS with the Guides tab out of sight, every page sleeps.
 */
const { WebContentsView, ipcMain, session, shell, Menu, clipboard } = require('electron');

const PARTITION = 'persist:qc-guides';
const LIVE_MAX = 6;
const SLEEP_AFTER_MS = 20 * 60 * 1000;
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));

// Controller support inside a page (step 2): a small helper run in its own isolated world (the page's scripts can't see
// it). It picks the links and controls on screen in reading order, rings the picked one in the app's accent colour,
// opens it, and fills a text box with what was typed on the app's on-screen keyboard.
const PAD_WORLD = 7781;
const PAD_JS = `(() => {
  if (window.__qcPad) return true;
  const P = (window.__qcPad = { el: null, prev: null });
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' && !el.disabled;
  };
  P.list = () => Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [contenteditable=true]'))
    .filter(vis)
    .sort((a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.abs(p.top - q.top) > 8 ? p.top - q.top : p.left - q.left; });
  P.mark = (el) => {
    if (P.el && P.prev) { P.el.style.outline = P.prev.o; P.el.style.outlineOffset = P.prev.off; }
    P.el = el; P.prev = null;
    if (!el) return;
    P.prev = { o: el.style.outline, off: el.style.outlineOffset };
    el.style.outline = '3px solid #a87ffb'; el.style.outlineOffset = '2px';
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  P.step = (d) => {
    const L = P.list();
    if (!L.length) { P.mark(null); return { none: true }; }
    let i = P.el ? L.indexOf(P.el) : -1;
    if (i < 0) i = d > 0 ? 0 : L.length - 1; else i = (i + d + L.length) % L.length;
    P.mark(L[i]);
    return { label: (L[i].innerText || L[i].getAttribute('aria-label') || L[i].value || '').trim().slice(0, 80) };
  };
  P.activate = () => {
    const el = P.el && document.contains(P.el) ? P.el : null;
    if (!el) return { none: true };
    const t = el.tagName;
    const editable = t === 'TEXTAREA' || el.isContentEditable || (t === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type || ''));
    el.focus();
    if (editable) return { editable: true, value: el.isContentEditable ? el.innerText : el.value || '' };
    el.click();
    return {};
  };
  // Scroll what's under the middle of the page (an inner panel that scrolls, else the page itself).
  P.scroll = (dy, smooth) => {
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) break;
      el = el.parentElement;
    }
    const target = el && el !== document.body && el !== document.documentElement ? el : (document.scrollingElement || document.documentElement);
    const h = target === (document.scrollingElement || document.documentElement) ? innerHeight : target.clientHeight;
    const by = dy === 'page' ? Math.round(h * 0.85) : dy === '-page' ? -Math.round(h * 0.85) : Number(dy) || 0;
    target.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
    return {};
  };
  P.fill = (text) => {
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    if (el.isContentEditable) el.innerText = text;
    else Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {};
  };
  return true;
})()`;

/** @param {{ getWindow: () => Electron.BrowserWindow | null }} opts */
function createGuideBrowser(opts) {
  /** @type {Map<string, { id: string, url: string, title: string, favicon: string, loading: boolean, zoom: number, view: Electron.WebContentsView | null, usedAt: number }>} */
  const tabs = new Map();
  let order = []; // tab ids, left to right
  let activeId = null;
  let shown = false; // the app says the active web tab's page area is on screen
  let bounds = null;
  let hiddenSince = Date.now();
  let seq = 0;
  let sessionReady = false;

  const win = () => {
    const w = opts.getWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  const toApp = (channel, payload) => {
    const w = win();
    if (w) w.webContents.send(channel, payload);
  };

  function prepareSession() {
    if (sessionReady) return;
    sessionReady = true;
    const ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((wc, permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item) => {
      // Downloads are off here: the app offers to open the link in the player's own browser instead.
      event.preventDefault();
      toApp('gb:download', { url: item.getURL(), name: item.getFilename() });
    });
  }

  function state() {
    const list = order.map((id) => {
      const t = tabs.get(id);
      const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
      return {
        id, url: t.url, title: t.title, favicon: t.favicon, loading: !!(wc && t.loading), zoom: t.zoom, asleep: !wc,
        canGoBack: !!(wc && wc.canGoBack()), canGoForward: !!(wc && wc.canGoForward()),
      };
    });
    return { tabs: list, activeId };
  }
  let stateTimer = null;
  const sendState = () => {
    if (stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; toApp('gb:state', state()); }, 30);
  };

  function wake(t) {
    if (t.view && !t.view.webContents.isDestroyed()) return t.view;
    prepareSession();
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    t.view = view;
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Links meant for a new tab or window (middle / Ctrl+click, target=_blank, a site's pop-up) open as a tab here.
      if (isWeb(url)) openTab(url, { background: disposition === 'background-tab' });
      else if (/^(steam|mailto):/i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    const guard = (event, url) => {
      if (isWeb(url)) return;
      event.preventDefault();
      if (/^(steam|mailto):/i.test(url)) shell.openExternal(url).catch(() => {});
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-start-loading', () => { t.loading = true; sendState(); });
    wc.on('did-stop-loading', () => { t.loading = false; sendState(); });
    const moved = (e, url) => { if (isWeb(url)) t.url = url; sendState(); };
    wc.on('did-navigate', moved);
    wc.on('did-navigate-in-page', moved);
    wc.on('page-title-updated', (e, title) => { t.title = String(title || '').slice(0, 200); sendState(); });
    wc.on('page-favicon-updated', (e, favicons) => { t.favicon = (favicons && favicons[0]) || ''; sendState(); });
    wc.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) { t.loading = false; sendState(); } });
    wc.on('found-in-page', (e, r) => toApp('gb:found', { id: t.id, active: r.activeMatchOrdinal, matches: r.matches }));
    wc.on('render-process-gone', () => { t.view = null; sendState(); });
    // A real browser's keys, while the page has the keyboard.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const k = String(input.key || '').toLowerCase();
      const ctrl = input.control || input.meta;
      let act = null;
      if (ctrl && !input.shift && k === 't') act = 'new-tab';
      else if (ctrl && k === 'w') act = 'close-tab';
      else if (ctrl && k === 'l') act = 'address';
      else if (ctrl && k === 'f') act = 'find';
      else if (ctrl && k === 'tab') act = input.shift ? 'prev-tab' : 'next-tab';
      else if ((ctrl && k === 'r') || k === 'f5') { action(t.id, 'reload'); event.preventDefault(); return; }
      else if (input.alt && k === 'arrowleft') { action(t.id, 'back'); event.preventDefault(); return; }
      else if (input.alt && k === 'arrowright') { action(t.id, 'forward'); event.preventDefault(); return; }
      else if (ctrl && (k === '=' || k === '+')) { action(t.id, 'zoom-in'); event.preventDefault(); return; }
      else if (ctrl && k === '-') { action(t.id, 'zoom-out'); event.preventDefault(); return; }
      else if (ctrl && k === '0') { action(t.id, 'zoom-reset'); event.preventDefault(); return; }
      if (!act) return;
      event.preventDefault();
      toApp('gb:key', { id: t.id, act });
    });
    // Right-click: the menu a browser has (open in a new tab, copy, back / forward / reload).
    wc.on('context-menu', (e, p) => {
      const items = [];
      if (p.linkURL && isWeb(p.linkURL)) {
        items.push({ label: 'Open link in new tab', click: () => openTab(p.linkURL, { background: true }) });
        items.push({ label: 'Open link in my browser', click: () => shell.openExternal(p.linkURL).catch(() => {}) });
        items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
        items.push({ type: 'separator' });
      }
      if (p.selectionText) items.push({ label: 'Copy', role: 'copy' }, { type: 'separator' });
      if (p.isEditable) items.push({ label: 'Cut', role: 'cut' }, { label: 'Paste', role: 'paste' }, { type: 'separator' });
      if (p.mediaType === 'image' && isWeb(p.srcURL)) items.push({ label: 'Open image in new tab', click: () => openTab(p.srcURL, { background: true }) }, { type: 'separator' });
      items.push(
        { label: 'Back', enabled: wc.canGoBack(), click: () => action(t.id, 'back') },
        { label: 'Forward', enabled: wc.canGoForward(), click: () => action(t.id, 'forward') },
        { label: 'Reload', click: () => action(t.id, 'reload') },
      );
      Menu.buildFromTemplate(items).popup({ window: win() || undefined });
    });
    if (t.zoom && t.zoom !== 1) wc.setZoomFactor(t.zoom);
    if (isWeb(t.url)) wc.loadURL(t.url).catch(() => {});
    return view;
  }

  function sleep(t) {
    if (!t.view) return;
    const w = win();
    try { if (w) w.contentView.removeChildView(t.view); } catch { /* already gone */ }
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch { /* closing anyway */ }
    t.view = null;
    t.loading = false;
  }

  /** Keep at most LIVE_MAX live pages: the least recently used ones (never the active one) go to sleep. */
  function trim() {
    const live = order.map((id) => tabs.get(id)).filter((t) => t.view && t.id !== activeId).sort((a, b) => a.usedAt - b.usedAt);
    while (live.length > LIVE_MAX - 1) sleep(live.shift());
  }

  /** Put the active tab's page where the app says (or nothing, when the Guides tab, the 📖 tab or the panel is away). */
  function layout() {
    const w = win();
    if (!w) return;
    for (const id of order) {
      const t = tabs.get(id);
      if (!t.view) continue;
      const on = shown && id === activeId && bounds && isWeb(t.url);
      if (on) {
        if (!w.contentView.children.includes(t.view)) w.contentView.addChildView(t.view);
        const z = w.webContents.getZoomFactor() || 1;
        t.view.setBounds({ x: Math.round(bounds.x * z), y: Math.round(bounds.y * z), width: Math.max(1, Math.round(bounds.width * z)), height: Math.max(1, Math.round(bounds.height * z)) });
        t.view.setVisible(true);
      } else if (w.contentView.children.includes(t.view)) {
        t.view.setVisible(false);
      }
    }
  }

  function openTab(url, { background = false, at } = {}) {
    const id = `gt${Date.now().toString(36)}${(seq++).toString(36)}`;
    const t = { id, url: isWeb(url) ? url : '', title: '', favicon: '', loading: false, zoom: 1, view: null, usedAt: Date.now() };
    tabs.set(id, t);
    const i = typeof at === 'number' ? at : activeId ? order.indexOf(activeId) + 1 : order.length;
    order.splice(Math.max(0, Math.min(order.length, i)), 0, id);
    if (t.url) wake(t);
    if (!background || !activeId) select(id);
    trim();
    sendState();
    return id;
  }

  function select(id) {
    if (!tabs.has(id)) return;
    activeId = id;
    const t = tabs.get(id);
    t.usedAt = Date.now();
    if (t.url) wake(t);
    trim();
    layout();
    if (shown && t.view) t.view.webContents.focus();
    sendState();
  }

  function closeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    sleep(t);
    const i = order.indexOf(id);
    order = order.filter((x) => x !== id);
    tabs.delete(id);
    if (activeId === id) {
      activeId = order[Math.min(i, order.length - 1)] || null;
      if (activeId) select(activeId);
    }
    layout();
    sendState();
  }

  function navigate(id, url) {
    const t = tabs.get(id);
    if (!t || !isWeb(url)) return;
    t.url = url;
    t.title = '';
    t.favicon = '';
    const view = wake(t);
    if (view.webContents.getURL() !== url) view.webContents.loadURL(url).catch(() => {});
    select(id);
  }

  function action(id, what, arg) {
    const t = tabs.get(id);
    if (!t) return;
    const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    if (what === 'reload' && !wc && t.url) return select(id);
    if (!wc) return;
    if (what === 'back' && wc.canGoBack()) wc.goBack();
    else if (what === 'forward' && wc.canGoForward()) wc.goForward();
    else if (what === 'reload') wc.reload();
    else if (what === 'stop') wc.stop();
    else if (what === 'zoom-in' || what === 'zoom-out' || what === 'zoom-reset') {
      const cur = t.zoom || 1;
      const next = what === 'zoom-reset' ? 1 : what === 'zoom-in' ? ZOOMS.find((z) => z > cur + 0.001) || cur : [...ZOOMS].reverse().find((z) => z < cur - 0.001) || cur;
      t.zoom = next;
      wc.setZoomFactor(next);
    } else if (what === 'find') {
      const text = String(arg && arg.text || '');
      if (!text) wc.stopFindInPage('clearSelection');
      else wc.findInPage(text, { forward: !(arg && arg.back), findNext: !!(arg && arg.next) });
    } else if (what === 'find-stop') wc.stopFindInPage('keepSelection');
    else if (what === 'focus') wc.focus();
    sendState();
  }

  // From the app (its own window only).
  const fromApp = (event) => { const w = win(); return !!w && event.sender === w.webContents; };
  ipcMain.handle('gb:open', (event, { url, background } = {}) => (fromApp(event) ? openTab(String(url || ''), { background: !!background }) : null));
  ipcMain.on('gb:close', (event, id) => { if (fromApp(event)) closeTab(String(id)); });
  ipcMain.on('gb:select', (event, id) => { if (fromApp(event)) select(String(id)); });
  ipcMain.on('gb:navigate', (event, { id, url } = {}) => { if (fromApp(event)) navigate(String(id), String(url || '')); });
  ipcMain.on('gb:action', (event, { id, action: what, arg } = {}) => { if (fromApp(event)) action(String(id), String(what), arg); });
  ipcMain.on('gb:move', (event, { id, to } = {}) => {
    if (!fromApp(event) || !tabs.has(id)) return;
    order = order.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, Number(to) || 0)), 0, id);
    sendState();
  });
  ipcMain.on('gb:layout', (event, { visible, rect } = {}) => {
    if (!fromApp(event)) return;
    const was = shown;
    shown = !!visible && !!rect;
    if (rect) bounds = { x: +rect.x || 0, y: +rect.y || 0, width: +rect.width || 0, height: +rect.height || 0 };
    if (!shown && was) hiddenSince = Date.now();
    layout();
  });
  // The app's set of tabs for a game (the Guides tab remembers each game's tabs): pages wake when picked.
  ipcMain.on('gb:restore', (event, { tabs: list, active } = {}) => {
    if (!fromApp(event)) return;
    for (const id of [...order]) { sleep(tabs.get(id)); tabs.delete(id); }
    order = [];
    activeId = null;
    for (const item of Array.isArray(list) ? list.slice(0, 30) : []) {
      const id = `gt${Date.now().toString(36)}${(seq++).toString(36)}`;
      tabs.set(id, { id, url: isWeb(item && item.url) ? item.url : '', title: String((item && item.title) || '').slice(0, 200), favicon: '', loading: false, zoom: 1, view: null, usedAt: 0 });
      order.push(id);
    }
    const i = Math.max(0, Math.min(order.length - 1, Number(active) || 0));
    if (order.length) activeId = order[i];
    sendState();
  });
  ipcMain.handle('gb:snapshot', async (event) => {
    // A picture of the page, shown by the app while something of its own (a menu, a dialog) sits over the page area.
    if (!fromApp(event) || !activeId) return null;
    const t = tabs.get(activeId);
    if (!t || !t.view || !shown) return null;
    try { return (await t.view.webContents.capturePage()).toDataURL(); } catch { return null; }
  });
  // The controller inside the page: scroll, step through links, open, back, fill a text box.
  ipcMain.handle('gb:pad', async (event, { id, cmd } = {}) => {
    if (!fromApp(event)) return null;
    const t = tabs.get(String(id));
    const wc = t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    if (!wc || !cmd) return null;
    const run = async (call) => {
      try {
        return await wc.executeJavaScriptInIsolatedWorld(PAD_WORLD, [{ code: `${PAD_JS}; window.__qcPad.${call}` }]);
      } catch {
        return null;
      }
    };
    // (cmd.scroll > 0 moves the page up, like a wheel turned up; cmd.page 1 = a page up, -1 = a page down.)
    if (cmd.page) return run(`scroll(${cmd.page > 0 ? "'-page'" : "'page'"}, true)`);
    if (cmd.scroll) return run(`scroll(${-(Number(cmd.scroll) || 0)}, false)`);
    if (cmd.link) return run(`step(${cmd.link > 0 ? 1 : -1})`);
    if (cmd.activate) return run('activate()');
    if (cmd.back) {
      if (wc.canGoBack()) { wc.goBack(); return {}; }
      return { home: true };
    }
    if (typeof cmd.fill === 'string') {
      const r = await run(`fill(${JSON.stringify(cmd.fill.slice(0, 2000))})`);
      if (cmd.submit) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        wc.sendInputEvent({ type: 'char', keyCode: '\r' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      }
      return r;
    }
    return null;
  });
  ipcMain.on('gb:external', (event, url) => { if (fromApp(event) && isWeb(url)) shell.openExternal(String(url)).catch(() => {}); });
  ipcMain.handle('gb:state', (event) => (fromApp(event) ? state() : null));

  // Out of sight for a long while: every page sleeps (addresses kept; a page wakes when picked).
  setInterval(() => {
    const w = win();
    const away = !shown || !w || !w.isVisible();
    if (!away) { hiddenSince = Date.now(); return; }
    if (Date.now() - hiddenSince < SLEEP_AFTER_MS) return;
    let any = false;
    for (const id of order) { const t = tabs.get(id); if (t.view) { sleep(t); any = true; } }
    if (any) sendState();
  }, 60000);

  return { partition: PARTITION, layout };
}

module.exports = { createGuideBrowser, PARTITION };
