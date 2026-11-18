/**
 * The answer card over the game (controller mode, owner Nov 17 2026: "never steal focus from the game"). An answer to
 * something asked from the quick menu over the game shows here, not in the panel: a small card in the top-right corner
 * of the game's screen that never takes focus (focusable: false, only ever shown with showInactive) and lets the mouse
 * through, so every button press and click keeps going to the game. The wheel's "Open this answer" opens the panel at
 * the answer; the card fades on its own after a minute.
 *
 *   thinking(label)  "Thinking…" under what was asked, as soon as it's asked
 *   answer({ id, question, title, text })  the answer (the newest one while the card is up)
 *   putAway()  out of sight (the wheel opened); the answer is kept for "Open this answer"
 */
const { BrowserWindow } = require('electron');
const path = require('path');

const WIDTH = 400;
const HEIGHT = 340;
const ANSWER_MS = 60000; // an answer fades after this
const THINKING_MS = 120000; // and a question that never got one, after this

/** @param {{ display: () => Electron.Display, strings: () => object }} opts */
function createAnswerCard(opts) {
  let win = null;
  let ready = false;
  let queue = [];
  let timer = null;
  let current = null; // { id, question, title, text, at } the answer on the card (or put away), for "Open this answer"
  let shownAt = 0;

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
      width: WIDTH,
      height: HEIGHT,
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
    // Clicks go through to the game, and the card is never in the app's own screenshots.
    win.setIgnoreMouseEvents(true);
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

  function place(w) {
    const d = opts.display();
    const { x, y, width } = d.workArea || d.bounds;
    w.setBounds({ x: Math.round(x + width - WIDTH - 24), y: Math.round(y + 24), width: WIDTH, height: HEIGHT });
  }

  function showFor(ms) {
    const w = ensure();
    place(w);
    if (!w.isVisible()) w.showInactive();
    w.webContents.invalidate(); // a fresh frame for what's just been sent
    shownAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(hide, ms);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    shownAt = 0;
    send('card-hide', {});
    // After the fade.
    setTimeout(() => { if (win && !win.isDestroyed() && !shownAt) win.hide(); }, 260);
  }

  return {
    /** Asked from the wheel over the game: the card shows what was asked, thinking. */
    thinking(label) {
      current = null;
      showFor(THINKING_MS);
      send('card-show', { state: 'thinking', question: String(label || ''), strings: opts.strings() });
    },
    /** An answer (the newest one while the card is up): it replaces whatever the card showed. */
    answer(a) {
      if (!a || !a.text) return;
      current = { id: String(a.id || ''), question: String(a.question || ''), title: String(a.title || ''), text: String(a.text || '').slice(0, 4000), at: Date.now() };
      showFor(ANSWER_MS);
      send('card-show', { state: 'answer', ...current, strings: opts.strings() });
    },
    /** Out of sight (the wheel opened over it); its answer stays for "Open this answer" a little longer. */
    putAway() {
      if (shownAt) hide();
    },
    hide() {
      current = null;
      hide();
    },
    /** Showing (thinking or an answer): answers that arrive now go on it. */
    isShowing: () => !!shownAt,
    /** The answer "Open this answer" opens: the one on the card, or put away within the last 2 minutes. */
    recent() {
      return current && Date.now() - current.at < 120000 ? current : null;
    },
  };
}

module.exports = { createAnswerCard };
