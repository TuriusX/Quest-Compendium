import React from 'react';
import { useT } from '../i18n';
import { displayGameName } from '../utils/gameName';

/**
 * Games-not-tabs (flag on): the line under the header, with the panel's whole width: the open game's full name (it
 * wraps rather than being cut), "Playing now" when it's the running game, and "#2" when it has several playthroughs.
 * A space with no game shows "Which game is this?" here instead (the prompt). The detection line still shows below
 * when it has something to do (another game running: Switch; a collection's "Which game?"; a program to confirm).
 */
export function GameLine({ name, running, playthrough, prompt }: { name: string; running: boolean; playthrough?: { name: string; count: number }; prompt?: React.ReactNode }) {
  const t = useT();
  const n = playthrough && playthrough.count > 1 ? playthrough.name.match(/^Playthrough (\d+)$/)?.[1] : undefined;
  return (
    <div
      role="status"
      className={`flex-shrink-0 flex items-center gap-2 min-h-8 px-3 py-1 border-b border-white/[0.06] text-[12.5px] ${running ? 'bg-emerald-500/[0.06]' : 'bg-white/[0.02]'}`}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {prompt || (
        <>
          <span className="min-w-0 font-bold text-white leading-snug line-clamp-2 break-words">{displayGameName(name)}</span>
          {running && (
            <span className="flex-shrink-0 flex items-center gap-1 text-[11.5px] text-emerald-300">
              <span className="text-[9px]" aria-hidden="true">▶</span>
              {t('spaces.playingNow')}
            </span>
          )}
          {playthrough && playthrough.count > 1 && (
            <span className="ml-auto flex-shrink-0 max-w-[8rem] truncate text-[11px] font-semibold text-zinc-300 border border-white/15 rounded-md px-1.5 py-0.5" title={`${t('spaces.playthroughs')}: ${playthrough.name}`}>
              {n ? `#${n}` : playthrough.name}
            </span>
          )}
        </>
      )}
    </div>
  );
}
