/**
 * PlayStation controllers read directly (owner, Nov 18 2026: a wireless DualSense wasn't seen; Windows' XInput only sees
 * Xbox-style pads, and Steam turns a DualSense into one only for the game it launched). Pure parsing of the
 * controllers' HID input reports into the same shape XInput gives (controller.cjs merges it with the Xbox pads), so it
 * can be tested without a controller. sonyPads.cjs reads the reports.
 *
 * Layouts (report data after the report id):
 *   DualSense USB 0x01 (63 bytes) and Bluetooth 0x31 (one header byte first): LX LY RX RY L2 R2 counter b0 b1 b2
 *   DualSense / DualShock 4 Bluetooth "simple" 0x01 (9-10 bytes) and DualShock 4 USB 0x01: LX LY RX RY b0 b1 b2 L2 R2
 *   DualShock 4 Bluetooth 0x11: two header bytes, then the simple layout.
 * b0: the D-pad as a hat (0 up, clockwise, 8 none) in the low nibble; Square, Cross, Circle, Triangle in the high bits.
 * b1: L1 R1 L2 R2 Create/Share Options L3 R3.  b2: PS (bit 0), touchpad click (bit 1).
 */

const BITS = {
  up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008, start: 0x0010, back: 0x0020, ls: 0x0040, rs: 0x0080,
  lb: 0x0100, rb: 0x0200, guide: 0x0400, a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
};
const SONY = 0x054c;
// DualSense, DualSense Edge, DualShock 4 (two models) and its wireless adapter.
const PRODUCTS = { 0x0ce6: 'dualsense', 0x0df2: 'dualsense', 0x05c4: 'ds4', 0x09cc: 'ds4', 0x0ba0: 'ds4' };
const HAT = [BITS.up, BITS.up | BITS.right, BITS.right, BITS.down | BITS.right, BITS.down, BITS.down | BITS.left, BITS.left, BITS.up | BITS.left];

const isSonyPad = (vendorId, productId) => vendorId === SONY && Object.prototype.hasOwnProperty.call(PRODUCTS, productId);

/** 0-255 (128 centre, down / right positive) to XInput's -32768..32767 (up / right positive). */
const axis = (v, flip) => {
  const n = Math.max(-32768, Math.min(32767, Math.round((v - 128) * 256)));
  return flip ? Math.max(-32768, Math.min(32767, -n)) || 0 : n;
};

function buttons(b0, b1, b2) {
  let w = 0;
  const hat = b0 & 0x0f;
  if (hat < 8) w |= HAT[hat];
  if (b0 & 0x10) w |= BITS.x; // Square
  if (b0 & 0x20) w |= BITS.a; // Cross
  if (b0 & 0x40) w |= BITS.b; // Circle
  if (b0 & 0x80) w |= BITS.y; // Triangle
  if (b1 & 0x01) w |= BITS.lb;
  if (b1 & 0x02) w |= BITS.rb;
  if (b1 & 0x10) w |= BITS.back; // Create / Share
  if (b1 & 0x20) w |= BITS.start; // Options
  if (b1 & 0x40) w |= BITS.ls;
  if (b1 & 0x80) w |= BITS.rs;
  if (b2 & 0x01) w |= BITS.guide; // PS
  if (b2 & 0x02) w |= BITS.back; // the touchpad's click also works as View / Share
  return w;
}

/**
 * One input report to an XInput-like state, or null for a report that isn't the controller's input.
 * @param {'dualsense'|'ds4'} kind @param {number} reportId @param {Uint8Array} d the data after the report id
 */
function parseReport(kind, reportId, d) {
  if (!d || !d.length) return null;
  let o = -1, layout = '';
  if (kind === 'dualsense') {
    if (reportId === 0x01 && d.length >= 60) { o = 0; layout = 'full'; }
    else if (reportId === 0x31 && d.length >= 60) { o = 1; layout = 'full'; }
    else if (reportId === 0x01 && d.length >= 9) { o = 0; layout = 'simple'; }
  } else {
    if (reportId === 0x01 && d.length >= 9) { o = 0; layout = 'simple'; }
    else if (reportId === 0x11 && d.length >= 11) { o = 2; layout = 'simple'; }
  }
  if (o < 0) return null;
  const stick = { sThumbLX: axis(d[o], false), sThumbLY: axis(d[o + 1], true), sThumbRX: axis(d[o + 2], false), sThumbRY: axis(d[o + 3], true) };
  if (layout === 'full') {
    return { wButtons: buttons(d[o + 7], d[o + 8], d[o + 9]), bLeftTrigger: d[o + 4], bRightTrigger: d[o + 5], ...stick };
  }
  return { wButtons: buttons(d[o + 4], d[o + 5], d[o + 6]), bLeftTrigger: d[o + 7], bRightTrigger: d[o + 8], ...stick };
}

module.exports = { parseReport, isSonyPad, PRODUCTS, SONY, BITS };
