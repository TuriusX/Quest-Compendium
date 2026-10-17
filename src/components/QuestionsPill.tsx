import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { balancesOf, topUp, resetParts } from '../utils/answerModel';

/** Re-renders every second while the page is visible (the countdown), on the second. */
function useSecond(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined;
    let first: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      setNow(Date.now());
      first = setTimeout(() => {
        setNow(Date.now());
        iv = setInterval(() => setNow(Date.now()), 1000);
      }, 1000 - (Date.now() % 1000));
    };
    const stop = () => {
      if (first) clearTimeout(first);
      if (iv) clearInterval(iv);
      first = iv = undefined;
    };
    const onVis = () => (document.hidden ? stop() : (stop(), start()));
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return now;
}

/** "5:26:41" until the reset (minutes and seconds padded). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * The questions left today and the time to the next top-up, in the header (and the compact view): "Pro 1 · Fast 3 ·
 * ⏱ 5:26:41", ticking every second, amber when both are used up. Click it for each model's count, a large countdown,
 * what the next top-up brings, and Premium.
 */
export function QuestionsPill({ userData, onOpenPaywall, small, onPress }: { userData?: any; onOpenPaywall?: () => void; small?: boolean; /** Instead of the popover (the compact view: no room for it, so it opens the full view). */ onPress?: () => void }) {
  const t = useT();
  const now = useSecond();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setTimeout(() => popRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 0);
  }, [open]);
  // Nothing until the server has said (the app's placeholder before it answers isn't a real balance).
  if (!userData || !(Number(userData.resetAt) > 0)) return null;
  const b = balancesOf(userData);
  const out = b.pro + b.fast === 0;
  const left = b.resetAt ? clock(b.resetAt - now) : '';
  const u = topUp(b, now);
  const refill = u && u.reset
    ? t('pill.reset', { parts: resetParts(u, t) })
    : u
    ? t('pill.refill', { parts: [
        u.proMax ? t('topup.max', { model: t('model.pro'), n: u.cap }) : u.pro > 0 ? t('topup.add', { model: t('model.pro'), n: u.pro }) : '',
        u.fastMax ? t('topup.max', { model: t('model.fast'), n: u.cap }) : u.fast > 0 ? t('topup.add', { model: t('model.fast'), n: u.fast }) : '',
      ].filter(Boolean).join(' · ') })
    : '';
  const row = (label: string, n: number, daily: number) => {
    const of = b.rollover && b.bankCap ? b.bankCap : daily;
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-zinc-300">{label}</span>
          <span className="flex-1" />
          <b className="text-white tabular-nums">{n}</b>
          {of > 0 && <span className="text-zinc-500 tabular-nums">{t('pill.of', { n: of })}</span>}
        </div>
        <div className="h-1.5 mt-1 mb-2 rounded-full bg-white/[0.08] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--accent-color)]" style={{ width: `${of > 0 ? Math.min(100, (n / of) * 100) : 0}%` }} />
        </div>
      </div>
    );
  };
  const title = [t('model.proHint', { n: b.pro }), t('model.fastHint', { n: b.fast }), left && t('pill.nextIn', { time: left })].filter(Boolean).join('\n');
  return (
    <div className="relative flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (onPress ? onPress() : setOpen((v) => !v))}
        aria-haspopup={onPress ? undefined : 'dialog'}
        aria-expanded={onPress ? undefined : open}
        title={title}
        className={`qc-pill flex items-center gap-1.5 rounded-full border whitespace-nowrap font-semibold tabular-nums cursor-pointer transition-colors ${
          small ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[11.5px]'
        } ${
          out
            ? 'bg-amber-500/15 border-amber-500/45 text-amber-100 hover:bg-amber-500/25'
            : 'bg-white/[0.04] border-white/[0.12] text-zinc-200 hover:border-[var(--accent-border)] hover:bg-white/[0.07]'
        }`}
      >
        <span>{t('model.pro')} {b.pro}</span>
        <span className="text-zinc-500">·</span>
        <span>{t('model.fast')} {b.fast}</span>
        {left && (
          <>
            <span className="text-zinc-500">·</span>
            <span className={out ? 'text-amber-300' : 'text-[var(--accent-color)]'}>
              <span aria-hidden="true">⏱ </span>
              {left}
            </span>
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={popRef}
            role="dialog"
            aria-label={t('pill.title')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                btnRef.current?.focus();
              }
            }}
            className="absolute right-0 top-9 z-50 w-72 p-3.5 rounded-xl bg-[#151622] border border-[var(--accent-border)] shadow-2xl text-[12.5px] animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="font-bold text-white mb-2">{t('pill.title')}</div>
            {row(t('model.pro'), b.pro, b.dailyPro)}
            {row(t('model.fast'), b.fast, b.dailyFast)}
            {left && (
              <>
                <div className="text-[11.5px] text-zinc-500">{t('pill.nextLabel')}</div>
                <div className={`text-[22px] font-bold tabular-nums leading-tight ${out ? 'text-amber-300' : 'text-[var(--accent-color)]'}`}>{left}</div>
              </>
            )}
            {refill && <div className="text-[11.5px] text-zinc-400 mt-0.5">{refill}</div>}
            <div className="text-[11.5px] text-zinc-500 mt-1">{t('pill.pick')}</div>
            {b.rollover ? (
              <div className="mt-2.5 text-[11.5px] text-zinc-300">{t('pill.carryOver', { n: b.bankCap || 0 })}</div>
            ) : (
              onOpenPaywall && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenPaywall();
                  }}
                  className="mt-2.5 w-full text-left px-2.5 py-2 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-white text-[12px] font-semibold hover:brightness-125 cursor-pointer"
                >
                  {t('pill.premium')}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
