import type { ChatMessage, GamePlaythrough, GameSpace, GameTab, PersonalQuest } from '../types';
import { isLegacyWelcomeTab, tabTime, withoutDeletedMessages, type Tombstones } from '../hooks/tabMerge';

/**
 * Compendium tabs to one space per game (games-not-tabs, owner Oct 27 2026): the migration, as a plan that writes
 * nothing. The app (behind GAME_SPACES_FLAG) and the owner's dry run (scripts/games/dryRunMigration.ts) both use it.
 *
 *   - every tab's game comes from a resolver (its Steam app, its collection pick, its names: the guide index), so the
 *     app and the server match games the same way
 *   - tabs for the same game become one game with one playthrough: conversations merged by time (each message keeps
 *     the tab it came from), notes joined under each tab's name, quest logs combined; nothing is dropped
 *   - a tab with no recognizable game keeps all it has in a space of its own ("Which game is this?"), with a
 *     suggestion: the guide game its conversation names most (no AI)
 *   - deleted tabs stay deleted; empty tabs with no game are left out (nothing to keep)
 *   - the plan counts messages, notes and quests before and after; anything fewer and it isn't ok (the app then keeps
 *     the tabs and reports it)
 */

export const GAME_SPACES_FLAG = 'qc-game-spaces';
export const FIRST_PLAYTHROUGH = 'pt1';

/** What a resolver says a tab is: a game (id + name), or which games it may be (a collection, unsure). */
export type TabGame = { id: string | null; name?: string; collectionPick?: string; options?: { id: string; name: string }[] };
export type Resolve = (tab: GameTab) => Promise<TabGame> | TabGame;
export type CatalogGame = { id: string; name: string };

export type NeedsGame = { spaceId: string; tabId: string; tabName: string; messages: number; lastActive: number; suggestion?: CatalogGame & { mentions: number }; options?: CatalogGame[] };
export type MergeNote = { gameId: string; name: string; tabs: string[] };
export type Counts = { tabs: number; messages: number; notesChars: number; quests: number };
export type MigrationPlan = {
  games: GameSpace[];
  playthroughs: GamePlaythrough[];
  /** tab id → space id: saved, so running it again (or on another computer) puts the same tab in the same place. */
  tabMap: Record<string, string>;
  merges: MergeNote[];
  needsGame: NeedsGame[];
  skipped: { tabId: string; tabName: string; why: 'deleted' | 'welcome' | 'empty' }[];
  before: Counts;
  after: Counts;
  ok: boolean;
  problems: string[];
};

