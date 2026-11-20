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
 *
 * The fan (owner, Nov 19 2026: "the radial wheel flares out from the orb in whatever corner of the screen it is on
 * inward"): with the orb on, show() gets `how.fan` (the hub on screen, the corner, the card size's scale) and the menu
 * opens as a quarter circle from the orb toward the screen's centre (fanLayout.cjs), the middle of the game kept clear.
 * Its window covers only that corner and is click-through except over the fan's parts (hit-tested here every 40 ms
 * against what the page reports, as the card does: answerCard.cjs). Opened by resting the mouse on the orb or from its
 * menu (how.mode 'mouse'), it never takes focus (the game keeps the keyboard; Esc closes it while it's up) and it closes
 * once the mouse has left the fan for a moment. Each fan's window is closed when it goes and a fresh one made for the
 * next (a window hidden and shown again loses the button-down of later clicks: answerCard.cjs found the same).
 *   Opening never picks anything (owner, Nov 19 2026: "I just don't want to click those shortcuts and it start asking
 * questions to the app again"): only a click, A / Enter / a number on a pointed item, or letting go of the shortcut's
 * keys while pointing at one (fanLayout.cjs releasePicks) does.
 */
const { BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fanMath = require('./fanLayout.cjs');

const FAN_LEAVE_MS = 650; // the mouse away from the fan this long (opened by the mouse): it closes
const FAN_MENU_GRACE_MS = 1500; // opened from the orb's menu: the mouse has this long to reach it first

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
      // Never throttled: a fan shown without focus otherwise left its highlight half-drawn (found testing, Nov 19 2026).
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'wheelPreload.cjs') },
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

  // The fan (owner, Nov 19 2026): its layout and window while it's up, the page's parts the mouse may reach, the item
  // the mouse is over, and when the mouse was last on it.
  let fan = null; // { L, hub (window coordinates), mode }
  let fanHits = [];
  let fanWatch = null;
  let fanOver = -2;
  let fanSeenAt = 0;
  let fanMouseIn = null;
  let escOn = false;

  function fanMouse(on) {
    if (!win || win.isDestroyed() || fanMouseIn === on) return;
    fanMouseIn = on;
    win.setIgnoreMouseEvents(!on);
  }
  function startFanWatch() {
    stopFanWatch();
    fanWatch = setInterval(() => {
      if (!open || !fan || !win || win.isDestroyed()) return stopFanWatch();
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = p.x - b.x, y = p.y - b.y;
      const hit = fanHits.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      fanMouse(!!hit);
      const i = hit && hit.id === 'item' ? hit.i : -1;
      if (i !== fanOver) {
        fanOver = i;
        send('wheel-input', { type: 'hover', i });
      }
      // Opened by the mouse: it goes once the mouse has left the fan (and the orb) for a moment.
      if (fan.mode === 'mouse') {
        if (hit || fanMath.inFan(x - fan.hub.x, y - fan.hub.y, fan.L)) fanSeenAt = Math.max(fanSeenAt, Date.now());
        else if (Date.now() - fanSeenAt > FAN_LEAVE_MS) close();
      }
    }, 40);
  }
  function stopFanWatch() {
    if (fanWatch) clearInterval(fanWatch);
    fanWatch = null;
  }
  /** Esc closes a fan opened by the mouse (it has no focus to hear keys): only while it's up. */
  function escape(on) {
    if (!globalShortcut || on === escOn) return;
    try {
      if (on) escOn = !globalShortcut.isRegistered('Escape') && globalShortcut.register('Escape', () => close());
      else { globalShortcut.unregister('Escape'); escOn = false; }
    } catch { escOn = false; }
  }

  /** Open; `override`: the items for this opening (main.cjs adds "Open this answer" and swaps in "Back to the game").
   * `how`: { mode: 'pad' } (the controller), { mode: 'keys', keys } (the keyboard shortcut and its keys) or
   * { mode: 'mouse', from: 'hover' | 'menu' } (the orb); with `fan: { hub, corner, scale, dot, accent }` it's the fan
   * from the orb (hub: the orb's centre on screen, or the card's inner corner while a card is out; dot: draw a hub,
   * the orb itself isn't showing). */
  function show(override, how = { mode: 'pad' }) {
    const list = Array.isArray(override) ? override : items;
    const mode = how && (how.mode === 'keys' || how.mode === 'mouse') ? how.mode : 'pad';
    const f = how && how.fan && how.fan.hub ? how.fan : null;
    const w = ensure();
    const d = opts.display();
    const area = d.workArea || d.bounds;
    const questions = Array.isArray(strings.questions) ? strings.questions : [];
    const keys = mode === 'keys';
    let fanPage = null;
    if (f) {
      const L = fanMath.layout(list.length, f.corner, f.scale);
      const r = fanMath.windowFor(f.hub, L, area);
      w.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
      fan = { L, hub: r.hub, mode };
      fanHits = [];
      fanOver = -2;
      fanSeenAt = Date.now() + (how.from === 'menu' ? FAN_MENU_GRACE_MS : 0);
      fanMouseIn = null;
      fanMouse(false);
      fanPage = { corner: L.corner, scale: L.scale, hub: r.hub, dot: !!f.dot, accent: f.accent || '' };
    } else {
      fan = null;
      w.setIgnoreMouseEvents(false); // (the whole ring takes the mouse, as before)
      const { x, y, width, height } = area;
      w.setBounds({ x: Math.round(x + (width - 560) / 2), y: Math.round(y + (height - 560) / 2), width: 560, height: 560 });
    }
    open = true;
    w.setOpacity(1); // (reopened before the last close let go of it)
    send('wheel-open', { items: list, strings, questions, mode, keys: keys && Array.isArray(how.keys) ? how.keys : [], fan: fanPage });
    if (keys) startAim();
    if (f) startFanWatch();
    if (mode === 'mouse') {
      // From the orb, by the mouse: never focused (the game keeps the keyboard and doesn't blink).
      previous = null;
      w.setFocusable(false);
      w.showInactive();
      escape(true);
      console.log('[wheel] open (fan, mouse)');
      return;
    }
    previous = opts.focusHelper.other ? opts.focusHelper.other() : null;
    w.show();
    w.focus();
    const took = opts.focusHelper.take ? opts.focusHelper.take(w) : null;
    if (!previous && took) previous = took;
    console.log(f ? `[wheel] open (fan, ${mode})` : '[wheel] open');
  }

  /** Close; `toPanel`: the panel opens next and takes focus itself (no hand-back to the game; resolves with the game's
   * window, for the panel to give focus back to). */
  function close(toPanel = false) {
    if (!open) return Promise.resolve();
    open = false;
    stopAim();
    stopFanWatch();
    escape(false);
    const wasFan = fan;
    fan = null;
    if (opts.onClose) opts.onClose();
    const w = win;
    send('wheel-close', {});
    // A fan's window goes for good; a fresh one (never shown) waits for the next opening.
    const retire = () => {
      if (!wasFan || !w || w.isDestroyed()) return;
      if (win === w) { win = null; ready = false; queue = []; }
      w.destroy();
      setTimeout(() => { if (!open && !win) ensure(); }, 50);
    };
    if (toPanel || !w || w.isDestroyed()) {
      if (w && !w.isDestroyed()) w.hide();
      retire();
      // The panel takes focus next: it gets the game's window, to give focus back to when it goes away.
      const game = previous;
      previous = null;
      return Promise.resolve(game);
    }
    // Opened by the mouse: it never had focus, so there's none to give back.
    if (wasFan && wasFan.mode === 'mouse') {
      w.hide();
      retire();
      previous = null;
      return Promise.resolve();
    }
    // Out of sight at once; focus back to the game once every button is let go.
    w.setOpacity(0);
    const back = previous;
    previous = null;
    return opts.whenReleased().then(() => {
      if (!w || w.isDestroyed() || (open && win === w)) return;
      if (opts.focusHelper.restore) opts.focusHelper.restore(w, back, {});
      w.hide();
      w.setOpacity(1);
      retire();
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
  // The fan's parts the mouse may reach (window coordinates): its items (with their index), the caption, the list.
  ipcMain.on('wheel-hits', (event, list) => {
    if (!win || event.sender !== win.webContents || !fan) return;
    fanHits = (Array.isArray(list) ? list : []).slice(0, 40).map((r) => ({
      id: ['item', 'caption', 'list'].includes(r && r.id) ? r.id : 'caption', i: Number.isInteger(r && r.i) ? r.i : -1,
      x: Number(r.x) || 0, y: Number(r.y) || 0, w: Math.max(0, Number(r.w) || 0), h: Math.max(0, Number(r.h) || 0),
    }));
  });

  return {
    isOpen: () => open,
    /** Open as the fan from the orb: how it was opened ('pad', 'keys', 'mouse'); null when closed or the full ring. */
    fanMode: () => (open && fan ? fan.mode : null),
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
