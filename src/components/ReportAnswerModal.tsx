import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, Loader2, Check, X } from './icons';
import { useT } from '../i18n';
import { auth } from '../lib/firebase';
import { getApiBaseUrl } from '../utils/api';

export type ReportReason = 'harmful' | 'wrong' | 'other';

/** What the report is about: the answer, the question before it, and where the player was. */
export type ReportTarget = { messageId: string; answer: string; question?: string; game?: string; place?: string; model?: string };

const BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { version: 'dev' };

/** Send a report on an AI answer (POST /api/report-answer). Throws with the server's message when it isn't saved. */
export async function sendAnswerReport(target: ReportTarget, reason: ReportReason, comment: string): Promise<void> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
  const res = await fetch(`${getApiBaseUrl()}/api/report-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...target, reason, comment, appVersion: BUILD.version, client: (window as any).electronAPI ? 'desktop' : 'web' }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText);
}

/**
 * "Report this answer": a reason (offensive or harmful / wrong or misleading / other), an optional comment, Send.
 * onSent gets the reason (an offensive or harmful answer is collapsed for the player).
 */
export const ReportAnswerModal: React.FC<{ target: ReportTarget | null; onClose: () => void; onSent: (reason: ReportReason) => void }> = ({ target, onClose, onSent }) => {
  const t = useT();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setReason(null);
    setComment('');
    setState('idle');
    setError('');
  }, [target?.messageId]);

  if (!target) return null;

  const send = async () => {
    if (!reason || state !== 'idle') return;
    setState('sending');
    setError('');
    try {
      await sendAnswerReport(target, reason, comment.trim());
      setState('sent');
      onSent(reason);
      setTimeout(onClose, 1600);
    } catch (e: any) {
      setState('idle');
      setError(e?.message || t('report.failed'));
    }
  };

  const reasons: { id: ReportReason; label: string }[] = [
    { id: 'harmful', label: t('report.harmful') },
    { id: 'wrong', label: t('report.wrong') },
    { id: 'other', label: t('report.other') },
  ];

  // In a portal: an ancestor's transform or backdrop filter would otherwise pin the dialog to the chat column.
  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qc-report-title"
    >
      <div
        className="bg-[#13131b] border border-white/15 rounded-2xl p-5 w-full max-w-[380px] shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-rose-300" aria-hidden="true" />
          <h2 id="qc-report-title" className="flex-1 font-semibold text-white text-sm">{t('report.title')}</h2>
          <button onClick={onClose} aria-label={t('report.cancel')} className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {state === 'sent' ? (
          <div className="flex items-center gap-2 py-4 text-sm text-emerald-300" role="status">
            <Check className="w-4 h-4" /> {t('report.thanks')}
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs text-zinc-400 mb-1">{t('report.reason')}</legend>
              {reasons.map((r) => (
                <label
                  key={r.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${reason === r.id ? 'border-[var(--accent-color)] bg-[var(--accent-dim)] text-white' : 'border-white/10 text-zinc-300 hover:bg-white/5'}`}
                >
                  <input type="radio" name="qc-report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-[var(--accent-color)]" />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t('report.comment')}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder={t('report.commentPlaceholder')}
                className="bg-black/50 border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:border-[var(--accent-color)] resize-none"
                onFocus={() => (window as any).electronAPI?.forceFocus?.()}
              />
            </label>
            {error && <div className="text-xs text-rose-300" role="alert">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-300 hover:bg-white/10 cursor-pointer">{t('report.cancel')}</button>
              <button
                onClick={send}
                disabled={!reason || state === 'sending'}
                className="px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-[var(--accent-color)] text-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
              >
                {state === 'sending' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t('report.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
