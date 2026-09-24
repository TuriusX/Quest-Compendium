/**
 * Controller support for the interface: everything you need without touching a keyboard.
 *
 * Input comes from the desktop app's system-level controller service (electron/controller.cjs) when available,
 * otherwise from the browser Gamepad API (web app, or while the window is focused).
 *
 *   D-pad / left stick  move between buttons        A  select           B  back (closes dialogs, then hides the overlay)
 *   X  voice question (press again to send)          Y  quick questions  Menu  on-screen keyboard
 *   View  screenshot & ask (desktop)                 LB / RB  previous / next game   Right stick  scroll
 *
 * The rest of the app is reached through small window events, so no app logic lives here:
 *   'qc-ask' {text}         send a question        'qc-set-input' {text}   mirror typed text into the question box
 *   'qc-switch-tab' {delta} change compendium      'trigger-voice-record' / 'trigger-auto-screenshot-submit' (existing)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '../i18n';

type Btn = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'start' | 'back' | 'ls' | 'rs';
type PadEvent = { type: 'button'; button: Btn } | { type: 'scroll'; dy: number };

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const electronAPI = () => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

// ---- Helpers for finding what's on screen -------------------------------------------------------------------

function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  const cs = getComputedStyle(el as HTMLElement);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none';
}

/** The top-most open dialog (full-screen fixed overlay), if any; otherwise the whole page. */
function topScope(): HTMLElement {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0, [role="dialog"]')).filter(
    (el) => !el.closest('[data-qc-pad-ui]') && isVisible(el) && el.querySelector(FOCUSABLE),
  );
  if (!overlays.length) return document.body;
  overlays.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0));
  return overlays[0];
}

function focusables(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[data-qc-pad-ui]') && isVisible(el));
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Pick the nearest element in a direction (classic spatial navigation). */
function nextInDirection(from: HTMLElement | null, dir: 'up' | 'down' | 'left' | 'right', items: HTMLElement[]): HTMLElement | null {
  if (!items.length) return null;
  if (!from || !items.includes(from)) return items[0];
  const a = from.getBoundingClientRect();
  const ac = center(a);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bc = center(b);
    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;
    let primary: number, secondary: number;
    if (dir === 'down') { if (b.top < a.bottom - 4 && dy <= 4) continue; primary = Math.max(0, b.top - a.bottom); secondary = Math.abs(dx); }
    else if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -4) continue; primary = Math.max(0, a.top - b.bottom); secondary = Math.abs(dx); }
    else if (dir === 'right') { if (b.left < a.right - 4 && dx <= 4) continue; primary = Math.max(0, b.left - a.right); secondary = Math.abs(dy); }
    else { if (b.right > a.left + 4 && dx >= -4) continue; primary = Math.max(0, a.left - b.right); secondary = Math.abs(dy); }
    const score = primary + secondary * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function scrollableIn(scope: HTMLElement): HTMLElement | null {
  const chat = scope.querySelector<HTMLElement>('[data-qc-scroll]');
  if (chat && isVisible(chat)) return chat;
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4 && isVisible(el);
  });
  return candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? null;
}

