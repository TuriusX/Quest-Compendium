import React, { useState } from 'react';
import { LogIn, X } from './icons';
import { useT } from '../i18n';

const DISMISSED = 'qc_signin_card_dismissed';
const today = () => new Date().toLocaleDateString('en-CA');

function dismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === today();
  } catch {
    return false;
  }
}

/**
 * The one sign-in prompt guests see: under the answer that used their last question today (or the limit message), what
 * signing in gives them, one button, and a close button that hides it for the rest of the day.
 */
export function SignInCard({ onSignIn, pro, fast }: { onSignIn: () => void; pro?: number; fast?: number }) {
  const t = useT();
  const [hidden, setHidden] = useState(dismissedToday);
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, today());
    } catch {
      /* hidden for now */
    }
    setHidden(true);
  };
  return (
    <div className="qc-px-frame relative mt-1 mb-4 ml-0 sm:ml-11 max-w-xl rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-4 pr-10 animate-in fade-in duration-200">
      <button
        type="button"
        onClick={close}
        title={t('common.close')}
        aria-label={t('common.close')}
        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-sm font-semibold text-white leading-snug">{t('signin.card')}</p>
      {pro != null && fast != null && <p className="mt-1 text-xs text-zinc-300">{t('signin.cardAmounts', { pro, fast })}</p>}
      <button
        type="button"
        onClick={onSignIn}
        className="qc-px-bevel mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 font-semibold text-sm transition cursor-pointer"
      >
        <LogIn className="w-4 h-4" />
        {t('auth.google')}
      </button>
    </div>
  );
}
