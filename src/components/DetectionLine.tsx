import React from 'react';
import { useT } from '../i18n';
import { displayGameName } from '../utils/gameName';
import { playBlipSound } from '../utils/audio';

/** What the app sees on Steam: the running game (and whether its compendium is the open one), or nothing. */
export interface Detection {
  /** The running game's name ('' when nothing is detected). */
  running: string;
  /** The open compendium is the running game. */
  open: boolean;
  /** Open (or start) the running game's compendium. */
  onSwitch: () => void;
  /** Detection is possible here (the desktop app); the web app shows nothing. */
  available: boolean;
}

/**
 * A slim line under the header (and at the top of the compact view), said without hovering:
 *   "▶ Playing Baldur's Gate 3 · Switch" (another compendium is open; Switch opens or starts the game's),
 *   "▶ Playing Baldur's Gate 3 · this compendium", or "No game detected · start one in Steam and it shows here".
 * Switch is an ordinary button, so the controller reaches it like any other.
 */
export function DetectionLine({ d, soundEnabled = true }: { d: Detection; soundEnabled?: boolean }) {
  const t = useT();
  if (!d.available) return null;
  const name = displayGameName(d.running);
  const tone = !d.running ? 'bg-white/[0.02] text-zinc-500' : d.open ? 'bg-emerald-500/[0.06] text-emerald-200/90' : 'bg-emerald-500/[0.12] text-emerald-100';
  return (
    <div role="status" className={`h-7 flex-shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.06] text-[12px] ${tone}`} style={{ WebkitAppRegion: 'no-drag' } as any}>
      {d.running ? (
        <>
          <span className="text-emerald-400 text-[10px]" aria-hidden="true">▶</span>
          <span className="truncate min-w-0">{d.open ? t('detect.playingHere', { game: name }) : t('detect.playing', { game: name })}</span>
          {!d.open && (
            <button
              type="button"
              onClick={() => {
                playBlipSound(soundEnabled);
                d.onSwitch();
              }}
              title={t('detect.switchTitle', { game: name })}
              className="ml-auto flex-shrink-0 h-5 px-2.5 rounded-md bg-emerald-400 text-[#06140d] font-bold text-[11.5px] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
            >
              {t('detect.switch')}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" aria-hidden="true" />
          <span className="truncate min-w-0">{t('detect.none')}</span>
        </>
      )}
    </div>
  );
}
