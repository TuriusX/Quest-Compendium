import React, { useEffect, useRef, useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { useT, useLocale } from '../i18n';
import { getApiBaseUrl } from '../utils/api';

/** "0.5.10" > "0.5.9". */
export function newerVersion(a: string, b: string): boolean {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/**
 * Updates in the desktop app (electron/updater.cjs):
 *   - a new version downloaded in the background: a small non-blocking bar, "Version 0.5.7 is ready." with Restart to
 *     update and Later (it installs when the app closes anyway);
 *   - the first launch after an update: a one-time "What's new in 0.5.7" card with that release's notes (the website's
 *     Recent updates line, in the app's language), dismissible.
 * `preview` shows both with sample data (for screenshots in a browser).
 */
export const AppUpdates: React.FC<{ compact?: boolean; preview?: { ready?: string; whatsNew?: { v: string; text: string } } }> = ({ compact = false, preview }) => {
  const t = useT();
  const locale = useLocale();
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const [ready, setReady] = useState<string>(preview?.ready || '');
  const [later, setLater] = useState(false);
  const [whatsNew, setWhatsNew] = useState<{ v: string; text: string } | null>(preview?.whatsNew || null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A downloaded update (also one that finished before this page loaded).
  useEffect(() => {
    if (!api?.onAppUpdate) return;
    api.onAppUpdate((s: any) => { if (s?.state === 'ready' && s.version) setReady(String(s.version)); });
    api.getUpdateState?.().then((s: any) => { if (s?.state === 'ready' && s.version) setReady(String(s.version)); }).catch(() => {});
  }, []);

  // The first launch on a newer version than last time: its notes, once.
  useEffect(() => {
    const now = String(api?.appVersion || '');
    if (!now || preview) return;
    let last = '';
    try {
      last = localStorage.getItem('qc_last_version') || '';
      localStorage.setItem('qc_last_version', now);
    } catch {
      return;
    }
    if (!last || !newerVersion(now, last)) return;
    let alive = true;
    fetch(`${getApiBaseUrl()}/api/changelog?v=${encodeURIComponent(now)}&lang=${encodeURIComponent(locale)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setWhatsNew({ v: now, text: String(d?.text || '') }))
      .catch(() => alive && setWhatsNew({ v: now, text: '' }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (whatsNew) setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
  }, [!!whatsNew]);

  const releaseUrl = (v: string) => `https://github.com/TuriusX/Quest-Compendium/releases/tag/v${v}`;
  // The notes start in lower case on the website ("a calmer Ask view…"): a sentence here.
  const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/([^.!?])$/, '$1.') : s);

  return (
    <>
      {/* In line under the header (it covers nothing); not in the compact view, where the update simply installs on quit. */}
      {ready && !later && !compact && (
        <div role="status" className="flex-shrink-0 mx-3 mt-2 flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#161620] border border-[var(--accent-border)] text-[12.5px] text-zinc-200 animate-in fade-in slide-in-from-top-1 duration-200">
          <Download className="w-4 h-4 text-[var(--accent-color)] flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">{t('update.ready', { v: ready })}</span>
          <button
            type="button"
            onClick={() => api?.installUpdate?.()}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-[var(--accent-color)] text-black text-[12px] font-bold hover:opacity-90 cursor-pointer"
          >
            {t('update.restart')}
          </button>
          <button
            type="button"
            onClick={() => setLater(true)}
            title={t('update.laterHint')}
            className="flex-shrink-0 px-2 py-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 text-[12px] font-semibold cursor-pointer"
          >
            {t('update.later')}
          </button>
        </div>
      )}
      {whatsNew && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setWhatsNew(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setWhatsNew(null); } }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="qc-whatsnew-title" className="w-full max-w-sm rounded-2xl bg-[#13141d] border border-[var(--accent-border)] shadow-2xl p-4 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--accent-color)]" aria-hidden="true" />
              <h2 id="qc-whatsnew-title" className="flex-1 font-fantasy font-bold text-[15px] text-white">{t('whatsnew.title', { v: whatsNew.v })}</h2>
              <button type="button" onClick={() => setWhatsNew(null)} aria-label={t('whatsnew.close')} className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-300">{whatsNew.text ? sentence(whatsNew.text) : t('whatsnew.fallback', { v: whatsNew.v })}</p>
            <div className="flex items-center gap-2 pt-1">
              <a href={releaseUrl(whatsNew.v)} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--accent-color)] hover:underline">{t('whatsnew.notes')}</a>
              <button ref={closeRef} type="button" onClick={() => setWhatsNew(null)} className="ml-auto px-3 py-1.5 rounded-lg bg-[var(--accent-color)] text-black text-[12px] font-bold hover:opacity-90 cursor-pointer">
                {t('whatsnew.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
