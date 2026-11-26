import React, { useEffect, useState } from 'react';
import { X } from './icons';
import { useT } from '../i18n';
import { isPhone } from '../utils/source';

/**
 * The web app's "get it over your game" card (owner, Nov 25 2026: "the value is people trying the desktop and decky
 * apps. The web app is the least useful"). Under the web app's 2nd answer on this device, again at the 8th and 20th,
 * never after a download was picked or after it was closed twice. Phones get the link to copy for their PC instead of
 * downloads. Each showing, download click and close is counted (POST /api/get-app, stats/{day}.getApp).
 */
const COUNT = 'qc_web_answers';
const DONE = 'qc_getapp_done';
const CLOSED = 'qc_getapp_closed';
const AT = [2, 8, 20];

const WINDOWS = 'https://github.com/TuriusX/Quest-Compendium/releases/latest/download/Quest-Compendium-Setup.exe';
const STORE = 'https://apps.microsoft.com/detail/9NN4DDKMD1X3';
const DECK = 'https://questcompendium.com/steam-deck/';
const SITE = 'https://questcompendium.com/';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* fine */
  }
};

const isWebApp = () => typeof window !== 'undefined' && !(window as any).electronAPI && !/QuestCompendiumDeck/i.test(navigator.userAgent || '');

/** Counts this answer; true when the card belongs under it. */
export function getAppDue(): boolean {
  if (!isWebApp()) return false;
  const n = (Number(read(COUNT)) || 0) + 1;
  write(COUNT, String(n));
  if (read(DONE) || (Number(read(CLOSED)) || 0) >= 2) return false;
  return AT.includes(n);
}

function send(event: string) {
  try {
    void fetch('/api/get-app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true }).catch(() => {});
  } catch {
    /* counting is best effort */
  }
}

let shownOnce = false; // one "shown" a page, however often the conversation re-renders

export function GetAppCard() {
  const t = useT();
  const [hidden, setHidden] = useState(() => !!read(DONE));
  const [copied, setCopied] = useState(false);
  const phone = isPhone();
  useEffect(() => {
    if (hidden || shownOnce) return;
    shownOnce = true;
    send('shown');
  }, [hidden]);
  if (hidden) return null;
  const close = () => {
    write(CLOSED, String((Number(read(CLOSED)) || 0) + 1));
    send('dismiss');
    setHidden(true);
  };
  const picked = (ev: string) => {
    write(DONE, ev);
    send(ev);
  };
  const copy = async () => {
    send('copy');
    try {
      await navigator.clipboard.writeText(SITE);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const link = 'qc-px-bevel inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition cursor-pointer';
  return (
    <div className="qc-px-frame relative mt-1 mb-4 ml-0 sm:ml-11 max-w-xl rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-4 pr-10 animate-in fade-in duration-200">
      <button
        type="button"
        onClick={close}
        title={t('common.close')}
        aria-label={t('common.close')}
        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-sm font-semibold text-white leading-snug">{t('getapp.title')}</p>
      <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{t(phone ? 'getapp.bodyPhone' : 'getapp.body')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {phone ? (
          <>
            <button type="button" onClick={copy} className={`${link} bg-white text-black hover:bg-zinc-200`}>
              {copied ? t('getapp.copied') : t('getapp.copy')}
            </button>
            <a href={DECK} target="_blank" rel="noopener noreferrer" onClick={() => picked('deck')} className={`${link} border border-white/15 text-white hover:bg-white/10`}>
              {t('getapp.deck')}
            </a>
          </>
        ) : (
          <>
            <a href={WINDOWS} target="_blank" rel="noopener noreferrer" onClick={() => picked('windows')} className={`${link} bg-white text-black hover:bg-zinc-200`}>
              {t('getapp.windows')}
            </a>
            <a href={STORE} target="_blank" rel="noopener noreferrer" onClick={() => picked('store')} className={`${link} border border-white/15 text-white hover:bg-white/10`}>
              {t('getapp.store')}
            </a>
            <a href={DECK} target="_blank" rel="noopener noreferrer" onClick={() => picked('deck')} className={`${link} border border-white/15 text-white hover:bg-white/10`}>
              {t('getapp.deck')}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
