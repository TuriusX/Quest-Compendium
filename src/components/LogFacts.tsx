import React, { useEffect, useRef, useState } from 'react';
import { ItemCard, type CardItem } from './ItemCard';
import { ChevronDown, ChevronRight, Trophy, X } from './icons';
import { useT } from '../i18n';
import { achKey } from '../utils/achievementGuide';
import type { Achievement } from '../types';

/**
 * The quest log's database sections (owner, Nov 15 2026; roadmap item 30, step 2), under Now, Next and the warning,
 * which they never replace: "Worth getting here" (the area's best gear and spells, best first, missables badged, then
 * its quests and people) and "Achievements here" (the Steam achievements still missing in this area, those a coming
 * point of no return ends first, and progress for the game). Every section folds and remembers it; long lists offer
 * "Show all"; empty sections don't show; facts not yet confirmed say so. No tick boxes (owner, Nov 20 2026, idea #6): an
 * item is removed (its ✕, or right-click, Remove) and stays off for this playthrough; it's kept where ticks were, so
 * items ticked before stay off too.
 */
export type AreaFacts = {
  slug: string;
  worth?: {
    gear: CardItem[];
    quests: { id: string; name: string; giver?: string; reward?: string; confirmed?: boolean }[];
    people: { id: string; name: string; why?: string; where?: string; confirmed?: boolean }[];
    todo: { id: string; name: string; why?: string; confirmed?: boolean }[];
  };
  achievements?: { name: string; how?: string; missable?: boolean; lost?: string; if?: string; rarity?: string }[];
};

const RARITY: [RegExp, string][] = [[/legendary|artifact|mythic|unique|exotic/i, '#f59e0b'], [/very\s*rare|epic/i, '#a855f7'], [/\brare\b/i, '#3b82f6'], [/uncommon/i, '#22c55e'], [/\bcommon\b/i, '#9ca3af']];
/** A rarity's loot color ("Very Rare" purple, "Rare" blue...), or the default for a spell level and the like. */
export const rarityColor = (r: string, fallback = '#c4b0ff') => RARITY.find(([re]) => re.test(r))?.[1] || fallback;

const OPEN_KEY = 'qc_log_open';
const readOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { return {}; } };
const SHOW = 10;

