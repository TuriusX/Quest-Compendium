import React, { useState } from 'react';
import { MapPin, Mic, Check } from './icons';
import type { ChatMessage } from '../types';
import { useT } from '../i18n';

/**
 * "Where are you?" under an answer, made for controllers: no typing needed.
 * - The AI was sure: a small "📍 Place" line with a "Not right?" button that opens the choices.
 * - It wasn't sure: its best guess and up to three other likely places as buttons, plus "Say it" (voice).
 * Picking a place remembers it for this game (sent with every later question) and, if it differs from the guess
 * the answer was based on, offers to answer again for the right place.
 */
export function PlaceBar({
  msg,
  question,
  confirmedPlace,
  onChoose,
  onReask,
}: {
  msg: ChatMessage;
  /** The player's question this answer replied to (for "answer again"). */
  question?: ChatMessage;
  /** The place the player already confirmed for this game, if any. */
  confirmedPlace?: string;
  onChoose: (name: string) => void;
  onReask: (name: string, question: ChatMessage) => void;
}) {
  const t = useT();
  const place = msg.place;
  const [open, setOpen] = useState(false);
  if (!place) return null;

  const chosen = msg.placeChosen;
  const guessed = place.name;
  const choices = [guessed, ...(place.options || [])];
  const alreadyKnown = confirmedPlace && confirmedPlace.toLowerCase() === guessed.toLowerCase();
  const asking = !chosen && !alreadyKnown && (!place.sure || open);

  const btn =
    'h-8 px-3 rounded-lg border text-[12px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 max-w-full';

  // Picked a different place than the one the answer was based on: offer to answer again.
  if (chosen && chosen.toLowerCase() !== guessed.toLowerCase()) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
        <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
        <span className="text-zinc-200 font-medium">{chosen}</span>
        {question && (
          <button
            type="button"
            onClick={() => onReask(chosen, question)}
            className={`${btn} bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent-color)] hover:brightness-125`}
          >
            {t('place.reask', { place: chosen })}
          </button>
        )}
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="mb-3 flex items-center gap-2 text-[12px] text-zinc-500">
        <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
        <span className="text-zinc-300 truncate">{chosen || guessed}</span>
        {!chosen && (
          <button type="button" onClick={() => setOpen(true)} className="text-zinc-500 hover:text-[var(--accent-color)] underline underline-offset-2 cursor-pointer">
            {t('place.notRight')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/10" role="group" aria-label={t('place.where')}>
      <div className="flex items-center gap-2 text-[12px] text-zinc-300 mb-2">
        <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
        <span className="font-semibold">{t('place.where')}</span>
        <span className="text-zinc-500">{t('place.hint')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {choices.map((name, i) => (
          <button
            key={name}
            type="button"
            onClick={() => onChoose(name)}
            className={`${btn} ${
              i === 0
                ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-zinc-100 hover:brightness-125'
                : 'bg-white/[0.04] border-white/10 text-zinc-200 hover:bg-white/[0.08]'
            }`}
          >
            {i === 0 && <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
            <span className="truncate">{name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('trigger-voice-record'))}
          className={`${btn} bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]`}
          title={t('place.sayTitle')}
        >
          <Mic className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          {t('place.say')}
        </button>
      </div>
    </div>
  );
}
