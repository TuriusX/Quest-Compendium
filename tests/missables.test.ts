// Run: npm run test:sync   (or: npx tsx tests/missables.test.ts)
import assert from "node:assert/strict";
import { parseItem, missableGaps, MISSABLE_STANDARD } from "../scripts/guides/common";
import { missablesOf, parseMissLines, applyMissRewrites } from "../scripts/guides/missables";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("the standard names the anchor, the final step and the lockout", () => {
  for (const s of ["findable anchor", "waypoint", "named NPC", "map coordinates", "exact final step", "drag the Scuffed Rock aside", "Perception check", "what locks it out", "Act 2"]) assert.ok(MISSABLE_STANDARD.includes(s), s);
});

test("ITEM lines: name | where | how | missable because (older lines still read)", () => {
  const e = parseItem(["Harper's Map", "where: From the Roadside Cliffs waypoint, walk west to the cliff edge; the Ornate Chest is under the Scuffed Rock", "how: drag the Scuffed Rock aside", "missable because: lost once you leave for Act 2"], "x1", ["bg3.wiki"]);
  assert.equal(e.where, "From the Roadside Cliffs waypoint, walk west to the cliff edge; the Ornate Chest is under the Scuffed Rock");
  assert.equal(e.how, "drag the Scuffed Rock aside");
  assert.equal(e.lockout, "lost once you leave for Act 2");
  assert.equal(e.missable, true);
  assert.deepEqual(e.sources, ["bg3.wiki"]);
  // Not missable: empty or "none".
  const n = parseItem(["Potion", "On the table in Arron's stall", "", "none"], "x2");
  assert.equal(n.missable, false);
  assert.equal(n.lockout, undefined);
  assert.equal(n.how, undefined);
  // The older format.
  const old = parseItem(["Ring", "In the chest", "missable: yes"], "x3");
  assert.equal(old.missable, true);
  assert.equal(old.where, "In the chest");
});

test("what a missable still lacks", () => {
  assert.deepEqual(missableGaps({ where: "In a chest", how: "", lockout: "" }), ["vague where", "no final step", "no lockout"]);
  assert.deepEqual(missableGaps({ where: "From the Roadside Cliffs waypoint, west to the Scuffed Rock", how: "drag the rock aside", lockout: "lost in Act 2" }), []);
});

const page = {
  name: "Roadside Cliffs",
  items: [
    { id: "x1", name: "Harper's Map", where: "In a chest", missable: true },
    { id: "x2", name: "Potion", where: "On a table", missable: false },
  ],
  sections: [{ title: "Don't miss", check: true, entries: [{ id: "m1", text: "Rescue the tiefling" }] }, { title: "Activities", check: false, entries: [{ id: "a1", text: "Fish" }] }],
};

test("a page's missables: missable items and its missable checklist", () => {
  assert.deepEqual(missablesOf(page).map((m) => `${m.kind}:${m.id}`), ["item:x1", "event:m1"]);
});

test("MISS lines rewrite only the listed entries, to the standard", () => {
  const r = parseMissLines(
    "MISS: x1 | item: Harper's Map | where: From the Roadside Cliffs waypoint, west to the cliff edge; the Ornate Chest under the Scuffed Rock | how: drag the Scuffed Rock aside | missable because: lost once you leave for Act 2\n" +
    "MISS: m1 | Rescue Mirkon | where: At the Secluded Cove south of the Emerald Grove, in the tunnels | how: push the rocks off the trapdoor | missable because: he drowns if you rest first\n" +
    "MISS: x9 | Not on the page | where: anywhere at all really | how: x | missable because: y\n" +
    "MISS: x2 | Potion | where: On the table by the door of the stall | how: - | missable because: not missable",
    new Set(["x1", "m1", "x2"]),
  );
  assert.deepEqual(r.map((x) => x.id), ["x1", "m1", "x2"]);
  assert.equal(r[0].how, "drag the Scuffed Rock aside");
  assert.equal(r[2].missable, false);
  const out = applyMissRewrites(page, r, ["bg3.wiki"]);
  assert.equal(out.items[0].lockout, "lost once you leave for Act 2");
  assert.equal(out.items[0].updatedFrom, "missables repair");
  assert.deepEqual(out.items[0].sources, ["bg3.wiki"]);
  assert.equal(out.sections[0].entries[0].text, "Rescue Mirkon: At the Secluded Cove south of the Emerald Grove, in the tunnels. Push the rocks off the trapdoor. Missable: he drowns if you rest first.");
  assert.equal(out.sections[1].entries[0].text, "Fish"); // not a missable checklist
});

console.log(`\n${passed} tests passed`);
