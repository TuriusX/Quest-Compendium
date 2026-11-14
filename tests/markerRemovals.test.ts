// Run: npm run test:sync   (or: npx tsx tests/markerRemovals.test.ts)
// What the close-up check made of each marker (locate.ts markerOutcomes), and the Quality page's list of removals
// (answerFeedback.ts addRemovals: newest first, the latest 200).
import assert from "node:assert/strict";
import { markerOutcomes } from "../locate";
import { addRemovals, MARKER_REMOVALS_KEPT } from "../answerFeedback";

// Not found, found near the centre, found far off, found but the blind look saw nobody.
assert.deepEqual(
  markerOutcomes(4, [{ index: 1, x: 0.55, y: 0.45 }, { index: 2, x: 0.9, y: 0.9 }, { index: 3, x: 0.5, y: 0.5 }], new Set([3])),
  ["not there", "kept", "moved", "no person"],
);
assert.deepEqual(markerOutcomes(2, [], new Set()), ["not there", "not there"]);

const r = (n: number) => ({ at: n, game: "G", label: `M${n}`, category: "key", guide: false, outcome: "not there", client: "desktop", appVersion: "0.7.0" });
const list = addRemovals(Array.from({ length: 199 }, (_, i) => r(i)), [r(1000), r(1001)]);
assert.equal(list.length, MARKER_REMOVALS_KEPT);
assert.deepEqual(list.slice(0, 2).map((x) => x.at), [1000, 1001], "newest first");
assert.equal(list[list.length - 1].at, 197, "the oldest fall off");
assert.equal(addRemovals(undefined, [r(1)]).length, 1);

console.log("markerRemovals: all passed");
