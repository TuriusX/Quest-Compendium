import { useEffect, useState } from 'react';
import { guideApi } from './guideApi';

/**
 * A game's IGDB art (/api/game-art: the key art and the cover, for games with a guide), fetched once per game and kept
 * on this computer (so the picture shows at once next time; refreshed in the background). The caller keeps the Steam
 * image it already has as the fallback: empty fields mean "use yours". For the sharpest size see utils/artCache.ts.
 */
export type GameArt = { art?: string; cover?: string };

const KEY = 'qc-game-art';
const MAX = 200;
const read = (): Record<string, GameArt> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
};
function keep(id: string, a: GameArt) {
  try {
    const all = read();
    delete all[id];
    all[id] = { ...(a.art ? { art: a.art } : {}), ...(a.cover ? { cover: a.cover } : {}) };
    const ids = Object.keys(all);
    for (const k of ids.slice(0, Math.max(0, ids.length - MAX))) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export function useGameArt(appId?: number | string | null, name?: string | null): GameArt {
  const id = `${appId || ''}|${String(name || '').toLowerCase()}`;
  const [art, setArt] = useState<GameArt>(() => read()[id] || {});
  useEffect(() => {
    if (!appId && !name) return;
    let live = true;
    setArt(read()[id] || {});
    const q = new URLSearchParams({ ...(appId ? { appId: String(appId) } : {}), ...(name ? { name } : {}) });
    guideApi(`/api/game-art?${q}`).then((x) => {
      if (!live) return;
      setArt(x || {});
      keep(id, x || {});
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return art;
}
