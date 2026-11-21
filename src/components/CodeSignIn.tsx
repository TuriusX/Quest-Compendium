import React, { useEffect, useRef, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useT } from '../i18n';
import { startDeviceCode, waitForDevice, type DeviceCode } from '../utils/emailSignIn';
import { saveGuestHandover } from '../utils/guestHandover';
import { LINK_ADDRESS } from '../utils/companion';

/**
 * Sign-in with a code (the companion app, owner Nov 20 2026): Game Mode has no browser for Google's sign-in, so the
 * screen shows a short code to type at questcompendium.com/link on a phone or PC (the Steam Deck plugin's way,
 * deviceAuth.ts). It signs in here by itself once the code is confirmed; a code that ran out is replaced with one tap.
 */
export const CodeSignIn: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  const t = useT();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'expired' | 'failed'>('loading');
  const stop = useRef<(() => void) | null>(null);

  const begin = async () => {
    stop.current?.();
    setState('loading');
    const device = await startDeviceCode();
    if (!device) { setState('failed'); return; }
    setCode(device);
    setState('ready');
    stop.current = waitForDevice(device, async (customToken) => {
      if (!customToken) { setState('expired'); return; }
      try {
        // A guest keeps their conversations and progress (merged into the account when it loads).
        saveGuestHandover();
        await signInWithCustomToken(auth, customToken);
        try { localStorage.removeItem('quest_guest_session'); } catch { /* fine */ }
        window.dispatchEvent(new Event('quest_auth_change'));
        onSignedIn();
      } catch {
        setState('failed');
      }
    });
  };
  useEffect(() => {
    void begin();
    return () => stop.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-qc-code-signin="" className="w-full rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)]/40 p-4 text-left">
      <div className="text-sm font-bold text-white">{t('companion.codeTitle')}</div>
      <ol className="mt-2 space-y-1.5 text-[13px] leading-snug text-zinc-300 list-decimal list-inside">
        <li>{t('companion.codeStep1')} <span className="font-mono font-bold text-white">{LINK_ADDRESS}</span></li>
        <li>{t('companion.codeStep2')}</li>
      </ol>
      <div className="mt-3 flex items-center justify-center h-14 rounded-lg bg-black/40 border border-white/10" role="status" aria-live="polite">
        {state === 'ready' && code ? (
          <span className="font-mono font-extrabold text-[26px] tracking-[0.18em] text-[var(--accent-color)]">{code.userCode}</span>
        ) : state === 'loading' ? (
          <span className="text-[13px] text-zinc-400">{t('companion.codeLoading')}</span>
        ) : (
          <span className="text-[13px] text-amber-300">{t(state === 'expired' ? 'companion.codeExpired' : 'companion.codeFailed')}</span>
        )}
      </div>
      {state === 'ready' ? (
        <p className="mt-2 text-[11.5px] text-zinc-500">{t('companion.codeWaiting')}</p>
      ) : state !== 'loading' ? (
        <button type="button" onClick={() => void begin()} className="mt-2 w-full py-2 rounded-lg bg-[var(--accent-color)] text-black text-[13px] font-bold hover:brightness-110 outline-none focus-visible:ring-2 focus-visible:ring-white">
          {t('companion.codeAgain')}
        </button>
      ) : null}
    </div>
  );
};
