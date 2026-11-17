/**
 * Controller support for the interface: everything you need without touching a keyboard.
 *
 * Input comes from the desktop app's system-level controller service (electron/controller.cjs) when available,
 * otherwise from the browser Gamepad API (web app, or while the window is focused).
 *
 *   D-pad / left stick  move between stops (src/utils/padStops.ts): each answer, the quick questions, the Ask bar, the
 *                       quest log's rows; A on an answer goes into it, B comes back out
 *   A  select (on the Ask bar: the keyboard)          B  back (closes dialogs, steps out of an answer; never hides the app)
 *   X  voice question (press again to send); on an answer: read it aloud
 *   Y  quick questions (hold: ask out loud, immersive mode); on an answer: its Actions menu
 *   A small prompt bar in the corner shows only the buttons that do something for what's selected (step 2).
 *   Menu  the quick menu (step 3): a ring of actions picked with the right stick or the d-pad, A to choose. It holds
 *         what used to be hidden on L3, R3, View and Menu (they still work): Help me here, Screenshot and ask, Speak,
 *         Find markers again, Quest log, Pro / Fast, Switch game, Type, Settings, Hide the app
 *   View  quest log
 *   LB / RB  Ask, Guide, then the previous / next game   LT / RT  page through long answers   Right stick  scroll
 *   R3 (press the right stick)  switch Pro / Fast for the next question
 *
 * The rest of the app is reached through small window events, so no app logic lives here:
 *   'qc-ask' {text}         send a question        'qc-set-input' {text}   mirror typed text into the question box
 *   'qc-switch-tab' {delta} change compendium      'trigger-voice-record' / 'trigger-auto-screenshot-submit' (existing)
 *   'qc-talk' {state}       hold to talk           'qc-pad-mode' {dir}     bumpers: Ask / Guide / games
 *   'qc-toggle-answer-model'  R3: Pro / Fast
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '../i18n';
import { QUICK_MAIN, QUICK_MORE, QUICK_HINTS, quickLabelKey } from '../utils/quickQuestions';
import { nextStop, ringIndex, ringSpot, type Stop } from '../utils/padStops';
import { glyph, styleFromId, type PadStyle } from '../utils/padGlyphs';
import { applySuggestion, buildVocab, deleteWord, suggest, type Vocab } from '../utils/padWords';
import { Camera, EyeOff, Gamepad2, Keyboard, LocateFixed, Mic, Move, ScanSearch, ScrollText, Settings, Zap } from 'lucide-react';

type Btn = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'start' | 'back' | 'ls' | 'rs';
type PadEvent =
  | { type: 'button'; button: Btn | 'lt' | 'rt' }
  | { type: 'scroll'; dy: number }
  | { type: 'talk'; state: 'start' | 'end' }
  // The right stick's direction while pushed (x right, y up, -1..1), and x = y = 0 once let go: points in the quick menu.
  | { type: 'stick'; x: number; y: number };

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, ' +
  '[role="button"]:not([aria-disabled="true"]), [role="tab"], [role="option"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

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
    // Sideways distance: none when the two overlap side by side (a wide slider row under a button counts as straight
    // below it), else the gap between them.
    const sideX = Math.max(0, b.left - a.right, a.left - b.right);
    const sideY = Math.max(0, b.top - a.bottom, a.top - b.bottom);
    if (dir === 'down') { if (b.top < a.bottom - 4 && dy <= 4) continue; primary = Math.max(0, b.top - a.bottom); secondary = sideX + Math.abs(dx) * 0.05; }
    else if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -4) continue; primary = Math.max(0, a.top - b.bottom); secondary = sideX + Math.abs(dx) * 0.05; }
    else if (dir === 'right') { if (b.left < a.right - 4 && dx <= 4) continue; primary = Math.max(0, b.left - a.right); secondary = sideY + Math.abs(dy) * 0.05; }
    else { if (b.right > a.left + 4 && dx >= -4) continue; primary = Math.max(0, a.left - b.right); secondary = sideY + Math.abs(dy) * 0.05; }
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

// ---- Stops (controller mode step 1, owner Nov 17 2026) ---------------------------------------------------------

/** Marked stops: each answer, the quick questions, the Ask bar (data-pad-stop, data-qc-ask-input). */
const STOP_SEL = '[data-pad-stop], [data-qc-ask-input]';

/**
 * A control worth stopping on: it says something (not an icon-only button), it's big enough to see, and it's not in the
 * header (the header's controls move to the quick menu). The Send button is never one: an empty Send asks about a
 * screenshot, one stray press away.
 */
