// Run: npx tsx tests/sonyPad.test.ts
// PlayStation controllers read directly (Nov 18 2026): their HID reports become XInput-like states.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseReport, isSonyPad, BITS } = require("../electron/sonyPadParse.cjs");

const CENTRE = [128, 128, 128, 128];
// DualSense over USB, report 0x01: LX LY RX RY L2 R2 counter b0 b1 b2 ...
const usb = (b0: number, b1: number, b2 = 0, sticks = CENTRE, l2 = 0, r2 = 0) => Uint8Array.from([...sticks, l2, r2, 7, b0, b1, b2, ...Array(53).fill(0)]);

// Nothing pressed: hat 8 (none), sticks centred.
let s = parseReport("dualsense", 0x01, usb(0x08, 0));
assert.equal(s.wButtons, 0);
assert.equal(s.sThumbLX, 0);
assert.equal(s.sThumbLY, 0);

// Cross = A, Circle = B, Square = X, Triangle = Y; D-pad up-right; L3 + R3 (the quick menu combo).
assert.equal(parseReport("dualsense", 0x01, usb(0x08 | 0x20, 0)).wButtons, BITS.a);
assert.equal(parseReport("dualsense", 0x01, usb(0x08 | 0x40, 0)).wButtons, BITS.b);
assert.equal(parseReport("dualsense", 0x01, usb(0x08 | 0x10, 0)).wButtons, BITS.x);
assert.equal(parseReport("dualsense", 0x01, usb(0x08 | 0x80, 0)).wButtons, BITS.y);
assert.equal(parseReport("dualsense", 0x01, usb(0x01, 0)).wButtons, BITS.up | BITS.right);
assert.equal(parseReport("dualsense", 0x01, usb(0x08, 0xc0)).wButtons, BITS.ls | BITS.rs);
// Options = Menu, Create = View, L1 / R1, PS = Guide.
assert.equal(parseReport("dualsense", 0x01, usb(0x08, 0x20)).wButtons, BITS.start);
assert.equal(parseReport("dualsense", 0x01, usb(0x08, 0x10)).wButtons, BITS.back);
assert.equal(parseReport("dualsense", 0x01, usb(0x08, 0x03)).wButtons, BITS.lb | BITS.rb);
assert.equal(parseReport("dualsense", 0x01, usb(0x08, 0, 0x01)).wButtons, BITS.guide);

// Sticks: left stick pushed up and right; the right stick down. XInput's Y is up-positive.
s = parseReport("dualsense", 0x01, usb(0x08, 0, 0, [255, 0, 128, 255]));
assert.ok(s.sThumbLX > 32000 && s.sThumbLY > 32000 && s.sThumbRY < -32000);
// Triggers.
s = parseReport("dualsense", 0x01, usb(0x08, 0, 0, CENTRE, 200, 10));
assert.equal(s.bLeftTrigger, 200);
assert.equal(s.bRightTrigger, 10);

// DualSense over Bluetooth, full report 0x31: one header byte first.
const bt = Uint8Array.from([0x10, ...usb(0x08 | 0x20, 0xc0)]);
assert.equal(parseReport("dualsense", 0x31, bt).wButtons, BITS.a | BITS.ls | BITS.rs);
// Bluetooth before full reports are turned on (simple 0x01): LX LY RX RY b0 b1 b2 L2 R2.
assert.equal(parseReport("dualsense", 0x01, Uint8Array.from([128, 128, 128, 128, 0x08 | 0x20, 0xc0, 0, 0, 0])).wButtons, BITS.a | BITS.ls | BITS.rs);

// DualShock 4: USB 0x01 (simple layout) and Bluetooth 0x11 (two header bytes).
assert.equal(parseReport("ds4", 0x01, Uint8Array.from([128, 128, 128, 128, 0x08 | 0x40, 0x20, 0, 0, 0, ...Array(54).fill(0)])).wButtons, BITS.b | BITS.start);
assert.equal(parseReport("ds4", 0x11, Uint8Array.from([0xc0, 0, 128, 128, 128, 128, 0x08 | 0x80, 0, 0x01, 0, 0])).wButtons, BITS.y | BITS.guide);

// Other reports (output acks, feature data) aren't input.
assert.equal(parseReport("dualsense", 0x05, Uint8Array.from([1, 2, 3])), null);

// Only Sony's game controllers; not, for example, Sony headphones (product 0x0f8a).
assert.ok(isSonyPad(0x054c, 0x0ce6));
assert.ok(isSonyPad(0x054c, 0x09cc));
assert.ok(!isSonyPad(0x054c, 0x0f8a));
assert.ok(!isSonyPad(0x045e, 0x0ce6));

console.log("sonyPad: ok");
