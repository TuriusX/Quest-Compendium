/**
 * The Guides tab (owner, Nov 17 2026: "implement the browser in that tab (change it to Guides)"; "The browser should
 * have tabs as well. Should be a good browser"). docs/proposals/guide-browser.md.
 *
 * A tab strip: 📖 Guide first (the app's own guide reader, `home`), then web tabs. A web tab's page is a locked-down
 * view laid over this component's page area by the desktop app (electron/guideBrowser.cjs); this component draws the
 * strip, the toolbar, the new-tab page and the find bar, and tells the app where the page goes. Each game keeps its own
 * tabs. While something of the app's own sits over the page area (a menu, a dialog, the controller's panels), a
 * picture of the page stands in for it, since the page itself is drawn above everything in the panel.
 *
 * The web app can't show other sites inside a page: there, the sites open in a new browser tab.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Copy, ExternalLink, Globe, Loader2, MoreHorizontal, Plus, RotateCw, Search, Star, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../i18n';
import { addressToUrl, DEFAULT_FAVOURITES, hostOf, samePage, suggestedSites, type Site } from '../utils/guideSites';

type Tab = { id: string; url: string; title: string; favicon: string; loading: boolean; zoom: number; asleep: boolean; canGoBack: boolean; canGoForward: boolean };
type GbState = { tabs: Tab[]; activeId: string | null };

const api = () => (typeof window !== 'undefined' ? (window as any).electronAPI?.guideBrowser : undefined);
const FAV_KEY = 'qc-guides-favourites';
const tabsKey = (game: string) => `qc-guides-tabs:${(game || '').trim().toLowerCase().slice(0, 80)}`;
const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* not kept */
  }
};
// Something of the app's own over the page area: the page (drawn above everything) steps aside for a picture of it.
const COVERS = '[role="dialog"], [role="menu"], [role="listbox"], [data-qc-pad-ui] > .pointer-events-auto, [data-gb-cover]';

