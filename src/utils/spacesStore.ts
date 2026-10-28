import type { GamePlaythrough, GameSpace, GameTab } from '../types';
import { FIRST_PLAYTHROUGH, looseName, type CatalogGame, type MergeNote, type MigrationPlan } from './gameSpaces';
import type { Tombstones } from '../hooks/tabMerge';

/**
 * One space per game, phase 2 (games-not-tabs, behind the qc-game-spaces flag): the store, and the bridge to the rest
 * of the app. The app keeps working with "tabs", but with the flag on each tab is a game showing its current
 * playthrough (toTabs); what the app changes on it goes back where it belongs (applyTabs):
 *   - the game's: notes, icon, the running game's data, the collection pick
 *   - the playthrough's: the conversation, the quest log, the place, the loaded guide steps
 * A tab the app adds (a new game) becomes a game with one playthrough; a tab it removes deletes the game (tombstoned,
 * so other devices drop it too). The compendium tabs themselves are left as they were (the migration's backup).
 */
export type SpacesState = {
  games: GameSpace[];
  playthroughs: GamePlaythrough[];
  /** game id or `${gameId}#${ptId}` → when it was deleted */
  deleted: Tombstones;
  /** compendium tab id → game id (the migration's map; a tab already placed stays where it went) */
  tabMap: Record<string, string>;
  migratedAt: number;
  /** A tab id the app made for a game that already had a space → that game's id (the app shows that game). */
  alias?: Record<string, string>;
  /** The first migration's merges and "Which game is this?", for the one-time notice (removed when dismissed). */
  notice?: { merges: MergeNote[]; needsGame: { spaceId: string; tabName: string; suggestion?: CatalogGame & { mentions: number }; options?: CatalogGame[] }[] };
};

export const emptySpaces = (): SpacesState => ({ games: [], playthroughs: [], deleted: {}, tabMap: {}, migratedAt: 0 });
export const ptKey = (gameId: string, ptId: string) => `${gameId}#${ptId}`;

const currentPt = (s: SpacesState, g: GameSpace): GamePlaythrough | undefined =>
  s.playthroughs.find((p) => p.gameId === g.id && p.id === g.currentPlaythrough) || s.playthroughs.find((p) => p.gameId === g.id);

/** The playthroughs of a game, oldest first. */
export const playthroughsOf = (s: SpacesState, gameId: string) => s.playthroughs.filter((p) => p.gameId === gameId).sort((a, b) => a.createdAt - b.createdAt);

/**
 * The name a playthrough's memory and progress are kept under (App.tsx playGame / gameProgressKey): the first
 * playthrough keeps what its tab used before (nothing moves); later ones get their own ("Elden Ring~pt2").
 */
export function memoryKeyOf(g: GameSpace, p: GamePlaythrough | undefined): string {
  if (!p || p.id === FIRST_PLAYTHROUGH) return p?.legacyGames?.[0] || g.activeSteamGame?.name || g.name;
  return `${g.activeSteamGame?.name || g.name}~${p.id}`;
}

/** The app's view: one tab per game, its current playthrough (most recently used game first). */
export function toTabs(s: SpacesState): GameTab[] {
  return s.games
    .filter((g) => s.deleted[g.id] === undefined || g.lastActive > s.deleted[g.id])
    .map((g) => {
      const p = currentPt(s, g);
      const tab: GameTab = {
        id: g.id,
        name: g.name,
        ...(g.icon ? { icon: g.icon } : {}),
        activeSteamGame: g.activeSteamGame ?? null,
        messages: p?.messages || [],
        notes: g.notes || '',
        personalQuests: p?.personalQuests || [],
        ...(p?.place ? { place: p.place } : {}),
        ...(p?.guideSteps ? { guideSteps: p.guideSteps } : {}),
        ...(g.collectionPick ? { guideKey: g.collectionPick } : {}),
        memoryKey: memoryKeyOf(g, p),
        playthrough: p ? { id: p.id, name: p.name, count: playthroughsOf(s, g.id).length } : undefined,
        createdAt: g.createdAt,
        lastActive: Math.max(g.lastActive, p?.lastActive || 0),
      };
      return tab;
    });
}

