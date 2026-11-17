import React, { useState } from 'react';
import { X } from './icons';
import { useT } from '../i18n';

/**
 * "Your trial ends tomorrow, then $4.99/month. Cancel any time in Settings → Account." (owner, Nov 2026: the monthly
 * free trial). Shown under the header in the trial's last day, until dismissed (once per trial, on this device).
 */
export const TrialEndsNote: React.FC<{ trialEnd?: number; onManage: () => void; now?: number }> = ({ trialEnd, onManage, now = Date.now() }) => {
  const t = useT();
  const key = `qc-trial-note-${trialEnd}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });
  if (!trialEnd || hidden || trialEnd <= now || trialEnd - now > 24 * 3_600_000) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(key, '1'); } catch { /* this session only */ }
  };
  return (
    <div role="status" className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-dim)] px-3 py-2 text-[12.5px] text-zinc-100">
      <span className="flex-1 min-w-0">{t('prem.trialEnds')}</span>
      <button type="button" onClick={onManage} className="shrink-0 rounded-md border border-white/15 px-2 py-1 font-semibold hover:bg-white/10 cursor-pointer">{t('prem.manage')}</button>
      <button type="button" onClick={dismiss} aria-label={t('visual.close')} className="shrink-0 rounded p-1 text-zinc-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
    </div>
  );
};
