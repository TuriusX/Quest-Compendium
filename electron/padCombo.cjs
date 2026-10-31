/**
 * Controller button combos, as pure logic (no XInput, no timers) so they can be tested: the overlay's show/hide combo
 * and hold-to-talk.
 *
 * Show / hide (Settings, controllerToggle), chosen to rarely clash with games:
 *   'hold-view-menu'  hold View + Menu for 1 second (the default)
 *   'double-view'     double-tap View
 *   'hold-ls-rs'      hold L3 + R3 (click both sticks) for 1 second
 *   'custom'          any buttons (controllerCustom.buttons), held for 1 second or double-tapped (controllerCustom.mode)
 *   'off'
 * A normal single press never triggers either: a hold needs the buttons down together for a full second, and a
 * double-tap needs two quick, clean presses (nothing else pressed) close together. Older settings ('back+start',
 * 'ls+rs', 'lb+rb+back') map onto these.
 *
 * Hold to talk (controllerTalk, default 'y'): while the overlay is open, holding the button starts a voice question and
 * releasing it sends it; a quick tap keeps the button's normal action.
 */

const BITS = {
  up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008,
  start: 0x0010, back: 0x0020, ls: 0x0040, rs: 0x0080,
  lb: 0x0100, rb: 0x0200, a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
};

const HOLD_MS = 1000;      // a show/hide hold
const TAP_MAX_MS = 300;    // a tap is shorter than this
const TAP_GAP_MS = 350;    // the second tap of a double-tap comes within this of the first's release
const TALK_HOLD_MS = 350;  // hold-to-talk starts after this

const LEGACY = {
  'back+start': { buttons: ['back', 'start'], mode: 'hold' },
  'ls+rs': { buttons: ['ls', 'rs'], mode: 'hold' },
  'lb+rb+back': { buttons: ['lb', 'rb', 'back'], mode: 'hold' },
};
const PRESETS = {
  'hold-view-menu': { buttons: ['back', 'start'], mode: 'hold' },
  'double-view': { buttons: ['back'], mode: 'double' },
  'hold-ls-rs': { buttons: ['ls', 'rs'], mode: 'hold' },
};

/** The show/hide combo for these settings: { buttons, mode, mask } or null (off, or no usable buttons). */
function comboFor(preset, custom) {
  const p = preset || 'hold-view-menu';
  if (p === 'off') return null;
  let c = PRESETS[p] || LEGACY[p];
  if (p === 'custom') {
    const buttons = (custom && Array.isArray(custom.buttons) ? custom.buttons : []).filter((b) => BITS[b] !== undefined).slice(0, 4);
    c = { buttons: [...new Set(buttons)], mode: custom && custom.mode === 'double' ? 'double' : 'hold' };
  }
  if (!c) c = PRESETS['hold-view-menu'];
  const mask = c.buttons.reduce((m, b) => m | (BITS[b] || 0), 0);
  // A single face button, bumper or direction clashes with every game: a custom combo is two buttons or more, or one of
  // View, Menu, L3 or R3 on its own. Anything else is refused (null), like 'off'.
  if (!mask || (c.buttons.length === 1 && !['back', 'start', 'ls', 'rs'].includes(c.buttons[0]))) return null;
  return { buttons: c.buttons, mode: c.mode, mask };
}

/**
 * The show/hide combo detector. step(buttons, t) is called every tick with the buttons down (bitmask) and the time;
 * it returns { fire } (true once when the combo completes) and `owns(bit)`: whether a member button's own action must
 * wait (it may be the start of the combo). pendingUntil(): a double-tap that might still complete holds member
 * presses until then.
 */
