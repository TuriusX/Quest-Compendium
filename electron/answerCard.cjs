/**
 * Pop-up answers over the game (owner, Nov 17-18 2026: "a brilliant change"; the design look "Pop-up answers").
 * An answer to something asked while playing (the controller's quick menu, or the keyboard's shortcuts with the panel
 * away) shows here instead of the panel sliding out: a card in a corner of the game's screen that never takes focus
 * (focusable: false, only ever shown with showInactive). The mouse goes through it except over the card itself, where
 * its buttons (More / Open / ✕) work without taking focus either. Cards never mention markers (owner, Nov 17).
 *
 *   thinking({ question, mode, place })   asked: the question and what's happening ("Got your screen", "Asking Pro"…)
 *   stage({ screen } | { sent, model })   what's happening, as the app learns it
 *   answer(payload)   the answer: title, steps, warnings in amber, one picture (or none), the text behind More
 *   update(payload)   the same answer with its picture, arrived later
 *   more()   the rest of the answer in place, then its next part (the quick menu's "More of this answer")
 *   pause() / resume()   while the quick menu is open, or the mouse is over the card
 *   setPrefs({ size, corner })   Settings: Small / Medium / Large, and the corner
 */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 520; // at Medium, on a 1080p screen
const SCALE = { s: 0.85, m: 1, l: 1.3 };
const MARGIN = 24;
const THINKING_MS = 120000; // a question that never got an answer goes after this

/** How long an answer stays: reading time for what's showing (20 s + 1 s per 15 words), at most 90 s; a warning, 30 s at least. */
function readingMs(text, hasWarning) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  const ms = Math.min(90000, 20000 + Math.round(words / 15) * 1000);
  return hasWarning ? Math.max(30000, ms) : ms;
}

// A drawn answer (wide: shown across the card, whole) may be a data URL of a few hundred KB; tag: "Illustration".
const pictureOf = (p) => (p && typeof p.url === 'string' && p.url
  ? { url: p.url, credit: String(p.credit || '').slice(0, 120), video: !!p.video, ...(p.wide ? { wide: true, tag: String(p.tag || '').slice(0, 40) } : {}) }
  : null);

