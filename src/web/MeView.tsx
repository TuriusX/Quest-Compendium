/**
 * Me: the account, questions left today, Premium, how answers come (Thorough or Quick), the language, and the apps that
 * work right over a game (owner-approved redesign, Nov 25 2026: the old app's 7-item menu and 5-tab Settings dialog,
 * down to what matters on the web).
 */
import React, { useState } from 'react';
import { LogOut, Monitor, Gamepad2, Sparkles, Globe, Zap, Undo2 } from 'lucide-react';
import { LOCALES, type Locale } from '../i18n';
import { logOut, signInWithGoogle, signInWithGoogleRedirect } from '../lib/firebase';
import { forgetGuest, type Status, type Who } from './webApi';

export type AnswerStyle = 'pro' | 'flash';

const WINDOWS = 'https://github.com/TuriusX/Quest-Compendium/releases/latest/download/Quest-Compendium-Setup.exe';
const STORE = 'https://apps.microsoft.com/detail/9NN4DDKMD1X3';
const DECK = 'https://questcompendium.com/steam-deck/';

export function MeView({ who, status, style, onStyle, locale, onLocale, onPremium, onOldApp }: {
  who: Who;
  status: Status | null;
  style: AnswerStyle;
  onStyle: (s: AnswerStyle) => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
  onPremium: () => void;
  onOldApp: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signIn = async () => {
    setBusy(true);
    setErr('');
    try {
      await signInWithGoogle();
      forgetGuest();
    } catch (e: any) {
      if (/popup/i.test(String(e?.code || e?.message || ''))) await signInWithGoogleRedirect().catch(() => setErr('Sign-in didn’t open. Try again.'));
      else if (!/cancelled|closed/i.test(String(e?.code || ''))) setErr('Sign-in didn’t work. Try again.');
    }
    setBusy(false);
  };
  const pro = Number(status?.proQueriesAvailable ?? NaN);
  const fast = Number(status?.flashQueriesAvailable ?? NaN);
  const left = Number.isFinite(pro) && Number.isFinite(fast) ? pro + fast : null;
  const premium = status?.isPremium === true;

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="w-head" style={{ fontSize: 24, margin: '6px 0 0' }}>Me</h1>

      <section className="w-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        {who.user ? (
          <>
            <div style={row}>
              <div style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--w-acc-dim)', color: 'var(--w-acc)', display: 'grid', placeItems: 'center', fontWeight: 700, flex: 'none' }}>{(who.user.displayName || who.user.email || '?').charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.user.displayName || 'Signed in'}</div>
                <div style={{ fontSize: 13, color: 'var(--w-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.user.email}</div>
              </div>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--w-dim)' }}>Your games and playthroughs are kept on your account, the same as in the Windows app.</div>
            <button className="w-btn ghost" style={{ justifySelf: 'start' }} onClick={() => void logOut()}><LogOut size={16} /> Sign out</button>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700 }}>You're trying Quest Compendium as a guest</div>
            <div style={{ fontSize: 14, color: 'var(--w-dim)' }}>Sign in for more questions every day, and your games kept on all your devices, including the Windows app.</div>
            <button className="w-btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={signIn}>Continue with Google</button>
            {err && <div style={{ color: 'var(--w-bad)', fontSize: 13.5 }}>{err}</div>}
          </>
        )}
      </section>

      <section className="w-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div className="w-label">Today</div>
        <div style={{ fontSize: 15 }}>{left === null ? 'Questions left: checking…' : `${left} question${left === 1 ? '' : 's'} left today`}{premium ? ' · Premium' : ''}</div>
        {!premium && <button className="w-chip" style={{ justifySelf: 'start' }} onClick={onPremium}><Sparkles size={14} /> {who.user ? 'See Premium' : 'Premium: more questions'}</button>}
        {premium && <button className="w-chip" style={{ justifySelf: 'start' }} onClick={onPremium}><Sparkles size={14} /> Your plan</button>}
      </section>

      <section className="w-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="w-label">Answers</div>
        <div role="radiogroup" aria-label="How answers come" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([['pro', 'Thorough', 'Checks sources. Up to half a minute.'], ['flash', 'Quick', 'A few seconds. Less checking.']] as const).map(([id, name, line]) => (
            <button key={id} role="radio" aria-checked={style === id} onClick={() => onStyle(id)}
              style={{ textAlign: 'left', padding: 12, borderRadius: 12, cursor: 'pointer', background: style === id ? 'var(--w-acc-dim)' : 'transparent', border: `1px solid ${style === id ? 'var(--w-acc-line)' : 'var(--w-line)'}`, color: 'var(--w-ink)' }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{id === 'flash' ? <Zap size={14} /> : <Sparkles size={14} />}{name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--w-dim)', marginTop: 2 }}>{line}</div>
            </button>
          ))}
        </div>
        <label style={{ ...row, fontSize: 15 }}>
          <Globe size={16} style={{ color: 'var(--w-dim)' }} />
          <span style={{ flex: 1 }}>Language</span>
          <select id="qcw-language" value={locale} onChange={(e) => onLocale(e.target.value as Locale)}
            style={{ background: 'var(--w-panel-2)', color: 'var(--w-ink)', border: '1px solid var(--w-line)', borderRadius: 10, padding: '7px 10px', font: 'inherit', fontSize: 14 }}>
            {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
      </section>

      <section className="w-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div className="w-label">Right over your game</div>
        <div style={{ fontSize: 14, color: 'var(--w-dim)' }}>The Windows app sits on top of your game: press a key to ask about what's on screen, and the answer pops up without leaving it. On Steam Deck it lives in the Quick Access menu.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a className="w-chip" style={{ textDecoration: 'none' }} href={WINDOWS} target="_blank" rel="noopener noreferrer"><Monitor size={14} /> Download for Windows</a>
          <a className="w-chip" style={{ textDecoration: 'none' }} href={STORE} target="_blank" rel="noopener noreferrer">Microsoft Store</a>
          <a className="w-chip" style={{ textDecoration: 'none' }} href={DECK} target="_blank" rel="noopener noreferrer"><Gamepad2 size={14} /> Steam Deck</a>
        </div>
      </section>

      <button className="w-chip" style={{ justifySelf: 'start', color: 'var(--w-dim)' }} onClick={onOldApp}><Undo2 size={14} /> Use the old web app</button>
    </div>
  );
}
