/**
 * The quick menu over the game (controller mode; owner, Nov 17 2026: wheel first).
 *
 * The open combo (hold L3 + R3 by default) always opens this ring, over the game or the panel; it never shows or
 * hides the panel itself. Asking items (Help me here, Screenshot and ask, Speak, a quick question from its list) run
 * with the game in front, and their answer goes on the answer card (answerCard.cjs), never taking focus. Only the
 * panel's own items (Open the panel, Open this answer, Type, Switch game) bring the panel in. While the ring is up it
 * holds focus, so the game doesn't react to the sticks or A; focus goes back once every button is let go.
 *
 * The page (wheel.html) draws the ring and the quick questions list; either stick or the d-pad points
 * (ringPoint.js). This module owns the window, the focus and the controller input while it's open.
 */
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/**
 * @param {{ focusHelper: object, display: () => Electron.Display, whenReleased: () => Promise<void>,
 *   onChoose: (key: string) => void, onTalk: (state: 'start'|'end'|'cancel') => void }} opts
 */
function createWheel(opts) {
  let win = null;
  let ready = false;
  let previous = null; // the window that had focus (the game), given back on close
  let items = []; // [{ key, label }] from the app (localized)
  let strings = {}; // { title, listening, select, close, ask, cancel }
  let queue = [];

  const send = (channel, payload) => {
    if (!win || win.isDestroyed()) return;
    if (!ready) queue.push([channel, payload]);
    else win.webContents.send(channel, payload);
  };

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    ready = false;
    win = new BrowserWindow({
      width: 560,
      height: 560,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'wheelPreload.cjs') },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Never in the app's own screenshots (the AI sees the game, not the menu).
    win.setContentProtection(true);
    win.webContents.once('did-finish-load', () => {
      ready = true;
      for (const [c, p] of queue) win.webContents.send(c, p);
      queue = [];
    });
    win.loadFile(path.join(__dirname, 'wheel.html'));
    win.on('closed', () => {
      win = null;
      ready = false;
    });
    return win;
  }

  let open = false;
  // Keyboard and mouse (owner, Nov 18 2026): the mouse points from where the cursor was when the menu opened, as an
  // offset, so a game that hides the cursor or holds it in the middle of the screen doesn't matter. Read here (not
  // from the page's mouse events) so it works wherever the cursor is, even off the menu's window.
  let aimTimer = null;
  function startAim() {
    stopAim();
    const from = screen.getCursorScreenPoint();
    let last = '';
    aimTimer = setInterval(() => {
      if (!open) return stopAim();
      const p = screen.getCursorScreenPoint();
      const v = `${p.x - from.x},${p.y - from.y}`;
      if (v === last) return;
      last = v;
      send('wheel-input', { type: 'aim', dx: p.x - from.x, dy: p.y - from.y });
    }, 16);
  }
  function stopAim() {
    if (aimTimer) clearInterval(aimTimer);
    aimTimer = null;
  }

  /** Open; `override`: the items for this opening (main.cjs adds "Open this answer" and swaps in "Back to the game").
   * `how`: { mode: 'pad' } (the controller) or { mode: 'keys', keys } (the keyboard shortcut and its keys). */
  function show(override, how = { mode: 'pad' }) {
    const w = ensure();
    const d = opts.display();
    const { x, y, width, height } = d.workArea || d.bounds;
    w.setBounds({ x: Math.round(x + (width - 560) / 2), y: Math.round(y + (height - 560) / 2), width: 560, height: 560 });
    previous = opts.focusHelper.other ? opts.focusHelper.other() : null;
    open = true;
    const questions = Array.isArray(strings.questions) ? strings.questions : [];
    const keys = how && how.mode === 'keys';
    send('wheel-open', { items: Array.isArray(override) ? override : items, strings, questions, mode: keys ? 'keys' : 'pad', keys: keys && Array.isArray(how.keys) ? how.keys : [] });
    if (keys) startAim();
    w.show();
    w.focus();
    const took = opts.focusHelper.take ? opts.focusHelper.take(w) : null;
    if (!previous && took) previous = took;
    console.log('[wheel] open');
  }

  /** Close; `toPanel`: the panel opens next and takes focus itself (no hand-back to the game; resolves with the game's
   * window, for the panel to give focus back to). */
  function close(toPanel = false) {
    if (!open) return Promise.resolve();
    open = false;
    stopAim();
    if (opts.onClose) opts.onClose();
    const w = win;
    send('wheel-close', {});
    if (toPanel || !w || w.isDestroyed()) {
      if (w && !w.isDestroyed()) w.hide();
      // The panel takes focus next: it gets the game's window, to give focus back to when it goes away.
      const game = previous;
      previous = null;
      return Promise.resolve(game);
    }
    // Out of sight at once; focus back to the game once every button is let go.
    w.setOpacity(0);
    const back = previous;
    previous = null;
    return opts.whenReleased().then(() => {
      if (open || !w || w.isDestroyed()) return;
      if (opts.focusHelper.restore) opts.focusHelper.restore(w, back, {});
      w.hide();
      w.setOpacity(1);
    });
  }

  // The page picked something, or closed. ('q:<id>': a quick question from its list.)
  ipcMain.on('wheel-choose', (event, key) => {
    if (!win || event.sender !== win.webContents || !open) return;
    if (key === 'speak') {
      // Speak keeps the ring up, listening: A asks, B cancels.
      opts.onTalk('start');
      return;
    }
    opts.onChoose(String(key || ''));
  });
  ipcMain.on('wheel-talk', (event, state) => {
    if (!win || event.sender !== win.webContents || !open) return;
    if (state === 'end' || state === 'cancel') {
      opts.onTalk(state);
      close();
    }
  });
  ipcMain.on('wheel-dismiss', (event) => {
    if (!win || event.sender !== win.webContents) return;
    close();
  });

  return {
    isOpen: () => open,
    hasItems: () => items.length > 0,
    items: () => items.slice(),
    strings: () => strings,
    show,
    close,
    /** The app's labels for the ring (localized): [{ key, label }] and the page's strings. */
    setItems(next, nextStrings) {
      items = Array.isArray(next) ? next.filter((i) => i && i.key && i.label).slice(0, 14) : [];
      strings = nextStrings && typeof nextStrings === 'object' ? nextStrings : {};
    },
    /** Controller input while the ring is open: buttons, the stick's direction, and hold-to-talk. */
    input(evt) {
      if (!evt) return;
      if (evt.type === 'talk') {
        // The talk button: listen while held; letting go asks.
        opts.onTalk(evt.state);
        send('wheel-input', { type: 'listening', on: evt.state === 'start' });
        if (evt.state === 'end') close();
        return;
      }
      send('wheel-input', evt);
    },
  };
}

module.exports = { createWheel };