/** @param {{ display: () => Electron.Display, strings: () => object, onAction: (what: string, current: object|null) => void }} opts */
function createAnswerCard(opts) {
  let win = null;
  let ready = false;
  let queue = [];
  let timer = null;
  let current = null; // the answer on the card (or put away), for "Open this answer"
  let thinkingNow = null;
  let shownAt = 0;
  let prefs = { size: 'm', corner: 'tr' };
  let height = 200;
  let moreState = { more: false, part: 0, parts: 0 };
  let total = 0; // the current timer's full length
  let endsAt = 0;
  let pausedLeft = 0;
  let mouseOver = false;

  const scale = () => SCALE[prefs.size] || 1;
  const width = () => Math.round(WIDTH * scale());
  const maxHeight = () => {
    const d = opts.display();
    return Math.round((d.workArea || d.bounds).height * 0.6);
  };

  const send = (channel, payload) => {
    if (channel === 'card-show') ensure(); // the first message makes the window (it waits for the page to load)
    if (!win || win.isDestroyed()) return;
    if (!ready) queue.push([channel, payload]);
    else win.webContents.send(channel, payload);
  };

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    ready = false;
    win = new BrowserWindow({
      width: width(),
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      // Never throttled while hidden: a transparent window shown again otherwise keeps its old (empty) frame.
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'answerCardPreload.cjs') },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Clicks go through to the game (except over the card itself, see 'card-mouse'); never in the app's own screenshots.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentProtection(true);
    win.webContents.once('did-finish-load', () => {
      ready = true;
      for (const [c, p] of queue) win.webContents.send(c, p);
      queue = [];
    });
    win.loadFile(path.join(__dirname, 'answerCard.html'));
    win.on('closed', () => {
      win = null;
      ready = false;
    });
    return win;
  }

  /** The card's corner of the game's screen, at the card's height. */
  function place() {
    if (!win || win.isDestroyed()) return;
    const d = opts.display();
    const { x, y, width: W, height: H } = d.workArea || d.bounds;
    const w = width();
    const h = Math.max(60, Math.min(maxHeight(), height));
    const right = prefs.corner === 'tr' || prefs.corner === 'br';
    const bottom = prefs.corner === 'bl' || prefs.corner === 'br';
    win.setBounds({ x: Math.round(right ? x + W - w - MARGIN : x + MARGIN), y: Math.round(bottom ? y + H - h - MARGIN : y + MARGIN), width: w, height: h });
  }

  function startTimer(ms) {
    clearTimeout(timer);
    total = ms;
    endsAt = Date.now() + ms;
    pausedLeft = 0;
    timer = setTimeout(hide, ms);
    send('card-timer', { left: ms, total: ms, paused: false });
  }

  function showFor(ms) {
    const w = ensure();
    place();
    if (!w.isVisible()) w.showInactive();
    w.webContents.invalidate(); // a fresh frame for what's just been sent
    shownAt = Date.now();
    startTimer(ms);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    shownAt = 0;
    thinkingNow = null;
    pausedLeft = 0;
    send('card-hide', {});
    // After the fade.
    setTimeout(() => {
      if (win && !win.isDestroyed() && !shownAt) {
        win.hide();
        win.setIgnoreMouseEvents(true, { forward: true });
        mouseOver = false;
      }
    }, 260);
  }

  const look = () => ({ strings: opts.strings(), scale: scale(), bottom: prefs.corner === 'bl' || prefs.corner === 'br', maxHeight: maxHeight() });

  function pause() {
    if (!shownAt || pausedLeft || thinkingNow) return;
    clearTimeout(timer);
    pausedLeft = Math.max(1000, endsAt - Date.now());
    send('card-timer', { left: pausedLeft, total, paused: true });
  }
  function resume() {
    if (!shownAt || !pausedLeft || mouseOver) return;
    const left = pausedLeft;
    pausedLeft = 0;
    endsAt = Date.now() + left;
    timer = setTimeout(hide, left);
    send('card-timer', { left, total, paused: false });
  }

  // From the page: its height (the window follows), whether More has more, the mouse over it, its buttons.
  const fromCard = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents;
  ipcMain.on('card-size', (event, h) => {
    if (!fromCard(event)) return;
    height = Math.max(60, Math.round(Number(h) || 0) + 2);
    place();
  });
  ipcMain.on('card-state', (event, s) => {
    if (!fromCard(event)) return;
    moreState = { more: !!(s && s.more), part: Number(s && s.part) || 0, parts: Number(s && s.parts) || 0 };
  });
  ipcMain.on('card-mouse', (event, over) => {
    if (!fromCard(event)) return;
    mouseOver = !!over;
    // Over the card: its buttons get the clicks (still without taking focus); elsewhere they go to the game.
    win.setIgnoreMouseEvents(!mouseOver, { forward: true });
    if (mouseOver) pause();
    else resume();
  });
  ipcMain.on('card-action', (event, what) => {
    if (!fromCard(event)) return;
    if (what === 'close') return void api.hide();
    if (what === 'open') opts.onAction('open', current);
  });

  const api = {
    /** Asked over the game: the card shows the question and what's happening. mode: 'pad' or 'keys' (its hints). */
    thinking({ question, mode, place: where } = {}) {
      current = null;
      thinkingNow = { state: 'thinking', question: String(question || ''), mode: mode === 'pad' ? 'pad' : 'keys', place: String(where || '') };
      showFor(THINKING_MS);
      send('card-show', { ...thinkingNow, ...look() });
    },
    /** What's happening while it thinks: the screenshot it took, the question sent (with Pro or Fast). */
    stage(s) {
      if (!thinkingNow || !s) return;
      if (typeof s.screen === 'string' && s.screen.startsWith('data:image')) thinkingNow.screen = s.screen;
      if (s.sent) {
        thinkingNow.sent = true;
        thinkingNow.model = s.model === 'Pro' || s.model === 'Fast' ? s.model : '';
      }
      if (typeof s.place === 'string' && s.place) thinkingNow.place = s.place;
      send('card-show', { ...thinkingNow, ...look() });
    },
    /** An answer (the newest while the card is up): it replaces whatever the card showed. */
    answer(a) {
      if (!a || !a.text) return;
      const mode = (thinkingNow && thinkingNow.mode) || (current && current.mode) || 'keys';
      // What was asked, as the card said it while thinking ("Screenshot & ask", a quick question), not the app's
      // stand-in text for a screenshot or a voice question.
      const asked = (thinkingNow && thinkingNow.question) || (current && current.id === String(a.id || '') && current.question) || '';
      thinkingNow = null;
      const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 8).map((s) => ({ kind: s.kind === 'warning' ? 'warning' : 'step', label: String(s.label || '').slice(0, 160), where: String(s.where || '').slice(0, 160) }));
      current = {
        state: 'answer', mode,
        id: String(a.id || ''), question: asked || String(a.question || ''), title: String(a.title || ''), text: String(a.text || '').slice(0, 6000),
        steps, model: a.model === 'Pro' || a.model === 'Fast' ? a.model : '', place: String(a.place || ''), combat: !!a.combat,
        picture: pictureOf(a.picture),
        at: Date.now(),
      };
      moreState = { more: false, part: 0, parts: 0 };
      const shown = steps.length ? `${current.text.split(/\s+/).slice(0, 60).join(' ')} ${steps.map((s) => `${s.label} ${s.where}`).join(' ')}` : current.text.split(/\s+/).slice(0, 180).join(' ');
      showFor(readingMs(`${current.title} ${shown}`, steps.some((s) => s.kind === 'warning')));
      send('card-show', { ...current, ...look() });
    },
    /** The same answer, updated (its picture arrived later): the card redraws without restarting its time. */
    update(a) {
      if (!current || !a || String(a.id || '') !== current.id || !shownAt) return false;
      const picture = pictureOf(a.picture);
      if (JSON.stringify(picture) !== JSON.stringify(current.picture)) {
        const newDrawing = !!(picture && picture.wide && !(current.picture && current.picture.wide));
        current.picture = picture;
        send('card-show', { ...current, ...look() });
        // A drawing arrived (a few seconds after the answer): at least 25 s more to look at it, unless paused.
        if (newDrawing && !pausedLeft && endsAt - Date.now() < 25000) startTimer(25000);
      }
      return true;
    },
    /** More of this answer: the rest in place, then the next part. Its time starts over (reading time for a part). */
    more() {
      if (!current) return;
      if (!shownAt) {
        showFor(30000);
        send('card-show', { ...current, ...look() });
      }
      send('card-more');
      startTimer(Math.min(90000, Math.max(25000, readingMs(current.text.split(/\s+/).slice(0, 140).join(' '), false))));
    },
    /** Whether More has more to show (the quick menu then offers it first). */
    canMore: () => !!current && !!shownAt && moreState.more,
    pause,
    resume,
    hide() {
      current = null;
      hide();
    },
    /** Out of sight now; the answer stays for "Open this answer" a little longer. */
    putAway() {
      if (shownAt) hide();
    },
    /** Showing (thinking or an answer): answers that arrive now go on it. */
    isShowing: () => !!shownAt,
    isThinking: () => !!thinkingNow,
    /** The answer "Open this answer" opens: the one on the card, or put away within the last 2 minutes. */
    recent() {
      return current && Date.now() - current.at < 120000 ? current : null;
    },
    setPrefs(p) {
      prefs = { size: SCALE[p && p.size] ? p.size : 'm', corner: ['tr', 'tl', 'br', 'bl'].includes(p && p.corner) ? p.corner : 'tr' };
      if (win && !win.isDestroyed()) place();
    },
  };
  return api;
}

module.exports = { createAnswerCard, readingMs };
