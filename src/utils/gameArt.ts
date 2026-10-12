import { useEffect, useState } from 'react';
import { guideApi } from './guideApi';

/**
 * A game's IGDB art (/api/game-art: the key art and the cover, for games with a guide), fetched once per game. The
 * caller keeps the Steam image it already has as the fallback: empty fields mean "use yours".
 */
export type GameArt = { art?: string; cover?: string };

export function useGameArt(appId?: number | string | null, name?: string | null): GameArt {
  const [art, setArt] = useState<GameArt>({});
  useEffect(() => {
    if (!appId && !name) return;
    let live = true;
    const q = new URLSearchParams({ ...(appId ? { appId: String(appId) } : {}), ...(name ? { name } : {}) });
    guideApi(`/api/game-art?${q}`).then((x) => { if (live) setArt(x || {}); }).catch(() => {});
    return () => { live = false; };
  }, [appId, name]);
  return art;
}