/** A new game's id from a tab the app made: its Steam app, else its name (the switcher reuses an existing game first). */
export function gameIdForTab(t: GameTab): string {
  const appId = Number(t.activeSteamGame?.appId) || 0;
  if (appId) return `steam:${appId}`;
  return `name:${looseName(t.activeSteamGame?.name || t.name) || t.id}`;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What the app did to its tabs, put back into the games and playthroughs. */
export function applyTabs(s: SpacesState, tabs: GameTab[], now = Date.now()): SpacesState {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const games: GameSpace[] = [];
  const pts = [...s.playthroughs];
  const deleted = { ...s.deleted };
  const shown = new Set(toTabs(s).map((t) => t.id));
  for (const g of s.games) {
    const t = byId.get(g.id);
    if (!t) {
      // Removed by the app (deleted): tombstoned; a game that wasn't showing (already deleted) just stays as it is.
      if (shown.has(g.id)) deleted[g.id] = now;
      games.push(g);
      continue;
    }
    const p = currentPt(s, g);
    const ng: GameSpace = { ...g };
    let gameChanged = false;
    if (!same(t.notes, g.notes)) { ng.notes = t.notes || ''; gameChanged = true; }
    if (!same(t.icon, g.icon)) { ng.icon = t.icon; gameChanged = true; }
    if (!same(t.activeSteamGame, g.activeSteamGame)) { ng.activeSteamGame = t.activeSteamGame ?? null; gameChanged = true; }
    if (!same(t.guideKey, g.collectionPick)) { ng.collectionPick = t.guideKey; gameChanged = true; }
    if (t.name && t.name !== g.name) { ng.name = t.name; gameChanged = true; }
    if (gameChanged) ng.lastActive = Math.max(g.lastActive, t.lastActive || now);
    games.push(ng);
    if (p) {
      const i = pts.findIndex((x) => x.gameId === g.id && x.id === p.id);
      const np: GamePlaythrough = { ...p };
      let ptChanged = false;
      if (!same(t.messages, p.messages)) { np.messages = t.messages || []; ptChanged = true; }
      if (!same(t.personalQuests || [], p.personalQuests)) { np.personalQuests = t.personalQuests || []; ptChanged = true; }
      if (!same(t.place, p.place)) { np.place = t.place; ptChanged = true; }
      if (!same(t.guideSteps, p.guideSteps)) { np.guideSteps = t.guideSteps; ptChanged = true; }
      if (ptChanged || (t.lastActive || 0) > p.lastActive) np.lastActive = Math.max(p.lastActive, t.lastActive || now);
      if (ptChanged || np.lastActive !== p.lastActive) pts[i] = np;
    }
  }
  // Tabs the app added: new games, or a game already here (by its Steam app or its name) coming back: the app is then
  // pointed at that game (alias), so a game is never in two spaces.
  const alias = { ...(s.alias || {}) };
  for (const t of tabs) {
    if (s.games.some((g) => g.id === t.id)) continue;
    const appId = Number(t.activeSteamGame?.appId) || 0;
    const name = looseName(t.activeSteamGame?.name || t.name);
    const existing = games.find((g) => (appId && Number(g.activeSteamGame?.appId) === appId) || (!!name && looseName(g.activeSteamGame?.name || g.name) === name));
    if (existing) {
      delete deleted[existing.id];
      existing.lastActive = now;
      alias[t.id] = existing.id;
      continue;
    }
    const id = t.id;
    games.push({
      id, name: t.name, kind: 'game', activeSteamGame: t.activeSteamGame ?? null, ...(t.icon ? { icon: t.icon } : {}),
      ...(t.guideKey ? { collectionPick: t.guideKey } : {}), notes: t.notes || '', currentPlaythrough: FIRST_PLAYTHROUGH,
      fromTabs: [], createdAt: t.createdAt || now, lastActive: t.lastActive || now,
    });
    pts.push({
      id: FIRST_PLAYTHROUGH, gameId: id, name: 'Playthrough 1', messages: t.messages || [], personalQuests: t.personalQuests || [],
      ...(t.place ? { place: t.place } : {}), ...(t.guideSteps ? { guideSteps: t.guideSteps } : {}),
      legacyGames: [(t.activeSteamGame?.name || t.name || '').trim()].filter(Boolean), createdAt: t.createdAt || now, lastActive: t.lastActive || now,
    });
  }
  return { ...s, games, playthroughs: pts, deleted, alias };
}

/** "New playthrough": a fresh conversation, quest log, place and memory; the game's notes stay. */
export function newPlaythrough(s: SpacesState, gameId: string, now = Date.now()): SpacesState {
  const mine = playthroughsOf(s, gameId);
  let n = mine.length + 1;
  while (mine.some((p) => p.id === `pt${n}`)) n++;
  const id = `pt${n}`;
  const p: GamePlaythrough = { id, gameId, name: `Playthrough ${n}`, messages: [], personalQuests: [], legacyGames: [], createdAt: now, lastActive: now };
  return {
    ...s,
    playthroughs: [...s.playthroughs, p],
    games: s.games.map((g) => (g.id === gameId ? { ...g, currentPlaythrough: id, lastActive: now } : g)),
  };
}

export function switchPlaythrough(s: SpacesState, gameId: string, ptId: string, now = Date.now()): SpacesState {
  if (!s.playthroughs.some((p) => p.gameId === gameId && p.id === ptId)) return s;
  return { ...s, games: s.games.map((g) => (g.id === gameId ? { ...g, currentPlaythrough: ptId, lastActive: now } : g)) };
}

export function renamePlaythrough(s: SpacesState, gameId: string, ptId: string, name: string, now = Date.now()): SpacesState {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return s;
  return { ...s, playthroughs: s.playthroughs.map((p) => (p.gameId === gameId && p.id === ptId ? { ...p, name: clean, lastActive: now } : p)) };
}

/** Puts a "Which game is this?" space with a game: into that game's space (merged as a playthrough), or renamed as it. */
export function assignGame(s: SpacesState, spaceId: string, game: { id: string; name: string; appId?: number }, now = Date.now()): SpacesState {
  const src = s.games.find((g) => g.id === spaceId);
  if (!src) return s;
  const target = s.games.find((g) => g.id === game.id && g.id !== spaceId);
  const tabMap = { ...s.tabMap };
  for (const t of src.fromTabs) tabMap[t] = game.id;
  if (!target) {
    // The space becomes that game.
    return {
      ...s, tabMap,
      games: s.games.map((g) => (g.id === spaceId ? { ...g, id: game.id, name: game.name, kind: 'game', ...(game.appId ? { activeSteamGame: { name: game.name, appId: game.appId } } : {}), lastActive: now } : g)),
      playthroughs: s.playthroughs.map((p) => (p.gameId === spaceId ? { ...p, gameId: game.id } : p)),
    };
  }
  // The game already has a space: this one joins it as another playthrough (nothing is mixed into the other's).
  const mine = playthroughsOf(s, game.id);
  let n = mine.length + 1;
  const moved = playthroughsOf(s, spaceId).map((p) => {
    while (mine.some((m) => m.id === `pt${n}`)) n++;
    const id = `pt${n++}`;
    return { ...p, gameId: game.id, id, name: `${src.name}` };
  });
  return {
    ...s, tabMap,
    games: s.games.filter((g) => g.id !== spaceId).map((g) => (g.id === game.id ? { ...g, notes: [g.notes, src.notes].filter(Boolean).join(''), fromTabs: [...g.fromTabs, ...src.fromTabs], lastActive: now } : g)),
    playthroughs: [...s.playthroughs.filter((p) => p.gameId !== spaceId), ...moved],
  };
}

const textOf = (html: string) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/**
 * The migration on this device, safe to run on every start (the compendium tabs stay as they were): games the plan
 * found that aren't here yet are added; a game already here gets what its tabs have that it doesn't (messages by id
 * into its first playthrough, notes, quests), never losing anything; a game deleted since stays deleted. The first
 * time, the plan's merges and "Which game is this?" are kept for the one-time notice.
 */
export function importPlan(s: SpacesState, plan: MigrationPlan, now = Date.now()): SpacesState {
  const games = s.games.map((g) => ({ ...g }));
  let pts = [...s.playthroughs];
  for (const g of plan.games) {
    if (s.deleted[g.id] !== undefined && s.deleted[g.id] >= g.lastActive) continue;
    const here = games.find((x) => x.id === g.id);
    const src = plan.playthroughs.find((p) => p.gameId === g.id);
    if (!here) {
      games.push(g);
      if (src) pts.push(src);
      continue;
    }
    here.fromTabs = [...new Set([...here.fromTabs, ...g.fromTabs])];
    if (textOf(g.notes) && !textOf(here.notes).includes(textOf(g.notes))) here.notes = `${here.notes || ''}${g.notes}`;
    const i = pts.findIndex((p) => p.gameId === g.id && p.id === FIRST_PLAYTHROUGH);
    if (!src || i < 0) continue;
    const p = pts[i];
    const ids = new Set(p.messages.map((m) => m.id));
    const add = src.messages.filter((m) => !ids.has(m.id));
    const titles = new Set(p.personalQuests.map((q) => looseName(q.title)));
    const quests = src.personalQuests.filter((q) => !titles.has(looseName(q.title)));
    if (add.length || quests.length) {
      pts = pts.map((x, j) => (j === i ? {
        ...x,
        messages: [...x.messages, ...add].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
        personalQuests: [...x.personalQuests, ...quests],
        legacyGames: [...new Set([...x.legacyGames, ...src.legacyGames])],
        lastActive: Math.max(x.lastActive, src.lastActive),
      } : x));
    }
  }
  const first = !s.migratedAt;
  return {
    ...s, games, playthroughs: pts,
    tabMap: { ...plan.tabMap, ...s.tabMap },
    migratedAt: s.migratedAt || now,
    ...(first && (plan.merges.length || plan.needsGame.length) ? { notice: { merges: plan.merges, needsGame: plan.needsGame.map((n) => ({ spaceId: n.spaceId, tabName: n.tabName, suggestion: n.suggestion, options: n.options })) } } : {}),
  };
}

/** "Keep separate": a game merged from several compendiums becomes one playthrough per compendium (by each message's tab). */
export function splitMerged(s: SpacesState, gameId: string, now = Date.now()): SpacesState {
  const p = s.playthroughs.find((x) => x.gameId === gameId && x.id === FIRST_PLAYTHROUGH);
  if (!p) return s;
  const groups = new Map<string, typeof p.messages>();
  for (const m of p.messages) {
    const k = m.fromCompendium || '';
    groups.set(k, [...(groups.get(k) || []), m]);
  }
  if (groups.size < 2) return s;
  const [firstName, ...rest] = [...groups.keys()];
  const mine = playthroughsOf(s, gameId);
  let n = mine.length + 1;
  const added: GamePlaythrough[] = rest.map((name) => {
    while (mine.some((x) => x.id === `pt${n}`)) n++;
    return { id: `pt${n++}`, gameId, name: name || 'Playthrough', messages: groups.get(name)!, personalQuests: [], legacyGames: [name].filter(Boolean), createdAt: now, lastActive: now };
  });
  return {
    ...s,
    playthroughs: [...s.playthroughs.map((x) => (x === p ? { ...p, name: firstName || p.name, messages: groups.get(firstName)!, lastActive: now } : x)), ...added],
  };
}

// ---- On this computer ----------------------------------------------------------------------------------------------

const KEY = (owner: string) => `qc-spaces:${owner}`;
export function readSpaces(owner: string): SpacesState | null {
  try {
    const raw = localStorage.getItem(KEY(owner));
    const j = raw ? JSON.parse(raw) : null;
    return j && Array.isArray(j.games) ? { ...emptySpaces(), ...j } : null;
  } catch {
    return null;
  }
}
export function writeSpaces(owner: string, s: SpacesState): void {
  try {
    localStorage.setItem(KEY(owner), JSON.stringify(s));
  } catch (e) {
    console.warn('[spaces] could not save on this computer:', (e as any)?.message);
  }
}
