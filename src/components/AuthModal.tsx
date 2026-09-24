import React, { useEffect, useState } from 'react';
import { Sparkles, Play, AlertCircle, ExternalLink, X } from './icons';
import { MagicalBookIcon } from './MagicalBookIcon';
import { signInWithGoogle, signInWithGoogleRedirect, auth } from '../lib/firebase';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { DEFAULT_PREVIEW_URL } from '../utils/api';
import { useT } from '../i18n';

interface AuthModalProps {
  onSignInSuccess: () => void;
  initialMessage?: string | null;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSignInSuccess, initialMessage, onClose }) => {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialMessage || null);
  const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;

  useEffect(() => {
    if (initialMessage) {
      setErrorMessage(initialMessage);
    }
  }, [initialMessage]);

  useEffect(() => {
    // Listen for external auth success if running in Electron
    if ((window as any).electronAPI?.onDesktopAuthSuccess) {
      (window as any).electronAPI.onDesktopAuthSuccess(async (payload: any) => {
        try {
          const idToken = typeof payload === 'string' ? payload : (payload?.googleIdToken || payload?.idToken);
          const accessToken = typeof payload === 'object' ? payload?.googleAccessToken : undefined;
          let credential = null;
          if (idToken) {
            credential = GoogleAuthProvider.credential(idToken);
          } else if (accessToken) {
            credential = GoogleAuthProvider.credential(null, accessToken);
          }
          if (credential) {
            await signInWithCredential(auth, credential);
          }
          if (typeof window !== 'undefined') {
            localStorage.removeItem('quest_guest_session');
            window.dispatchEvent(new Event('quest_auth_change'));
          }
          onSignInSuccess();
        } catch (error) {
          console.error('Failed to sign in with external token:', error);
          setLoading(false);
        }
      });
    }
  }, [onSignInSuccess]);

  const handleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('quest_guest_session');
        window.dispatchEvent(new Event('quest_auth_change'));
      }
      if ((window as any).electronAPI?.startDesktopLogin) {
        // We are in Electron, open system browser for OAuth
        (window as any).electronAPI.startDesktopLogin();
      } else {
        // Standard web flow
        await signInWithGoogle();
        onSignInSuccess();
      }
    } catch (error: any) {
      console.error('Sign in failed:', error);
      const errCode = error?.code || '';
      const errMsg = error?.message || '';

      if (errCode === 'auth/popup-blocked') {
        setErrorMessage(t('auth.err.popupBlocked'));
      } else if (errCode === 'auth/unauthorized-domain') {
        setErrorMessage('Domain not authorized in Firebase Console > Authentication > Settings > Authorized domains. You can continue as Guest or use the redirect option.');
      } else if (errCode === 'auth/popup-closed-by-user') {
        setErrorMessage(t('auth.err.closed'));
      } else if (errCode === 'auth/network-request-failed') {
        setErrorMessage(t('auth.err.network'));
      } else if (errCode === 'auth/argument-error') {
        setErrorMessage(t('auth.err.argument'));
      } else {
        setErrorMessage(
          errMsg
            ? `Sign-in error: ${errMsg}`
            : t('auth.err.generic')
        );
      }
      setLoading(false);
    }
  };

  const handleContinueAsGuest = async () => {
    try {
      await auth.signOut();
    } catch (e) {}
    if (typeof window !== 'undefined') {
      const guestId = 'guest_' + Math.random().toString(36).substring(2, 12);
      localStorage.setItem('quest_guest_session', guestId);
      window.dispatchEvent(new Event('quest_auth_change'));
    }
    onSignInSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_0_40px_var(--accent-glow)] overflow-hidden flex flex-col items-center p-8 text-center">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        )}
        <MagicalBookIcon className="w-16 h-16 mb-6 shadow-[0_0_30px_rgba(171,119,250,0.3)] rounded-2xl" />
        <h2 className="font-fantasy font-bold text-2xl text-white mb-2 tracking-wide">
          QUEST COMPENDIUM
        </h2>
        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
          {t('auth.tagline')}
        </p>

        {errorMessage && (
          <div className="w-full mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-start gap-2 text-left">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Primary Action on Itch.io / Embedded: Continue as Guest */}
        {isEmbedded && (
          <button
            onClick={handleContinueAsGuest}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold py-3.5 px-6 rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:shadow-[0_0_25px_rgba(147,51,234,0.5)] transition-all transform active:scale-[0.98] mb-3"
          >
            <Play className="w-4 h-4 fill-white" />
            {t('auth.guestPrimary')}
          </button>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-3 font-semibold py-3 px-6 rounded-xl transition-all disabled:opacity-50 ${
            isEmbedded
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-sm'
              : 'bg-white text-black hover:bg-zinc-200'
          }`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {loading ? t('auth.authenticating') : t('auth.google')}
        </button>

        {errorMessage && !isEmbedded && !(window as any).electronAPI?.startDesktopLogin && (
          <button
            onClick={async () => {
              try {
                setLoading(true);
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('quest_guest_session');
                }
                await signInWithGoogleRedirect();
              } catch (e: any) {
                setErrorMessage(e?.message || t('auth.redirectFailed'));
                setLoading(false);
              }
            }}
            disabled={loading}
            className="w-full mt-2.5 py-2 px-4 rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-xs text-zinc-300 border border-zinc-700/60 transition-colors"
          >
            {t('auth.redirect')}
          </button>
        )}

        {!isEmbedded && (
          <button
            onClick={handleContinueAsGuest}
            className="w-full mt-3 py-2.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t('auth.guest')}
          </button>
        )}
        
        {isEmbedded && (
          <div className="mt-6 pt-5 border-t border-white/10 flex flex-col items-center w-full">
            <p className="text-xs text-zinc-400 mb-3 px-2">
              {t('auth.itch')}
            </p>
            <a
              href={DEFAULT_PREVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-purple-300 hover:text-white transition-colors bg-purple-950/40 hover:bg-purple-900/60 px-4 py-2 rounded-lg border border-purple-500/30 flex items-center gap-1.5"
            >
              {t('auth.openWeb')}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