/** A name compared loosely (case, punctuation, ™ and spacing don't matter). */
export const looseName = (s: string | null | undefined) => String(s || '').replace(/[™®©]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const textOf = (html: string) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The game name the tab's playthrough memory and progress were kept under (App.tsx playGame / gameProgressKey). */
export const legacyGameOf = (t: GameTab) => (t.activeSteamGame?.name || t.name || '').trim();
const hasContent = (t: GameTab) => (t.messages?.length || 0) > 0 || !!textOf(t.notes) || (t.personalQuests?.length || 0) > 0;

/** How a player says a game: its name, the part before a subtitle ("The Witcher 3"), without "The". At least 5 letters. */
function sayings(name: string): string[] {
  const out = new Set<string>();
  for (const n of [name, name.split(/[:–—]| - /)[0]]) {
    const l = looseName(n);
    out.add(l);
    if (l.startsWith('the')) out.add(l.slice(3));
  }
  return [...out].filter((s) => s.length >= 5);
}

/** The catalog game a conversation names most (at least twice), for "Which game is this?". No AI. */
export function suggestGame(t: GameTab, catalog: CatalogGame[]): (CatalogGame & { mentions: number }) | undefined {
  const text = looseName([t.name, ...(t.messages || []).map((m) => m?.text || '')].join(' '));
  if (!text) return undefined;
  let best: (CatalogGame & { mentions: number }) | undefined;
  for (const g of catalog) {
    let n = 0;
    for (const s of sayings(g.name)) n = Math.max(n, text.split(s).length - 1);
    if (n >= 2 && (!best || n > best.mentions)) best = { ...g, mentions: n };
  }
  return best;
}

function count(tabs: GameTab[]): Omit<Counts, 'quests'> {
  const ids = new Set<string>();
  let notesChars = 0;
  for (const t of tabs) {
    for (const m of t.messages || []) if (m?.id) ids.add(m.id);
    notesChars += textOf(t.notes).length;
  }
  return { tabs: tabs.length, messages: ids.size, notesChars };
}

/** The conversations of several tabs as one: every message once (by id, the fuller copy), by time. */
function mergeMessages(tabs: GameTab[], tagged: boolean): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const t of tabs) {
    for (const m of t.messages || []) {
      if (!m?.id) continue;
      const msg = tagged ? { ...m, fromCompendium: t.name } : m;
      const had = byId.get(m.id);
      if (!had || (msg.text || '').length > (had.text || '').length) byId.set(m.id, msg);
    }
  }
  return [...byId.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/** Notes of several tabs: one tab's as they are; several under each tab's name (oldest tab first). */
function mergeNotes(tabs: GameTab[]): string {
  const withNotes = tabs.filter((t) => textOf(t.notes));
  if (withNotes.length <= 1) return withNotes[0]?.notes || '';
  return withNotes.map((t) => `<h3>From "${esc(t.name || 'a compendium')}"</h3>${t.notes}`).join('');
}

/** Quest logs combined: by id, then by title; done in either copy stays done. */
function mergeQuests(tabs: GameTab[]): PersonalQuest[] {
  const out = new Map<string, PersonalQuest>();
  for (const t of tabs) {
    for (const q of t.personalQuests || []) {
      if (!q?.title) continue;
      const k = looseName(q.title) || q.id;
      const had = out.get(k);
      out.set(k, had ? { ...had, completed: had.completed || q.completed, createdAt: Math.min(had.createdAt, q.createdAt) } : q);
    }
  }
  return [...out.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** The space and its first playthrough for a group of tabs (oldest tab first). */
function build(id: string, name: string, kind: GameSpace['kind'], tabs: GameTab[], collectionPick?: string): { game: GameSpace; pt: GamePlaythrough } {
  const newest = [...tabs].sort((a, b) => tabTime(b) - tabTime(a));
  const pick = <K extends keyof GameTab>(k: K) => newest.find((t) => t[k])?.[k];
  const createdAt = Math.min(...tabs.map((t) => t.createdAt || tabTime(t)));
  const lastActive = Math.max(...tabs.map(tabTime));
  const steam = newest.find((t) => t.activeSteamGame && !t.activeSteamGame.isAutoDetected)?.activeSteamGame || pick('activeSteamGame') || null;
  const game: GameSpace = {
    id, name, kind,
    icon: pick('icon') as string | undefined,
    activeSteamGame: steam,
    collectionPick: collectionPick || (pick('guideKey') as string | undefined),
    notes: mergeNotes(tabs),
    currentPlaythrough: FIRST_PLAYTHROUGH,
    fromTabs: tabs.map((t) => t.id),
    createdAt, lastActive,
  };
  const pt: GamePlaythrough = {
    id: FIRST_PLAYTHROUGH, gameId: id, name: 'Playthrough 1',
    messages: mergeMessages(tabs, tabs.length > 1),
    personalQuests: mergeQuests(tabs),
    place: pick('place') as GamePlaythrough['place'],
    guideSteps: pick('guideSteps') as GamePlaythrough['guideSteps'],
    legacyGames: [...new Set(tabs.map(legacyGameOf).filter(Boolean))],
    createdAt, lastActive,
  };
  if (!game.collectionPick) delete game.collectionPick;
  if (!game.icon) delete game.icon;
  if (!pt.place) delete pt.place;
  if (!pt.guideSteps) delete pt.guideSteps;
  return { game, pt };
}

/**
 * The plan: what the spaces would be. `previous` is an earlier run's tabMap (a tab already placed stays where it went).
 */
export async function planMigration(tabs: GameTab[], deleted: Tombstones, resolve: Resolve, catalog: CatalogGame[] = [], previous: Record<string, string> = {}): Promise<MigrationPlan> {
  const skipped: MigrationPlan['skipped'] = [];
  const live: GameTab[] = [];
  for (const raw of tabs || []) {
    if (!raw?.id) continue;
    const t = withoutDeletedMessages(raw, deleted);
    if (deleted[t.id] !== undefined && tabTime(t) <= deleted[t.id]) skipped.push({ tabId: t.id, tabName: t.name, why: 'deleted' });
    else if (isLegacyWelcomeTab(t)) skipped.push({ tabId: t.id, tabName: t.name, why: 'welcome' });
    else live.push(t);
  }
  live.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1));

  // Each tab's game.
  type Placed = { tab: GameTab; id: string | null; name: string; pick?: string; options?: CatalogGame[] };
  const placed: Placed[] = [];
  for (const tab of live) {
    const before = previous[tab.id];
    if (before && !before.startsWith('tab:')) {
      const g = await resolve(tab);
      const same = g.id === before;
      placed.push({ tab, id: before, name: (same && g.name) || catalog.find((c) => c.id === before)?.name || legacyGameOf(tab) || before, pick: same ? g.collectionPick : undefined });
      continue;
    }
    const g = await resolve(tab);
    placed.push(g.id ? { tab, id: g.id, name: g.name || legacyGameOf(tab), pick: g.collectionPick } : { tab, id: null, name: tab.name, options: g.options });
  }
  // A game found only by name joins the same game found by its Steam app ("name:x" → "steam:1" named x).
  const byLoose = new Map<string, string>();
  for (const p of placed) if (p.id && !p.id.startsWith('name:')) byLoose.set(looseName(p.name), p.id);
  for (const p of placed) if (p.id?.startsWith('name:') && byLoose.has(looseName(p.name))) p.id = byLoose.get(looseName(p.name))!;

  const games: GameSpace[] = [];
  const playthroughs: GamePlaythrough[] = [];
  const tabMap: Record<string, string> = {};
  const merges: MergeNote[] = [];
  const needsGame: NeedsGame[] = [];
  const groups = new Map<string, Placed[]>();
  for (const p of placed) {
    if (p.id) {
      groups.set(p.id, [...(groups.get(p.id) || []), p]);
    } else if (!hasContent(p.tab)) {
      skipped.push({ tabId: p.tab.id, tabName: p.tab.name, why: 'empty' });
    } else {
      const id = `tab:${p.tab.id}`;
      const { game, pt } = build(id, p.tab.name || 'Untitled', 'unsorted', [p.tab]);
      games.push(game);
      playthroughs.push(pt);
      tabMap[p.tab.id] = id;
      needsGame.push({ spaceId: id, tabId: p.tab.id, tabName: p.tab.name, messages: pt.messages.length, lastActive: game.lastActive, suggestion: suggestGame(p.tab, catalog), ...(p.options?.length ? { options: p.options } : {}) });
    }
  }
  for (const [id, ps] of groups) {
    const name = ps.find((p) => p.name)?.name || id;
    const { game, pt } = build(id, name, 'game', ps.map((p) => p.tab), ps.find((p) => p.pick)?.pick);
    games.push(game);
    playthroughs.push(pt);
    for (const p of ps) tabMap[p.tab.id] = id;
    if (ps.length > 1) merges.push({ gameId: id, name, tabs: ps.map((p) => p.tab.name) });
  }
  games.sort((a, b) => b.lastActive - a.lastActive);

  // Nothing lost: the kept tabs' messages, notes and quests are all in the spaces.
  const kept = live.filter((t) => tabMap[t.id]);
  const questKeys = new Set<string>();
  for (const t of kept) for (const q of t.personalQuests || []) if (q?.title) questKeys.add(`${tabMap[t.id]}|${looseName(q.title)}`);
  const before: Counts = { ...count(kept), quests: questKeys.size };
  const after: Counts = {
    tabs: games.reduce((n, g) => n + g.fromTabs.length, 0),
    messages: new Set(playthroughs.flatMap((p) => p.messages.map((m) => m.id))).size,
    notesChars: kept.length ? games.reduce((n, g) => n + textOf(g.notes).length, 0) : 0,
    quests: new Set(playthroughs.flatMap((p) => p.personalQuests.map((q) => `${p.gameId}|${looseName(q.title)}`))).size,
  };
  const problems: string[] = [];
  if (after.tabs !== before.tabs) problems.push(`tabs: ${before.tabs} kept, ${after.tabs} placed`);
  if (after.messages < before.messages) problems.push(`messages: ${before.messages} before, ${after.messages} after`);
  if (after.notesChars < before.notesChars) problems.push(`notes: ${before.notesChars} characters before, ${after.notesChars} after`);
  if (after.quests < before.quests) problems.push(`quests: ${before.quests} before, ${after.quests} after`);
  for (const t of kept) {
    const pt = playthroughs.find((p) => p.gameId === tabMap[t.id])!;
    const ids = new Set(pt.messages.map((m) => m.id));
    const lost = (t.messages || []).filter((m) => m?.id && !ids.has(m.id)).length;
    if (lost) problems.push(`"${t.name}": ${lost} message(s) missing`);
    if (textOf(t.notes) && !textOf(games.find((g) => g.id === tabMap[t.id])!.notes).includes(textOf(t.notes))) problems.push(`"${t.name}": notes missing`);
  }
  return { games, playthroughs, tabMap, merges, needsGame, skipped, before, after, ok: problems.length === 0, problems };
}
