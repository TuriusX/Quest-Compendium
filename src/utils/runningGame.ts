import type { GameTab, SteamGameData } from '../types';
import { displayGameName } from './gameName';

/** A name compared loosely: case, punctuation and edition dashes don't matter ("Baldur's Gate 3" = "Baldurs Gate 3"). */
const loose = (s: string | null | undefined) => displayGameName(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Is this compendium the game that's running? Its Steam app first, else its game's or its own name. */
export function isTabForGame(tab: GameTab, game: SteamGameData | null | undefined): boolean {
  if (!game) return false;
  const saved = tab.activeSteamGame && !tab.activeSteamGame.isAutoDetected ? tab.activeSteamGame : null;
  if (saved?.appId && game.appId) return Number(saved.appId) === Number(game.appId);
  const want = loose(game.name);
  return !!want && (loose(saved?.name) === want || loose(tab.name) === want);
}

/** The compendium for the running game, if there is one (the most recently used when several match). */
export function tabForGame(tabs: GameTab[], game: SteamGameData | null | undefined): GameTab | null {
  if (!game) return null;
  return tabs.filter((t) => isTabForGame(t, game)).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0] || null;
}