/** Close the top dialog: its close/cancel button if we can find one, else Escape. Returns false if none open. */
function closeTopDialog(): boolean {
  const scope = topScope();
  if (scope === document.body) return false;
  const buttons = focusables(scope).filter((el) => el.tagName === 'BUTTON');
  const closeBtn =
    buttons.find((b) => b.querySelector('svg.lucide-x, svg[data-icon="close"]')) ||
    buttons.find((b) => /close|cerrar|fechar|cancel|✕|×/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.title ?? ''} ${b.textContent ?? ''}`));
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

// ---- Input sources ------------------------------------------------------------------------------------------

/** Browser Gamepad API (standard mapping), with the same repeat behavior as the desktop service. */
function useGamepadPolling(enabled: boolean, onEvent: (e: PadEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const MAP: [number, Btn][] = [[0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [8, 'back'], [9, 'start'], [10, 'ls'], [11, 'rs']];
    const prev = new Set<Btn>();
    const rep: Record<string, { since: number; last: number } | null> = { up: null, down: null, left: null, right: null };
    let lastScroll = 0;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!document.hasFocus()) return;
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
      if (!pads.length) return;
      const t = performance.now();
      const down = new Set<Btn>();
      let lx = 0, ly = 0, ry = 0;
      for (const p of pads) {
        for (const [i, name] of MAP) if (p.buttons[i]?.pressed) down.add(name);
        if (p.buttons[12]?.pressed) down.add('up');
        if (p.buttons[13]?.pressed) down.add('down');
        if (p.buttons[14]?.pressed) down.add('left');
        if (p.buttons[15]?.pressed) down.add('right');
        if (Math.abs(p.axes[0] ?? 0) > Math.abs(lx)) lx = p.axes[0] ?? 0;
        if (Math.abs(p.axes[1] ?? 0) > Math.abs(ly)) ly = p.axes[1] ?? 0;
        if (Math.abs(p.axes[3] ?? 0) > Math.abs(ry)) ry = p.axes[3] ?? 0;
      }
      if (ly < -0.55) down.add('up');
      if (ly > 0.55) down.add('down');
      if (lx < -0.55) down.add('left');
      if (lx > 0.55) down.add('right');
      for (const [, name] of MAP) if (down.has(name) && !prev.has(name)) onEventRef.current({ type: 'button', button: name });
      for (const d of ['up', 'down', 'left', 'right'] as const) {
        if (!down.has(d)) { rep[d] = null; continue; }
        const r = rep[d];
        if (!r) { rep[d] = { since: t, last: t }; onEventRef.current({ type: 'button', button: d }); }
        else if (t - r.since > 380 && t - r.last > 110) { r.last = t; onEventRef.current({ type: 'button', button: d }); }
      }
      if (Math.abs(ry) > 0.25 && t - lastScroll > 33) { lastScroll = t; onEventRef.current({ type: 'scroll', dy: Math.round(ry * 42) }); }
      prev.clear();
      for (const [, name] of MAP) if (down.has(name)) prev.add(name);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}

// ---- On-screen keyboard layouts -----------------------------------------------------------------------------

const LETTERS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
];
const SYMBOLS = [
  ['á', 'é', 'í', 'ó', 'ú', 'à', 'â', 'ê', 'ô', 'ü'],
  ['ñ', 'ç', 'ã', 'õ', '¿', '¡', '!', '-', ':', ';'],
  ['(', ')', '"', '/', '@', '#', '&', '+', '=', '*'],
  ['%', '$', '€', '_', '<', '>', '[', ']', '~', '…'],
];
const SPECIALS = ['shift', 'symbols', 'space', 'backspace', 'send'] as const;
type Special = (typeof SPECIALS)[number];

// ---- The layer ----------------------------------------------------------------------------------------------

export function ControllerLayer({ enabled }: { enabled: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [padMode, setPadMode] = useState(false);
  const [panel, setPanel] = useState<null | 'questions' | 'keyboard'>(null);
  const [qIndex, setQIndex] = useState(0);
  const [text, setText] = useState('');
  const [kb, setKb] = useState({ row: 1, col: 0, shift: false, symbols: false });
  const [desktopPad, setDesktopPad] = useState<boolean | null>(null);
  const focusedRef = useRef<HTMLElement | null>(null);

  const questions = [
    t('chat.follow2'),
    t('chat.p1.q'),
    t('chat.p2.q'),
    t('chat.p3.q'),
    t('chat.p4.q'),
    t('chat.follow1'),
    t('chat.follow3'),
  ];
  const questionLabels = [
    t('chat.follow2'),
    t('chat.p1.title'),
    t('chat.p2.title'),
    t('chat.p3.title'),
    t('chat.p4.title'),
    t('chat.follow1'),
    t('chat.follow3'),
  ];

  // Controller mode shows the focus ring and button hints; any mouse or keyboard use hides them again.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('qc-pad', padMode && enabled);
    if (!padMode) return;
    const exit = (e: Event) => {
      if ((e as MouseEvent).isTrusted === false) return;
      setPadMode(false);
      setPanel(null);
    };
    const onMove = (e: MouseEvent) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 8) exit(e);
    };
    window.addEventListener('mousedown', exit, true);
    window.addEventListener('keydown', exit, true);
    window.addEventListener('mousemove', onMove, true);
    return () => {
      window.removeEventListener('mousedown', exit, true);
      window.removeEventListener('keydown', exit, true);
      window.removeEventListener('mousemove', onMove, true);
    };
  }, [padMode, enabled]);

  useEffect(() => () => document.documentElement.classList.remove('qc-pad'), []);

  const setFocus = useCallback((el: HTMLElement | null) => {
    if (focusedRef.current) focusedRef.current.classList.remove('qc-pad-focus');
    focusedRef.current = el;
    if (!el) return;
    el.classList.add('qc-pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const openKeyboard = useCallback(() => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-qc-ask-input]');
    setText(box?.value ?? '');
    setKb({ row: 1, col: 0, shift: false, symbols: false });
    setPanel('keyboard');
  }, []);

  const typeText = useCallback((next: string) => {
    setText(next);
    emit('qc-set-input', { text: next });
  }, []);

  const pressKey = useCallback(
    (key: string | Special) => {
      if (key === 'shift') return setKb((k) => ({ ...k, shift: !k.shift }));
      if (key === 'symbols') return setKb((k) => ({ ...k, symbols: !k.symbols }));
      if (key === 'space') return typeText(text + ' ');
      if (key === 'backspace') return typeText(text.slice(0, -1));
      if (key === 'send') {
        if (text.trim()) emit('qc-ask', { text: text.trim() });
        setText('');
        setPanel(null);
        return;
      }
      typeText(text + (kb.shift ? key.toUpperCase() : key));
      if (kb.shift) setKb((k) => ({ ...k, shift: false }));
    },
    [text, kb.shift, typeText],
  );

  const handle = useCallback(
    (e: PadEvent) => {
      if (!enabled) return;
      if (!padMode) {
        setPadMode(true);
        if (e.type === 'button' && !panel) {
          // The first press just wakes controller mode and puts focus somewhere sensible.
          const box = document.querySelector<HTMLElement>('[data-qc-ask-input]');
          setFocus(box && isVisible(box) ? box : focusables(topScope())[0] ?? null);
          return;
        }
      }

      if (e.type === 'scroll') {
        const el = scrollableIn(topScope());
        if (el) el.scrollBy({ top: e.dy });
        return;
      }
      const b = e.button;

      // --- Quick questions panel
      if (panel === 'questions') {
        if (b === 'up') setQIndex((i) => (i + questions.length - 1) % questions.length);
        else if (b === 'down') setQIndex((i) => (i + 1) % questions.length);
        else if (b === 'a') { emit('qc-ask', { text: questions[qIndex] }); setPanel(null); }
        else if (b === 'b' || b === 'y') setPanel(null);
        return;
      }

      // --- On-screen keyboard
      if (panel === 'keyboard') {
        const rows = kb.symbols ? SYMBOLS : LETTERS;
        const lastRow = rows.length; // index of the specials row
        if (b === 'up' || b === 'down') {
          setKb((k) => {
            const row = Math.max(0, Math.min(lastRow, k.row + (b === 'down' ? 1 : -1)));
            let col = k.col;
            if (k.row === lastRow && row !== lastRow) col = Math.round((k.col / (SPECIALS.length - 1)) * 9);
            if (row === lastRow && k.row !== lastRow) col = Math.round((k.col / 9) * (SPECIALS.length - 1));
            return { ...k, row, col };
          });
        } else if (b === 'left' || b === 'right') {
          setKb((k) => {
            const width = k.row === lastRow ? SPECIALS.length : 10;
            return { ...k, col: (k.col + (b === 'right' ? 1 : width - 1)) % width };
          });
        } else if (b === 'a') {
          pressKey(kb.row === lastRow ? SPECIALS[kb.col] : rows[kb.row][kb.col]);
        } else if (b === 'x') pressKey('backspace');
        else if (b === 'y') pressKey('space');
        else if (b === 'ls') pressKey('shift');
        else if (b === 'rs') pressKey('symbols');
        else if (b === 'start') pressKey('send');
        else if (b === 'b') setPanel(null);
        return;
      }

      // --- Normal navigation
      const scope = topScope();
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
        const items = focusables(scope);
        const current = document.activeElement instanceof HTMLElement ? document.activeElement : focusedRef.current;
        setFocus(nextInDirection(current, b, items));
      } else if (b === 'a') {
        const el = (document.activeElement as HTMLElement) || focusedRef.current;
        if (el?.matches('[data-qc-ask-input]')) openKeyboard();
        else if (el && el !== document.body) el.click();
      } else if (b === 'b') {
        if (!closeTopDialog()) electronAPI()?.toggleSlide?.();
      } else if (b === 'x') {
        emit('trigger-voice-record');
      } else if (b === 'y') {
        setQIndex(0);
        setPanel('questions');
      } else if (b === 'start') {
        openKeyboard();
      } else if (b === 'back') {
        if (electronAPI()) emit('trigger-auto-screenshot-submit');
      } else if (b === 'lb' || b === 'rb') {
        emit('qc-switch-tab', { delta: b === 'rb' ? 1 : -1 });
      }
    },
    [enabled, padMode, panel, questions, qIndex, kb, pressKey, openKeyboard, setFocus],
  );

  // Desktop: system-level controller service. Falls back to the Gamepad API if it isn't available.
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    const api = electronAPI();
    if (!api?.onControllerInput) {
      setDesktopPad(false);
      return;
    }
    api.onControllerInput((evt: PadEvent) => handleRef.current(evt));
    api.onControllerActivated?.(() => {
      setPadMode(true);
      setTimeout(() => {
        const box = document.querySelector<HTMLElement>('[data-qc-ask-input]');
        if (box && isVisible(box)) setFocus(box);
      }, 200);
    });
    Promise.resolve(api.getControllerStatus?.())
      .then((s: any) => setDesktopPad(!!s?.available))
      .catch(() => setDesktopPad(false));
  }, [setFocus]);

  useGamepadPolling(enabled && desktopPad === false, (evt) => handleRef.current(evt));

  if (!enabled || !padMode) return null;

  const rows = kb.symbols ? SYMBOLS : LETTERS;
  const specialsLabel: Record<Special, string> = {
    shift: '⇧',
    symbols: kb.symbols ? 'abc' : 'á#',
    space: t('pad.space'),
    backspace: '⌫',
    send: t('pad.send'),
  };

  const Glyph = ({ b }: { b: string }) => <span className={`qc-glyph qc-glyph-${b}`}>{b.toUpperCase()}</span>;
  const Hint = ({ b, label }: { b: string; label: string }) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Glyph b={b} />
      {label}
    </span>
  );

  return (
    <div data-qc-pad-ui className="fixed inset-x-0 bottom-0 z-[400] pointer-events-none flex flex-col items-center gap-2 p-3">
      {panel === 'questions' && (
        <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-[#0d0e15]/97 border border-[var(--accent-border)] shadow-2xl p-3 space-y-1.5" role="listbox" aria-label={t('pad.questions')}>
          <div className="px-1 pb-1 text-[10px] font-mono uppercase text-zinc-400">{t('pad.questions')}</div>
          {questionLabels.map((label, i) => (
            <div
              key={i}
              role="option"
              aria-selected={i === qIndex}
              className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                i === qIndex ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : 'border-transparent text-zinc-300'
              }`}
            >
              {label}
            </div>
          ))}
        </div>
      )}

      {panel === 'keyboard' && (
        <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-[#0d0e15]/97 border border-[var(--accent-border)] shadow-2xl p-3 space-y-2" aria-label={t('pad.keyboard')}>
          <div className="px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-white min-h-[40px] break-words" lang={locale}>
            {text || <span className="text-zinc-500">{t('chat.ask')}</span>}
            <span className="qc-caret" />
          </div>
          {rows.map((row, r) => (
            <div key={r} className="grid grid-cols-10 gap-1.5">
              {row.map((key, c) => (
                <span
                  key={key}
                  className={`h-9 flex items-center justify-center rounded-lg border text-sm font-semibold ${
                    kb.row === r && kb.col === c ? 'bg-[var(--accent-color)] text-[#16101f] border-transparent scale-105' : 'bg-white/[0.05] border-white/10 text-zinc-200'
                  }`}
                >
                  {kb.shift ? key.toUpperCase() : key}
                </span>
              ))}
            </div>
          ))}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 3fr 1fr 1.6fr' }}>
            {SPECIALS.map((key, c) => {
              const selected = kb.row === rows.length && kb.col === c;
              const on = (key === 'shift' && kb.shift) || (key === 'symbols' && kb.symbols);
              return (
                <span
                  key={key}
                  className={`h-9 flex items-center justify-center rounded-lg border text-xs font-bold ${
                    selected
                      ? 'bg-[var(--accent-color)] text-[#16101f] border-transparent scale-105'
                      : on
                        ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white'
                        : key === 'send'
                          ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white'
                          : 'bg-white/[0.05] border-white/10 text-zinc-200'
                  }`}
                >
                  {specialsLabel[key]}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Button hints */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 py-2 rounded-2xl bg-black/80 border border-white/10 text-[11px] font-medium text-zinc-200 shadow-lg">
        {panel === 'keyboard' ? (
          <>
            <Hint b="a" label={t('pad.type')} />
            <Hint b="x" label={t('pad.delete')} />
            <Hint b="y" label={t('pad.space')} />
            <Hint b="l3" label={t('pad.shift')} />
            <Hint b="menu" label={t('pad.send')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : panel === 'questions' ? (
          <>
            <Hint b="a" label={t('pad.ask')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : (
          <>
            <Hint b="a" label={t('pad.select')} />
            <Hint b="b" label={t('pad.back')} />
            <Hint b="x" label={t('pad.voice')} />
            <Hint b="y" label={t('pad.questions')} />
            <Hint b="menu" label={t('pad.keyboard')} />
            <Hint b="lb" label={t('pad.games')} />
          </>
        )}
      </div>
    </div>
  );
}
