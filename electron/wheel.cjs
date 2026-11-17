/**
 * The quick menu over the game (controller mode, owner Nov 17 2026: "the radial wheel pops up along with the side
 * window, which probably isn't necessary, at least until there's an answer").
 *
 * The show / hide combo, with the panel away, opens only this ring, in the middle of the game's screen. Its first item
 * opens the panel; Speak, Screenshot and ask and Help me here run from here, and the panel slides in by itself when
 * the answer arrives (main.cjs, 'answer-arrived'). While the ring is up it holds focus, like the panel, so the game
 * doesn't react to the stick or A; focus goes back to the game once every button is let go.
 *
 * The page (wheel.html) draws the ring and picks with the right stick or the d-pad; this module owns the window, the
 * focus and the controller input while it's open.
 */
const { BrowserWindow, ipcMain } = require('electron');
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
  function show() {
    const w = ensure();
    const d = opts.display();
    const { x, y, width, height } = d.workArea || d.bounds;
    w.setBounds({ x: Math.round(x + (width - 560) / 2), y: Math.round(y + (height - 560) / 2), width: 560, height: 560 });
    previous = opts.focusHelper.other ? opts.focusHelper.other() : null;
    open = true;
    send('wheel-open', { items, strings });
    w.show();
    w.focus();
    const took = opts.focusHelper.take ? opts.focusHelper.take(w) : null;
    if (!previous && took) previous = took;
    console.log('[wheel] open');
  }

  /** Close; `toPanel`: the panel opens next and takes focus itself (no hand-back to the game). */
  function close(toPanel = false) {
    if (!open) return Promise.resolve();
    open = false;
    const w = win;
    send('wheel-close', {});
    if (toPanel || !w || w.isDestroyed()) {
      if (w && !w.isDestroyed()) w.hide();
      previous = null;
      return Promise.resolve();
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

  // The page picked something, or closed.
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
    show,
    close,
    /** The app's labels for the ring (localized): [{ key, label }] and the page's strings. */
    setItems(next, nextStrings) {
      items = Array.isArray(next) ? next.filter((i) => i && i.key && i.label).slice(0, 12) : [];
      strings = nextStrings && typeof nextStrings === 'object' ? nextStrings : {};
    },
    /** Controller input while the ring is open: buttons, the stick's direction, and hold-to-talk. */
    input(evt) {
      if (!evt) return;
      if (evt.type === 'talk') {
        // A hold that asks in one motion (or the talk button): listen while held; letting go asks.
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
