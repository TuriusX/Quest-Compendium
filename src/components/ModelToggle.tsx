import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { topUpLine, type AnswerModel, type Balances } from '../utils/answerModel';
import { RefillInfo } from './QuestionsPill';

/** Re-renders every minute (the top-up countdown), on the minute. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setNow(Date.now());
      iv = setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(first);
      if (iv) clearInterval(iv);
    };
  }, []);
  return now;
}

/**
 * Pro / Fast in the top bar (owner, Nov 6 2026): a short pill with the model in use and its questions left ("Pro 2"). A click
 * opens a card with both, what each is for, how many are left, and when more come; picking one there switches. Left /
 * Right (and Up / Down) switch while the card has focus, Esc closes it; a controller's R3 switches too (ControllerLayer).
 */
export function ModelToggle({ value, onChange, pro, fast, disabled, balances, showCounts = false, quota }: { value: AnswerModel; onChange: (m: AnswerModel) => void; pro: number; fast: number; disabled?: boolean; balances?: Balances; showCounts?: boolean; quota?: any }) {
  const t = useT();
  const now = useMinute();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const next = balances ? topUpLine(balances, t, now) : '';
  const opts: { id: AnswerModel; label: string; left: number; desc: string }[] = [
    { id: 'pro', label: t('model.pro'), left: pro, desc: t('model.proDesc') },
    { id: 'fast', label: t('model.fast'), left: fast, desc: t('model.fastDesc') },
  ];
  const cur = opts.find((o) => o.id === value)!;
  useEffect(() => {
    if (open) setTimeout(() => card.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true }), 0);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      if (!disabled) onChange(value === 'pro' ? 'fast' : 'pro');
    }
  };
  const hint = [t(value === 'pro' ? 'model.proHint' : 'model.fastHint', { n: cur.left }), next].filter(Boolean).join('\n');
  return (
    <div className="relative" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('model.label')}: ${cur.label}${showCounts ? `, ${t('model.left', { n: cur.left })}` : ''}`}
        title={hint}
        className={`qc-px-frame h-8 pl-2.5 pr-1.5 rounded-lg border flex items-center gap-1.5 text-[12px] font-semibold leading-none whitespace-nowrap cursor-pointer transition-colors ${open ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : 'bg-black/30 border-white/10 text-zinc-100 hover:border-[var(--accent-border)]'}`}
      >
        <span>{cur.label}</span>
        {showCounts && <span className={`tabular-nums ${cur.left === 0 ? 'text-amber-300' : 'text-[var(--accent-color)]'}`}>{cur.left}</span>}
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={card} role="dialog" aria-label={t('model.label')} onKeyDown={onKey} className="absolute right-0 top-10 z-50 w-72 max-w-[calc(100vw-24px)] py-1.5 rounded-xl bg-[#161620] border border-white/15 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{t('pill.title')}</div>
            <div role="radiogroup" aria-label={t('model.label')}>
              {opts.map((o) => {
                const on = value === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    disabled={disabled}
                    onClick={() => { onChange(o.id); setOpen(false); }}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left outline-none cursor-pointer disabled:cursor-not-allowed hover:bg-white/[0.06] focus-visible:bg-white/[0.08] ${o.left === 0 ? 'opacity-60' : ''}`}
                  >
                    <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${on ? 'border-[var(--accent-color)]' : 'border-zinc-500'}`} aria-hidden="true">
                      {on && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)]" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className={`text-[13px] font-bold ${on ? 'text-white' : 'text-zinc-200'}`}>{o.label}</span>
                        {showCounts && <span className={`ml-auto text-[12px] font-semibold tabular-nums ${o.left === 0 ? 'text-amber-300' : 'text-[var(--accent-color)]'}`}>{t('model.left', { n: o.left })}</span>}
                      </span>
                      <span className="block text-[11.5px] text-zinc-400 leading-snug">{o.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="h-px bg-white/[0.08] mt-1 mx-2" />
            <RefillInfo userData={quota} />
          </div>
        </>
      )}
    </div>
  );
}
