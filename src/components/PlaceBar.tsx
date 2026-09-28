import React, { useState } from 'react';
import { MapPin, Mic, Check, BookOpen } from './icons';
import type { ChatMessage } from '../types';
import { useT } from '../i18n';

/**
 * "Where are you?" and "When in the story?" under an answer, made for controllers: no typing needed.
 * - The AI was sure: a small "📍 Place · story" line with a "Not right?" button that opens the choices.
 * - It wasn't sure: its best guess and up to three other likely options as buttons, plus "Say it" (voice).
 * Picks are remembered for this game (sent with every later question). If a pick differs from what the answer was
 * based on, a button offers to answer again with the right place and story point.
 */
export function PlaceBar({
  msg,
  question,
  confirmedPlace,
  confirmedStory,
  onChoosePlace,
  onChooseStory,
  onReask,
}: {
  msg: ChatMessage;
  /** The player's question this answer replied to (for "answer again"). */
  question?: ChatMessage;
  confirmedPlace?: string;
  confirmedStory?: string;
  onChoosePlace: (name: string) => void;
  onChooseStory: (story: string) => void;
  onReask: (place: string, story: string | undefined, question: ChatMessage) => void;
}) {
  const t = useT();
  const place = msg.place;
  const [open, setOpen] = useState(false);
  if (!place) return null;

  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const placeNow = msg.placeChosen || (same(confirmedPlace, place.name) ? confirmedPlace : undefined);
  const storyNow = msg.storyChosen || (same(confirmedStory, place.story) ? confirmedStory : undefined);
  const askPlace = !placeNow && (!place.sure || open);
  const askStory = !!place.story && !storyNow && (!place.storySure || open);

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
  const choices = (list: string[], pick: (v: string) => void) =>
    list.map((v, i) => (
      <button key={v} type="button" onClick={() => pick(v)} className={i === 0 ? guessBtn : otherBtn}>
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
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
        <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
        <span className="text-zinc-300">{placeNow || place.name}</span>
        {(storyNow || place.story) && <span className="text-zinc-500">· {storyNow || place.story}</span>}
        {reask}
        {!reask && !(msg.placeChosen && (!place.story || msg.storyChosen)) && (
          <button type="button" onClick={() => setOpen(true)} className="text-zinc-500 hover:text-[var(--accent-color)] underline underline-offset-2 cursor-pointer">
            {t('place.notRight')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-3" role="group" aria-label={t('place.where')}>
      {askPlace && (
        <div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-300 mb-2">
            <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
            <span className="font-semibold">{t('place.where')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {choices([place.name, ...(place.options || [])], onChoosePlace)}
            {say}
          </div>
        </div>
      )}
      {askStory && (
        <div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-300 mb-2">
            <BookOpen className="w-3.5 h-3.5 text-[var(--accent-color)]" aria-hidden="true" />
            <span className="font-semibold">{t('place.when')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {choices([place.story as string, ...(place.storyOptions || [])], onChooseStory)}
            {!askPlace && say}
          </div>
        </div>
      )}
      <div className="text-[11px] text-zinc-500">{t('place.hint')}</div>
    </div>
  );
}
