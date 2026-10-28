/**
 * Which game a compendium tab is (games-not-tabs migration, src/utils/gameSpaces.ts), from the guide index the same way
 * the server matches answers to guides (guidesApi.ts pickGuideKey): the tab's collection pick, its Steam app, its names.
 * A game with no guide is still a game (steam:<appId>, or name:<loose name> from the Steam name); a tab with only its
 * own name and no guide match needs the player ("Which game is this?"), with the collection's games when its Steam app
 * holds several.
 */
import { guideCollection, guideKeyFor, guideList, shortGameName } from '../../guidesApi';
import { looseName, type CatalogGame, type Resolve } from '../../src/utils/gameSpaces';

export async function guideCatalog(): Promise<CatalogGame[]> {
  return (await guideList()).map((g) => ({ id: g.key, name: shortGameName(g.game) }));
}

export function guideResolver(catalog: CatalogGame[]): Resolve {
  const names = new Map(catalog.map((g) => [g.id, g.name]));
  return async (tab) => {
    const s = tab.activeSteamGame;
    const appId = Number(s?.appId) || undefined;
    const collection = appId ? await guideCollection(appId) : [];
    const key = await guideKeyFor(s?.name || tab.name, appId, tab.name, tab.guideKey);
    if (key) return { id: key, name: names.get(key) || key, ...(collection.length ? { collectionPick: key } : {}) };
    if (collection.length) return { id: null, options: collection.map((c) => ({ id: c.key, name: c.game })) };
    if (appId && s?.name) return { id: `steam:${appId}`, name: shortGameName(s.name) };
    if (s?.name) return { id: `name:${looseName(s.name)}`, name: shortGameName(s.name) };
    return { id: null };
  };
}
