import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { questionsLeft, type Balances } from '../utils/answerModel';
import { RefillInfo } from './QuestionsPill';

/**
 * Questions left today (owner, Nov 22 2026): one number, no bars and no kinds of answer. The server answers with its
 * question model while those last and its faster one after, without telling anyone (the answer's grey line still
 * names the model). A click opens a card with the reset time.
 *
 * Since the one-bar header (owner, Nov 24 2026, overlay audit) it's also the one way into an account: "3 left" in the
 * top bar ("3 left · Sign in" for a guest, in place of the separate Sign in button, which the top bar hides while this
 * shows), and its card has Sign in (guests) and Subscribe (everyone not on Premium; Subscribe was in the line under the
 * top bar from Nov 15 2026 until that line went).
 */
export function AnswerMeter({ balances, quota, guest = false, onSignIn }: { balances: Balances; quota?: any; guest?: boolean; onSignIn?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const known = Number(quota?.resetAt) > 0 || balances.dailyPro > 0 || balances.dailyFast > 0;
  const n = questionsLeft(balances);
  const none = n === 0;
  useEffect(() => {
    if (open) setTimeout(() => card.current?.focus({ preventScroll: true }), 0);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const label = none ? t('ask.pillNone') : n === 1 ? t('ask.pillLeftOne') : t('ask.pillLeft', { n });
  // The top bar shows the short form ("3 left"); the full sentence is the tooltip.
  const short = t('ask.pillShort', { n });
  const premium = !!quota?.isPremium;
  const signIn = guest && !!onSignIn;
  if (!known) return null;
  return (
    <div className="relative" data-qc-meter="" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={signIn ? `${label} · ${t('signin.header')}` : label}
        title={signIn ? `${label} · ${t('signin.headerTitle')}` : label}
        className={`qc-px-frame h-8 px-2 rounded-lg border flex items-center gap-1.5 text-[12px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-colors ${
          open ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : none ? 'bg-black/30 border-amber-400/30 text-amber-200 hover:border-amber-300/60' : signIn ? 'bg-black/30 border-[var(--accent-border)] text-zinc-100 hover:bg-[var(--accent-dim)]' : 'bg-black/30 border-white/10 text-zinc-100 hover:border-[var(--accent-border)]'
        }`}
      >
        <span className="tabular-nums">{short}</span>
        {signIn && (
          <>
            <span className="text-zinc-500" aria-hidden="true">·</span>
            <span className="text-[var(--accent-color)]">{t('signin.header')}</span>
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={card}
            tabIndex={-1}
            role="dialog"
            aria-label={t('ask.cardTitle')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}
            className="absolute right-0 top-10 z-50 w-64 max-w-[calc(100vw-24px)] py-2 rounded-xl bg-[#161620] border border-white/15 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{t('ask.cardTitle')}</div>
            <div className="px-3 flex items-baseline gap-2 text-[12.5px] leading-snug">
              <span className="text-zinc-200 font-semibold">{t('ask.cardLeftLabel')}</span>
              <span className="ml-auto tabular-nums text-[var(--accent-color)] font-semibold">{n}</span>
            </div>
            <div className="h-px bg-white/[0.08] mt-2 mx-2" />
            <RefillInfo userData={quota} />
            {(signIn || !premium) && (
              <div className="px-3 pt-2 flex flex-col gap-1.5">
                {signIn && (
                  <button
                    type="button"
                    data-qc-signin-card
                    onClick={() => { setOpen(false); onSignIn!(); }}
                    title={t('signin.headerTitle')}
                    className="w-full h-8 rounded-lg bg-[var(--accent-color)] text-black text-[12.5px] font-bold hover:brightness-110 cursor-pointer flex items-center justify-center shadow-[0_0_10px_var(--accent-dim)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  >
                    {t('signin.header')}
                  </button>
                )}
                {!premium && (
                  <button
                    type="button"
                    data-qc-subscribe
                    onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('qc-open-premium')); }}
                    title={t('prem.headerTitle')}
                    className={`w-full h-8 rounded-lg text-[12.5px] font-bold cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                      signIn ? 'border border-[var(--accent-border)] text-[var(--accent-color)] hover:bg-[var(--accent-dim)]' : 'bg-[var(--accent-color)] text-black hover:brightness-110 shadow-[0_0_10px_var(--accent-dim)]'
                    }`}
                  >
                    <span aria-hidden="true">✦</span>{t('prem.header')}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
