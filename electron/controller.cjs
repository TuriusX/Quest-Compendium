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
  // The Xbox / PS button: only XInputGetStateEx reports it. Games never see it, which makes it the cleanest open button.
  GUIDE: 0x0400,
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
    // XInputGetStateEx (exported only by number, 100) is the same call plus the Xbox / PS (Guide) button (controller
    // mode, Nov 2026). Used when xinput1_4 / 1_3 has it; otherwise the plain call (no Guide button).
    let getState = (index, state) => XInputGetState(index, state);
    try {
      const kernel32 = koffi.load('kernel32.dll');
      const GetModuleHandleW = kernel32.func('uintptr_t __stdcall GetModuleHandleW(str16 name)');
      const GetProcAddress = kernel32.func('void * __stdcall GetProcAddress(uintptr_t h, uintptr_t name)');
      for (const dll of ['xinput1_4.dll', 'xinput1_3.dll']) {
        const h = GetModuleHandleW(dll);
        const ex = h ? GetProcAddress(h, 100) : null;
        if (ex) {
          const proto = koffi.proto('uint32 __stdcall QC_XInputGetStateEx(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)');
          getState = (index, state) => koffi.call(ex, proto, index, state);
          break;
        }
      }
    } catch (_) {
      /* the plain call */
    }
    return (index) => {
      const state = {};
      const result = getState(index, state);
      return result === 0 ? state.Gamepad : null; // 0 = ERROR_SUCCESS, 1167 = not connected
    };
  } catch (err) {
    console.warn('[controller] XInput unavailable:', err && err.message);
    return null;
  }
}

