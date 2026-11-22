import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { questionsLeft, type Balances } from '../utils/answerModel';
import { RefillInfo } from './QuestionsPill';

/**
 * Questions left today (owner, Nov 22 2026): one number, no bars and no kinds of answer. The server answers with its
 * question model while those last and its faster one after, without telling anyone (the answer's grey line still
 * names the model). A click opens a card with the reset time.
 */
export function AnswerMeter({ balances, quota }: { balances: Balances; quota?: any }) {
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
  if (!known) return null;
  return (
    <div className="relative" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`qc-px-frame h-8 px-2.5 rounded-lg border flex items-center gap-1.5 text-[12px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-colors ${
          open ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : none ? 'bg-black/30 border-amber-400/30 text-amber-200 hover:border-amber-300/60' : 'bg-black/30 border-white/10 text-zinc-100 hover:border-[var(--accent-border)]'
        }`}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z" /></svg>
        <span className="tabular-nums">{label}</span>
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
          </div>
        </>
      )}
    </div>
  );
}
