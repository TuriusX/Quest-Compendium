// Run: npm run test:sync   (or: npx tsx tests/progress.test.ts)
import assert from "node:assert/strict";
import { singleArea } from "../src/utils/placeName";
import { addDone, doneForRequest, areaMovedPast, endedFight, extractDone, DONE_MAX, DONE_RULES } from "../src/utils/progressMemory";
import { areaForSeenText } from "../locateMe";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const areas = ["Ravaged Beach", "Emerald Grove", "The Hollow", "Blighted Village", "Overgrown Ruins - Dank Crypt"];

test("a place is always one guide area", () => {
  assert.equal(singleArea("Emerald Grove, Ravaged Beach", areas), "Emerald Grove");
  assert.equal(singleArea("The Hollow, Emerald Grove", areas), "The Hollow");
  assert.equal(singleArea("emerald grove", areas), "Emerald Grove");
  // An area whose own name has detail stays whole.
  assert.equal(singleArea("Overgrown Ruins - Dank Crypt", areas), "Overgrown Ruins - Dank Crypt");
  // Not a guide area, or a game without a guide: unchanged.
  assert.equal(singleArea("Duncan's House, near South Figaro", areas), "Duncan's House, near South Figaro");
  assert.equal(singleArea("Emerald Grove, Ravaged Beach", []), "Emerald Grove, Ravaged Beach");
});

test("the 'already done' list: newest first, repeats move to the front, capped at 30", () => {
  let list = addDone([], [{ text: "Defend the Emerald Grove gate", kind: "fight" }], 1000);
  list = addDone(list, [{ text: "Ravaged Beach", kind: "area" }], 2000);
  assert.deepEqual(list.map((x) => x.text), ["Ravaged Beach", "Defend the Emerald Grove gate"]);
  list = addDone(list, [{ text: "defend the emerald grove GATE", kind: "fight" }], 3000);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, "fight");
  for (let i = 0; i < 40; i++) list = addDone(list, [{ text: `Step number ${i}`, kind: "step" }], 4000 + i);
  assert.equal(list.length, DONE_MAX);
  assert.equal(list[0].text, "Step number 39");
  assert.deepEqual(doneForRequest(addDone([], [{ text: "Gate fight", kind: "fight" }, { text: "Ravaged Beach", kind: "area" }])), ["Fight: Gate fight", "Area: Ravaged Beach"]);
  // Too short to mean anything: ignored.
  assert.deepEqual(addDone([], [{ text: " a ", kind: "quest" }]), []);
});

test("moving on to a later guide area leaves the earlier one behind", () => {
  assert.equal(areaMovedPast(areas, "Emerald Grove", "The Hollow"), "Emerald Grove");
  assert.equal(areaMovedPast(areas, "The Hollow", "Emerald Grove"), null); // going back
  assert.equal(areaMovedPast(areas, "The Hollow", "The Hollow"), null);
  assert.equal(areaMovedPast(areas, "Somewhere else", "The Hollow"), null);
});

test("a fight ends when a combat answer is followed by a screenshot with no fight", () => {
  const msgs = [
    { role: "user" },
    { role: "assistant", combat: true, fight: "Goblin raid on the grove gate", title: "Defend the gate" },
    { role: "user" },
  ];
  assert.equal(endedFight(msgs, { noFight: true }), "Goblin raid on the grove gate");
  assert.equal(endedFight([{ role: "assistant", combat: true, title: "Defend the gate" }], { noFight: true }), "Defend the gate");
  assert.equal(endedFight(msgs, {}), null); // no screenshot (or still a fight)
  assert.equal(endedFight([{ role: "assistant" }], { noFight: true }), null); // no fight before
});

test("<qc-done> reports finished content and is always removed", () => {
  const r = extractDone('Head into the Hollow.\n<qc-done>["Defend the Emerald Grove gate", "Rescue Arabella"]</qc-done>');
  assert.deepEqual(r, { text: "Head into the Hollow.", done: ["Defend the Emerald Grove gate", "Rescue Arabella"] });
  assert.deepEqual(extractDone("No block."), { text: "No block.", done: [] });
  assert.deepEqual(extractDone("Go.\n<qc-done>{oops</qc-done>"), { text: "Go.", done: [] });
  assert.match(DONE_RULES, /<qc-done>\["Defend the Emerald Grove gate"\]<\/qc-done>/);
});

test("a place name read on screen names its guide area (or the area of a sub-location)", () => {
  const guide = {
    areas: areas.map((name) => ({ slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, story: "" })),
    pages: {
      "the-hollow": { items: [{ id: "i1", name: "Torch", where: "Druid Grove, the Hollow's inner chamber" }], secrets: [], enemies: [], shops: [], tips: [], sections: [] },
    } as Record<string, any>,
  };
  assert.equal(areaForSeenText("The Hollow", guide), "The Hollow");
  assert.equal(areaForSeenText("THE HOLLOW", guide), "The Hollow");
  assert.equal(areaForSeenText("Emerald Grove Environs", guide), "Emerald Grove");
  assert.equal(areaForSeenText("Moonrise Towers", guide), null);
  assert.equal(areaForSeenText("", guide), null);
});

console.log(`\n${passed} tests passed`);