export function LogFacts(p: {
  facts: AreaFacts;
  game: string;
  /** The guide's key, for the item cards' "Not right". */
  gameKey: string;
  done: Set<string>;
  /** Remove an item (g:<area>:<id>): off the list for this playthrough, with Undo in the log. */
  onRemove: (id: string, text: string) => void;
  steam?: { list?: Achievement[]; unlocked?: number; total?: number } | null;
  /** The area's list is being found right now (worthOnDemand.ts): one quiet line in its place. */
  finding?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const [all, setAll] = useState<Record<string, boolean>>({});
  // The item card: hover shows it after a moment, click keeps it open (Esc or a click elsewhere closes it).
  const [card, setCard] = useState<{ item: CardItem; rect: DOMRect; kept: boolean; doc: Document } | null>(null);
  // Right-click on an item: Remove.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; text: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; };
  // The card opens beside the quest log (its whole column), level with the item, never over the list itself.
  const anchorOf = (el: HTMLElement) => { const r = el.getBoundingClientRect(); const col = (el.closest('[data-qc-log-worth]') as HTMLElement | null)?.getBoundingClientRect(); return col ? new DOMRect(col.left, r.top, col.width + 14, r.height) : r; };
  const showSoon = (item: CardItem, el: HTMLElement) => { clearHover(); hoverTimer.current = setTimeout(() => setCard((c) => (c?.kept ? c : { item, rect: anchorOf(el), kept: false, doc: el.ownerDocument })), 350); };
  const hideSoon = () => { clearHover(); hoverTimer.current = setTimeout(() => setCard((c) => (c?.kept ? c : null)), 200); };
  useEffect(() => {
    if (!card?.kept) return;
    const away = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!el.closest?.('[data-qc-item-card]') && !el.closest?.('[data-qc-item-name]')) setCard(null); };
    // The log's own window (docked: the panel; popped out: its window).
    const w = card.doc.defaultView || window;
    w.addEventListener('mousedown', away);
    return () => w.removeEventListener('mousedown', away);
  }, [card?.kept, card?.doc]);
  useEffect(() => () => clearHover(), []);
  const isOpen = (id: string) => open[id] !== false;
  const toggle = (id: string) => setOpen((o) => { const n = { ...o, [id]: !isOpen(id) }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* remembered for this session only */ } return n; });
  // Missable: a yellow square bullet, not the word (owner, Nov 21 2026: the word took up space). Named for screen readers.
  const missDot = (cls = '') => (
    <span data-qc-missable="" title={t('logfacts.missable')} className={`flex-shrink-0 inline-block w-1.5 h-1.5 rounded-[1px] bg-amber-400 ${cls}`}><span className="sr-only">{t('logfacts.missable')}</span></span>
  );
  const head = (id: string, title: string, count: React.ReactNode, icon?: React.ReactNode) => (
    <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen(id)} data-qc-log-section={id}
      className="w-full flex items-center gap-2 mb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] font-mono text-zinc-500 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
      {isOpen(id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      {icon}{title}
      <span className="ml-auto normal-case tracking-normal font-sans font-semibold text-[11px] text-zinc-500">{count}</span>
    </button>
  );
  const more = (id: string, n: number) => n > SHOW ? (
    <button type="button" onClick={() => setAll((a) => ({ ...a, [id]: !a[id] }))} className="self-start mt-1 text-[12px] font-semibold text-[var(--accent-color)] hover:underline outline-none focus-visible:underline">
      {all[id] ? t('logfacts.showLess') : t('logfacts.showAll', { n })}
    </button>
  ) : null;

  // ---- Worth getting here ----
  const w = p.facts.worth;
  const gear = w?.gear || [];
  // What's left: removed items (and ones ticked before) stay off.
  const left = gear.filter((g) => !p.done.has(g.id));
  const extras = (w?.quests.length || 0) + (w?.people.length || 0) + (w?.todo.length || 0);
  const worth = w && (left.length || extras) ? (
    <div data-qc-log-worth="">
      {head('worth', t('logfacts.worth'), gear.length ? t('logfacts.bestFirst') : '')}
      {isOpen('worth') && (
        <div className="flex flex-col gap-1.5">
          {(all.worth ? left : left.slice(0, SHOW)).map((g) => {
            const tid = `g:${p.facts.slug}:${g.id}`;
            return (
              <div key={g.id} data-qc-worth-item={g.id} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: tid, text: g.name }); }}
                className="group/row flex gap-2 items-start">
                {g.missable || g.lost
                  ? missDot('mt-[7px]')
                  : <span className="flex-shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full" style={{ background: g.rarity ? rarityColor(g.rarity) : '#71717a' }} aria-hidden="true" />}
                <div className="min-w-0 flex-1 text-[13px] leading-snug">
                  <button type="button" data-qc-item-name={g.id}
                    onMouseEnter={(e) => showSoon(g, e.currentTarget)} onMouseLeave={hideSoon}
                    onClick={(e) => { clearHover(); const r = anchorOf(e.currentTarget); const doc = e.currentTarget.ownerDocument; setCard((c) => (c?.kept && c.item.id === g.id ? null : { item: g, rect: r, kept: true, doc })); }}
                    className="font-semibold text-white text-left hover:underline decoration-white/30 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-white rounded cursor-pointer">{g.name}</button>
                  {g.rarity && <span className="ml-1.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: rarityColor(g.rarity) }}>{g.rarity}</span>}
                  {/* One line per item (owner, Nov 15 2026): what it does, where and how are in its card (hover or click the name). */}
                  {(g.lost || g.lockout) && <div className="text-[11.5px] text-amber-300/90">{g.lost ? t('logfacts.goneAt', { when: g.lost }) : g.lockout}</div>}
                </div>
                <button type="button" data-qc-log-remove={tid} onClick={() => p.onRemove(tid, g.name)} title={t('tracker.logRemove')} aria-label={`${t('tracker.logRemove')}: ${g.name}`}
                  className="flex-shrink-0 self-start w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-white/[0.08] opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {more('worth', left.length)}
          {extras > 0 && (
            <>
              <button type="button" onClick={() => setAll((a) => ({ ...a, people: !a.people }))} aria-expanded={!!all.people}
                className="self-start mt-0.5 text-[12px] font-semibold text-[var(--accent-color)] hover:underline outline-none focus-visible:underline">
                {[w.quests.length ? t('logfacts.quests', { n: w.quests.length }) : '', w.people.length ? t('logfacts.people', { n: w.people.length }) : '', w.todo.length ? t('logfacts.todo', { n: w.todo.length }) : ''].filter(Boolean).join(' · ')}
              </button>
              {all.people && (
                <ul className="flex flex-col gap-1 text-[12.5px] leading-snug">
                  {w.quests.map((q) => <li key={q.id}><span className="font-semibold text-white">{q.name}</span><span className="text-zinc-400">{[q.giver && ` · ${t('logfacts.from', { who: q.giver })}`, q.reward && ` · ${t('logfacts.reward', { what: q.reward })}`].filter(Boolean).join('')}</span></li>)}
                  {w.people.map((x) => <li key={x.id}><span className="font-semibold text-white">{x.name}</span>{x.why && <span className="text-zinc-400"> · {x.why}</span>}</li>)}
                  {w.todo.map((x) => <li key={x.id}><span className="font-semibold text-white">{x.name}</span>{x.why && <span className="text-zinc-400"> · {x.why}</span>}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  ) : null;

  // ---- Achievements here ----
  const list = p.steam?.list || [];
  const unlocked = new Set(list.filter((a) => a.unlocked).map((a) => achKey(a.name)));
  const known = list.length > 0;
  const here = (p.facts.achievements || [])
    .filter((a) => !unlocked.has(achKey(a.name)))
    .sort((x, y) => Number(!!y.lost) - Number(!!x.lost) || Number(!!y.missable) - Number(!!x.missable));
  const total = p.steam?.total || list.length;
  const got = p.steam?.unlocked ?? list.filter((a) => a.unlocked).length;
  const ach = (p.facts.achievements || []).length ? (
    <div data-qc-log-ach="">
      {head('ach', t('logfacts.ach'), known ? t('logfacts.fromSteam') : '', <Trophy className="w-3 h-3 text-amber-300/80" />)}
      {isOpen('ach') && (
        <div className="flex flex-col gap-1.5">
          {here.length === 0 && known && <div className="text-[12px] text-emerald-300/90">{t('logfacts.allHere')}</div>}
          {(all.ach ? here : here.slice(0, SHOW)).map((a) => (
            <div key={a.name} className="text-[13px] leading-snug">
              {(a.missable || a.lost) && missDot('mr-1.5 align-middle')}
              <span className="font-semibold text-white">{a.name}</span>
              {a.rarity && <span className="ml-1.5 text-[11px] text-emerald-300/80">{t('logfacts.players', { n: a.rarity })}</span>}
              {a.lost && <div className="text-[11.5px] text-amber-300/90">{t('logfacts.goneAt', { when: a.lost })}</div>}
              {!a.lost && a.if && <div className="text-[11.5px] text-amber-300/90">{t('logfacts.lostIf', { what: a.if.replace(/^(lost\s+)?if\s+/i, '') })}</div>}
              {a.how && <div className="text-[12px] text-zinc-400">{a.how}</div>}
            </div>
          ))}
          {more('ach', here.length)}
          {!known && <div className="text-[11.5px] text-zinc-500">{t('logfacts.steamNote')}</div>}
          {known && total > 0 && (
            <div className="mt-1">
              <div className="flex text-[11px] text-zinc-500"><span>{p.game}</span><span className="ml-auto font-mono">{t('logfacts.progress', { n: got, total, pct: Math.round((got / total) * 100) })}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[var(--accent-color)]" style={{ width: `${Math.round((got / total) * 100)}%` }} /></div>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  // Being found (owner, Nov 15 2026): the section's heading and one quiet line, until the list is in.
  const finding = !worth && p.finding ? (
    <div data-qc-log-finding="">
      {head('worth', t('logfacts.worth'), '')}
      <div className="flex items-center gap-2 text-[12.5px] text-zinc-400">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-pulse" aria-hidden="true" />
        {t('logfacts.finding')}
      </div>
    </div>
  ) : null;
  if (!worth && !ach && !finding) return null;
  return (
    <>
      {finding}
      {worth}
      {ach}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} aria-hidden="true" />
          <div role="menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } }}
            style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 50) }}
            className="fixed z-50 w-44 py-1 rounded-lg bg-[#161620] border border-white/15 shadow-2xl">
            <button type="button" role="menuitem" autoFocus onClick={() => { p.onRemove(menu.id, menu.text); setMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer">
              <X className="w-3.5 h-3.5 text-zinc-400" />{t('tracker.logRemove')}
            </button>
          </div>
        </>
      )}
      {card && (
        <ItemCard item={card.item} anchor={card.rect} doc={card.doc} gameKey={p.gameKey} color={card.item.rarity ? rarityColor(card.item.rarity, '#ffffff') : '#ffffff'}
          onClose={() => setCard(null)} onEnter={clearHover} onLeave={() => { if (!card.kept) hideSoon(); }} />
      )}
    </>
  );
}
