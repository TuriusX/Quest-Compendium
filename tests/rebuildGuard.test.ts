// Run: npm run test:sync   (or: npx tsx tests/rebuildGuard.test.ts)
import assert from "node:assert/strict";
import { rebuildVerdict, keepOnRestructure, normName } from "../scripts/guides/rebuildGuard";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// Crow's Perch as it was before a rebuild dropped its fights (an evidence page: checked, with its sources on the page).
const crowsPerch = {
  name: "Crow's Perch", status: "published", verified: true, sources: ["thegamer.com", "gamespot.com", "fextralife.com"],
  walkthrough: [
    { id: "w1", title: "Cross the bridge", text: "Ronvid of the Small Marsh waits at the gate." },
    { id: "w2", title: "Meet the Baron", text: "Talk to the Bloody Baron in his manor." },
    { id: "w3", title: "Ugly Baby", text: "Search the Baron's quarters." },
  ],
  fights: [
    { id: "f1", name: "Oswin", rewards: "Oswin's armour" },
    { id: "f2", name: "Baron fistfight", rewards: "the Baron's respect", sources: ["gamespot.com"] },
  ],
  items: [{ id: "i1", name: "Sigismund Dijkstra Gwent Card", where: "the Baron's office", sources: [] }],
  choices: [{ id: "c1", title: "Fate of the Botchling", options: [{ label: "Slay it" }, { label: "Name it" }] }],
};

test("Crow's Perch: a rebuild that drops the Oswin and Baron fistfight fights is held", () => {
  const rebuilt = { ...crowsPerch, fights: [] };
  const v = rebuildVerdict(crowsPerch, rebuilt, 0);
  assert.equal(v.hold, true);
  assert.deepEqual(v.lost.map((x) => x.name), ["Oswin", "Baron fistfight"]);
  assert.ok(v.lost.every((x) => x.kind === "fight" && x.sourced));
  assert.match(v.reasons[0], /drops 2 sourced entries: fight "Oswin", fight "Baron fistfight"/);
});

test("the same content reworded, reordered or moved into the walkthrough isn't a loss", () => {
  const rebuilt = {
    ...crowsPerch,
    fights: [{ id: "x", name: "Fistfight with the Bloody Baron" }],
    walkthrough: [...crowsPerch.walkthrough, { id: "w4", title: "The cellar", text: "Oswin waits in the cellar of the manor." }],
    items: [{ id: "i9", name: "Sigismund Dijkstra gwent card" }],
    choices: [{ id: "c9", title: "The fate of the botchling", options: [] }],
  };
  // "Baron fistfight" renamed "Fistfight with the Bloody Baron"; Oswin moved into a walkthrough step.
  const v = rebuildVerdict(crowsPerch, rebuilt, 500);
  assert.equal(v.hold, false);
  assert.deepEqual(v.lost, []);
});

test("unsourced entries may go from a page nobody finds; not from one with impressions", () => {
  const quick = { name: "New Londo Ruins", status: "published", verified: false, items: [{ name: "Invented Ring" }, { name: "Transient Curse" }], secrets: [{ text: "An illusory wall behind the third bell hides a chest" }] };
  const rebuilt = { ...quick, items: [{ name: "Transient Curse" }], secrets: [] };
  const free = rebuildVerdict(quick, rebuilt, 0);
  assert.equal(free.hold, false);
  assert.equal(free.lost.length, 2);
  assert.ok(free.lost.every((x) => !x.sourced));
  const ranking = rebuildVerdict(quick, rebuilt, 120);
  assert.equal(ranking.hold, true);
  assert.match(ranking.reasons[0], /120 Search Console impressions and the rebuild drops 2 more/);
});

test("an entry's own sources decide; banned and low-trust sites and our own site don't count", () => {
  const old = { status: "published", verified: false, items: [
    { name: "Golden Gun", sources: ["fextralife.com", "reddit.com", "questcompendium.com"] },
    { name: "Q-Beam", sources: ["https://www.ign.com/wikis/prey"] },
  ] };
  const v = rebuildVerdict(old, { items: [] }, 0);
  assert.equal(v.hold, true);
  assert.deepEqual(v.lost.map((x) => [x.name, x.sourced]), [["Golden Gun", false], ["Q-Beam", true]]);
});

test("a walkthrough cut to under two thirds of its steps is a loss; secrets compared by their words", () => {
  const old = { status: "published", verified: true, sources: ["ign.com"], walkthrough: Array.from({ length: 9 }, (_, i) => ({ title: `Step ${i}` })), secrets: [{ text: "Shoot the hanging lantern to drop a ladder" }] };
  const v = rebuildVerdict(old, { walkthrough: old.walkthrough.slice(0, 5), secrets: [{ text: "Drop the ladder by shooting the lantern that hangs there" }] }, 0);
  assert.deepEqual(v.lost.map((x) => x.kind), ["walkthrough"]);
  assert.equal(v.lost[0].name, "9 steps → 5");
  assert.equal(rebuildVerdict(old, { walkthrough: old.walkthrough.slice(0, 6), secrets: old.secrets }, 0).hold, false);
});

test("a new page (nothing live before) is never held", () => {
  assert.deepEqual(rebuildVerdict(null, { items: [] }, 900), { hold: false, reasons: [], lost: [] });
});

test("restructures keep a page with impressions unless the new outline has its name", () => {
  assert.equal(keepOnRestructure("Lakay", 46, ["Chapter 5: Guarma", "Saint Denis"]), true);
  assert.equal(keepOnRestructure("Lakay", 46, ["lakay", "Saint Denis"]), false);
  assert.equal(keepOnRestructure("The Lakay!", 46, ["Lakay"]), false);
  assert.equal(keepOnRestructure("Lakay", 0, ["Saint Denis"]), false);
  assert.equal(normName("Crow’s Perch"), "crows perch");
});

console.log(`\n${passed} tests passed`);