/** Shown at all (not hidden or collapsed), wherever it is scrolled to. */
function shown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function meaningful(el: HTMLElement): boolean {
  if (el.closest('header') || el.closest('[data-qc-pad-ui]') || el.matches('[data-qc-send], [data-qc-log-popout], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.height < 18) return false;
  const text = (el.innerText || (el as HTMLInputElement).value || '').trim();
  return text.length >= 2 || el.matches('textarea, input[type="text"], select');
}

/**
 * The stops on screen now, in two zones: the quest log ('log', every row that says something) and the rest ('main':
 * the marked stops of the conversation, or on other views such as the Guide, the controls that say something).
 */
function gatherStops(): { els: HTMLElement[]; stops: Stop[] } {
  const els: HTMLElement[] = [];
  const add = (el: HTMLElement) => {
    if (!els.includes(el) && isVisible(el)) els.push(el);
  };
  const log = document.querySelector<HTMLElement>('[data-qc-log]');
  if (log && isVisible(log)) focusables(log).filter(meaningful).forEach(add);
  const marked = Array.from(document.querySelectorAll<HTMLElement>(STOP_SEL)).filter((el) => !el.closest('[data-qc-log]') && !el.closest('[data-qc-pad-ui]'));
  const ask = marked.find((el) => el.matches('[data-qc-ask-input]'));
  // Answers scrolled out of view still count (up from the oldest one on screen goes on to older ones; the conversation
  // scrolls to it).
  if (ask && isVisible(ask)) marked.forEach((el) => (el.matches('[data-pad-stop="answer"]') ? shown(el) && !els.includes(el) && els.push(el) : add(el)));
  else focusables(document.body).filter((el) => !el.closest('[data-qc-log]') && meaningful(el)).forEach(add);
  const stops = els.map((el, id) => {
    const r = el.getBoundingClientRect();
    return { id, zone: el.closest('[data-qc-log]') ? 'log' : 'main', box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
  return { els, stops };
}

/** Where the controller starts: the Ask bar, else the first stop. */
function defaultStop(): HTMLElement | null {
  const box = document.querySelector<HTMLElement>('[data-qc-ask-input]');
  if (box && isVisible(box)) return box;
  return gatherStops().els[0] ?? null;
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
function useGamepadPolling(enabled: boolean, talkButton: string, onEvent: (e: PadEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const MAP: [number, Btn][] = [[0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [8, 'back'], [9, 'start'], [10, 'ls'], [11, 'rs']];
    const prev = new Set<Btn>();
    const rep: Record<string, { since: number; last: number } | null> = { up: null, down: null, left: null, right: null, lt: null, rt: null };
    // Hold to talk on one button: held 350 ms starts listening, letting go sends; a tap is its normal press.
    let talkSince: number | null = null, talking = false;
    let lastScroll = 0;
    let lastStick = 0;
    let stickOut = false;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!document.hasFocus()) return;
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
      if (!pads.length) return;
      const t = performance.now();
      const down = new Set<Btn>();
      let lx = 0, ly = 0, ry = 0, rx = 0;
      for (const p of pads) {
        for (const [i, name] of MAP) if (p.buttons[i]?.pressed) down.add(name);
        if (p.buttons[12]?.pressed) down.add('up');
        if (p.buttons[13]?.pressed) down.add('down');
        if (p.buttons[14]?.pressed) down.add('left');
        if (p.buttons[15]?.pressed) down.add('right');
        if (Math.abs(p.axes[0] ?? 0) > Math.abs(lx)) lx = p.axes[0] ?? 0;
        if (Math.abs(p.axes[1] ?? 0) > Math.abs(ly)) ly = p.axes[1] ?? 0;
        if (Math.abs(p.axes[3] ?? 0) > Math.abs(ry)) ry = p.axes[3] ?? 0;
        if (Math.abs(p.axes[2] ?? 0) > Math.abs(rx)) rx = p.axes[2] ?? 0;
        if ((p.buttons[6]?.value ?? 0) > 0.5) down.add('lt' as Btn);
        if ((p.buttons[7]?.value ?? 0) > 0.5) down.add('rt' as Btn);
      }
      if (ly < -0.55) down.add('up');
      if (ly > 0.55) down.add('down');
      if (lx < -0.55) down.add('left');
      if (lx > 0.55) down.add('right');
      const tb = talkButton !== 'off' ? (talkButton as Btn) : null;
      if (tb) {
        if (down.has(tb)) {
          if (talkSince === null) talkSince = t;
          if (!talking && t - talkSince >= 350) { talking = true; onEventRef.current({ type: 'talk', state: 'start' }); }
        } else if (talkSince !== null) {
          if (talking) onEventRef.current({ type: 'talk', state: 'end' });
          else onEventRef.current({ type: 'button', button: tb });
          talkSince = null; talking = false;
        }
      }
      for (const [, name] of MAP) if (name !== tb && down.has(name) && !prev.has(name)) onEventRef.current({ type: 'button', button: name });
      for (const d of ['up', 'down', 'left', 'right', 'lt', 'rt'] as const) {
        if (!down.has(d as Btn)) { rep[d] = null; continue; }
        const r = rep[d];
        const every = d === 'lt' || d === 'rt' ? 330 : 110;
        if (!r) { rep[d] = { since: t, last: t }; onEventRef.current({ type: 'button', button: d }); }
        else if (t - r.since > 380 && t - r.last > every) { r.last = t; onEventRef.current({ type: 'button', button: d }); }
      }
      if (Math.abs(ry) > 0.25 && t - lastScroll > 33) { lastScroll = t; onEventRef.current({ type: 'scroll', dy: Math.round(ry * 42) }); }
      if (Math.hypot(rx, ry) > 0.55 && t - lastStick > 50) { lastStick = t; stickOut = true; onEventRef.current({ type: 'stick', x: rx, y: -ry }); }
      else if (stickOut && Math.hypot(rx, ry) <= 0.55) { stickOut = false; onEventRef.current({ type: 'stick', x: 0, y: 0 }); }
      prev.clear();
      for (const [, name] of MAP) if (down.has(name)) prev.add(name);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, talkButton]);
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

export function ControllerLayer({ enabled, padStyle = 'auto', talkButton = 'y', hintMode = false, logAttached = false, intro = true }: { enabled: boolean; padStyle?: 'auto' | PadStyle; talkButton?: string; hintMode?: boolean; logAttached?: boolean; intro?: boolean }) {
  const [talking, setTalking] = useState(false);
  const t = useT();
  const locale = useLocale();
  const [padMode, setPadMode] = useState(false);
  const [panel, setPanel] = useState<null | 'questions' | 'keyboard' | 'actions' | 'quick'>(null);
  const [qmIndex, setQmIndex] = useState(0);
  // The Actions menu (Y on an answer): everything the mouse version offers for it, as one list.
  const [actions, setActions] = useState<{ label: string; run: () => void }[]>([]);
  const [aIndex, setAIndex] = useState(0);
  // What the controller is on, for the prompt bar: 'ask' | 'quick' | 'answer' | 'card' | 'log' | 'other'.
  const [kind, setKind] = useState('ask');
  // The first time a controller is used (step 6): one screen with the layout. A or B closes it for good.
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    if (!padMode || !intro) return;
    try {
      if (!localStorage.getItem('qc-pad-intro-seen')) setShowIntro(true);
    } catch {
      /* no storage: skip it */
    }
  }, [padMode, intro]);
  const closeIntro = () => {
    setShowIntro(false);
    try {
      localStorage.setItem('qc-pad-intro-seen', '1');
    } catch {
      /* shown again next time */
    }
  };
  // Button names (step 4): the setting, else what the controller says it is (only readable while the panel has focus;
  // the system-level reader can't tell), else Xbox.
  const [detected, setDetected] = useState<PadStyle | null>(null);
  const style: PadStyle = padStyle !== 'auto' ? padStyle : detected || 'xbox';
  useEffect(() => {
    if (padStyle !== 'auto' || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const look = () => {
      for (const p of Array.from(navigator.getGamepads() || [])) {
        const s = p && styleFromId(p.id);
        if (s) return setDetected(s);
      }
    };
    look();
    window.addEventListener('gamepadconnected', look);
    const timer = setInterval(look, 3000);
    return () => {
      window.removeEventListener('gamepadconnected', look);
      clearInterval(timer);
    };
  }, [padStyle]);
  // The panel tabs' bumper badges (index.css: [data-qc-tabs]) follow the style.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--qc-g-lb', JSON.stringify(glyph('lb', style).text));
    root.setProperty('--qc-g-rb', JSON.stringify(glyph('rb', style).text));
  }, [style]);
  const [qIndex, setQIndex] = useState(0);
  const [text, setText] = useState('');
  const [kb, setKb] = useState({ row: 1, col: 0, shift: false, symbols: false });
  const [desktopPad, setDesktopPad] = useState<boolean | null>(null);
  const focusedRef = useRef<HTMLElement | null>(null);
  // Inside an answer (A on it): the d-pad moves among its own controls; B comes back out to the answer.
  const cardRef = useRef<HTMLElement | null>(null);
  // The focus is out of date (the panel was hidden, or controller mode ended): the next press starts from the Ask bar
  // instead of acting on a control the player can't see is selected.
  const staleRef = useRef(true);
  // The controller is in the attached quest log (RB from Ask, LB from Guide): up / down move its highlight, A ticks,
  // B or LB goes back to Ask, RB on to Guide. The log is another window: it's driven through the app.
  const [logFocus, setLogFocus] = useState(false);
  const logKey = (action: string) => (window as any).electronAPI?.trackerKey?.(action);
  useEffect(() => {
    // Docked, the log is part of this page (components/QuestLog.tsx): the controller just moves into it (Now's box), and
    // the d-pad, A and B work there like anywhere else. Popped out (or tucked in), it's driven through the app.
    const on = () => {
      const docked = document.querySelector<HTMLElement>('[data-qc-log] [data-qc-log-now]:not([disabled])')
        || document.querySelector<HTMLElement>('[data-qc-log] button:not([disabled])');
      if (docked) { setFocusRef.current(docked); return; }
      setLogFocus(true);
      logKey('focus');
    };
    // Somewhere asked for the controller's focus (a new answer's "Set as Now").
    const focusEl = (e: Event) => {
      const el = (e as CustomEvent).detail?.el;
      if (el instanceof HTMLElement && document.documentElement.classList.contains('qc-pad')) setFocusRef.current(el);
    };
    window.addEventListener('qc-log-focus', on);
    window.addEventListener('qc-pad-focus', focusEl);
    return () => { window.removeEventListener('qc-log-focus', on); window.removeEventListener('qc-pad-focus', focusEl); };
  }, []);
  // Out of the log when controller mode ends or the log goes (detached, put away, the panel hidden).
  useEffect(() => {
    if (logFocus && (!padMode || !logAttached || !enabled)) { setLogFocus(false); logKey('blur'); }
  }, [logFocus, padMode, logAttached, enabled]);

  // The quick questions (src/utils/quickQuestions.ts): the starters, then the ones behind "More" (and "Just a hint"
  // with hint mode on).
  const quickIds = [...QUICK_MAIN, ...QUICK_MORE, ...(hintMode ? [QUICK_HINTS[0]] : [])];
  const questionLabels = quickIds.map((id) => t(quickLabelKey(id)));

  // Controller mode shows the focus ring and button hints; any mouse or keyboard use hides them again.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('qc-pad', padMode && enabled);
    if (!padMode) return;
    const exit = (e: Event) => {
      if ((e as MouseEvent).isTrusted === false) return;
      setPadMode(false);
      setPanel(null);
      staleRef.current = true;
      cardRef.current = null;
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
    if (focusedRef.current) focusedRef.current.removeAttribute('data-qc-pad-focus');
    focusedRef.current = el;
    setKind(
      !el ? 'other'
        : el.matches('input[type="range"]') ? 'slider'
        : el.matches('[data-qc-ask-input]') ? 'ask'
        : el.matches('[data-pad-stop="quick"]') ? 'quick'
        : el.matches('[data-pad-stop="answer"]') ? 'answer'
        : cardRef.current && cardRef.current.contains(el) ? 'card'
        : el.closest('[data-qc-log]') ? 'log'
        : el.closest('[role="dialog"], .fixed.inset-0') ? 'dialog'
        : 'other',
    );
    if (!el) return;
    el.setAttribute('data-qc-pad-focus', ''); // an attribute: React redraws class lists (a tab that changes its look), not this
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  const setFocusRef = useRef(setFocus);
  setFocusRef.current = setFocus;

  // The keyboard's caret (where letters go; LT / RT move it) and its word suggestions (step 5), from what's on screen.
  const [caret, setCaret] = useState(0);
  const vocabRef = useRef<Vocab>(new Map());
  const openKeyboard = useCallback(() => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-qc-ask-input]');
    const value = box?.value ?? '';
    setText(value);
    setCaret(value.length);
    setKb({ row: 1, col: 0, shift: false, symbols: false });
    // Words and names to suggest: the game (header), the quest log, the latest answers.
    const texts = [
      document.querySelector<HTMLElement>('header')?.innerText || '',
      document.querySelector<HTMLElement>('[data-qc-log]')?.innerText || '',
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-pad-stop="answer"]')).slice(-6).map((el) => el.innerText),
    ];
    vocabRef.current = buildVocab(texts);
    setPanel('keyboard');
  }, []);

  /**
   * The quick menu (step 3): what used to sit on hidden buttons, in one ring. Desktop-only actions (screenshot, find
   * markers, settings, hide) only on the desktop.
   */
  const desktop = !!electronAPI();
  const quickMenu: { key: string; label: string; Icon: React.ComponentType<{ className?: string }>; run: () => void }[] = [
    { key: 'help', label: t('set.locateKey'), Icon: LocateFixed, run: () => emit('qc-help-here') },
    ...(desktop ? [{ key: 'shot', label: t('pad.shotAsk'), Icon: Camera, run: () => emit('trigger-auto-screenshot-submit') }] : []),
    { key: 'speak', label: t('pad.voice'), Icon: Mic, run: () => emit('trigger-voice-record') },
    ...(desktop ? [{ key: 'find', label: t('set.sc.findMarkers'), Icon: ScanSearch, run: () => emit('qc-find-markers') }] : []),
    { key: 'log', label: t('pad.questLog'), Icon: ScrollText, run: () => emit('qc-toggle-log') },
    { key: 'model', label: t('pad.model'), Icon: Zap, run: () => emit('qc-toggle-answer-model') },
    { key: 'games', label: t('pad.switchGame'), Icon: Gamepad2, run: () => emit('qc-open-games') },
    { key: 'type', label: t('pad.keyboard'), Icon: Keyboard, run: () => openKeyboardRef.current() },
    ...(desktop ? [{ key: 'settings', label: t('common.settings'), Icon: Settings, run: () => electronAPI()?.openSettingsWindow?.() }] : []),
    ...(desktop ? [{ key: 'hide', label: t('pad.hideApp'), Icon: EyeOff, run: () => electronAPI()?.toggleSlide?.() }] : []),
  ];

  /** The answer the controller is on (the answer itself, or a control inside it). */
  const currentAnswer = (): HTMLElement | null => {
    const el = (document.activeElement as HTMLElement | null) || focusedRef.current;
    return (el?.closest?.('[data-pad-stop="answer"]') as HTMLElement | null) || null;
  };
  /**
   * The Actions menu for an answer: its own buttons in order (read aloud, 👍 / 👎, pin, the markers' Show / Hide and
   * Find again), then what its ⋯ menu holds (save to notes, copy, report), run without opening that menu.
   */
  const openActions = useCallback((answer: HTMLElement) => {
    const items: { label: string; run: () => void }[] = [];
    const seen = new Set<string>();
    for (const el of Array.from(answer.querySelectorAll<HTMLElement>('[data-pad-action]'))) {
      const label = (el.getAttribute('data-pad-label') || el.getAttribute('aria-label') || el.title || el.innerText || '').trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      items.push({ label, run: () => el.click() });
    }
    const id = answer.getAttribute('data-msg-id') || '';
    for (const [action, key] of [['save', 'chat.saveTitle'], ['copy', 'chat.copy'], ['report', 'report.tooltip']] as const) {
      items.push({ label: t(key), run: () => emit('qc-answer-action', { id, action }) });
    }
    setActions(items);
    setAIndex(0);
    setPanel('actions');
  }, [t]);

  const showIntroRef = useRef(showIntro);
  showIntroRef.current = showIntro;
  const openKeyboardRef = useRef(openKeyboard);
  openKeyboardRef.current = openKeyboard;

  // The quick menu over the game (electron/wheel.cjs): the desktop app shows it, not the panel, when the controller's
  // open combo is used with the panel away. It gets this menu's labels (plus "Open the panel" first; Hide the app means
  // nothing there), and sends back what was picked.
  const quickMenuRef = useRef(quickMenu);
  quickMenuRef.current = quickMenu;
  useEffect(() => {
    const api = electronAPI();
    if (!api?.setQuickMenu) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    api.setQuickMenu(
      [{ key: 'panel', label: t('pad.openPanel') }, ...quickMenuRef.current.filter((i) => i.key !== 'hide').map(({ key, label }) => ({ key, label }))],
      { title: t('pad.quickMenu'), listening: t('pad.listening'), listeningTap: t('pad.listeningTap'), select: t('pad.select'), close: t('common.close'), ask: t('pad.ask'), cancel: t('common.cancel'), accent, glyphs: { a: glyph('a', style), b: glyph('b', style) } },
    );
  }, [locale, t, style]);
  useEffect(() => {
    electronAPI()?.onQuickAction?.((key: string) => {
      // Speak from the ring: listening while it's up; A asks, B cancels.
      if (key.startsWith('talk-')) return emit('qc-talk', { state: key.slice(5) });
      quickMenuRef.current.find((i) => i.key === key)?.run();
    });
  }, []);

  const typeText = useCallback((next: string, nextCaret: number) => {
    setText(next);
    setCaret(Math.max(0, Math.min(next.length, nextCaret)));
    emit('qc-set-input', { text: next });
  }, []);
  const suggestions = panel === 'keyboard' ? suggest(vocabRef.current, text, caret) : [];

  const pressKey = useCallback(
    (key: string | Special) => {
      if (key === 'shift') return setKb((k) => ({ ...k, shift: !k.shift }));
      if (key === 'symbols') return setKb((k) => ({ ...k, symbols: !k.symbols }));
      const at = Math.min(caret, text.length);
      if (key === 'space') return typeText(text.slice(0, at) + ' ' + text.slice(at), at + 1);
      if (key === 'backspace') return at > 0 && typeText(text.slice(0, at - 1) + text.slice(at), at - 1);
      if (key === 'send') {
        if (text.trim()) emit('qc-ask', { text: text.trim() });
        setText('');
        setCaret(0);
        setPanel(null);
        return;
      }
      const ch = kb.shift ? key.toUpperCase() : key;
      typeText(text.slice(0, at) + ch + text.slice(at), at + ch.length);
      if (kb.shift) setKb((k) => ({ ...k, shift: false }));
    },
    [text, caret, kb.shift, typeText],
  );
  /** A word suggestion in place of the word being typed. */
  const pickSuggestion = (word: string | undefined) => {
    if (!word) return;
    const r = applySuggestion(text, Math.min(caret, text.length), word);
    typeText(r.text, r.caret);
    setKb((k) => (k.row < 0 ? { ...k, row: 0, col: 0 } : k));
  };

  const handle = useCallback(
    (e: PadEvent) => {
      if (!enabled) return;
      if (!padMode || staleRef.current) {
        // Into controller mode, or back after the panel was away: the focus starts fresh, on the Ask bar ("Open a tab
        // for X?" when it's showing), so a press never acts on a control the player can't see is selected. The press
        // still counts (A types, X speaks, Y asks a quick question), except a direction or B, which just shows where
        // the focus is.
        setPadMode(true);
        staleRef.current = false;
        cardRef.current = null;
        // The very first time: the guide comes up first, and this press only opens it.
        let seen = true;
        try {
          seen = !!localStorage.getItem('qc-pad-intro-seen');
        } catch {
          /* no storage */
        }
        if (intro && !seen) {
          setShowIntro(true);
          setFocus(defaultStop());
          return;
        }
        if (e.type === 'button' && !panel) {
          const offer = document.querySelector<HTMLElement>('[data-qc-offer-open]');
          if (offer && e.button === 'a') { offer.click(); return; }
          setFocus(offer || defaultStop());
          if (['up', 'down', 'left', 'right', 'b'].includes(e.button)) return;
        }
      }

      // The right stick points in the quick menu; elsewhere its direction means nothing (it scrolls).
      if (e.type === 'stick') {
        if (panel === 'quick') {
          const i = ringIndex(e.x, e.y, quickMenu.length);
          if (i !== null) setQmIndex(i);
        }
        return;
      }
      if (showIntroRef.current) {
        if (e.type === 'button' && (e.button === 'a' || e.button === 'b')) closeIntro();
        return;
      }
      if (e.type === 'scroll') {
        if (panel === 'quick') return;
        const el = scrollableIn(topScope());
        if (el) el.scrollBy({ top: e.dy });
        return;
      }
      // Hold to talk (immersive mode): the chat listens while held and sends when let go.
      if (e.type === 'talk') {
        setPanel(null);
        setTalking(e.state === 'start');
        emit('qc-talk', { state: e.state });
        return;
      }
      const b = e.button;
      // In the attached quest log.
      if (logFocus) {
        if (b === 'up' || b === 'down') logKey(b === 'down' ? 'next' : 'prev');
        else if (b === 'a') logKey('tick');
        else if (b === 'b' || b === 'rb') {
          setLogFocus(false);
          logKey('blur');
          if (b === 'rb') emit('qc-pad-mode', { dir: 1, fromLog: true });
        }
        return;
      }
      // Triggers page through long answers (and lists), most of a screen at a time. (In the keyboard: the caret.)
      if ((b === 'lt' || b === 'rt') && panel !== 'keyboard') {
        const el = scrollableIn(topScope());
        if (el) el.scrollBy({ top: (b === 'rt' ? 1 : -1) * Math.round(el.clientHeight * 0.8), behavior: 'smooth' });
        return;
      }

      // --- Quick questions panel
      if (panel === 'questions') {
        if (b === 'up') setQIndex((i) => (i + questionLabels.length - 1) % questionLabels.length);
        else if (b === 'down') setQIndex((i) => (i + 1) % questionLabels.length);
        else if (b === 'a') { emit('qc-ask', { text: questionLabels[qIndex], quick: quickIds[qIndex] }); setPanel(null); }
        else if (b === 'b' || b === 'y') setPanel(null);
        return;
      }

      // --- Quick menu: the d-pad steps round the ring (the right stick points); A chooses; B or Menu closes.
      if (panel === 'quick') {
        const n = quickMenu.length;
        if (b === 'right' || b === 'down') setQmIndex((i) => (i + 1) % n);
        else if (b === 'left' || b === 'up') setQmIndex((i) => (i + n - 1) % n);
        else if (b === 'a') {
          const item = quickMenu[qmIndex];
          setPanel(null);
          item?.run();
        } else if (b === 'b' || b === 'start') setPanel(null);
        return;
      }

      // --- Actions menu
      if (panel === 'actions') {
        if (b === 'up') setAIndex((i) => (i + actions.length - 1) % Math.max(1, actions.length));
        else if (b === 'down') setAIndex((i) => (i + 1) % Math.max(1, actions.length));
        else if (b === 'a') {
          const item = actions[aIndex];
          setPanel(null);
          item?.run();
        } else if (b === 'b' || b === 'y') setPanel(null);
        return;
      }

      // --- On-screen keyboard
      if (panel === 'keyboard') {
        const rows = kb.symbols ? SYMBOLS : LETTERS;
        const lastRow = rows.length; // index of the specials row
        // Row -1: the word suggestions above the keys (when there are any).
        if (kb.row < 0) {
          if (!suggestions.length || b === 'down') setKb((k) => ({ ...k, row: 0, col: 0 }));
          else if (b === 'left' || b === 'right') setKb((k) => ({ ...k, col: (k.col + (b === 'right' ? 1 : suggestions.length - 1)) % suggestions.length }));
          else if (b === 'a') pickSuggestion(suggestions[kb.col]);
          if (b === 'down' || b === 'left' || b === 'right' || b === 'a') return;
        }
        if (b === 'lt' || b === 'rt') return setCaret((c) => Math.max(0, Math.min(text.length, c + (b === 'rt' ? 1 : -1))));
        if (b === 'rb') return pickSuggestion(suggestions[0]);
        if (b === 'lb') {
          const r = deleteWord(text, Math.min(caret, text.length));
          return typeText(r.text, r.caret);
        }
        if (b === 'up' && kb.row === 0 && suggestions.length) return setKb((k) => ({ ...k, row: -1, col: 0 }));
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
      // Inside an answer: its own controls; B back out to the answer.
      const card = cardRef.current && document.contains(cardRef.current) && scope === document.body ? cardRef.current : null;
      if (cardRef.current && !card) cardRef.current = null;
      if (card) {
        if (b === 'b') {
          cardRef.current = null;
          setFocus(card);
          return;
        }
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
          const items = focusables(card).filter((el) => !el.matches('[data-qc-send]'));
          const current = document.activeElement instanceof HTMLElement ? document.activeElement : focusedRef.current;
          const next = nextInDirection(current && card.contains(current) ? current : null, b, items);
          if (next) setFocus(next);
          return;
        }
      }
      // In the docked quest log: B back to the question box; RB on to the Guide, LB back to Ask.
      const inLog = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-qc-log]');
      // In the quest log (the left end): LB stays, B or RB back to the Ask bar.
      if (inLog && b === 'lb') return;
      if (inLog && (b === 'b' || b === 'rb')) {
        setFocus(document.querySelector<HTMLElement>('[data-qc-ask-input]'));
        if (b === 'rb') emit('qc-pad-mode', { dir: 1, fromLog: true });
        return;
      }
      // A slider (text size, volume): left / right change it, a step at a time.
      const onSlider = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range' ? document.activeElement : null;
      if (onSlider && (b === 'left' || b === 'right')) {
        const step = Number(onSlider.step) || 1;
        const min = onSlider.min === '' ? 0 : Number(onSlider.min);
        const max = onSlider.max === '' ? 100 : Number(onSlider.max);
        const next = Math.max(min, Math.min(max, Number(onSlider.value) + (b === 'right' ? step : -step)));
        // React keeps its own copy of the value: set it the way a person dragging would.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(onSlider, String(next));
        onSlider.dispatchEvent(new Event('input', { bubbles: true }));
        onSlider.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
        const current = document.activeElement instanceof HTMLElement ? document.activeElement : focusedRef.current;
        if (scope !== document.body) {
          // A dialog: its controls, as before (dialogs get their own layout in a later step).
          setFocus(nextInDirection(current, b, focusables(scope).filter((el) => !el.matches('[data-qc-send]'))));
          return;
        }
        const { els, stops } = gatherStops();
        const at = current ? els.findIndex((el) => el === current || el.contains(current)) : -1;
        if (at < 0) {
          setFocus(defaultStop());
          return;
        }
        // Answers go in conversation order (scrolled out of view, they can sit below the quick questions on screen):
        // up and down step answer to answer; down from the newest goes to the quick questions, and up from those to
        // the newest answer.
        const answers = els.filter((el) => el.matches('[data-pad-stop="answer"]'));
        const cur = els[at];
        if ((b === 'up' || b === 'down') && answers.includes(cur)) {
          const i = answers.indexOf(cur) + (b === 'down' ? 1 : -1);
          if (i >= 0 && i < answers.length) return setFocus(answers[i]);
          if (b === 'up') return;
          const below = els.filter((el) => !answers.includes(el) && !el.closest('[data-qc-log]'));
          const bottomRow = below.sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top || p.getBoundingClientRect().left - q.getBoundingClientRect().left)[0];
          if (bottomRow) setFocus(bottomRow);
          return;
        }
        const to = nextStop(stops, at, b);
        if (to === null) return;
        if (b === 'up' && answers.includes(els[to]) && answers.length) return setFocus(answers[answers.length - 1]);
        // Into the quest log from the conversation: its Now, the row that matters most.
        if (b === 'left' && !cur.closest('[data-qc-log]') && els[to].closest('[data-qc-log]')) {
          // (The marked Now control is its tick box; the stop is the row next to it.)
          const mark = document.querySelector<HTMLElement>('[data-qc-log] [data-qc-log-now]');
          if (mark && isVisible(mark)) {
            const m = mark.getBoundingClientRect();
            const near = els
              .filter((el) => el.closest('[data-qc-log]'))
              .map((el) => ({ el, d: Math.abs(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - (m.top + m.height / 2)) }))
              .sort((p, q) => p.d - q.d)[0];
            if (near) return setFocus(near.el);
          }
        }
        setFocus(els[to]);
      } else if (b === 'a') {
        const el = (document.activeElement as HTMLElement) || focusedRef.current;
        // "Open a tab for X?" (DetectionLine): A says yes unless the controller is on another button.
        const offer = document.querySelector<HTMLElement>('[data-qc-offer-open]');
        if (offer && (!el || el === document.body || el.matches('[data-qc-ask-input]'))) offer.click();
        else if (el?.matches('[data-qc-ask-input]')) openKeyboard();
        else if (el?.matches('[data-pad-stop="answer"]')) {
          // Into the answer: its first control (the marker chip, a link, the votes).
          const first = focusables(el).filter((c) => !c.matches('[data-qc-send]'))[0];
          if (first) {
            cardRef.current = el;
            setFocus(first);
          }
        } else if (el && el !== document.body && !el.matches('[data-qc-send]')) el.click();
      } else if (b === 'b') {
        // Back: the open dialog closes. B never hides the app (hiding is the show / hide combo).
        closeTopDialog();
      } else if (b === 'x') {
        // On an answer: read it aloud (again: stop). Elsewhere: ask out loud.
        const answer = scope === document.body ? currentAnswer() : null;
        const read = answer?.querySelector<HTMLElement>('[data-pad-action="read"]');
        if (read) read.click();
        else emit('trigger-voice-record');
      } else if (b === 'y') {
        // On an answer: its Actions menu. Elsewhere: the quick questions.
        const answer = scope === document.body ? currentAnswer() : null;
        if (answer) openActions(answer);
        else {
          setQIndex(0);
          setPanel('questions');
        }
      } else if (b === 'start') {
        // The quick menu, wherever you are (the keyboard: A on the Ask bar, or Type in this menu).
        setQmIndex(0);
        setPanel('quick');
      } else if (b === 'back') {
        // View: the quest log opens or closes (owner, Oct 30 2026). Screenshot and ask moved to L3.
        emit('qc-toggle-log');
      } else if (b === 'ls') {
        if (electronAPI()) emit('trigger-auto-screenshot-submit');
      } else if (b === 'lb' || b === 'rb') {
        // Ask -> Guide -> the next game (RB), and back (LB). Inside a dialog: nothing.
        if (scope !== document.body) {
          // A dialog with tabs (Settings): the previous / next tab, and the focus on it.
          const tabs = Array.from(scope.querySelectorAll<HTMLElement>('[data-pad-tab], [role="tab"]')).filter(isVisible);
          const at = tabs.findIndex((tb) => tb.getAttribute('aria-selected') === 'true');
          const to = tabs[at + (b === 'rb' ? 1 : -1)];
          if (to) {
            to.click();
            setFocus(to);
          }
        } else {
          emit('qc-pad-mode', { dir: b === 'rb' ? 1 : -1 });
          // The new panel's first stop once it's drawn (the quest log takes the focus itself).
          setTimeout(() => {
            const at = document.activeElement as HTMLElement | null;
            if (!at || at === document.body || !isVisible(at)) setFocusRef.current(defaultStop());
          }, 180);
        }
      } else if (b === 'rs') {
        // R3: Pro / Fast for the next question (ChatArea's switch next to the send button). Inside a dialog: nothing.
        if (scope === document.body) emit('qc-toggle-answer-model');
      }
    },
    [enabled, padMode, panel, questionLabels, qIndex, kb, pressKey, openKeyboard, setFocus, logFocus, actions, aIndex, openActions, quickMenu, qmIndex, text, caret, suggestions, typeText, showIntro, intro],
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
    // The panel slid away: whatever was selected is out of date when it comes back.
    api.onPanelHidden?.(() => {
      staleRef.current = true;
      cardRef.current = null;
    });
    api.onControllerActivated?.(() => {
      setPadMode(true);
      staleRef.current = false;
      cardRef.current = null;
      setTimeout(() => setFocus(defaultStop()), 200);
    });
    Promise.resolve(api.getControllerStatus?.())
      .then((s: any) => setDesktopPad(!!s?.available))
      .catch(() => setDesktopPad(false));
  }, [setFocus]);

  useGamepadPolling(enabled && desktopPad === false, talkButton, (evt) => handleRef.current(evt));

  if (!enabled || !padMode) return null;

  const rows = kb.symbols ? SYMBOLS : LETTERS;
  const specialsLabel: Record<Special, string> = {
    shift: '⇧',
    symbols: kb.symbols ? 'abc' : 'á#',
    space: t('pad.space'),
    backspace: '⌫',
    send: t('pad.send'),
  };

  const hasTabs = kind === 'dialog' && !!topScope().querySelector('[data-pad-tab], [role="tab"]');
  const Glyph = ({ b }: { b: string }) => {
    // The d-pad (↕ / ↔): an icon (the pixel font has no arrows).
    if (!/^[a-z0-9]+$/.test(b)) {
      return (
        <span className="qc-glyph" style={{ background: '#3f3f46', color: '#f4f4f5', borderRadius: 5 }}>
          <Move className="w-3 h-3" />
        </span>
      );
    }
    const g = glyph(b, style);
    return (
      <span className="qc-glyph" style={{ background: g.bg, color: g.fg, borderRadius: g.round ? 999 : 5 }}>
        {g.text}
      </span>
    );
  };
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

      {showIntro && (
        <div className="fixed inset-0 z-[402] pointer-events-auto flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={t('pad.introTitle')}>
          <div className="w-full max-w-md rounded-2xl bg-[#0d0e15]/97 border border-[var(--accent-border)] shadow-2xl p-5 space-y-3">
            <div className="text-base font-bold text-white">{t('pad.introTitle')}</div>
            {([
              [['↕'], 'pad.introMove'],
              [['lb', 'rb'], 'pad.introPanels'],
              [['menu'], 'pad.introMenu'],
              [['y'], 'pad.introActions'],
              [['b'], 'pad.introBack'],
            ] as [string[], string][]).map(([keys, label]) => (
              <div key={label} className="flex items-center gap-3 text-[13px] text-zinc-200">
                <span className="flex items-center gap-1 w-20 flex-shrink-0">{keys.map((k) => <Glyph key={k} b={k} />)}</span>
                <span>{t(label)}</span>
              </div>
            ))}
            <p className="text-[12px] leading-snug text-zinc-400">{t('pad.introOpen')}</p>
            <div className="flex justify-end">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white"><Glyph b="a" />{t('pad.introOk')}</span>
            </div>
          </div>
        </div>
      )}

      {panel === 'quick' && (
        <div className="fixed inset-0 z-[401] pointer-events-auto flex items-center justify-center bg-black/55" role="menu" aria-label={t('pad.quickMenu')}>
          <div className="relative" style={{ width: 360, height: 360 }}>
            <div className="absolute inset-[70px] rounded-full border border-[var(--accent-border)] bg-[#0d0e15]/95 shadow-2xl flex flex-col items-center justify-center text-center px-6">
              <div className="text-[10px] font-mono uppercase text-zinc-400 mb-1">{t('pad.quickMenu')}</div>
              <div className="text-base font-bold text-white leading-tight">{quickMenu[qmIndex]?.label}</div>
            </div>
            {quickMenu.map((item, i) => {
              const at = ringSpot(i, quickMenu.length, 150);
              const on = i === qmIndex;
              return (
                <div
                  key={item.key}
                  role="menuitem"
                  aria-current={on}
                  aria-label={item.label}
                  className={`absolute w-14 h-14 -ml-7 -mt-7 rounded-full border flex items-center justify-center transition-transform ${
                    on ? 'bg-[var(--accent-color)] border-transparent text-[#16101f] scale-110 shadow-[0_0_18px_var(--accent-glow)]' : 'bg-[#13141d] border-white/15 text-zinc-200'
                  }`}
                  style={{ left: 180 + at.x, top: 180 + at.y }}
                >
                  <item.Icon className="w-6 h-6" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {panel === 'actions' && (
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#0d0e15]/97 border border-[var(--accent-border)] shadow-2xl p-3 space-y-1" role="menu" aria-label={t('pad.actions')}>
          <div className="px-1 pb-1 text-[10px] font-mono uppercase text-zinc-400">{t('pad.actions')}</div>
          {actions.map((item, i) => (
            <div
              key={i}
              role="menuitem"
              aria-current={i === aIndex}
              className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                i === aIndex ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white' : 'border-transparent text-zinc-300'
              }`}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {panel === 'keyboard' && (
        <div className="pointer-events-auto w-full max-w-2xl rounded-2xl bg-[#0d0e15]/97 border border-[var(--accent-border)] shadow-2xl p-3.5 space-y-2" aria-label={t('pad.keyboard')}>
          <div className="px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-[15px] text-white min-h-[46px] break-words whitespace-pre-wrap" lang={locale}>
            {text ? (
              <>
                {text.slice(0, caret)}
                <span className="qc-caret" />
                {text.slice(caret)}
              </>
            ) : (
              <>
                <span className="qc-caret" />
                <span className="text-zinc-500">{t('chat.ask')}</span>
              </>
            )}
          </div>
          {/* Word suggestions: names and words from the game, the quest log and the answers (RB takes the first). */}
          <div className="flex flex-wrap gap-1.5 min-h-[34px]" aria-label={t('pad.suggestions')}>
            {suggestions.map((w, i) => (
              <span
                key={w}
                className={`px-3 h-[34px] flex items-center rounded-lg border text-sm font-semibold ${
                  kb.row < 0 && kb.col === i
                    ? 'bg-[var(--accent-color)] text-[#16101f] border-transparent'
                    : i === 0
                      ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white'
                      : 'bg-white/[0.05] border-white/10 text-zinc-200'
                }`}
              >
                {w}
              </span>
            ))}
          </div>
          {rows.map((row, r) => (
            <div key={r} className="grid grid-cols-10 gap-1.5">
              {row.map((key, c) => (
                <span
                  key={key}
                  className={`h-11 flex items-center justify-center rounded-lg border text-base font-semibold ${
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
                  className={`h-11 flex items-center justify-center rounded-lg border text-sm font-bold ${
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

      {/* The prompt bar: only the buttons that do something for what's selected (step 2), in the corner. */}
      <div className="self-end flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-3 py-1.5 rounded-xl bg-black/85 border border-white/10 text-[11px] font-medium text-zinc-200 shadow-lg">
        {panel === 'keyboard' ? (
          <>
            <Hint b="a" label={t('pad.type')} />
            {suggestions.length > 0 && <Hint b="rb" label={t('pad.useSuggestion')} />}
            <Hint b="x" label={t('pad.delete')} />
            <Hint b="lb" label={t('pad.deleteWord')} />
            <Hint b="y" label={t('pad.space')} />
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Glyph b="lt" />
              <Glyph b="rt" />
              {t('pad.cursor')}
            </span>
            <Hint b="menu" label={t('pad.send')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : panel === 'questions' ? (
          <>
            <Hint b="a" label={t('pad.ask')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : logFocus ? (
          <>
            <Hint b="↕" label={t('pad.logMove')} />
            <Hint b="a" label={t('pad.logTick')} />
            <Hint b="b" label={t('pad.back')} />
          </>
        ) : panel === 'quick' ? (
          <>
            <Hint b="rs" label={t('pad.logMove')} />
            <Hint b="a" label={t('pad.select')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : panel === 'actions' ? (
          <>
            <Hint b="a" label={t('pad.select')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : talking ? (
          <Hint b={talkButton !== 'off' ? talkButton : 'x'} label={t('pad.listening')} />
        ) : kind === 'ask' ? (
          <>
            <Hint b="a" label={t('pad.type')} />
            <Hint b="x" label={t('pad.voice')} />
            <Hint b="y" label={t('pad.questions')} />
          </>
        ) : kind === 'slider' ? (
          <>
            <Hint b="↔" label={t('pad.adjust')} />
            <Hint b="b" label={t('common.close')} />
          </>
        ) : kind === 'dialog' ? (
          <>
            <Hint b="a" label={t('pad.select')} />
            {hasTabs && (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Glyph b="lb" />
                <Glyph b="rb" />
                {t('pad.tabs')}
              </span>
            )}
            <Hint b="b" label={t('common.close')} />
          </>
        ) : kind === 'quick' ? (
          <Hint b="a" label={t('pad.ask')} />
        ) : kind === 'answer' ? (
          <>
            <Hint b="a" label={t('pad.open')} />
            <Hint b="x" label={t('chat.readAloud')} />
            <Hint b="y" label={t('pad.actions')} />
            <Hint b="rt" label={t('pad.page')} />
          </>
        ) : kind === 'card' ? (
          <>
            <Hint b="a" label={t('pad.select')} />
            <Hint b="y" label={t('pad.actions')} />
            <Hint b="b" label={t('pad.back')} />
          </>
        ) : (
          <>
            <Hint b="a" label={t('pad.select')} />
            <Hint b="b" label={t('pad.back')} />
          </>
        )}
      </div>
    </div>
  );
}
