import type { GameTab, SteamGameData } from '../types';
import { displayGameName } from './gameName';

/** A name compared loosely: case, punctuation and edition dashes don't matter ("Baldur's Gate 3" = "Baldurs Gate 3"). */
const loose = (s: string | null | undefined) => displayGameName(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * What the shared resolver (/api/guides/find, the same matching as the answers' guides and the game spaces) says the
 * running game is: its guide (key) and that guide's game name, so an edition or a collection's name finds the right
 * compendium ("ELDEN RING NIGHTREIGN" isn't Elden Ring; "Kingdom Hearts HD 1.5+2.5 ReMIX" has several).
 */
export type ResolvedGame = { key?: string | null; game?: string | null };

/** Is this compendium the game that's running? Its Steam app first, else its guide, else its game's or its own name. */
export function isTabForGame(tab: GameTab, game: SteamGameData | null | undefined, resolved?: ResolvedGame | null): boolean {
  if (!game) return false;
  const saved = tab.activeSteamGame && !tab.activeSteamGame.isAutoDetected ? tab.activeSteamGame : null;
  if (saved?.appId && game.appId) return Number(saved.appId) === Number(game.appId);
  if (resolved?.key && tab.guideKey) return tab.guideKey === resolved.key;
  const names = [loose(saved?.name), loose(tab.name)].filter(Boolean);
  return [game.name, resolved?.game].some((n) => !!loose(n) && names.includes(loose(n)));
}

/** The compendium for the running game, if there is one (the most recently used when several match). */
export function tabForGame(tabs: GameTab[], game: SteamGameData | null | undefined, resolved?: ResolvedGame | null): GameTab | null {
  if (!game) return null;
  return tabs.filter((t) => isTabForGame(t, game, resolved)).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0] || null;
}

/** The running game as one id: its Steam app, else its name (loosely). */
export const runningId = (game: SteamGameData | null | undefined): string | null =>
  !game ? null : Number(game.appId) > 0 ? `steam:${Number(game.appId)}` : loose(game.name) ? `name:${loose(game.name)}` : null;

/**
 * Following the running game with the current tabs (owner Oct 30 2026). Called when the running game is known (and
 * resolved); acts only when a game starts:
 *   - its compendium exists: switch to it (automatic switching on), with a short "Switched to X"
 *   - none yet: offer "Open a tab for X?" (never made on its own)
 * The same game still running does nothing, so a compendium picked by hand stays until a different game starts. A
 * game closed and started again a minute later counts as starting again; a shorter gap (Steam's id blinking while a
 * game launches) doesn't.
 */
export type FollowState = { id: string | null; goneAt: number };
export type FollowAction = { kind: 'none' } | { kind: 'switch'; tabId: string; quiet?: boolean } | { kind: 'offer' } | { kind: 'create' };
export const RESTART_GAP_MS = 60_000;

/**
 * Made seamless (owner, Nov 19 2026: "automatically switch to the tab of the game that is detected"):
 *   - a game with no compendium gets one opened for it ("Opened a tab for X · Undo"), unless the player undid that for
 *     this game before (declined); with automatic switching off it's only offered, as before
 *   - another compendium open while the game runs (picked by hand): readable while the panel is in front; once the
 *     player is back in the game (away: the panel hidden or the game focused) the game's compendium is open again
 */
export function followRunning(
  state: FollowState,
  id: string | null,
  now: number,
  o: { matchTabId: string | null; activeTabId: string | null; auto: boolean; away?: boolean; declined?: boolean },
): { state: FollowState; action: FollowAction } {
  if (!id) return { state: { id: state.id, goneAt: state.goneAt || now }, action: { kind: 'none' } };
  const restarted = !!state.goneAt && now - state.goneAt >= RESTART_GAP_MS;
  const started = id !== state.id || restarted;
  const next = { id, goneAt: 0 };
  if (!o.matchTabId) {
    if (!started) return { state: next, action: { kind: 'none' } };
    return { state: next, action: o.auto && !o.declined ? { kind: 'create' } : { kind: 'offer' } };
  }
  if (o.matchTabId === o.activeTabId || !o.auto) return { state: next, action: { kind: 'none' } };
  if (started) return { state: next, action: { kind: 'switch', tabId: o.matchTabId } };
  if (o.away) return { state: next, action: { kind: 'switch', tabId: o.matchTabId, quiet: true } };
  return { state: next, action: { kind: 'none' } };
}
