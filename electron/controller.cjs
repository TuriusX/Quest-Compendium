/**
 * Controller support for the desktop overlay.
 *
 * Browser-based apps (Electron included) generally only receive controller input while their own window is
 * focused, so an overlay cannot see a controller while the game has focus. This service reads Xbox-compatible
 * controllers at the system level through XInput (the same API most PC games use), so a controller can:
 *   - show / hide the overlay with a button combo (electron/padCombo.cjs: a 1-second hold or a double-tap), even while a
 *     game is focused,
 *   - hold a button to ask out loud (hold-to-talk), and
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

const { comboFor, createComboDetector, createHoldToTalk, BITS } = require('./padCombo.cjs');

/** Triggers past this (0-255) count as pressed: they page through long answers. */
const TRIGGER_DOWN = 128;

/**
 * @param {{ onToggle: () => void, onInput: (evt: object) => void, isVisible: () => boolean, readPad?: (i: number) => object|null, now?: () => number }} opts
 *
 * Events sent to the app (onInput): { type: 'button', button } for presses (with key-repeat for directions and the
 * triggers 'lt' / 'rt'), { type: 'scroll', dy } for the right stick, and { type: 'talk', state: 'start' | 'end' } for
 * hold-to-talk.
 */
function createControllerService(opts) {
  const readPad = opts.readPad || loadXInput();
  const now = opts.now || Date.now;
  const available = typeof readPad === 'function';

  let config = { enabled: true };
  let combo = createComboDetector(comboFor('hold-view-menu'));
  let talk = null; // hold-to-talk on one button (only while the overlay is visible)
  let talkBit = 0;
  let timer = null;
  const connected = [false, false, false, false];
  let lastScan = -Infinity;
  let prevButtons = 0;
  let firedDuringPress = false;
  const pendingMember = new Map(); // combo member -> released at (its press waits: it may be the start of the combo)
  const suppressed = new Set(); // combo members that just fired the combo: ignored until they're let go
  const repeat = { up: null, down: null, left: null, right: null, lt: null, rt: null };
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
    let lx = 0, ly = 0, ry = 0, lt = 0, rt = 0;
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
      lt = Math.max(lt, g.bLeftTrigger || 0);
      rt = Math.max(rt, g.bRightTrigger || 0);
    }

    // Show / hide combo (a 1-second hold or a double-tap). Works whether or not the overlay is visible.
    if (combo.step(buttons, t).fire) {
      firedDuringPress = true;
      pendingMember.clear();
      for (const [name, bit] of SIMPLE) if (combo.mask & bit) suppressed.add(name);
      if (talk) talk.reset();
      opts.onToggle();
    }
    if ((buttons & combo.mask) === 0 && !combo.pendingUntil()) firedDuringPress = false;

    const visible = opts.isVisible();

    // Hold to talk: a long press starts listening and the release sends; a tap is the button's normal press.
    let talkTap = false;
    if (talk) {
      let ev = null;
      if (visible || talk.active()) ev = talk.step(buttons, t);
      else talk.reset();
      if (ev === 'start' || ev === 'end') opts.onInput({ type: 'talk', state: ev });
      else if (ev === 'tap') talkTap = true;
    }

    // Simple buttons. Combo members report on release (and only if the combo didn't fire; for a double-tap, only once
    // it can no longer complete), so starting the combo never triggers their normal action. The talk button reports
    // its taps from the hold-to-talk check above.
    for (const [name, bit] of SIMPLE) {
      const down = (buttons & bit) !== 0;
      const wasDown = (prevButtons & bit) !== 0;
      const member = (combo.mask & bit) !== 0;
      if (member && suppressed.has(name)) {
        if (!down) suppressed.delete(name);
        continue;
      }
      if (bit === talkBit && talk && !member) {
        if (talkTap && visible) opts.onInput({ type: 'button', button: name });
        continue;
      }
      if (down && !wasDown) {
        if (member) pendingMember.set(name, 0);
        else if (visible) opts.onInput({ type: 'button', button: name });
      } else if (!down && wasDown && member && pendingMember.has(name)) {
        pendingMember.set(name, t); // released: reported once the combo can't complete
      }
    }
    for (const [name, releasedAt] of pendingMember) {
      if (!releasedAt) continue;
      if (firedDuringPress) { pendingMember.delete(name); continue; }
      if (combo.pendingUntil() > t) continue;
      pendingMember.delete(name);
      if (visible) opts.onInput({ type: 'button', button: name });
    }

    // Directions (D-pad or left stick) and the triggers, with key-repeat while held.
    const nx = lx / 32767;
    const ny = ly / 32767;
    const held = {
      up: (buttons & BTN.UP) !== 0 || ny > STICK_DEADZONE,
      down: (buttons & BTN.DOWN) !== 0 || ny < -STICK_DEADZONE,
      left: (buttons & BTN.LEFT) !== 0 || nx < -STICK_DEADZONE,
      right: (buttons & BTN.RIGHT) !== 0 || nx > STICK_DEADZONE,
      lt: lt > TRIGGER_DOWN,
      rt: rt > TRIGGER_DOWN,
    };
    for (const d of Object.keys(held)) {
      if (!held[d] || !visible) {
        repeat[d] = null;
        continue;
      }
      if (!repeat[d]) {
        repeat[d] = { since: t, last: t };
        opts.onInput({ type: 'button', button: d });
      } else if (t - repeat[d].since > REPEAT_DELAY_MS && t - repeat[d].last > REPEAT_EVERY_MS * (d === 'lt' || d === 'rt' ? 3 : 1)) {
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

  /** { enabled, toggle: preset, custom: { buttons, mode }, talk: button name or 'off' } (older apps: { chord }). */
  function setConfig(next) {
    const n = next || {};
    config = { enabled: n.enabled !== false };
    combo = createComboDetector(comboFor(n.toggle || n.chord || 'hold-view-menu', n.custom));
    const tb = n.talk === undefined ? 'y' : n.talk;
    talkBit = tb && tb !== 'off' && BITS[tb] ? BITS[tb] : 0;
    talk = talkBit ? createHoldToTalk(talkBit) : null;
    pendingMember.clear();
    suppressed.clear();
    if (config.enabled) start();
    else stop();
  }

  setConfig(config);
  return { available, setConfig, stop, _tick: tick };
}

module.exports = { createControllerService, BTN };
