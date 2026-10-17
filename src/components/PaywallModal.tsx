import React, { useEffect, useState } from 'react';
import { Check, CreditCard, X } from './icons';
import { useT } from '../i18n';
import { GlainIcon } from './GlainIcon';
import { startCheckout, openBillingPortal } from '../utils/billing';

interface PaywallModalProps {
  onClose?: () => void;
  /** A guest: Premium belongs to an account, so Subscribe signs in first (and this opens again after). */
  isGuest?: boolean;
  onSignIn?: () => void;
  /** Already Premium: this is "Your plan", with Manage or cancel. */
  isPremium?: boolean;
  /** The beta: on-screen markers and Gemini voices are free for everyone for now. */
  beta?: boolean;
  /** Who manages Premium ('stripe': the portal; 'grant': given by hand), and when it renews or ends. */
  premiumSource?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Premium: Free and Premium side by side, the player's plan marked. No padlock and no "unlock": free players can
 * already do everything, Premium gives more questions. During the beta the extras are labelled as free for everyone.
 * Premium players see "Your plan" with when it renews (or ends) and Manage or cancel.
 */
export const PaywallModal: React.FC<PaywallModalProps> = ({ onClose, isGuest = false, onSignIn, isPremium = false, beta = false, premiumSource, periodEnd, cancelAtPeriodEnd }) => {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [opened, setOpened] = useState(false);
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI;
  // Escape closes it (wherever the focus is).
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const date = periodEnd ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  const go = async (fn: () => Promise<void>) => {
    setLoading(true);
    setErrorMsg('');
    try {
      await fn();
      setOpened(true);
    } catch (e: any) {
      if (e?.message === 'signin') {
        try { sessionStorage.setItem('qc-after-signin', 'premium'); } catch {}
        onSignIn?.();
      } else setErrorMsg(t('prem.error'));
    } finally {
      setLoading(false);
    }
  };
  const subscribe = () => {
    if (isGuest) {
      // Premium belongs to an account: sign in, then this opens again.
      try { sessionStorage.setItem('qc-after-signin', 'premium'); } catch {}
      onSignIn?.();
      return;
    }
    void go(startCheckout);
  };

  const extra = (label: string) => (
    <li className="flex items-start gap-2">
      <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--accent-color)]" />
      <span>{label}{beta && <span className="block text-[11px] text-zinc-500">{t('prem.betaFree')}</span>}</span>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="qc-prem-title" className="w-full max-w-lg bg-[#0c0d14] border border-[var(--accent-border)] rounded-2xl shadow-[0_0_50px_var(--accent-glow)] overflow-hidden flex flex-col p-6 sm:p-7 relative">
        {onClose && (
          <button onClick={onClose} aria-label={t('common.close')} className="absolute top-3 right-3 p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-xl transition-colors z-10 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        )}
        <h2 id="qc-prem-title" className="font-fantasy font-bold text-2xl text-white mb-1 tracking-wide text-center">{isPremium ? t('prem.yourPlan') : t('prem.title')}</h2>
        <p className="text-zinc-400 text-[13px] mb-5 text-center">{isPremium ? t('prem.thanks') : t('prem.sub')}</p>

        {isPremium ? (
          <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-4 mb-5 text-[13px] text-zinc-200 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-white"><GlainIcon size={15} /> {t('prem.premiumPlan')}</div>
            <div>{t('prem.premiumQ')}</div>
            {premiumSource === 'stripe' && date && <div className="text-zinc-300">{cancelAtPeriodEnd ? t('prem.endsOn', { date }) : t('prem.renewsOn', { date })}</div>}
            {premiumSource === 'grant' && <div className="text-zinc-400">{t('prem.granted')}</div>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-5 text-[12.5px]">
            <div className={`rounded-xl border p-3.5 ${isGuest ? 'border-white/10' : 'border-white/25'} bg-white/[0.03]`}>
              <div className="flex items-center justify-between mb-2"><span className="font-semibold text-white">{t('prem.free')}</span>{!isGuest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">{t('prem.current')}</span>}</div>
              <div className="text-zinc-400 mb-2">{t('prem.freePrice')}</div>
              <ul className="space-y-1.5 text-zinc-300">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" /><span>{t('prem.freeQ')}</span></li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" /><span>{t('prem.everywhere')}</span></li>
              </ul>
            </div>
            <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-3.5">
              <div className="flex items-center justify-between mb-2"><span className="font-semibold text-white flex items-center gap-1.5"><GlainIcon size={14} /> {t('prem.premiumPlan')}</span></div>
              <div className="text-[var(--accent-color)] font-bold mb-2">$4.99<span className="text-zinc-400 font-normal">{t('pay.perMonth')}</span></div>
              <ul className="space-y-1.5 text-zinc-200">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--accent-color)]" /><span>{t('prem.premiumQ')}</span></li>
                {extra(t('prem.markers'))}
                {extra(t('prem.voices'))}
              </ul>
            </div>
          </div>
        )}

        {errorMsg && <div role="alert" className="bg-red-500/10 border border-red-500/40 text-red-300 text-[13px] p-3 rounded-lg mb-3">{errorMsg}</div>}
        {opened && isDesktop && <div className="text-[12.5px] text-zinc-300 mb-3 text-center">{isPremium ? t('prem.portalOpened') : t('prem.checkoutOpened')}</div>}

        {isPremium ? (
          premiumSource === 'stripe' && (
            <button onClick={() => void go(openBillingPortal)} disabled={loading} className="w-full flex items-center justify-center gap-2 border border-[var(--accent-border)] text-white font-semibold py-3 px-6 rounded-xl hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50 cursor-pointer">
              <CreditCard className="w-5 h-5" /> {loading ? t('pay.connecting') : t('prem.manage')}
            </button>
          )
        ) : (
          <>
            <button onClick={subscribe} disabled={loading} className="w-full flex items-center justify-center gap-2 bg-[var(--accent-color)] text-black font-bold py-3 px-6 rounded-xl hover:brightness-110 transition disabled:opacity-50 cursor-pointer">
              <CreditCard className="w-5 h-5" />
              {loading ? t('pay.connecting') : isGuest ? t('prem.signInToSubscribe') : t('prem.subscribe')}
            </button>
            <p className="mt-3 text-[11.5px] text-zinc-500 text-center">{isGuest ? t('prem.guestNote') : t('prem.cancelNote')}</p>
          </>
        )}
      </div>
    </div>
  );
};
