/**
 * Controller support for the desktop overlay.
 *
 * Browser-based apps (Electron included) generally only receive controller input while their own window is
 * focused, so an overlay cannot see a controller while the game has focus. This service reads Xbox-compatible
 * controllers at the system level through XInput (the same API most PC games use), so a controller can:
 *   - show / hide the overlay with a held button chord, even while a game is focused, and
 *   - drive the overlay (buttons, D-pad / left stick, right-stick scrolling) while it is visible.
 *
 * Windows only. On other systems, or if XInput can't be loaded, `available` is false and the app falls back to
 * the browser Gamepad API (which works while the overlay window is focused).
 * PlayStation / Switch controllers appear as Xbox controllers when Steam Input or DS4Windows is running.
 */

const BTN = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LS: 0x0040, RS: 0x0080,
  LB: 0x0100, RB: 0x0200, A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
};

/** Buttons forwarded to the app as simple presses (directions are handled separately, with repeat). */
const SIMPLE = [
  ['a', BTN.A], ['b', BTN.B], ['x', BTN.X], ['y', BTN.Y],
  ['lb', BTN.LB], ['rb', BTN.RB], ['start', BTN.START], ['back', BTN.BACK],
  ['ls', BTN.LS], ['rs', BTN.RS],
];

/** Show/hide chords (held for HOLD_MS). */
const CHORDS = {
  'back+start': BTN.BACK | BTN.START,  // View + Menu
  'ls+rs': BTN.LS | BTN.RS,            // click both sticks
  'lb+rb+back': BTN.LB | BTN.RB | BTN.BACK,
  off: 0,
};

const HOLD_MS = 450;
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 110;
const STICK_DEADZONE = 0.55;
const SCROLL_DEADZONE = 0.25;
const TICK_MS = 16;
const RESCAN_MS = 2000;

function loadXInput() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    let lib = null;
    for (const dll of ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']) {
      try {
        lib = koffi.load(dll);
        break;
      } catch (_) {
        /* try the next one */
      }
    }
    if (!lib) return null;
    const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
      wButtons: 'uint16',
      bLeftTrigger: 'uint8',
      bRightTrigger: 'uint8',
      sThumbLX: 'int16',
      sThumbLY: 'int16',
      sThumbRX: 'int16',
      sThumbRY: 'int16',
    });
    const XINPUT_STATE = koffi.struct('XINPUT_STATE', {
      dwPacketNumber: 'uint32',
      Gamepad: XINPUT_GAMEPAD,
    });
    const XInputGetState = lib.func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)');
    return (index) => {
      const state = {};
      const result = XInputGetState(index, state);
      return result === 0 ? state.Gamepad : null; // 0 = ERROR_SUCCESS, 1167 = not connected
    };
  } catch (err) {
    console.warn('[controller] XInput unavailable:', err && err.message);
    return null;
  }
}

/**
 * @param {{ onToggle: () => void, onInput: (evt: object) => void, isVisible: () => boolean, readPad?: (i: number) => object|null, now?: () => number }} opts
 */
