import React, { useEffect, useRef, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Mail } from './icons';
import { useLocale, useT } from '../i18n';
import { saveGuestHandover } from '../utils/guestHandover';
import { sendEmailLink, startDeviceCode, waitForDevice, type DeviceCode } from '../utils/emailSignIn';

/**
 * "or" and an email field under Sign in with Google: Firebase emails a one-time sign-in link, no password.
 * Web: the link signs this browser in. Desktop app: the link asks to confirm the code shown here, and the app then
 * signs itself in (utils/emailSignIn.ts).
 */
export function EmailSignInForm({ onSignedIn, onBusy }: { onSignedIn: () => void; onBusy?: (busy: boolean) => void }) {
  const t = useT();
  const lang = useLocale();
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'expired'>('idle');
  const [error, setError] = useState('');
  const [code, setCode] = useState<DeviceCode | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  useEffect(() => { onBusy?.(state === 'sending'); }, [state, onBusy]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError(t('email.err.address')); return; }
    setError('');
    setState('sending');
    stop.current?.();
    let device: DeviceCode | null = null;
    if (isDesktop) {
      device = await startDeviceCode();
      if (!device) { setError(t('email.err.send')); setState('idle'); return; }
    }
    const r = await sendEmailLink(address, lang, device?.userCode);
    if (r !== 'ok') {
      setError(r === 'bad_email' ? t('email.err.address') : r === 'too_many' ? t('email.err.tooMany') : t('email.err.send'));
      setState('idle');
      return;
    }
    // A guest keeps their conversations and progress (merged into the account when it loads).
    saveGuestHandover();
    setCode(device);
    setState('sent');
    if (device) {
      stop.current = waitForDevice(device, async (customToken) => {
        if (!customToken) { setState('expired'); return; }
        try {
          await signInWithCustomToken(auth, customToken);
          try { localStorage.removeItem('quest_guest_session'); } catch { /* fine */ }
          window.dispatchEvent(new Event('quest_auth_change'));
          onSignedIn();
        } catch {
          setError(t('email.err.send'));
          setState('idle');
        }
      });
    }
  };

  if (state === 'sent' || state === 'expired') {
    return (
      <div className="w-full mt-4 rounded-xl border border-white/15 bg-white/[0.04] p-4 text-left text-[13px] text-zinc-300" role="status">
        <p className="font-semibold text-white flex items-center gap-2"><Mail className="w-4 h-4 text-[var(--accent-color)]" /> {t('email.checkTitle')}</p>
        <p className="mt-1.5">{t('email.sentTo', { email: email.trim() })}</p>
        {code ? (
          state === 'expired' ? (
            <p className="mt-2 text-amber-300">{t('email.expired')}</p>
          ) : (
            <>
              <p className="mt-2">{t('email.desktopHint')}</p>
              <p className="mt-2 text-center font-mono text-2xl tracking-[0.25em] text-white" aria-label={t('email.codeLabel')}>{code.userCode}</p>
              <p className="mt-2 text-[11.5px] text-zinc-500 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] animate-pulse" /> {t('email.waiting')}</p>
            </>
          )
        ) : (
          <p className="mt-2">{t('email.webHint')}</p>
        )}
        <p className="mt-2 text-[11.5px] text-zinc-500">{t('email.spam')}</p>
        <div className="mt-3 flex gap-3">
          <button type="button" onClick={() => void send()} className="text-[12px] text-[var(--accent-color)] hover:underline cursor-pointer">{t('email.resend')}</button>
          <button type="button" onClick={() => { stop.current?.(); setState('idle'); setCode(null); }} className="text-[12px] text-zinc-400 hover:text-white cursor-pointer">{t('email.other')}</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="w-full">
      <div className="flex items-center gap-3 my-4 text-[11px] uppercase tracking-wider text-zinc-500" aria-hidden="true">
        <span className="flex-1 h-px bg-white/10" />{t('email.or')}<span className="flex-1 h-px bg-white/10" />
      </div>
      <label className="sr-only" htmlFor="qc-email">{t('email.label')}</label>
      <input
        id="qc-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('email.placeholder')}
        className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[var(--accent-border)]"
      />
      {error && <p role="alert" className="mt-2 text-left text-[12px] text-amber-300">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="w-full mt-2.5 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/15 text-sm font-semibold text-zinc-100 transition-colors disabled:opacity-50 cursor-pointer"
      >
        <Mail className="w-4 h-4" />
        {state === 'sending' ? t('email.sending') : t('email.send')}
      </button>
      <p className="mt-2 text-[11px] text-zinc-500 leading-snug">{t('email.noPassword')}</p>
    </form>
  );
}
