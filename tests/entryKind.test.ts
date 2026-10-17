// Run: npm run test:sync   (or: npx tsx tests/entryKind.test.ts)
import assert from "node:assert/strict";
import { entryKind, entryIconSvg, ENTRY_ICON_PATHS, ENTRY_COLORS } from "../src/utils/entryKind";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("items: a chest when the name, place or text says so, otherwise an item", () => {
  assert.equal(entryKind({ section: "items", name: "Ornate Chest", where: "Under the rock" }), "chest");
  assert.equal(entryKind({ section: "items", name: "Harper's Map", where: "In a strongbox by the bed" }), "chest");
  assert.equal(entryKind({ section: "items", name: "Crowns", where: "Hidden stash behind the tower" }), "chest");
  assert.equal(entryKind({ section: "items", name: "Treasure", where: "" }), "chest");
  assert.equal(entryKind({ section: "items", name: "Annabelle's Bones", where: "From Annabelle in the laboratory" }), "item");
  // Whole words only: "chestplate" and "cachet" aren't containers.
  assert.equal(entryKind({ section: "items", name: "Griffin Chestplate", where: "Cachet's room" }), "item");
});

test("secrets, fights, enemies and shops by their list", () => {
  assert.equal(entryKind({ section: "secrets", text: "Wall levers by the bed: pull both to open the lab stairs" }), "secret");
  assert.equal(entryKind({ section: "fights", name: "Plague Maiden" }), "boss");
  assert.equal(entryKind({ section: "enemies", name: "Rotfiends" }), "enemy");
  assert.equal(entryKind({ section: "shops", name: "Blacksmith" }), "shop");
});

test("travel points in any list; custom sections and steps otherwise have none", () => {
  assert.equal(entryKind({ section: "sections", text: "Fyke Isle Signpost: along the main path" }), "travel");
  assert.equal(entryKind({ section: "secrets", text: "Site of Grace: Church of Elleh, east of the start" }), "travel");
  assert.equal(entryKind({ section: "items", name: "Bonfire", where: "Firelink Shrine" }), "travel");
  assert.equal(entryKind({ section: "step", name: "Fast travel point" }), "travel");
  assert.equal(entryKind({ section: "step", name: "Island approaches" }), null);
  assert.equal(entryKind({ section: "sections", text: "Annabelle's Bones can be missed" }), null);
  // A longer sentence that only passes a signpost is still a secret.
  assert.equal(entryKind({ section: "secrets", text: "Pull the lever left of the stairs behind the old signpost" }), "secret");
  // A boss named after a bonfire is still a boss.
  assert.equal(entryKind({ section: "fights", name: "Bonfire Knight" }), "boss");
});

test("every kind has an icon and a colour, and the svg is hidden from screen readers", () => {
  for (const k of ["chest", "item", "secret", "boss", "enemy", "shop", "travel", "miss"] as const) {
    assert.ok(ENTRY_ICON_PATHS[k].startsWith("<"), k);
    assert.match(ENTRY_COLORS[k], /^#[0-9a-f]{6}$/, k);
  }
  const svg = entryIconSvg("travel");
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /color:#34d399/);
});

console.log(`\n${passed} tests passed`);