function createControllerService(opts) {
  const readPad = opts.readPad || loadXInput();
  const now = opts.now || Date.now;
  const available = typeof readPad === 'function';

  let config = { enabled: true, chord: 'back+start' };
  let timer = null;
  const connected = [false, false, false, false];
  let lastScan = -Infinity;
  let prevButtons = 0;
  let chordSince = null;
  let chordFired = false;
  let chordFiredDuringPress = false;
  const pendingChordPress = new Set(); // chord-member buttons pressed but not yet reported
  const repeat = { up: null, down: null, left: null, right: null };
  let lastScroll = 0;

  function tick() {
    const t = now();

    // Look for newly connected pads every couple of seconds (reading an empty slot is slow).
    if (t - lastScan > RESCAN_MS) {
      lastScan = t;
      for (let i = 0; i < 4; i++) if (!connected[i]) connected[i] = readPad(i) !== null;
    }

    // Merge every connected pad into one virtual controller.
    let buttons = 0;
    let lx = 0, ly = 0, ry = 0;
    for (let i = 0; i < 4; i++) {
      if (!connected[i]) continue;
      const g = readPad(i);
      if (!g) {
        connected[i] = false;
        continue;
      }
      buttons |= g.wButtons;
      if (Math.abs(g.sThumbLX) > Math.abs(lx)) lx = g.sThumbLX;
      if (Math.abs(g.sThumbLY) > Math.abs(ly)) ly = g.sThumbLY;
      if (Math.abs(g.sThumbRY) > Math.abs(ry)) ry = g.sThumbRY;
    }

    const chordMask = CHORDS[config.chord] || 0;

    // Show / hide chord, held for HOLD_MS. Works whether or not the overlay is visible.
    if (chordMask && (buttons & chordMask) === chordMask) {
      if (chordSince === null) chordSince = t;
      if (!chordFired && t - chordSince >= HOLD_MS) {
        chordFired = true;
        chordFiredDuringPress = true;
        pendingChordPress.clear();
        opts.onToggle();
      }
    } else {
      chordSince = null;
      chordFired = false;
    }
    if (!chordMask || (buttons & chordMask) === 0) chordFiredDuringPress = false;

    const visible = opts.isVisible();

    // Simple buttons. Chord members report on release (and only if the chord didn't fire), so starting the
    // chord never triggers their normal action.
    for (const [name, bit] of SIMPLE) {
      const down = (buttons & bit) !== 0;
      const wasDown = (prevButtons & bit) !== 0;
      const isChordMember = (chordMask & bit) !== 0;
      if (down && !wasDown) {
        if (isChordMember) pendingChordPress.add(name);
        else if (visible) opts.onInput({ type: 'button', button: name });
      } else if (!down && wasDown && isChordMember) {
        if (pendingChordPress.has(name) && !chordFiredDuringPress && visible) opts.onInput({ type: 'button', button: name });
        pendingChordPress.delete(name);
      }
    }

    // Directions (D-pad or left stick), with key-repeat while held.
    const nx = lx / 32767;
    const ny = ly / 32767;
    const dirs = {
      up: (buttons & BTN.UP) !== 0 || ny > STICK_DEADZONE,
      down: (buttons & BTN.DOWN) !== 0 || ny < -STICK_DEADZONE,
      left: (buttons & BTN.LEFT) !== 0 || nx < -STICK_DEADZONE,
      right: (buttons & BTN.RIGHT) !== 0 || nx > STICK_DEADZONE,
    };
    for (const d of Object.keys(dirs)) {
      if (!dirs[d] || !visible) {
        repeat[d] = null;
        continue;
      }
      if (!repeat[d]) {
        repeat[d] = { since: t, last: t };
        opts.onInput({ type: 'button', button: d });
      } else if (t - repeat[d].since > REPEAT_DELAY_MS && t - repeat[d].last > REPEAT_EVERY_MS) {
        repeat[d].last = t;
        opts.onInput({ type: 'button', button: d });
      }
    }

    // Right stick scrolls.
    const nry = ry / 32767;
    if (visible && Math.abs(nry) > SCROLL_DEADZONE && t - lastScroll > 33) {
      lastScroll = t;
      opts.onInput({ type: 'scroll', dy: Math.round(-nry * 42) });
    }

    prevButtons = buttons;
  }

  function start() {
    if (!available || timer) return;
    timer = setInterval(() => {
      try {
        tick();
      } catch (err) {
        console.warn('[controller] tick failed:', err && err.message);
      }
    }, TICK_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function setConfig(next) {
    config = {
      enabled: next && next.enabled !== false,
      chord: next && CHORDS[next.chord] !== undefined ? next.chord : 'back+start',
    };
    if (config.enabled) start();
    else stop();
  }

  setConfig(config);
  return { available, setConfig, stop, _tick: tick };
}

module.exports = { createControllerService, BTN, CHORDS };
