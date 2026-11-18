// Run: npx tsx tests/ringPoint.test.ts   (part of npm run test:sync)
// Both sticks and the d-pad point at the quick menu the same way (owner, Nov 17 2026), in the panel's ring
// (src/utils/padStops.ts) and the wheel over the game (electron/ringPoint.js): both run on the same cases.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createRingPointer as panelPointer } from "../src/utils/padStops";

const require = createRequire(import.meta.url);
const wheel = require("../electron/ringPoint.js") as { createRingPointer: typeof panelPointer };

for (const [name, make] of [["panel", panelPointer], ["wheel", wheel.createRingPointer]] as const) {
  // 8 items: up, right, down, left, and the diagonals.
  let p = make();
  assert.equal(p.stick("left", 0, 1, 8), 0, `${name}: left stick up = the top item`);
  assert.equal(p.stick("left", 0, 0, 8), null, `${name}: let go, nothing`);
  assert.equal(p.stick("right", 1, 0, 8), 2, `${name}: right stick right`);
  p.stick("right", 0, 0, 8);
  assert.equal(p.stick("left", -1, 0, 8), 6, `${name}: left stick left, the same as the right stick would`);
  // Both pushed: the one pushed further wins.
  p.stick("right", 0, 0.6, 8);
  assert.equal(p.stick("left", 0, -1, 8), 4, `${name}: left pushed further`);

  p = make();
  assert.equal(p.dpad("up", 0, 8, 3), 0, `${name}: d-pad up`);
  assert.equal(p.dpad("right", 1000, 8, 0), 2, `${name}: d-pad right`);
  assert.equal(p.dpad("down", 2000, 8, 2), 4);
  assert.equal(p.dpad("left", 3000, 8, 4), 6);
  // Two arrows together: the diagonal.
  p.dpad("up", 4000, 8, 6);
  assert.equal(p.dpad("right", 4040, 8, 0), 1, `${name}: up + right together`);
  assert.equal(p.dpad("up", 5000, 8, 1), 0, `${name}: up alone again later`);
  assert.equal(p.dpad("up", 6000, 8, 0), 0, `${name}: 8 items: up again stays (every item has its own direction)`);

  // 12 items: up again moves to the other item nearest that direction, and back.
  p = make();
  assert.equal(p.dpad("up", 0, 12, 5), 0);
  assert.equal(p.dpad("up", 1000, 12, 0), 1, `${name}: 12 items: up again, the neighbour`);
  assert.equal(p.dpad("up", 2000, 12, 1), 0, `${name}: and back`);
  // 11 items: left (270°) sits between items 8 (262°) and 9 (295°).
  p = make();
  assert.equal(p.dpad("left", 0, 11, 0), 8);
  assert.equal(p.dpad("left", 1000, 11, 8), 9);
  // A stick in between starts over.
  p.stick("right", 0, 1, 11);
  assert.equal(p.dpad("left", 2000, 11, 0), 8, `${name}: after the stick, left points again`);
}

console.log("ringPoint: all passed");
