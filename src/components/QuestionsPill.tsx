import { useEffect, useState } from 'react';
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
 * When the next questions come (ticking) and what the next top-up brings: the foot of the Pro / Fast card in the top bar
 * (owner, Nov 6 2026; it was the top of the ⋯ menu). Nothing until the server has said.
 */
export function RefillInfo({ userData }: { userData?: any }) {
  const t = useT();
  const now = useSecond();
  if (!userData || !(Number(userData.resetAt) > 0)) return null;
  const b = balancesOf(userData);
  const u = topUp(b, now);
  const refill = u && u.reset
    ? t('pill.reset', { parts: resetParts(u, t) })
    : u
    ? t('pill.refill', { parts: [
        u.proMax ? t('topup.max', { model: t('model.pro'), n: u.cap }) : u.pro > 0 ? t('topup.add', { model: t('model.pro'), n: u.pro }) : '',
        u.fastMax ? t('topup.max', { model: t('model.fast'), n: u.cap }) : u.fast > 0 ? t('topup.add', { model: t('model.fast'), n: u.fast }) : '',
      ].filter(Boolean).join(' · ') })
    : '';
  return (
    <div className="px-3 pt-2 pb-1 text-[12px] tabular-nums">
      {b.resetAt ? <div className="text-[var(--accent-color)] font-semibold">{t('pill.nextIn', { time: clock(b.resetAt - now) })}</div> : null}
      {refill && <div className="text-[11.5px] text-zinc-400 mt-0.5 leading-snug">{refill}</div>}
    </div>
  );
}

/** Above the question box when both are used up: when the next questions come, ticking. */
export function NextQuestionsLine({ resetAt }: { resetAt: number }) {
  const t = useT();
  const now = useSecond();
  return <div role="status" className="mb-2 text-center text-[12px] font-semibold tabular-nums text-amber-300">{t('pill.nextIn', { time: clock(resetAt - now) })}</div>;
}
