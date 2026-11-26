/**
 * What the new web app keeps on this device: the games the player picked (most recent first) and, per game, where they
 * are and the last questions and answers. Photos aren't kept (a small preview at most), so it stays well inside the
 * browser's storage. Not synced with the desktop app yet (part 2).
 */
import type { Game, Place, Turn } from './webApi';

const GAMES = 'qcw_games';
const GAME = (k: string) => `qcw_game_${k}`;
const MAX_TURNS = 40;

export const gameId = (g: Pick<Game, 'name' | 'appId'>) => (g.appId ? `a${g.appId}` : `n${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`);

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: this visit still works */
  }
};

export function recentGames(): Game[] {
  return read<Game[]>(GAMES, []);
}

export function rememberGame(g: Game): void {
  const list = recentGames().filter((x) => gameId(x) !== gameId(g));
  write(GAMES, [g, ...list].slice(0, 12));
}

export function forgetGame(g: Game): void {
  write(GAMES, recentGames().filter((x) => gameId(x) !== gameId(g)));
  try {
    localStorage.removeItem(GAME(gameId(g)));
  } catch {
    /* fine */
  }
}

export type GameState = { place: Place | null; turns: Turn[] };

export function loadGame(g: Game): GameState {
  const s = read<GameState>(GAME(gameId(g)), { place: null, turns: [] });
  return { place: s.place || null, turns: Array.isArray(s.turns) ? s.turns : [] };
}

export function saveGame(g: Game, s: GameState): void {
  write(GAME(gameId(g)), { place: s.place, turns: s.turns.filter((t) => t.answer || t.problem).slice(-MAX_TURNS) });
}
