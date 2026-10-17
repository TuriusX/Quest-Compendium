import React, { useState } from 'react';
import { X } from './icons';
import { useT } from '../i18n';
import { GlainIcon } from './GlainIcon';

const DISMISSED = 'qc_premium_card_dismissed';
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A free player out of questions: one card under the limit message (never a pop-up), what Premium gives, See Premium
 * (the Premium screen) and Not now, which hides it for the rest of the day.
 */
export function PremiumCard({ onSeePremium }: { onSeePremium: () => void }) {
  const t = useT();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISSED) === today(); } catch { return false; }
  });
  if (hidden) return null;
  const close = () => {
    try { localStorage.setItem(DISMISSED, today()); } catch { /* hidden for now */ }
    setHidden(true);
  };
  return (
    <div className="qc-px-frame relative mt-1 mb-4 ml-0 sm:ml-11 max-w-xl rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-4 pr-10 animate-in fade-in duration-200">
      <button type="button" onClick={close} title={t('prem.notNow')} aria-label={t('prem.notNow')} className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer">
        <X className="w-4 h-4" />
      </button>
      <p className="text-sm font-semibold text-white leading-snug flex items-center gap-2"><GlainIcon size={15} /> {t('prem.cardTitle')}</p>
      <p className="mt-1 text-xs text-zinc-300">{t('prem.cardBody')}</p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onSeePremium} className="qc-px-bevel inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent-color)] text-black hover:brightness-110 font-semibold text-sm transition cursor-pointer">
          {t('prem.see')}
        </button>
        <button type="button" onClick={close} className="px-3 py-2 rounded-xl text-sm text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer">
          {t('prem.notNow')}
        </button>
      </div>
    </div>
  );
}
