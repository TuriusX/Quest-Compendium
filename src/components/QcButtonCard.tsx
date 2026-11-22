/**
 * "Your Quest Compendium button" (owner, Nov 22 2026): a button the game never sees. Any shared button combo also
 * reaches the game (L3 + R3 opened the quick menu AND Baldur's Gate 3's photo mode), so the clean way is a macro
 * button, a back paddle set to press the quick menu shortcut (Alt+Q): the app catches the shortcut, and Steam Input or
 * the controller's own app keeps the paddle from the game. This card explains it for the player's kind of controller
 * and tests it live: "Press your button now", and it turns green when the shortcut arrives.
 */
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Gamepad2, Loader2 } from 'lucide-react';
import { useT } from '../i18n';
import { keyLabel, shortcutKeys } from '../utils/shortcut';
import { AppSettings } from '../types';

type Route = NonNullable<AppSettings['qcButtonRoute']>;
const ROUTES: Route[] = ['steam', 'elite', 'software', 'none'];

export function QcButtonCard({ settings, onUpdateSettings, onBlip }: { settings: AppSettings; onUpdateSettings: (u: Partial<AppSettings>) => void; onBlip?: () => void }) {
  const tr = useT();
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const keys = settings.quickMenuShortcut && settings.quickMenuShortcut !== 'off' ? settings.quickMenuShortcut : 'Alt+Q';
  const route: Route = settings.qcButtonRoute || 'steam';
  const [test, setTest] = useState<'idle' | 'waiting' | 'pad' | 'keys'>('idle');
  const timer = useRef<number | null>(null);

  // The test: main reports the shortcut (or the controller combo) instead of opening the quick menu.
  useEffect(() => {
    if (test !== 'waiting' || !api?.qcButtonTest) return;
    api.qcButtonTest(true);
    const off = api.onQcButtonPressed?.((info: { via: string; fromPad: boolean }) => {
      setTest(info.fromPad ? 'pad' : 'keys');
      api.qcButtonTest(false);
      if (info.via === 'keys') onUpdateSettings({ qcButtonWorkedAt: Date.now() });
    });
    timer.current = window.setTimeout(() => setTest('idle'), 60000);
    return () => {
      api.qcButtonTest(false);
      if (typeof off === 'function') off();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [test]); // eslint-disable-line react-hooks/exhaustive-deps

  const worked = !!settings.qcButtonWorkedAt;
  const caps = shortcutKeys(keys).map((k) => keyLabel(k));

  return (
    <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)] p-4 space-y-3" id="qc-button-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Gamepad2 className="w-5 h-5 mt-0.5 text-[var(--accent-color)] flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-white">{tr('qcb.title')}</div>
            <div className="text-[11px] text-zinc-300 leading-relaxed">{tr('qcb.why')}</div>
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full whitespace-nowrap ${worked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-300'}`}>
          {worked ? tr('qcb.statusOk') : tr('qcb.statusNot')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
        <span>{tr('qcb.setTo')}</span>
        {caps.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-zinc-500">+</span>}
            <kbd className="px-2 py-1 rounded-md bg-black/40 border border-white/15 text-white font-mono text-xs">{c}</kbd>
          </React.Fragment>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-white">{tr('qcb.whichQ')}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ROUTES.map((r) => (
            <button
              key={r}
              aria-pressed={route === r}
              onClick={() => { onBlip?.(); onUpdateSettings({ qcButtonRoute: r }); }}
              className={`p-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${route === r ? 'bg-black/40 border-[var(--accent-border)] text-white' : 'bg-black/20 border-white/[0.08] text-zinc-300 hover:border-white/20'}`}
            >
              {tr(`qcb.route.${r}`)}
            </button>
          ))}
        </div>
        <ol className="list-decimal pl-5 space-y-1 text-[11px] text-zinc-300 leading-relaxed">
          {[1, 2, 3, 4].map((n) => {
            const k = `qcb.${route}.${n}`;
            const v = tr(k, { keys: caps.join(' + ') });
            return v && v !== k ? <li key={n}>{v}</li> : null;
          })}
        </ol>
      </div>

      {route !== 'none' && (
        <div className="rounded-lg bg-black/30 border border-white/[0.08] p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-300 min-w-0" aria-live="polite">
            {test === 'idle' && tr('qcb.testIdle')}
            {test === 'waiting' && <span className="flex items-center gap-2 text-white"><Loader2 className="w-3.5 h-3.5 animate-spin" />{tr('qcb.testWaiting')}</span>}
            {test === 'pad' && <span className="flex items-center gap-2 text-emerald-300 font-semibold"><CheckCircle2 className="w-4 h-4" />{tr('qcb.testPad')}</span>}
            {test === 'keys' && <span className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="w-4 h-4" />{tr('qcb.testKeys', { keys: caps.join(' + ') })}</span>}
          </div>
          <button
            onClick={() => { onBlip?.(); setTest(test === 'waiting' ? 'idle' : 'waiting'); }}
            disabled={!api?.qcButtonTest}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--accent-color)] text-[#16101f] cursor-pointer disabled:opacity-40"
          >
            {test === 'waiting' ? tr('qcb.testStop') : test === 'idle' ? tr('qcb.testStart') : tr('qcb.testAgain')}
          </button>
        </div>
      )}
    </div>
  );
}
