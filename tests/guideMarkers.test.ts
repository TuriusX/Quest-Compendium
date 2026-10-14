// Run: npm run test:sync   (or: npx tsx tests/guideMarkers.test.ts)
import assert from "node:assert/strict";
import { parseSpotReply, spotPrompt } from "../spot";
import { guideEntriesForMarkers, guideMarkersPrompt } from "../guidesApi";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const page: any = {
  key: "elden-ring", slug: "volcano-manor", name: "Volcano Manor",
  items: [
    { id: "i1", name: "Magma Shot", where: "Drawing Room", missable: true },
    { id: "i2", name: "Ruins Greatsword", where: "Prison Town" },
    { id: "i3", name: "Drawing-Room Key", where: "From Tanith", missable: true },
    { id: "", name: "No id" },
  ],
  secrets: [{ id: "s1", text: "Hidden wall behind the Abductor Virgin" }],
};

test("guide entries for markers: unticked only, missables first, entries without an id left out", () => {
  const e = guideEntriesForMarkers(page, { slug: "volcano-manor", ids: ["i3"] });
  assert.deepEqual(e.map((x) => x.id), ["i1", "i2", "s1"]);
  assert.equal(e[0].missable, true);
});
test("ticks for another area don't count, and a merged tick (a+b) counts for its parts", () => {
  assert.equal(guideEntriesForMarkers(page, { slug: "limgrave", ids: ["i1"] }).length, 4);
  assert.deepEqual(guideEntriesForMarkers(page, { slug: "volcano-manor", ids: ["i1+i2"] }).map((x) => x.id), ["i3", "s1"]);
});
test("the prompt lists ids and caps the markers", () => {
  const p = guideMarkersPrompt(guideEntriesForMarkers(page, null));
  assert.match(p, /- i1 \| Magma Shot \| Drawing Room \| MISSABLE/);
  assert.match(p, /At most 2 such markers/);
});
test("a Spot it reply: visible with a point, else not visible", () => {
  assert.deepEqual(parseSpotReply('{"visible":true,"x":275,"y":215,"label":"Stormveil Castle"}'), { visible: true, x: 0.275, y: 0.215, label: "Stormveil Castle" });
  assert.deepEqual(parseSpotReply('{"visible":false,"x":null,"y":null}'), { visible: false });
  assert.deepEqual(parseSpotReply('{"visible":true,"x":null}'), { visible: false });
  assert.deepEqual(parseSpotReply("not json"), { visible: false });
  assert.match(spotPrompt("Elden Ring", "Melina", ""), /"Melina"/);
});
console.log(`\n${passed} tests passed`);
