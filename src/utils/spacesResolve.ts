import type { GameTab } from '../types';
import { guideApi } from './guideApi';
import { looseName, type Resolve } from './gameSpaces';
import { displayGameName } from './gameName';

/**
 * Which game a compendium tab is, on the player's device (games-not-tabs migration): the server's own guide matching
 * (/api/guides/find, the same rules as scripts/games/resolveTab.ts and the answers' guides: the collection pick, the
 * Steam app, the names), and a collection's games (/api/guides/collection) when its Steam app holds several. A game
 * without a guide is still a game (steam:<appId>, or name:<loose name> from its Steam name). Throws when the server
 * can't be reached: the migration then waits for the next start.
 */
export const resolveTabWithServer: Resolve = async (tab: GameTab) => {
  const s = tab.activeSteamGame;
  const appId = Number(s?.appId) || 0;
  const q = new URLSearchParams({ game: s?.name || tab.name || '', alt: tab.name || '', ...(appId ? { appId: String(appId) } : {}), ...(tab.guideKey ? { key: tab.guideKey } : {}) });
  const found: any = await guideApi(`/api/guides/find?${q}`);
  const collection: { key: string; game: string }[] = appId ? ((await guideApi(`/api/guides/collection?appId=${appId}`))?.games || []) : [];
  if (found?.key) return { id: found.key, name: displayGameName(found.game || found.key), ...(collection.length ? { collectionPick: found.key } : {}) };
  if (collection.length) return { id: null, options: collection.map((c) => ({ id: c.key, name: c.game })) };
  if (appId && s?.name) return { id: `steam:${appId}`, name: displayGameName(s.name) };
  if (s?.name) return { id: `name:${looseName(s.name)}`, name: displayGameName(s.name) };
  return { id: null };
};
