/**
 * Learned detection (games-not-tabs phase 2, owner Oct 27 2026; behind the qc-game-spaces flag). Detection beyond
 * Steam (electron/gameDetect.cjs) reports the focused program when it's a game; what it is comes from here:
 *   - the player's own answer for that program, remembered per player (settings.learnedPrograms, synced): never asked
 *     again; "Not a game" is remembered the same way
 *   - a launcher's game (Steam library, Epic, GOG, Xbox, Battle.net): used as detected
 *   - anything else (an emulator's game read from its title, another installer's name, a screen-filling program):
 *     asked once ("Playing X?" or "Which game is this?"), then learned
 * When nothing is recognized the app keeps working with the game last picked (nothing here blocks).
 */
import type { SteamGameData } from '../types';

import { GAME_SPACES_FLAG } from './gameSpaces';
export { GAME_SPACES_FLAG };
export const gameSpacesOn = (): boolean => {
  try {
    return localStorage.getItem(GAME_SPACES_FLAG) === '1';
  } catch {
    return false;
  }
};

/** What the desktop app reports (electron/gameDetect.cjs classify, without the process id). */
export type ProgramGame = {
  source: 'steam' | 'epic' | 'gog' | 'xbox' | 'battlenet' | 'ea' | 'ubisoft' | 'rockstar' | 'installed' | 'emulator' | 'unknown';
  name: string | null;
  sure: boolean;
  key: string;
  exe: string;
  title?: string;
  storeId?: string;
  emulator?: string;
};

/** A program's game as the player said ({ name }), or { none: true } for "Not a game". */
export type Learned = { name: string; appId?: number } | { none: true };
export type LearnedPrograms = Record<string, Learned>;

/** At most this many programs remembered (the oldest answers go first). */
export const LEARNED_MAX = 300;

export type ProgramVerdict =
  | { state: 'game'; game: SteamGameData & { source: string } }
  | { state: 'ask'; guess: string | null; via: string }
  | { state: 'ignore' };

const viaOf = (p: ProgramGame) => (p.source === 'emulator' ? p.emulator || 'emulator' : p.source === 'unknown' ? p.exe : p.source);

export function resolveProgram(p: ProgramGame | null | undefined, learned: LearnedPrograms | undefined): ProgramVerdict {
  if (!p) return { state: 'ignore' };
  const said = learned?.[p.key];
  if (said) return 'none' in said ? { state: 'ignore' } : { state: 'game', game: { name: said.name, appId: said.appId || 0, isAutoDetected: true, source: p.source } };
  if (p.sure && p.name) {
    const appId = p.source === 'steam' ? Number(p.storeId) || 0 : 0;
    return { state: 'game', game: { name: p.name, appId, isAutoDetected: true, source: p.source } };
  }
  return { state: 'ask', guess: p.name, via: viaOf(p) };
}

/** The player's answer for a program, remembered (null = not a game); the newest answers kept. */
export function learn(learned: LearnedPrograms | undefined, key: string, name: string | null, appId?: number): LearnedPrograms {
  const next: LearnedPrograms = { ...(learned || {}) };
  delete next[key];
  next[key] = name ? { name: name.trim(), ...(appId ? { appId } : {}) } : { none: true };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - LEARNED_MAX))) delete next[k];
  return next;
}