const { comboFor, chordFor, createComboDetector, createChord, createHoldToTalk, BITS, SLIP_MS } = require('./padCombo.cjs');

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
  let combo = createComboDetector(comboFor('hold-ls-rs'));
  // The quest log's tick and cycle chords (the show / hide modifier + a button; off until turned on in Settings),
  // whether or not the overlay is visible.
  let tickChord = createChord(null);
  let nextChord = createChord(null);
  let locateChord = createChord(null); // Locate me (default: the modifier + the d-pad's down)
  let talk = null; // hold-to-talk on one button (only while the overlay is visible)
  let talkBit = 0;
  let timer = null;
  const connected = [false, false, false, false];
  let lastScan = -Infinity;
  let prevButtons = 0;
  let firedDuringPress = false;
  const pendingMember = new Map(); // combo member -> released at (its press waits: it may be the start of the combo)
  const suppressed = new Set(); // combo members that just fired the combo: ignored until they're let go
  // Combo members pressed while another member was down too (an attempt at the combo, even one let go too soon):
  // their own action never runs (owner, Nov 18 2026: L3 + R3 kept taking screenshots and switching Pro / Fast).
  const touched = new Set();
  const repeat = { up: null, down: null, left: null, right: null, lt: null, rt: null };
  let lastScroll = 0;
  let lastStick = 0;
  let stickOut = false;
  let lastStickL = 0;
  let stickOutL = false;
  // Buttons (and triggers) down on the last read: the panel hands focus back to the game only once they're all let go.
  let heldBits = 0;

  function tick() {
    const t = now();

    // Look for newly connected pads every couple of seconds (reading an empty slot is slow).
    if (t - lastScan > RESCAN_MS) {
      lastScan = t;
      for (let i = 0; i < 4; i++) if (!connected[i]) connected[i] = readPad(i) !== null;
    }

    // Merge every connected pad into one virtual controller.
    let buttons = 0;
    let lx = 0, ly = 0, ry = 0, rx = 0, lt = 0, rt = 0;
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
      if (Math.abs(g.sThumbRX || 0) > Math.abs(rx)) rx = g.sThumbRX || 0;
      lt = Math.max(lt, g.bLeftTrigger || 0);
      rt = Math.max(rt, g.bRightTrigger || 0);
    }
    // PlayStation controllers read directly (sonyPads.cjs; owner, Nov 18 2026): merged the same way.
    for (const g of (opts.extraPads ? opts.extraPads() : [])) {
      buttons |= g.wButtons;
      if (Math.abs(g.sThumbLX) > Math.abs(lx)) lx = g.sThumbLX;
      if (Math.abs(g.sThumbLY) > Math.abs(ly)) ly = g.sThumbLY;
      if (Math.abs(g.sThumbRY) > Math.abs(ry)) ry = g.sThumbRY;
      if (Math.abs(g.sThumbRX || 0) > Math.abs(rx)) rx = g.sThumbRX || 0;
      lt = Math.max(lt, g.bLeftTrigger || 0);
      rt = Math.max(rt, g.bRightTrigger || 0);
    }
    heldBits = buttons | (lt > 30 ? 0x10000 : 0) | (rt > 30 ? 0x20000 : 0);

    // Show / hide combo (a 1-second hold or a double-tap). Works whether or not the overlay is visible.
    if (combo.step(buttons, t).fire) {
      firedDuringPress = true;
      pendingMember.clear();
      touched.clear();
      for (const [name, bit] of SIMPLE) if (combo.mask & bit) suppressed.add(name);
      if (talk) talk.reset();
      // The combo only opens / closes the quick menu. (Nov 17's "keep holding to ask out loud" is gone: owner, Nov 19
      // 2026, holding L3 + R3 a moment too long sent a question. Asking is on the wheel.)
      opts.onToggle();
    }
    if ((buttons & combo.mask) === 0 && !combo.pendingUntil()) firedDuringPress = false;

    // The quest log's tick / cycle chords. The modifier press that starts one isn't also reported as its own press.
    for (const [chord, action] of [[tickChord, 'tick'], [nextChord, 'next'], [locateChord, 'locate']]) {
      if (chord.step(buttons) && opts.onTrackerKey) {
        opts.onTrackerKey(action);
        const mod = SIMPLE.find(([, bit]) => bit === chord.modBit);
        if (mod) { suppressed.add(mod[0]); pendingMember.delete(mod[0]); }
      }
    }

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
    // Two or more of the combo's buttons down at once: each of them is part of a combo attempt.
    const membersDown = buttons & combo.mask;
    if (membersDown && (membersDown & (membersDown - 1))) {
      for (const [name, bit] of SIMPLE) if (membersDown & bit) touched.add(name);
    }
    for (const [name, bit] of SIMPLE) {
      const down = (buttons & bit) !== 0;
      const wasDown = (prevButtons & bit) !== 0;
      const member = (combo.mask & bit) !== 0;
      if (member && suppressed.has(name)) {
        if (!down) { suppressed.delete(name); touched.delete(name); }
        continue;
      }
      if (bit === talkBit && talk && !member) {
        if (talkTap && visible) opts.onInput({ type: 'button', button: name });
        continue;
      }
      if (down && !wasDown) {
        // A member pressed again moments after letting go (a slip): the same press, still waiting.
        if (member) pendingMember.set(name, 0);
        else if (visible) opts.onInput({ type: 'button', button: name });
      } else if (!down && wasDown && member && pendingMember.has(name)) {
        pendingMember.set(name, t); // released: reported once the combo can't complete
      }
    }
    for (const [name, releasedAt] of pendingMember) {
      if (!releasedAt) continue;
      if (firedDuringPress) { pendingMember.delete(name); touched.delete(name); continue; }
      if (combo.pendingUntil() > t) continue;
      // Let go for good (not a slip), and only then: a member that was part of a combo attempt does nothing.
      if (t - releasedAt < SLIP_MS) continue;
      pendingMember.delete(name);
      const attempt = touched.delete(name);
      if (visible && !attempt) opts.onInput({ type: 'button', button: name });
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
      // Where a direction came from (the d-pad, or the left stick) and whether it's a key-repeat: the quick menu
      // points with the sticks' own direction ('stick' below) and takes only fresh d-pad presses.
      const bit = d === 'up' ? BTN.UP : d === 'down' ? BTN.DOWN : d === 'left' ? BTN.LEFT : d === 'right' ? BTN.RIGHT : 0;
      const src = bit ? ((buttons & bit) !== 0 ? 'dpad' : 'stick') : undefined;
      if (!repeat[d]) {
        repeat[d] = { since: t, last: t };
        opts.onInput({ type: 'button', button: d, ...(src ? { src } : {}) });
      } else if (t - repeat[d].since > REPEAT_DELAY_MS && t - repeat[d].last > REPEAT_EVERY_MS * (d === 'lt' || d === 'rt' ? 3 : 1)) {
        repeat[d].last = t;
        opts.onInput({ type: 'button', button: d, repeat: true, ...(src ? { src } : {}) });
      }
    }

    // Right stick scrolls; both sticks also point in the quick menu, so their direction is sent too while pushed
    // ({ type: 'stick', which, x, y }, -1..1, y up), and once when let go (x = y = 0).
    const pushedL = Math.hypot(nx, ny) > STICK_DEADZONE;
    if (visible && pushedL && t - lastStickL > 50) {
      lastStickL = t;
      stickOutL = true;
      opts.onInput({ type: 'stick', which: 'left', x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 });
    } else if (stickOutL && !pushedL) {
      stickOutL = false;
      opts.onInput({ type: 'stick', which: 'left', x: 0, y: 0 });
    }
    const nry = ry / 32767;
    const nrx = rx / 32767;
    if (visible && Math.abs(nry) > SCROLL_DEADZONE && t - lastScroll > 33) {
      lastScroll = t;
      opts.onInput({ type: 'scroll', dy: Math.round(-nry * 42) });
    }
    const pushed = Math.hypot(nrx, nry) > STICK_DEADZONE;
    if (visible && pushed && t - lastStick > 50) {
      lastStick = t;
      stickOut = true;
      opts.onInput({ type: 'stick', which: 'right', x: Math.round(nrx * 100) / 100, y: Math.round(nry * 100) / 100 });
    } else if (stickOut && !pushed) {
      stickOut = false;
      opts.onInput({ type: 'stick', which: 'right', x: 0, y: 0 });
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

  /**
   * { enabled, toggle: preset, custom: { buttons, mode }, talk: button name or 'off', trackerTick, trackerNext: chord
   * presets or 'off' } (older apps: { chord }).
   */
  function setConfig(next) {
    const n = next || {};
    config = { enabled: n.enabled !== false };
    const toggleCombo = comboFor(n.toggle || n.chord || 'hold-ls-rs', n.custom);
    combo = createComboDetector(toggleCombo);
    tickChord = createChord(chordFor(n.trackerTick || 'off', toggleCombo));
    nextChord = createChord(chordFor(n.trackerNext || 'off', toggleCombo));
    locateChord = createChord(chordFor(n.trackerLocate || 'down', toggleCombo));
    const tb = n.talk === undefined ? 'y' : n.talk;
    talkBit = tb && tb !== 'off' && BITS[tb] ? BITS[tb] : 0;
    talk = talkBit ? createHoldToTalk(talkBit) : null;
    pendingMember.clear();
    touched.clear();
    suppressed.clear();
    if (config.enabled) start();
    else stop();
  }

  setConfig(config);
  /**
   * Resolves once no button or trigger has been down for `quietMs` (or after `maxMs` anyway): the panel hands focus
   * back to the game only then, so the B that closed it never reaches the game as a dodge or a cancel (owner, Nov 17
   * 2026: the controller must never fight the game). Right away when no controller is read.
   */
  function whenReleased(quietMs = 120, maxMs = 3000) {
    if (!available || !timer) return Promise.resolve();
    const start = now();
    let quietSince = heldBits ? 0 : start;
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const t = now();
        if (heldBits) quietSince = 0;
        else if (!quietSince) quietSince = t;
        if ((quietSince && t - quietSince >= quietMs) || t - start >= maxMs) {
          clearInterval(check);
          resolve();
        }
      }, TICK_MS);
    });
  }
  // Tests: the combo firing, and input as if from the controller.
  const _toggle = () => opts.onToggle();
  const _input = (evt) => opts.onInput(evt);
  return { available, setConfig, stop, whenReleased, _tick: tick, _toggle, _input };
}

module.exports = { createControllerService, BTN };
