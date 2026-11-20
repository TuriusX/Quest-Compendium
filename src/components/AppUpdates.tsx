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
 * Settings' "Check for updates" (desktop): asks now (electron/updater.cjs check-for-updates) and shows the whole flow
 * in place (owner, Nov 20 2026: no going back to the main window to install): checking, a newer version downloading
 * with its progress (live from 'app-update', also one that started before Settings opened), then "Version X is
 * ready" with Restart to update right here. Also: up to date, couldn't check, or, installed from the Microsoft Store,
 * that the Store keeps it up to date.
 */
export const UpdateCheck: React.FC = () => {
  const t = useT();
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [dl, setDl] = useState<{ v: string; p: number } | null>(null);
  const [ready, setReady] = useState('');
  // Where an update is, now and as it changes while Settings is open.
  useEffect(() => {
    if (!api) return;
    const take = (s: any) => {
      if (!s) return;
      if (s.state === 'downloading') { setDl({ v: String(s.version || ''), p: Number(s.percent) || 0 }); setSaid(''); }
      else if (s.state === 'ready' && s.version) { setDl(null); setReady(String(s.version)); setSaid(''); }
      else if (s.state === 'failed') { setDl(null); setSaid(t('update.failed')); }
    };
    const off = api.onAppUpdate?.(take);
    api.getUpdateState?.().then(take).catch(() => {});
    return () => { if (typeof off === 'function') off(); };
  }, []);
  if (!api) return null;
  const current = String(api.appVersion || '');
  const store = api.isStoreBuild === true;
  const go = async () => {
    setBusy(true);
    setSaid('');
    let r: any = null;
    try { r = await api.checkForUpdates?.(); } catch { r = null; }
    setBusy(false);
    const v = String(r?.version || '');
    if (r?.state === 'downloading') return void setDl((d) => d || { v, p: Number(r.percent) || 0 });
    if (r?.state === 'ready') return void setReady(v);
    setSaid(
      r?.state === 'current' ? t('update.current', { v: r.current || current })
        : r?.state === 'store' ? t('update.store')
        : r?.state === 'dev' ? t('update.dev')
        : t('update.failed'),
    );
  };
  const line = ready ? t('update.ready', { v: ready }) : dl ? t('update.downloading', { v: dl.v, p: String(dl.p) }) : said || (store ? t('update.store') : '');
  return (
    <div className="p-3 rounded-xl bg-black/30 border border-white/[0.08] space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white">{t('update.version', { v: current || '?' })}</div>
          <div className="text-[11px] text-zinc-400" role="status">{line}</div>
        </div>
        {!store && ready && (
          <button
            type="button"
            onClick={() => api.installUpdate?.()}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-[var(--accent-color)] text-black text-[12px] font-bold hover:opacity-90 cursor-pointer"
          >
            {t('update.restart')}
          </button>
        )}
        {!store && !ready && (
          <button
            type="button"
            disabled={busy || !!dl}
            onClick={() => void go()}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
          >
            {busy ? t('update.checking') : t('update.check')}
          </button>
        )}
      </div>
      {dl && !ready && (
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dl.p}>
          <div className="h-full bg-[var(--accent-color)] transition-[width] duration-300" style={{ width: `${Math.max(3, dl.p)}%` }} />
        </div>
      )}
    </div>
  );
};

/**
 * Updates in the desktop app (electron/updater.cjs):
 *   - a new version downloaded in the background: a small non-blocking bar, "Version 0.5.7 is ready." with Restart to
 *     update and Later (it installs when the app closes anyway);
 *   - the first launch after an update: a one-time "What's new in 0.5.7" card with that release's notes (the website's
 *     Recent updates line, in the app's language), dismissible.
 * `preview` shows both with sample data (for screenshots in a browser).
 */
export const AppUpdates: React.FC<{ preview?: { ready?: string; whatsNew?: { v: string; text: string } } }> = ({ preview }) => {
  const t = useT();
  const locale = useLocale();
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const [ready, setReady] = useState<string>(preview?.ready || '');
  const [later, setLater] = useState(false);
  // A new version coming down (Nov 20 2026: so the wait doesn't feel stuck): its version and progress.
  const [coming, setComing] = useState<{ v: string; p: number } | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ v: string; text: string } | null>(preview?.whatsNew || null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A downloaded update (also one that finished before this page loaded).
  useEffect(() => {
    if (!api?.onAppUpdate) return;
    const take = (s: any) => {
      if (s?.state === 'ready' && s.version) { setComing(null); setReady(String(s.version)); }
      else if (s?.state === 'downloading') setComing({ v: String(s.version || ''), p: Number(s.percent) || 0 });
      else if (s?.state === 'failed') setComing(null);
    };
    api.onAppUpdate(take);
    api.getUpdateState?.().then(take).catch(() => {});
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
      {/* In line under the header (it covers nothing). */}
      {coming && !ready && !later && (
        <div role="status" className="flex-shrink-0 mx-3 mt-2 px-3 py-2 rounded-xl bg-[#161620] border border-white/[0.08] text-[12px] text-zinc-400 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-zinc-500 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">{t('update.downloading', { v: coming.v, p: String(coming.p) })}</span>
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-[var(--accent-color)] transition-[width] duration-300" style={{ width: `${Math.max(3, coming.p)}%` }} />
          </div>
        </div>
      )}
      {ready && !later && (
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
