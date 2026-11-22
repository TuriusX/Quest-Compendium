import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Balances } from '../utils/answerModel';
import { RefillInfo } from './QuestionsPill';

/**
 * One ask button (owner, Nov 21 2026): no Pro / Fast choice. Every question gets a best answer while the day's best
 * answers last, then quick ones until the daily reset; this meter (in the Pro / Fast switch's old place) shows how many
 * best answers are left. A click opens a card that explains it, with the reset time.
 */
export function AnswerMeter({ balances, quota }: { balances: Balances; quota?: any }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const { pro, fast, dailyPro } = balances;
  const known = Number(quota?.resetAt) > 0 || dailyPro > 0;
  const total = Math.max(dailyPro, pro);
  const segs = Math.min(10, total);
  const filled = total ? Math.round((Math.min(pro, total) / total) * segs) : 0;
  const reset = balances.resetAt ? new Date(balances.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const quick = pro === 0;
  useEffect(() => {
    if (open) setTimeout(() => card.current?.focus({ preventScroll: true }), 0);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const label = quick ? t('ask.meterQuick', { time: reset || '—' }) : t('ask.meterBest', { n: pro, d: total });
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
        className={`qc-px-frame h-8 px-2.5 rounded-lg border flex items-center gap-2 text-[12px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-colors ${
          open ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : quick ? 'bg-black/30 border-amber-400/30 text-amber-200 hover:border-amber-300/60' : 'bg-black/30 border-white/10 text-zinc-100 hover:border-[var(--accent-border)]'
        }`}
      >
        {quick ? (
          <>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></svg>
            <span>{t('ask.pillQuick', { time: reset || '—' })}</span>
          </>
        ) : (
          <>
            <span className="flex gap-[2px]" aria-hidden="true">
              {Array.from({ length: segs }, (_, i) => (
                <span key={i} className={`w-[4px] h-[13px] rounded-[2px] ${i < filled ? 'bg-[var(--accent-color)]' : 'bg-white/15'}`} />
              ))}
            </span>
            <span className="tabular-nums">{t('ask.pillBest', { n: pro })}</span>
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
            className="absolute right-0 top-10 z-50 w-72 max-w-[calc(100vw-24px)] py-2 rounded-xl bg-[#161620] border border-white/15 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{t('ask.cardTitle')}</div>
            <div className="px-3 flex flex-col gap-1.5 text-[12.5px] leading-snug">
              <div className="flex items-baseline gap-2"><span className="text-zinc-200 font-semibold">{t('ask.bestMany')}</span><span className="ml-auto tabular-nums text-[var(--accent-color)] font-semibold">{t('ask.cardLeft', { n: pro, d: total })}</span></div>
              <div className="flex items-baseline gap-2"><span className="text-zinc-200 font-semibold">{t('ask.quickMany')}</span><span className="ml-auto tabular-nums text-zinc-300 font-semibold">{t('model.left', { n: fast })}</span></div>
              <p className="text-[11.5px] text-zinc-400">{t('ask.cardWhat')}</p>
            </div>
            <div className="h-px bg-white/[0.08] mt-2 mx-2" />
            <RefillInfo userData={quota} />
          </div>
        </>
      )}
    </div>
  );
}
