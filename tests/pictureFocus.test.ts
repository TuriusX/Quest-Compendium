// Run: npm run test:sync   (or: npx tsx tests/pictureFocus.test.ts)
import assert from "node:assert/strict";
import { asFocus, defaultFocus, coverOffsets, coverPosition } from "../src/utils/focus";
import { focusFromReply } from "../scripts/guides/pictureFocus";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a tall portrait cut to 4:3 keeps the face at the top (Dandelion, 1280×2502, face at 13%)", () => {
  const f = { x: 0.47, y: 0.13, face: true };
  const o = coverOffsets(1280, 2502, f, 288, 216);
  // The cut shows the top 38% of the picture from this offset: the face has to be inside it.
  const shown = (1280 / 2502) / (288 / 216), top = o.y * (1 - shown);
  assert.ok(f.y > top && f.y < top + shown, `face ${f.y} outside ${top}..${top + shown}`);
  assert.equal(coverPosition(1280, 2502, f, 288, 216).endsWith(" 0%"), true);
});

test("a wide card with the person on the left: the square follows them, not the middle", () => {
  const o = coverOffsets(1280, 720, { x: 0.25, y: 0.25, face: true }, 150, 150);
  assert.ok(o.x < 0.1, String(o.x));
  assert.equal(o.y, 0.5); // no room to move up or down in a square of a wide picture
});

test("a focal point in the middle, or none, cuts from the middle as before", () => {
  assert.equal(coverPosition(1280, 720, { x: 0.5, y: 0.5 }, 200, 150), "50% 50%");
  assert.equal(coverPosition(1280, 720, null, 200, 150), "50% 50%");
  assert.equal(coverPosition(0, 0, { x: 0.1, y: 0.1 }, 200, 150), "50% 50%");
});

test("stored focal points are checked; the default holds a character's portrait near the top", () => {
  assert.equal(asFocus({ x: 1.2, y: 0.5 }), null);
  assert.equal(asFocus("0.5"), null);
  assert.deepEqual(asFocus({ x: 0.3, y: 0.2, face: 1 }), { x: 0.3, y: 0.2, face: true });
  assert.deepEqual(defaultFocus(600, 1200, true), { x: 0.5, y: 0.15, face: true });
  assert.deepEqual(defaultFocus(1280, 720, true), { x: 0.5, y: 0.5 });
  assert.deepEqual(defaultFocus(600, 1200, false), { x: 0.5, y: 0.5 });
});

test("the model's box (0..1000, y first) becomes its middle; nonsense is ignored", () => {
  assert.deepEqual(focusFromReply({ face: true, box_2d: [100, 400, 200, 500] }), { x: 0.45, y: 0.15, face: true });
  assert.deepEqual(focusFromReply({ face: false, box_2d: [0, 0, 1000, 1000] }), { x: 0.5, y: 0.5 });
  assert.equal(focusFromReply({ box_2d: [500, 500, 400, 600] }), null);
  assert.equal(focusFromReply({ box_2d: [1, 2, 3] }), null);
  assert.equal(focusFromReply(null), null);
});

console.log(`\n${passed} passed`);