function createComboDetector(combo, timing = {}) {
  const holdMs = timing.holdMs || HOLD_MS, tapMax = timing.tapMaxMs || TAP_MAX_MS, gap = timing.tapGapMs || TAP_GAP_MS;
  let since = null, fired = false; // hold
  // double-tap: 'idle' -> 'down1' (first press) -> 'gap' (released, waiting for the second) -> fire on the second press
  let phase = 'idle', at = 0;
  function step(buttons, t) {
    if (!combo) return { fire: false };
    const all = (buttons & combo.mask) === combo.mask;
    const others = (buttons & ~combo.mask) !== 0;
    if (combo.mode === 'hold') {
      if (all) {
        if (since === null) since = t;
        if (!fired && t - since >= holdMs) { fired = true; return { fire: true }; }
      } else { since = null; fired = false; }
      return { fire: false };
    }
    // double-tap
    if (others) { phase = 'idle'; return { fire: false }; }
    const none = (buttons & combo.mask) === 0;
    if (phase === 'idle') { if (all) { phase = 'down1'; at = t; } }
    else if (phase === 'down1') {
      if (none) { if (t - at <= tapMax) { phase = 'gap'; at = t; } else phase = 'idle'; }
      else if (t - at > tapMax) phase = 'held'; // held too long to be a tap
    } else if (phase === 'held') { if (none) phase = 'idle'; }
    else if (phase === 'gap') {
      if (all) { phase = 'fired'; return { fire: true }; }
      if (t - at > gap) phase = 'idle';
    } else if (phase === 'fired') { if (none) phase = 'idle'; }
    return { fire: false };
  }
  /** While a double-tap could still complete, a member's normal press waits (until this time; 0 = not waiting). */
  const pendingUntil = () => (combo && combo.mode === 'double' && (phase === 'down1' || phase === 'gap') ? at + (phase === 'gap' ? gap : tapMax + gap) : 0);
  return { step, pendingUntil, mask: combo ? combo.mask : 0, mode: combo ? combo.mode : null };
}

/**
 * Hold-to-talk on one button: step(down, t) returns 'tap' (released before the hold time: the button's normal
 * action), 'start' (held long enough: start listening), 'end' (released after a start: send), or null.
 */
function createHoldToTalk(bit, ms = TALK_HOLD_MS) {
  let since = null, started = false;
  function step(buttons, t) {
    const down = (buttons & bit) !== 0;
    if (down) {
      if (since === null) { since = t; started = false; }
      if (!started && t - since >= ms) { started = true; return 'start'; }
      return null;
    }
    if (since === null) return null;
    const was = started;
    since = null; started = false;
    return was ? 'end' : 'tap';
  }
  const reset = () => { since = null; started = false; };
  return { step, reset, active: () => started };
}

/**
 * The quest log's tick and cycle buttons (Settings: controllerTick, controllerNext; off by default): hold the player's
 * show / hide modifier, then press the other button. The modifier is the first button of their show / hide combo (View
 * for View + Menu or double-tap View, L3 for L3 + R3, the first of a custom combo; View when show / hide is off), since
 * they already chose it as safe for their game. Pressing the other button alone keeps its normal action; only the
 * pair counts, and never while other buttons are down.
 *   tick: 'up' | 'a' | 'off' (default)      cycle: 'right' | 'rb' | 'off' (default)
 *   Locate me: 'down' (default) | 'x' | 'off'
 * Older values name View: 'view-up', 'view-a', 'view-right', 'view-rb'.
 */
const CHORD_KEYS = ['up', 'a', 'right', 'rb', 'down', 'x'];
/** The modifier of the show / hide combo (a button name). */
function chordModifier(toggleCombo) {
  return toggleCombo && toggleCombo.buttons && toggleCombo.buttons[0] && BITS[toggleCombo.buttons[0]] !== undefined ? toggleCombo.buttons[0] : 'back';
}
/**
 * A chord's buttons, or null: off, unknown, the modifier itself, or a button of the show / hide combo (pressing that
 * combo would tick by accident).
 */
function chordFor(preset, toggleCombo) {
  const key = String(preset || 'off').replace(/^view-/, '');
  if (!CHORD_KEYS.includes(key)) return null;
  const mod = chordModifier(toggleCombo);
  if (key === mod || (toggleCombo && (toggleCombo.mask & BITS[key]))) return null;
  const buttons = [mod, key];
  const mask = BITS[mod] | BITS[key];
  return { buttons, mask, mod: BITS[mod], key: BITS[key] };
}
/** step(buttons) fires once when the second button goes down while the first is held (and nothing else is down). */
function createChord(chord) {
  let prevKey = false;
  function step(buttons) {
    if (!chord) return false;
    const keyDown = (buttons & chord.key) !== 0;
    const fire = keyDown && !prevKey && (buttons & chord.mod) !== 0 && (buttons & ~chord.mask) === 0;
    prevKey = keyDown;
    return fire;
  }
  return { step, mask: chord ? chord.mask : 0, modBit: chord ? chord.mod : 0 };
}

module.exports = { BITS, PRESETS, CHORD_KEYS, comboFor, chordFor, chordModifier, createComboDetector, createChord, createHoldToTalk, HOLD_MS, TAP_MAX_MS, TAP_GAP_MS, TALK_HOLD_MS };
