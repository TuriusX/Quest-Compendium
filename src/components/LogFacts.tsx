import React, { useEffect, useRef, useState } from 'react';
import { ItemCard, type CardItem } from './ItemCard';
import { ChevronDown, ChevronRight, Trophy } from './icons';
import { useT } from '../i18n';
import { achKey } from '../utils/achievementGuide';
import type { Achievement } from '../types';

/**
 * The quest log's database sections (owner, Nov 15 2026; roadmap item 30, step 2), under Now, Next and the warning,
 * which they never replace: "Worth getting here" (the area's best gear and spells, best first, missables badged, then
 * its quests and people) and "Achievements here" (the Steam achievements still missing in this area, those a coming
 * point of no return ends first, and progress for the game). Every section folds and remembers it; long lists offer
 * "Show all"; empty sections don't show; facts not yet confirmed say so. The ticks are the guide's own (shared with the
 * site's "Worth it here").
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
const SHOW = 5;

export function LogFacts(p: {
  facts: AreaFacts;
  game: string;
  /** The guide's key, for the item cards' "Not right". */
  gameKey: string;
  done: Set<string>;
  onTick: (id: string, done: boolean) => void;
  steam?: { list?: Achievement[]; unlocked?: number; total?: number } | null;
}) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const [all, setAll] = useState<Record<string, boolean>>({});
  // The item card: hover shows it after a moment, click keeps it open (Esc or a click elsewhere closes it).
  const [card, setCard] = useState<{ item: CardItem; rect: DOMRect; kept: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; };
  // The card opens beside the quest log (its whole column), level with the item, never over the list itself.
  const anchorOf = (el: HTMLElement) => { const r = el.getBoundingClientRect(); const col = (el.closest('[data-qc-log-worth]') as HTMLElement | null)?.getBoundingClientRect(); return col ? new DOMRect(col.left, r.top, col.width + 14, r.height) : r; };
  const showSoon = (item: CardItem, el: HTMLElement) => { clearHover(); hoverTimer.current = setTimeout(() => setCard((c) => (c?.kept ? c : { item, rect: anchorOf(el), kept: false })), 350); };
  const hideSoon = () => { clearHover(); hoverTimer.current = setTimeout(() => setCard((c) => (c?.kept ? c : null)), 200); };
  useEffect(() => {
    if (!card?.kept) return;
    const away = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!el.closest?.('[data-qc-item-card]') && !el.closest?.('[data-qc-item-name]')) setCard(null); };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [card?.kept]);
  useEffect(() => () => clearHover(), []);
  const isOpen = (id: string) => open[id] !== false;
  const toggle = (id: string) => setOpen((o) => { const n = { ...o, [id]: !isOpen(id) }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* remembered for this session only */ } return n; });
  const missTag = (lost?: string) => (
    <span className="ml-1.5 inline-block rounded border border-amber-400/40 bg-amber-400/10 px-1 text-[9.5px] font-bold uppercase tracking-wide text-amber-300 align-middle">{t('logfacts.missable')}</span>
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
  const extras = (w?.quests.length || 0) + (w?.people.length || 0) + (w?.todo.length || 0);
  const worth = w && (gear.length || extras) ? (
    <div data-qc-log-worth="">
      {head('worth', t('logfacts.worth'), gear.length ? t('logfacts.bestFirst') : '')}
      {isOpen('worth') && (
        <div className="flex flex-col gap-1.5">
          {(all.worth ? gear : gear.slice(0, SHOW)).map((g) => {
            const tid = `g:${p.facts.slug}:${g.id}`;
            const on = p.done.has(g.id);
            return (
              <div key={g.id} className="flex gap-2 items-start">
                <button type="button" role="checkbox" aria-checked={on} onClick={() => p.onTick(tid, !on)} aria-label={g.name}
                  className={`flex-shrink-0 w-[15px] h-[15px] mt-[2px] border rounded-[3px] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white ${on ? 'bg-[var(--accent-color)] border-[var(--accent-color)]' : 'border-zinc-400/70 bg-black/30 hover:bg-white/10'}`}>
                  {on && <span className="text-black text-[10px] font-black leading-none">✓</span>}
                </button>
                <div className={`min-w-0 text-[13px] leading-snug ${on ? 'opacity-50' : ''}`}>
                  <button type="button" data-qc-item-name={g.id}
                    onMouseEnter={(e) => showSoon(g, e.currentTarget)} onMouseLeave={hideSoon}
                    onClick={(e) => { clearHover(); const r = anchorOf(e.currentTarget); setCard((c) => (c?.kept && c.item.id === g.id ? null : { item: g, rect: r, kept: true })); }}
                    className="font-semibold text-white text-left hover:underline decoration-white/30 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-white rounded cursor-pointer">{g.name}</button>
                  {g.rarity && <span className="ml-1.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: rarityColor(g.rarity) }}>{g.rarity}</span>}
                  {(g.missable || g.lost) && missTag(g.lost)}
                  {/* One line per item (owner, Nov 15 2026): what it does, where and how are in its card (hover or click the name). */}
                  {(g.lost || g.lockout) && <div className="text-[11.5px] text-amber-300/90">{g.lost ? t('logfacts.goneAt', { when: g.lost }) : g.lockout}</div>}
                </div>
              </div>
            );
          })}
          {more('worth', gear.length)}
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
              <span className="font-semibold text-white">{a.name}</span>
              {(a.missable || a.lost) && missTag()}
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

  if (!worth && !ach) return null;
  return (
    <>
      {worth}
      {ach}
      {card && (
        <ItemCard item={card.item} anchor={card.rect} gameKey={p.gameKey} color={card.item.rarity ? rarityColor(card.item.rarity, '#ffffff') : '#ffffff'}
          onClose={() => setCard(null)} onEnter={clearHover} onLeave={() => { if (!card.kept) hideSoon(); }} />
      )}
    </>
  );
}
