import React, { useState } from 'react';
import { Check, ChevronRight, X } from './icons';
import { useT } from '../i18n';
import { QuestLogo } from './QuestLogo';

/**
 * A 20-second first-run intro: the three things every new player needs to know (borderless window mode, the
 * screenshot hotkey, confirming where you are) plus Ask | Guide. Shown once per computer; "Skip" is always there.
 */
const KEY = 'qc-walkthrough-done';
export const walkthroughDone = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
};

export function Walkthrough({ isDesktop, onDone }: { isDesktop: boolean; onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const steps = [
    { title: t('tour.1t'), body: t('tour.1b'), icon: '🖥️' },
    { title: t('tour.2t'), body: isDesktop ? t('tour.2bDesktop') : t('tour.2bWeb'), icon: '📸' },
    { title: t('tour.3t'), body: t('tour.3b'), icon: '📍' },
    { title: t('tour.4t'), body: t('tour.4b'), icon: '📖' },
  ];
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    onDone();
  };
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('tour.title')}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--accent-border)] bg-[#0d0e15] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2 px-4 pt-4">
          <QuestLogo size={16} compact />
          <span className="font-fantasy font-bold text-xs text-zinc-300 tracking-wide">{t('tour.title')}</span>
          <button type="button" onClick={finish} aria-label={t('tour.skip')} className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pt-5 pb-4">
          <div className="text-3xl mb-3" aria-hidden="true">{s.icon}</div>
          <h2 className="text-base font-bold text-white leading-snug">{s.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{s.body}</p>
        </div>
        <div className="flex items-center gap-2 px-4 pb-4">
          <div className="flex items-center gap-1.5 mr-auto" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-[var(--accent-color)]' : 'w-1.5 bg-white/20'}`} />
            ))}
          </div>
          {!last && (
            <button type="button" onClick={finish} className="h-9 px-3 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer">
              {t('tour.skip')}
            </button>
          )}
          <button
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
