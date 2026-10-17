import React, { useState } from 'react';
import { MapPin, Mic, Check, BookOpen, Crosshair } from './icons';
import type { ChatMessage } from '../types';
import { useT } from '../i18n';
import { storyPhrase } from '../utils/placeName';

/**
 * "Where are you?" and "When in the story?" under an answer, made for controllers: no typing needed.
 * - Usually one line: "📍 Place · story [✓ Right] [Change]". Change opens the choices.
 * - The AI couldn't tell the place: its best guess and up to three other likely options as buttons, plus "Say it"
 *   (voice). An unsure story point alone stays on the one line (Right confirms it; Change offers the options).
 * Picks are remembered for this game (sent with every later question). If a pick differs from what the answer was
 * based on, a button offers to answer again with the right place and story point.
 * "Locate me" (desktop, games with a guide) looks at a screenshot and sets the place from the guide's areas.
 */
export function PlaceBar({
  msg,
  question,
  confirmedPlace,
  confirmedStory,
  onChoosePlace,
  onChooseStory,
  onReask,
  onLocate,
  locating,
  locateNote,
}: {
  msg: ChatMessage;
  /** The player's question this answer replied to (for "answer again"). */
  question?: ChatMessage;
  confirmedPlace?: string;
  confirmedStory?: string;
  onChoosePlace: (name: string) => void;
  onChooseStory: (story: string) => void;
  onReask: (place: string, story: string | undefined, question: ChatMessage) => void;
  /** "Locate me": find the place from a screenshot (its own daily limit, not the player's questions). */
  onLocate?: () => void;
  locating?: boolean;
  /** The last "Locate me" result when it couldn't set the place (used up, unreadable screenshot…). */
  locateNote?: string;
}) {
  const t = useT();
  const place = msg.place;
  const [open, setOpen] = useState(false);
  if (!place) return null;

  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const placeNow = msg.placeChosen || (same(confirmedPlace, place.name) ? confirmedPlace : undefined);
  const storyNow = msg.storyChosen || (same(confirmedStory, place.story) ? confirmedStory : undefined);
  // Change opens the choices even for something already confirmed; on its own, only an unsure place asks.
  const askPlace = open || (!placeNow && !place.sure);
  const askStory = !!place.story && open;

  const btn =
    'h-8 px-3 rounded-lg border text-[12px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 max-w-full';
  const guessBtn = `${btn} bg-[var(--accent-dim)] border-[var(--accent-border)] text-zinc-100 hover:brightness-125`;
  const otherBtn = `${btn} bg-white/[0.04] border-white/10 text-zinc-200 hover:bg-white/[0.08]`;
  const say = (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('trigger-voice-record'))}
      className={`${btn} bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]`}
      title={t('place.sayTitle')}
    >
      <Mic className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      {t('place.say')}
    </button>
  );
  const locate = onLocate ? (
    <button
      type="button"
      onClick={onLocate}
      disabled={locating}
      title={t('place.locateTitle')}
      className={`h-7 px-2.5 rounded-lg border border-white/10 bg-white/[0.04] text-[12px] font-semibold text-zinc-200 hover:bg-white/[0.08] transition-colors inline-flex items-center gap-1.5 ${locating ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
    >
      <Crosshair className={`w-3.5 h-3.5 flex-shrink-0 ${locating ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {locating ? t('place.locating') : t('place.locate')}
    </button>
  ) : null;
  const note = locateNote ? <div className="basis-full text-[11px] text-amber-300/90">{locateNote}</div> : null;
  const choices = (list: string[], pick: (v: string) => void, closes: boolean) =>
    list.map((v, i) => (
      <button
        key={v}
        type="button"
        onClick={() => {
          pick(v);
          if (closes) setOpen(false);
        }}
        className={i === 0 ? guessBtn : otherBtn}
      >
        {i === 0 && <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
        <span className="truncate">{v}</span>
      </button>
    ));

  // The answer was based on a different place or story point than the one picked: offer to answer again.
  const placeChanged = msg.placeChosen && !same(msg.placeChosen, place.name);
  const storyChanged = msg.storyChosen && !same(msg.storyChosen, place.story);
  const reask =
    question && (placeChanged || storyChanged) && !askPlace && !askStory ? (
      <button
        type="button"
        onClick={() => onReask(placeNow || place.name, storyNow || place.story, question)}
        className={`${btn} bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent-color)] hover:brightness-125`}
      >
        {t('place.reaskShort')}
      </button>
    ) : null;

  if (!askPlace && !askStory) {
    const unconfirmed = !placeNow || (place.story && !storyNow);
    const small = 'h-6 px-2 rounded-md text-[11.5px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1';
    return (
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] min-w-0">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-[var(--accent-color)]" aria-hidden="true" />
          <span className="text-zinc-200 font-medium">{placeNow || place.name}</span>
          {(storyNow || place.story) && <span className="text-zinc-400">· {storyPhrase(storyNow || place.story)}</span>}
        </span>
        {reask}
        {!reask && unconfirmed && (
          <button
            type="button"
            onClick={() => {
              if (!placeNow) onChoosePlace(place.name);
              if (place.story && !storyNow) onChooseStory(place.story);
            }}
            className={`${small} border border-[var(--accent-border)] bg-[var(--accent-dim)] text-zinc-100 hover:brightness-125`}
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {t('place.rightShort')}
          </button>
        )}
        {!reask && (
          <button type="button" onClick={() => setOpen(true)} className={`${small} text-[var(--accent-color)] hover:bg-[var(--accent-dim)]`}>
            {t('place.change')}
          </button>
        )}
        {note}
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 rounded-xl bg-[var(--accent-dim)] border-2 border-[var(--accent-border)] space-y-3" role="group" aria-label={t('place.where')}>
      {askPlace && (
        <div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-300 mb-2">
            <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
            <span className="font-semibold text-white">{t('place.where')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {choices([place.name, ...(place.options || [])], onChoosePlace, !askStory)}
            {say}
            {locate}
            {note}
          </div>
        </div>
      )}
      {askStory && (
        <div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-300 mb-2">
            <BookOpen className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
            <span className="font-semibold text-white">{t('place.when')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {choices([place.story as string, ...(place.storyOptions || [])].map((s) => storyPhrase(s)), onChooseStory, true)}
            {!askPlace && say}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
        <span className="flex-1">{t('place.hint')}</span>
        {open && (
          <button type="button" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white cursor-pointer">
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
