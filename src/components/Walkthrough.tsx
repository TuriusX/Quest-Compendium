import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, X } from './icons';
import { useT } from '../i18n';
import { QuestLogo } from './QuestLogo';

/**
 * The 30-second first-run tour. Desktop: the show / hide hotkey (it also frees the mouse; borderless mode so the overlay
 * can show), the screenshot hotkey, the compact view, the quest log and its keys, Pro / Fast. The web app: asking with a
 * screenshot, Ask | Guide, Pro / Fast. Each step shows its keys as keycaps, from the player's own settings.
 *
 * Shown once per computer (a player who saw the earlier tour isn't shown this one); "Skip" is always there, and the
 * ⋯ menu's "Quick tour" opens it again (the 'qc-open-tour' event). Keyboard and controller: the buttons take focus
 * (Next first), ← / → step through it, Esc closes it.
 */
const KEY = 'qc-tour-done';
const OLD_KEY = 'qc-walkthrough-done';
export const walkthroughDone = () => {
  try {
    return localStorage.getItem(KEY) === '1' || localStorage.getItem(OLD_KEY) === '1';
  } catch {
    return true;
  }
};
/** Opens the tour again (the ⋯ menu's "Quick tour"). */
export const OPEN_TOUR_EVENT = 'qc-open-tour';

/** Each shortcut as keycaps, one per key ("Ctrl + Shift + S" and "Ctrl+Shift+S" look the same). */
const Keys = ({ keys }: { keys: string[] }) => (
  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
    {keys.filter(Boolean).map((combo, i) => (
      <span key={i} className="inline-flex items-center gap-1">
        {combo.split(/\s*\+\s*/).filter(Boolean).map((k, j) => (
          <kbd key={j} className="min-w-[26px] px-1.5 py-0.5 rounded-md bg-white/[0.07] border border-white/15 border-b-[3px] text-center text-[12px] font-mono font-semibold text-zinc-100">
            {k}
          </kbd>
        ))}
      </span>
    ))}
  </span>
);

export function Walkthrough({ isDesktop, screenshotKeys, hideKeys, tickKeys, nextKeys, onDone }: {
  isDesktop: boolean; screenshotKeys?: string; hideKeys?: string; tickKeys?: string; nextKeys?: string; onDone: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const hide = hideKeys || 'Ctrl+Space';
  const shot = screenshotKeys || 'Ctrl+Shift+S';
  const tick = tickKeys || 'Ctrl+Shift+Enter';
  const next = nextKeys || 'Ctrl+Shift+↓';
  const steps: { icon: string; title: string; body: string; keys?: string[] }[] = isDesktop
    ? [
        { icon: '🎮', title: t('tour2.hideT'), body: t('tour2.hideB', { keys: hide }), keys: [hide] },
        { icon: '📸', title: t('tour2.shotT'), body: t('tour2.shotB', { keys: shot }), keys: [shot] },
        { icon: '🗔', title: t('tour2.compactT'), body: t('tour2.compactB', { keys: 'Ctrl+Shift+F' }), keys: ['Ctrl+Shift+F'] },
        { icon: '📜', title: t('tour2.logT'), body: t('tour2.logB', { tick, next }), keys: [tick, next] },
        { icon: '⚡', title: t('tour2.proT'), body: t('tour2.proB') },
      ]
    : [
        { icon: '📸', title: t('tour2.shotT'), body: t('tour.2bWeb') },
        { icon: '📖', title: t('tour.4t'), body: t('tour.4b') },
        { icon: '⚡', title: t('tour2.proT'), body: t('tour2.proB') },
      ];
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    onDone();
  };
  const s = steps[step];
  const last = step === steps.length - 1;
  // Focus lands on Next (or Let's go) at each step, for keyboard and controller players.
  useEffect(() => {
    const id = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, [step]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!last) setStep(step + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (step > 0) setStep(step - 1); }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('tour.title')} onKeyDown={onKey}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--accent-border)] bg-[#0d0e15] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2 px-4 pt-4">
          <QuestLogo size={16} compact />
          <span className="font-fantasy font-bold text-xs text-zinc-300 tracking-wide">{t('tour.title')}</span>
          <span className="text-[11px] text-zinc-500 font-mono">{step + 1}/{steps.length}</span>
          <button type="button" onClick={finish} aria-label={t('tour.skip')} className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pt-5 pb-4 min-h-[13rem]">
          <div className="text-3xl mb-3" aria-hidden="true">{s.icon}</div>
          <h2 className="text-base font-bold text-white leading-snug">{s.title}</h2>
          {s.keys && <div className="mt-2.5"><Keys keys={s.keys} /></div>}
          <p className="mt-2.5 text-sm leading-relaxed text-zinc-300">{s.body}</p>
        </div>
        <div className="flex items-center gap-2 px-4 pb-4">
          <div className="flex items-center gap-1.5 mr-auto" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-[var(--accent-color)]' : 'w-1.5 bg-white/20'}`} />
            ))}
          </div>
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} aria-label={t('tour2.back')} className="h-9 w-9 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          ) : (
            <button type="button" onClick={finish} className="h-9 px-3 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer">
              {t('tour.skip')}
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="qc-px-bevel h-9 px-4 rounded-lg bg-[var(--accent-color)] hover:brightness-110 text-[#16101f] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {last ? t('tour.done') : t('tour.next')}
            {last ? <Check className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
