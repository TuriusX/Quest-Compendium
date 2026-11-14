// Run: npm run test:sync   (or: npx tsx tests/markerCheck.test.ts)
import assert from "node:assert/strict";
import { settleCheck } from "../src/utils/markerCheck";

const pts = [
  { x: 0.1, y: 0.1, label: "Chest" },
  { x: 0.5, y: 0.5, label: "Lever", where: "left of the door" },
  { x: 0.8, y: 0.2, label: "Archer" },
  { x: 0.3, y: 0.7, label: "Barrel" },
];

// Removes markers the check looked at and couldn't see, and keeps ticks on the new numbering.
{
  const s = settleCheck(pts, [{ index: 0, x: 0.1, y: 0.1 }, { index: 2, x: 0.82, y: 0.2 }, { index: 3, x: 0.3, y: 0.7 }], 4, [0, 2, 3]);
  assert.deepEqual(s.removed, [1]);
  assert.deepEqual(s.kept.map((p) => p.label), ["Chest", "Archer", "Barrel"]);
  assert.deepEqual(s.done, [0, 1, 2]);
  assert.deepEqual(s.removedLabels, ["Lever (left of the door)"]);
  assert.deepEqual(s.moves.map((m) => m.index), [2]);
  assert.equal(s.kept[1].x, 0.82);
}

// A removed marker that was ticked loses only its own tick.
{
  const s = settleCheck(pts, [{ index: 0, x: 0.1, y: 0.1 }, { index: 2, x: 0.8, y: 0.2 }, { index: 3, x: 0.3, y: 0.7 }], 4, [1, 3]);
  assert.deepEqual(s.done, [2]);
}

// Only markers the server actually checked can be removed (older servers check 5).
{
  const eight = Array.from({ length: 8 }, (_, i) => ({ x: i / 10, y: 0.5, label: `M${i}` }));
  const found = [0, 1, 2, 3, 4].map((index) => ({ index, x: index / 10, y: 0.5 }));
  assert.deepEqual(settleCheck(eight, found, 5).removed, []);
  assert.deepEqual(settleCheck(eight, found, 8).removed, [5, 6, 7]);
}

// Tiny moves are ignored.
{
  const s = settleCheck(pts, pts.map((p, index) => ({ index, x: p.x + 0.001, y: p.y })), 4);
  assert.deepEqual(s.moves, []);
  assert.deepEqual(s.removed, []);
}

console.log("markerCheck: all passed");
