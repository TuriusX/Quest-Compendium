import React, { useEffect, useRef, useState } from 'react';
import { isSignInWithEmailLink, signInWithEmailLink, signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { MagicalBookIcon } from './MagicalBookIcon';
import { useT } from '../i18n';
import { EMAIL_FOR_SIGNIN } from '../utils/emailSignIn';

/**
 * Where the email's sign-in link lands (/email-signin). It signs this browser in with the link, then:
 * - with a device code (?code=, the desktop app or the Steam Deck): "Sign in the device showing this code?" On Yes the
 *   code is approved (/api/device/approve) and the device signs itself in. On No nothing is signed in anywhere.
 * - without one (the web app): straight into the app.
 * Opened in a different browser than the one that asked, it asks for the address again (Firebase's rule).
 */
export function EmailSignInPage() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  const [state, setState] = useState<'working' | 'askEmail' | 'confirm' | 'approving' | 'done' | 'declined' | 'invalid'>('working');
  const [email, setEmail] = useState(() => { try { return localStorage.getItem(EMAIL_FOR_SIGNIN) || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const hadUser = useRef<string | null>(null);
  const started = useRef(false);

  const finish = async (address: string) => {
    setState('working');
    setError('');
    try {
      const cred = await signInWithEmailLink(auth, address.trim(), window.location.href);
      try { localStorage.removeItem(EMAIL_FOR_SIGNIN); } catch { /* fine */ }
      // The address already on another account (shouldn't happen: one account per address): use that one.
      try {
        const r = await fetch('/api/email-link/check', { method: 'POST', headers: { Authorization: `Bearer ${await cred.user.getIdToken()}` } });
        const b: any = await r.json().catch(() => ({}));
        if (b.customToken) await signInWithCustomToken(auth, b.customToken);
      } catch { /* the account it signed in to */ }
      if (code) { setState('confirm'); return; }
      try { localStorage.removeItem('quest_guest_session'); } catch { /* fine */ }
      window.location.replace('/');
    } catch (e: any) {
      const c = String(e?.code || '');
      if (c === 'auth/invalid-email' || c === 'auth/missing-email') {
        setError(t('email.page.wrongEmail'));
        setState('askEmail');
      } else {
        setState('invalid');
      }
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      await auth.authStateReady().catch(() => {});
      hadUser.current = auth.currentUser?.uid || null;
      if (!isSignInWithEmailLink(auth, window.location.href)) { setState('invalid'); return; }
      if (!email) { setState('askEmail'); return; }
      await finish(email);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Leaves this browser as it was (signed out, unless someone was already signed in here). */
  const tidy = async () => {
    if (!hadUser.current) await signOut(auth).catch(() => {});
  };

  const approve = async () => {
    setState('approving');
    try {
      const token = await auth.currentUser!.getIdToken();
      const r = await fetch('/api/device/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userCode: code }) });
      if (r.ok) { await tidy(); setState('done'); return; }
      setError(r.status === 404 ? t('email.page.codeExpired') : r.status === 409 ? t('email.page.codeUsed') : t('email.page.failed'));
      setState('confirm');
    } catch {
      setError(t('email.page.failed'));
      setState('confirm');
    }
  };

  const decline = async () => {
    await tidy();
    setState('declined');
  };

  const btn = 'w-full py-3 px-6 rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-50';
  return (
    <div className="min-h-screen w-full bg-[#0c0d14] text-white flex items-center justify-center p-6">
      <main className="w-full max-w-sm text-center">
        <MagicalBookIcon className="w-14 h-14 mx-auto mb-5 rounded-2xl" />
        <h1 className="font-fantasy font-bold text-xl tracking-wide mb-3">QUEST COMPENDIUM</h1>

        {state === 'working' && <p className="text-zinc-400 text-sm">{t('email.page.signingIn')}</p>}

        {state === 'askEmail' && (
          <form onSubmit={(e) => { e.preventDefault(); void finish(email); }} className="text-left">
            <p className="text-zinc-300 text-sm mb-3">{t('email.page.confirmEmail')}</p>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email.placeholder')} aria-label={t('email.label')}
              className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/15 text-white focus:outline-none focus:border-[var(--accent-border)]" />
            {error && <p role="alert" className="mt-2 text-[13px] text-amber-300">{error}</p>}
            <button type="submit" className={`${btn} mt-3 bg-[var(--accent-color)] text-black`}>{t('email.page.continue')}</button>
          </form>
        )}

        {(state === 'confirm' || state === 'approving') && (
          <div>
            <p className="text-zinc-300 text-sm">{t('email.page.confirmDevice')}</p>
            <p className="my-4 font-mono text-3xl tracking-[0.25em]">{code}</p>
            <p className="text-zinc-500 text-[12.5px] mb-4">{t('email.page.onlyIf')}</p>
            {error && <p role="alert" className="mb-3 text-[13px] text-amber-300">{error}</p>}
            <button onClick={() => void approve()} disabled={state === 'approving'} className={`${btn} bg-[var(--accent-color)] text-black`}>{t('email.page.yes')}</button>
            <button onClick={() => void decline()} disabled={state === 'approving'} className={`${btn} mt-2 border border-white/15 text-zinc-200 hover:bg-white/10`}>{t('email.page.no')}</button>
          </div>
        )}

        {state === 'done' && <p className="text-green-400 text-sm">{t('email.page.done')}</p>}
        {state === 'declined' && <p className="text-zinc-300 text-sm">{t('email.page.declined')}</p>}
        {state === 'invalid' && (
          <div>
            <p className="text-zinc-300 text-sm mb-4">{t('email.page.invalid')}</p>
            <a href="/" className="text-[var(--accent-color)] text-sm hover:underline">{t('email.page.open')}</a>
          </div>
        )}
      </main>
    </div>
  );
}