export function GuidesBrowser({ active, game, steamAppId, home }: { active: boolean; game: string; steamAppId?: number; home: React.ReactNode }) {
  const t = useT();
  const gb = api();
  const desktop = !!gb;
  const [st, setSt] = useState<GbState>({ tabs: [], activeId: null });
  const [onHome, setOnHome] = useState(true);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [favs, setFavs] = useState<Site[]>(() => read(FAV_KEY, DEFAULT_FAVOURITES));
  const [find, setFind] = useState<{ open: boolean; text: string; active: number; matches: number }>({ open: false, text: '', active: 0, matches: 0 });
  const [download, setDownload] = useState<string>('');
  const [covered, setCovered] = useState(false);
  const [snap, setSnap] = useState<string | null>(null);
  // The page steps aside only once its picture is ready (so nothing flashes empty).
  const [stepAside, setStepAside] = useState(false);
  const [copied, setCopied] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const restoredFor = useRef<string | null>(null);

  const tab = st.tabs.find((x) => x.id === st.activeId) || null;
  const showingPage = !onHome && !!tab && !!tab.url;
  const sites = suggestedSites(game, steamAppId);
  const siteName = (k: string) => (k === 'steam' ? t('gb.s.steam') : k === 'youtube' ? t('gb.s.youtube') : k === 'map' ? t('gb.s.map') : k === 'fandom' ? 'Fandom' : k === 'gamefaqs' ? 'GameFAQs' : 'Reddit');

  // ---- The desktop app's tabs: their state, and each game's set kept on this computer.
  useEffect(() => {
    if (!gb) return;
    gb.onState((s: GbState) => setSt(s || { tabs: [], activeId: null }));
    gb.onFound((f: { active: number; matches: number }) => setFind((x) => ({ ...x, active: f.active || 0, matches: f.matches || 0 })));
    gb.onDownload((d: { url: string }) => setDownload(String(d.url || '')));
  }, [gb]);
  useEffect(() => {
    if (!gb || restoredFor.current === game) return;
    restoredFor.current = game;
    const saved = read<{ tabs: { url: string; title: string }[]; active: number; home: boolean } | null>(tabsKey(game), null);
    gb.restore(saved?.tabs || [], saved?.active || 0);
    setOnHome(saved ? saved.home !== false : true);
  }, [gb, game]);
  useEffect(() => {
    if (!gb || restoredFor.current !== game) return;
    write(tabsKey(game), { tabs: st.tabs.map((x) => ({ url: x.url, title: x.title })), active: Math.max(0, st.tabs.findIndex((x) => x.id === st.activeId)), home: onHome });
  }, [st, onHome, game, gb]);
  useEffect(() => write(FAV_KEY, favs), [favs]);
  // The last web tab closed: back to the guide.
  const tabCount = useRef(0);
  useEffect(() => {
    if (gb && tabCount.current > 0 && st.tabs.length === 0) setOnHome(true);
    tabCount.current = st.tabs.length;
  }, [st.tabs.length, gb]);
  // The address bar follows the page, unless the player is typing in it.
  useEffect(() => {
    if (!editing) setAddress(tab?.url || '');
  }, [tab?.url, tab?.id, editing]);

  // ---- Where the page goes (desktop): this component's page area, when it's on screen and nothing covers it.
  const visible = active && showingPage && !stepAside;
  const sendLayout = useCallback(() => {
    if (!gb) return;
    const el = pageRef.current;
    if (!visible || !el) return gb.layout(false, null);
    const r = el.getBoundingClientRect();
    let bottom = r.bottom;
    // The controller's prompt bar sits at the bottom of the panel: the page stops above it.
    const bar = document.querySelector<HTMLElement>('[data-qc-pad-ui] [data-qc-prompt-bar]');
    if (bar) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
    if (r.width < 4 || bottom - r.top < 4) return gb.layout(false, null);
    gb.layout(true, { x: r.left, y: r.top, width: r.width, height: bottom - r.top });
  }, [gb, visible]);
  useLayoutEffect(() => {
    sendLayout();
    const el = pageRef.current;
    if (!el || !gb) return;
    const ro = new ResizeObserver(() => sendLayout());
    ro.observe(el);
    window.addEventListener('resize', sendLayout);
    const iv = setInterval(sendLayout, 700); // things above it can grow without a resize (a note, a banner)
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sendLayout);
      clearInterval(iv);
    };
  }, [sendLayout, gb]);
  useEffect(() => () => api()?.layout(false, null), []);
  // Something of the app's own over the page area: a picture of the page stands in.
  useEffect(() => {
    if (!gb) return;
    const check = () => {
      const el = pageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const over = Array.from(document.querySelectorAll<HTMLElement>(COVERS)).some((c) => {
        if (el.contains(c)) return false;
        const b = c.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
      });
      setCovered((was) => (was === over ? was : over));
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'role', 'hidden'] });
    check();
    return () => mo.disconnect();
  }, [gb]);
  useEffect(() => {
    if (!gb) return;
    let alive = true;
    if (covered && active && showingPage) {
      gb.snapshot().then((url: string | null) => {
        if (!alive) return;
        setSnap(url);
        setStepAside(true);
      });
    } else {
      setStepAside(false);
      const id = setTimeout(() => alive && setSnap(null), 120);
      return () => {
        alive = false;
        clearTimeout(id);
      };
    }
    return () => {
      alive = false;
    };
  }, [covered, active, showingPage, gb]);

  // The ⋯ menu closes on a click anywhere else, or when the page itself is clicked (the panel's page loses focus).
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (e.type === 'mousedown' && el?.closest?.('[data-gb-menu]')) return;
      setMenu(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // ---- Actions
  const openTab = useCallback(async (url = '', background = false) => {
    if (!gb) {
      // The web app: a site opens in a new browser tab; "+" shows the sites page here.
      if (url) window.open(url, '_blank', 'noopener');
      else setOnHome(false);
      return;
    }
    await gb.open(url, background);
    if (!background) {
      setOnHome(false);
      if (!url) setTimeout(() => addressRef.current?.focus(), 30);
    }
  }, [gb]);
  const go = (raw: string) => {
    const url = addressToUrl(raw, game);
    if (!url) return;
    setEditing(false);
    if (!gb) return void window.open(url, '_blank', 'noopener');
    if (tab && !onHome) gb.navigate(tab.id, url);
    else void openTab(url);
  };
  const selectTab = (id: string | 'home') => {
    setMenu(false);
    if (id === 'home') return setOnHome(true);
    setOnHome(false);
    gb?.select(id);
  };
  const closeTab = (id: string) => gb?.close(id);
  const isFav = !!tab && favs.some((f) => samePage(f.url, tab.url));
  const toggleFav = () => {
    if (!tab?.url) return;
    setFavs((list) => (isFav ? list.filter((f) => !samePage(f.url, tab.url)) : [...list, { name: (tab.title || hostOf(tab.url)).slice(0, 60), url: tab.url }]));
  };
  const cycle = (dir: number) => {
    const ids: (string | 'home')[] = ['home', ...st.tabs.map((x) => x.id)];
    const at = onHome ? 0 : Math.max(0, ids.indexOf(st.activeId || 'home'));
    selectTab(ids[(at + dir + ids.length) % ids.length]);
  };
  const openFind = () => {
    if (!showingPage) return;
    setFind((f) => ({ ...f, open: true }));
    setTimeout(() => findRef.current?.select(), 20);
  };
  const closeFind = () => {
    setFind({ open: false, text: '', active: 0, matches: 0 });
    if (tab) gb?.action(tab.id, 'find-stop');
  };

  // A browser's keys: from the page (the desktop app passes them on) and from the app's own controls here.
  const keyRef = useRef<(act: string) => void>(() => {});
  keyRef.current = (act: string) => {
    if (act === 'new-tab') void openTab('');
    else if (act === 'close-tab') { if (tab && !onHome) closeTab(tab.id); }
    else if (act === 'address') { if (!onHome) { addressRef.current?.focus(); addressRef.current?.select(); } }
    else if (act === 'find') openFind();
    else if (act === 'next-tab') cycle(1);
    else if (act === 'prev-tab') cycle(-1);
  };
  useEffect(() => {
    gb?.onKey((k: { act: string }) => keyRef.current(k.act));
  }, [gb]);
  useEffect(() => {
    if (!active || !gb) return;
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const k = e.key.toLowerCase();
      const act = k === 't' && !e.shiftKey ? 'new-tab' : k === 'w' ? 'close-tab' : k === 'l' ? 'address' : k === 'f' ? 'find' : k === 'tab' ? (e.shiftKey ? 'prev-tab' : 'next-tab') : null;
      if (!act) return;
      e.preventDefault();
      keyRef.current(act);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, gb]);

  // ---- The parts
  const btn = 'p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-default cursor-pointer transition-colors';
  const startPage = (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-xl space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
          className="flex items-center gap-2 rounded-xl bg-white/[0.05] border border-white/10 focus-within:border-[var(--accent-border)] px-3 py-2.5"
        >
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            value={address}
            onChange={(e) => { setEditing(true); setAddress(e.target.value); }}
            placeholder={game ? t('gb.searchGame', { game }) : t('gb.address')}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-zinc-100 placeholder:text-zinc-500"
            aria-label={t('gb.address')}
          />
        </form>
        {sites.length > 0 && (
          <section>
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">{t('gb.suggested', { game })}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sites.map((s) => (
                <SiteTile key={s.key} name={siteName(s.key)} url={s.url} onOpen={(bg) => (gb && tab && !onHome && !tab.url && !bg ? gb.navigate(tab.id, s.url) : openTab(s.url, bg))} webOnly={!desktop} />
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">{t('gb.favourites')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {favs.map((f) => (
              <SiteTile
                key={f.url}
                name={f.name}
                url={f.url}
                onOpen={(bg) => (gb && tab && !onHome && !tab.url && !bg ? gb.navigate(tab.id, f.url) : openTab(f.url, bg))}
                onRemove={() => setFavs((list) => list.filter((x) => x.url !== f.url))}
                removeLabel={t('gb.unfav')}
                webOnly={!desktop}
              />
            ))}
          </div>
        </section>
        {!desktop && <p className="text-[11px] text-zinc-500">{t('gb.webOnly')}</p>}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs: 📖 Guide, then the web tabs. */}
      <div role="tablist" aria-label={t('main.guide')} className="flex items-end gap-1 px-2 pt-1.5 border-b border-white/[0.08] bg-black/30 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden select-none">
        <button
          type="button"
          role="tab"
          aria-selected={onHome}
          onClick={() => selectTab('home')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-[12px] flex-shrink-0 border-x border-t transition-colors cursor-pointer ${onHome ? 'bg-[#12131c] border-white/15 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
        >
          <BookOpen className="w-3.5 h-3.5 text-[var(--accent-color)]" />
          {t('gb.home')}
        </button>
        {st.tabs.map((x) => {
          const on = !onHome && x.id === st.activeId;
          return (
            <div
              key={x.id}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              title={x.title || x.url}
              onClick={() => selectTab(x.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTab(x.id); } }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(x.id); } }}
              className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-t-lg text-[12px] w-40 min-w-[96px] flex-shrink border-x border-t transition-colors cursor-pointer ${on ? 'bg-[#12131c] border-white/15 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
            >
              {x.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-zinc-400" /> : x.favicon ? <img src={x.favicon} alt="" className="w-3.5 h-3.5 flex-shrink-0 rounded-sm" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : <Globe className="w-3.5 h-3.5 flex-shrink-0 text-sky-400" />}
              <span className="truncate flex-1">{x.title || hostOf(x.url) || t('gb.newTab')}</span>
              <button
                type="button"
                aria-label={t('gb.closeTab')}
                title={t('gb.closeTab')}
                onClick={(e) => { e.stopPropagation(); closeTab(x.id); }}
                className={`p-0.5 rounded hover:bg-white/15 text-zinc-500 hover:text-white flex-shrink-0 ${on ? '' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        <button type="button" onClick={() => void openTab('')} className={`${btn} mb-0.5 flex-shrink-0`} aria-label={t('gb.newTab')} title={`${t('gb.newTab')} (Ctrl+T)`}>
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* The toolbar, on a web tab. */}
      {!onHome && tab && (
        <div className="relative flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.08] bg-black/20">
          <button type="button" className={btn} disabled={!tab.canGoBack} onClick={() => gb?.action(tab.id, 'back')} aria-label={t('gb.back')} title={`${t('gb.back')} (Alt+←)`}><ArrowLeft className="w-4 h-4" /></button>
          <button type="button" className={btn} disabled={!tab.canGoForward} onClick={() => gb?.action(tab.id, 'forward')} aria-label={t('gb.forward')} title={`${t('gb.forward')} (Alt+→)`}><ArrowRight className="w-4 h-4" /></button>
          <button type="button" className={btn} disabled={!tab.url} onClick={() => gb?.action(tab.id, tab.loading ? 'stop' : 'reload')} aria-label={tab.loading ? t('gb.stop') : t('gb.reload')} title={tab.loading ? t('gb.stop') : `${t('gb.reload')} (F5)`}>
            {tab.loading ? <X className="w-4 h-4" /> : <RotateCw className="w-4 h-4" />}
          </button>
          <form
            className="flex-1 min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              go(address);
              addressRef.current?.blur();
            }}
          >
            <input
              ref={addressRef}
              value={address}
              onFocus={(e) => { setEditing(true); e.target.select(); }}
              onBlur={() => setEditing(false)}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setAddress(tab.url); addressRef.current?.blur(); } }}
              placeholder={t('gb.address')}
              aria-label={t('gb.address')}
              spellCheck={false}
              className="w-full rounded-full bg-white/[0.06] border border-white/10 focus:border-[var(--accent-border)] px-3 py-1 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 outline-none"
            />
          </form>
          <button type="button" className={btn} disabled={!tab.url} onClick={toggleFav} aria-label={isFav ? t('gb.unfav') : t('gb.fav')} title={isFav ? t('gb.unfav') : t('gb.fav')}>
            <Star className={`w-4 h-4 ${isFav ? 'fill-[var(--accent-color)] text-[var(--accent-color)]' : ''}`} />
          </button>
          <button type="button" data-gb-menu className={btn} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={t('gb.more')} title={t('gb.more')}>
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menu && (
            <div role="menu" data-gb-menu className="absolute right-2 top-full mt-1 z-50 w-56 rounded-xl bg-[#13141d] border border-white/10 shadow-2xl p-1 text-[12.5px]">
              <div className="flex items-center justify-between px-2 py-1.5 text-zinc-300">
                <span>{t('gb.zoom')}</span>
                <span className="flex items-center gap-1">
                  <button type="button" role="menuitem" className={btn} onClick={() => gb?.action(tab.id, 'zoom-out')} aria-label="−"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <button type="button" role="menuitem" className="px-1.5 text-zinc-300 tabular-nums hover:text-white cursor-pointer" onClick={() => gb?.action(tab.id, 'zoom-reset')}>{Math.round((tab.zoom || 1) * 100)}%</button>
                  <button type="button" role="menuitem" className={btn} onClick={() => gb?.action(tab.id, 'zoom-in')} aria-label="+"><ZoomIn className="w-3.5 h-3.5" /></button>
                </span>
              </div>
              <MenuItem icon={<Search className="w-3.5 h-3.5" />} label={`${t('gb.find')}  Ctrl+F`} onClick={() => { setMenu(false); openFind(); }} disabled={!tab.url} />
              <MenuItem icon={<ExternalLink className="w-3.5 h-3.5" />} label={t('gb.openExternal')} onClick={() => { setMenu(false); gb?.external(tab.url); }} disabled={!tab.url} />
              <MenuItem
                icon={<Copy className="w-3.5 h-3.5" />}
                label={copied ? t('gb.copied') : t('gb.copyLink')}
                disabled={!tab.url}
                onClick={() => {
                  navigator.clipboard?.writeText(tab.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Find in page. */}
      {find.open && showingPage && tab && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.08] bg-black/30">
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          <input
            ref={findRef}
            value={find.text}
            onChange={(e) => {
              const text = e.target.value;
              setFind((f) => ({ ...f, text }));
              gb?.action(tab.id, 'find', { text });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') gb?.action(tab.id, 'find', { text: find.text, next: true, back: e.shiftKey });
              if (e.key === 'Escape') closeFind();
            }}
            placeholder={t('gb.find')}
            aria-label={t('gb.find')}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
          />
          <span className="text-[11px] text-zinc-500 tabular-nums">{find.text ? (find.matches ? `${find.active}/${find.matches}` : t('gb.noMatches')) : ''}</span>
          <button type="button" className={btn} onClick={closeFind} aria-label={t('common.close')}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* A download the page started: off here; the player's own browser can take it. */}
      {download && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.08] bg-amber-500/10 text-[12px] text-amber-200">
          <span className="flex-1 min-w-0 truncate">{t('gb.downloadOff')}</span>
          <button type="button" className="underline hover:text-white cursor-pointer" onClick={() => { gb?.external(download); setDownload(''); }}>{t('gb.openExternal')}</button>
          <button type="button" className={btn} onClick={() => setDownload('')} aria-label={t('common.close')}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* The page area. */}
      {onHome ? (
        <div className="flex-1 flex flex-col min-h-0">{home}</div>
      ) : !tab || !tab.url ? (
        startPage
      ) : (
        <div ref={pageRef} className="flex-1 min-h-0 relative bg-white">
          {snap && <img src={snap} alt="" className="absolute inset-0 w-full h-full object-cover object-left-top" />}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-zinc-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 cursor-pointer">
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );
}

function SiteTile({ name, url, onOpen, onRemove, removeLabel, webOnly }: { name: string; url: string; onOpen: (background: boolean) => void; onRemove?: () => void; removeLabel?: string; webOnly?: boolean }) {
  const host = hostOf(url);
  const inner = (
    <>
      <span className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] text-[var(--accent-color)] flex items-center justify-center text-sm font-bold flex-shrink-0">{(name || host || '?').slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-zinc-100">{name}</span>
        <span className="block truncate text-[10.5px] text-zinc-500">{host}</span>
      </span>
    </>
  );
  return (
    <div className="group relative">
      {webOnly ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:border-[var(--accent-border)] hover:bg-white/[0.06] px-2.5 py-2 transition-colors">
          {inner}
        </a>
      ) : (
        <button
          type="button"
          onClick={(e) => onOpen(e.ctrlKey || e.metaKey)}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onOpen(true); } }}
          className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:border-[var(--accent-border)] hover:bg-white/[0.06] px-2.5 py-2 text-left transition-colors cursor-pointer"
        >
          {inner}
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel} className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-5 h-5 items-center justify-center rounded-full bg-zinc-800 border border-white/15 text-zinc-300 hover:text-white cursor-pointer">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
