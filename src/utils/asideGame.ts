import type { GameTab } from '../types';
import { displayGameName } from './gameName';

/**
 * Side questions (owner, Nov 19 2026): every question goes to the running game's compendium, "unless the question is
 * about another game". A question that names another game the player has a compendium for is answered as that game's
 * (an "About X" card), kept out of this game's history, place and memory, and filed in that game's compendium.
 *
 * Read on the device from the compendiums' names (no model call, so the answer itself is never changed). The same
 * matching as the server's gameNamedIn (visualServer.ts): whole words, the longest name wins, and a one-word name
 * ("Control", "Hades") only when it's capitalised and said as a game ("in Control", "Hades's", "playing Hades").
 */
export type AsideGame = { name: string; tabId: string };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[™®©:'’.,!?()\-–—]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The other game a question is about (one the player has a compendium for), or null: then it's about this game. */
export function asideGameIn(question: string, tabs: GameTab[], currentTabId: string | null | undefined): AsideGame | null {
  const q = norm(question);
  const current = tabs.find((t) => t.id === currentTabId);
  const currentNames = current ? [current.name, current.activeSteamGame?.name].filter(Boolean).map((n) => norm(displayGameName(n)).trim()) : [];
  let best: AsideGame | null = null, bestLen = 0;
  for (const t of tabs) {
    if (t.id === currentTabId) continue;
    for (const raw of [t.activeSteamGame?.name, t.name]) {
      if (!raw) continue;
      const name = displayGameName(raw);
      const n = norm(name).trim();
      if (n.length < 4 || n.length <= bestLen || !q.includes(` ${n} `)) continue;
      // This game's own name, or part of it ("Elden Ring" while playing Elden Ring Nightreign): not another game.
      if (currentNames.some((c) => ` ${c} `.includes(` ${n} `))) continue;
      if (!n.includes(' ')) {
        const word = name.replace(/[™®©]/g, '').trim();
        const W = `${word.charAt(0).toUpperCase()}${esc(word.slice(1))}`;
        const said = new RegExp(`\\b(in|for|of|about|from|playing|play|played|than|vs\\.?|like)\\s+${W}([^A-Za-z]|$)|(^|[^A-Za-z])${W}['’]s?\\b`);
        if (!said.test(question)) continue;
      }
      best = { name: displayGameName(t.name || name), tabId: t.id };
      bestLen = n.length;
    }
  }
  return best;
}
