// Run: npx tsx tests/padStops.test.ts   (part of npm run test:sync)
// Controller mode step 1 (src/utils/padStops.ts): the d-pad moves between stops, not every button.
import assert from "node:assert/strict";
import { nextStop, sameRow, type Stop } from "../src/utils/padStops";

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
// The panel: a quest log column on the left (Now, two steps), the conversation on the right (two answers, a row of
// quick questions, the Ask bar).
const stops: Stop[] = [
  { id: 1, zone: "log", box: box(10, 100, 260, 90) }, // Now
  { id: 2, zone: "log", box: box(10, 280, 260, 40) }, // step
  { id: 3, zone: "log", box: box(10, 330, 260, 40) }, // step
  { id: 10, zone: "main", box: box(320, 120, 480, 300) }, // older answer
  { id: 11, zone: "main", box: box(320, 440, 300, 120) }, // newest answer
  { id: 20, zone: "main", box: box(320, 650, 110, 26) }, // quick: What's after that?
  { id: 21, zone: "main", box: box(440, 650, 150, 26) }, // quick: Show me where on screen
  { id: 22, zone: "main", box: box(760, 650, 60, 26) }, // quick: More
  { id: 30, zone: "main", box: box(320, 690, 510, 50) }, // Ask bar
];

assert.equal(nextStop(stops, 30, "up"), 20, "up from the Ask bar: the quick questions");
assert.equal(nextStop(stops, 20, "up"), 11, "then the newest answer");
assert.equal(nextStop(stops, 11, "up"), 10, "then the older one");
assert.equal(nextStop(stops, 10, "up"), null, "nothing above: stay");
assert.equal(nextStop(stops, 11, "down"), 20);
assert.equal(nextStop(stops, 20, "down"), 30);
assert.equal(nextStop(stops, 20, "right"), 21, "along the row of quick questions");
assert.equal(nextStop(stops, 21, "right"), 22);
assert.equal(nextStop(stops, 22, "right"), null, "the conversation is the right-most zone");
assert.equal(nextStop(stops, 20, "left"), 3, "off the row's left end: into the quest log, the nearest step");
assert.equal(nextStop(stops, 11, "left"), 3);
assert.equal(nextStop(stops, 1, "right"), 10, "from Now across to the answer beside it");
assert.equal(nextStop(stops, 2, "down"), 3);
assert.equal(nextStop(stops, 3, "down"), null, "the quest log's end: stay, never jump to another zone");
assert.equal(nextStop(stops, 99, "up"), null, "an unknown stop moves nowhere");
assert.equal(nextStop([], 1, "up"), null);
assert.equal(sameRow(box(0, 0, 10, 20), box(20, 10, 10, 20)), true);
assert.equal(sameRow(box(0, 0, 10, 20), box(20, 15, 10, 20)), false);

console.log("padStops: all passed");
