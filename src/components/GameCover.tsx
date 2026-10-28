import React from 'react';
import { useT } from '../i18n';
import { useGameArt } from '../utils/gameArt';
import { sharpIgdb, steamCover, steamHeader, useArt } from '../utils/artCache';

/**
 * A game's box art, sharp at any screen scale (utils/artCache.ts: the largest size, scaled down, kept on this
 * computer): IGDB's cover when the game has a guide, else Steam's library portrait, else the picture the game came
 * with, else Steam's header, else the game's initials. `unknown`: a neutral "?" (a space with no game yet). `live`: a
 * green dot (the running game). Used by the compact card, the game switcher's button and its list.
 */
export function GameCover({ appId, name, fallback, live = false, unknown = false, className, dot = 'w-3 h-3' }: { appId?: number; name: string; fallback?: string; live?: boolean; unknown?: boolean; className: string; dot?: string }) {
  const t = useT();
  const ig = useGameArt(unknown ? null : appId || null, unknown ? null : name || null);
  const src = useArt(unknown ? [] : [ig.cover && sharpIgdb(ig.cover, 'cover'), steamCover(appId), fallback && sharpIgdb(fallback, 'cover'), steamHeader(appId)]);
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`relative flex-shrink-0 rounded-md ${unknown ? 'border border-dashed border-zinc-500/70 bg-white/[0.03]' : 'border border-white/15 bg-gradient-to-br from-[var(--accent-dim)] to-black/60'} ${className}`}>
      {unknown ? (
        <span className="absolute inset-0 grid place-items-center text-[12px] font-bold text-zinc-300" aria-hidden="true">?</span>
      ) : src ? (
        <img src={src} alt="" decoding="async" draggable={false} className="w-full h-full object-cover rounded-md" />
      ) : src === null ? (
        <span className="absolute inset-0 grid place-items-center text-[10px] font-bold text-[var(--accent-color)]">{initials}</span>
      ) : null}
      {live && (
        <span
          className={`absolute -right-1 -bottom-1 ${dot} rounded-full bg-emerald-400 border-2 border-[#0b0b10] shadow-[0_0_6px_rgba(52,211,153,0.9)]`}
          title={t('compact.running')}
          aria-label={t('compact.running')}
          role="img"
        />
      )}
    </div>
  );
}
