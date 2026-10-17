// Run: npm run test:sync   (or: npx tsx tests/consistency.test.ts)
import assert from "node:assert/strict";
import { findConflicts, baseAndVariant, placesIn, giverClaims, type Mention } from "../scripts/guides/consistency";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const item = (name: string, on: string, text: string, places: string[], extra: Partial<Mention> = {}): Mention =>
  ({ kind: "item", name, on, onName: on, text, places, named: true, variant: baseAndVariant(name).variant, ...extra });

test("names, set pieces and places", () => {
  assert.deepEqual(baseAndVariant("Haligtree Secret Medallion (Left)"), { base: "haligtree secret medallion", variant: "left" });
  assert.deepEqual(baseAndVariant("Golden Gun"), { base: "golden gun", variant: "" });
  const known = ["castle sol", "mountaintops of the giants", "sol", "village of the albinaurics"];
  assert.deepEqual(placesIn("Castle Sol in the northern Mountaintops of the Giants", known), ["castle sol", "mountaintops of the giants"]);
  assert.deepEqual(placesIn("nowhere known", known), []);
});

test("the Haligtree Secret Medallion: one half placed in two different places", () => {
  const c = findConflicts([
    item("Haligtree Secret Medallion (Left)", "Mountaintops of the Giants", "Castle Sol, chest on the roof", ["castle sol"]),
    item("haligtree secret medallion", "entity:ensha", "either half (such as from Albus in the Village of the Albinaurics)", ["village of the albinaurics"]),
  ]);
  assert.equal(c.length, 1);
  assert.match(c[0].reason, /in different places: \(left\) castle sol .* village of the albinaurics/);
  // Two different halves in two places is how the game is: no conflict.
  assert.deepEqual(findConflicts([
    item("Haligtree Secret Medallion (Left)", "Village of the Albinaurics", "from Albus", ["village of the albinaurics"]),
    item("Haligtree Secret Medallion (Right)", "Mountaintops of the Giants", "Castle Sol", ["castle sol"]),
  ]), []);
});

test("Prey's Golden Gun: missable on one page, not on the other; listed on a page its text says it isn't in", () => {
  const c = findConflicts([
    item("Golden Gun", "Arboretum", "Inside Jada Marks' cabin safe in the Crew Quarters", ["crew quarters"], { missable: true }),
    item("Golden Gun", "Crew Quarters", "inside Jada Marks' cabin safe", ["crew quarters"], { missable: false, named: false }),
  ]);
  assert.equal(c.length, 1);
  assert.match(c[0].reason, /missable on Arboretum, not on Crew Quarters/);
  assert.match(c[0].reason, /listed on Arboretum, but its text puts it in Crew Quarters/);
});

test("Dark Souls' Skull Lantern: a Necromancer drop on one page, a corpse in the Tomb of the Giants on another", () => {
  const c = findConflicts([
    item("Skull Lantern", "Catacombs", "Uncommon drop from Necromancers", ["catacombs"], { named: false }),
    item("Skull Lantern", "Catacombs", "drop of Necromancer", ["catacombs"], { from: "Necromancer" }),
    item("Skull Lantern", "Tomb of the Giants", "Dropped into a pit by Patches, found on a corpse below", ["tomb of the giants"], { named: false }),
  ]);
  assert.equal(c.length, 1);
  assert.match(c[0].reason, /a drop on Catacombs.*picked up on Tomb of the Giants/);
  // A pick-up won from the same enemy agrees with the drop.
  assert.deepEqual(findConflicts([
    item("Unalloyed Gold Needle", "Caelid", "Dropped by Commander O'Neil", ["caelid"]),
    item("Unalloyed Gold Needle", "entity:millicent", "Obtained by defeating Commander O'Neil", ["swamp of aeonia"]),
  ]).filter((x) => /drop/.test(x.reason)), []);
});

test("a boss reward credited to two different bosses is a swapped pairing; one boss under two names isn't", () => {
  const reward = (name: string, on: string, from: string) => item(name, on, `reward of ${from}`, [on.toLowerCase()], { from, fight: true });
  const c = findConflicts([reward("Staff of the Avatar", "Deeproot Depths", "Erdtree Avatar"), reward("Staff of the Avatar", "Dragonbarrow", "Putrid Avatar")]);
  assert.match(c[0].reason, /a reward of different fights: Erdtree Avatar .* Putrid Avatar/);
  assert.deepEqual(findConflicts([reward("Handmaiden's Mace", "House of Grief", "Viconia DeVir (Mother Superior)"), reward("Handmaiden's Mace", "Lower City", "Viconia DeVir")]), []);
  // Common materials (many pages, many enemies) and non-items aren't compared.
  assert.deepEqual(findConflicts([reward("heavy XP", "A", "X"), reward("heavy XP", "B", "Y")]), []);
});

test("an item many pages list is common: only its set pieces are compared", () => {
  const many = ["A", "B", "C"].map((p) => item("Titanite Shard", p, `on a corpse in ${p}`, [p.toLowerCase()]));
  assert.deepEqual(findConflicts(many), []);
});

test("mission givers: the same mission given by two people on different pages", () => {
  const q = (on: string, giver: string): Mention => ({ kind: "quest", name: "The Spines of America", on, onName: on, text: `given by ${giver}`, places: [], giver });
  assert.match(findConflicts([q("entity:the-spines-of-america", "Dutch van der Linde"), q("entity:hosea-matthews", "Hosea Matthews")])[0].reason, /given by Dutch van der Linde and Hosea Matthews/);
  assert.deepEqual(findConflicts([q("entity:a", "Dutch"), q("entity:b", "Dutch van der Linde")]), []);
  const missions = ["The Spines of America", "Exit Pursued by a Bruised Ego"];
  const people = ["Hosea Matthews", "Dutch van der Linde"];
  assert.deepEqual(giverClaims("Hosea gives Arthur The Spines of America in Chapter 2.", missions, people), [{ mission: "The Spines of America", giver: "Hosea Matthews" }]);
  assert.deepEqual(giverClaims("Hosea and Dutch appear in The Spines of America.", missions, people), []);
  assert.deepEqual(giverClaims("Hosea introduces Arthur to Seamus during The Spines of America.", missions, people), []);
});

test("an NPC a page places where their own page never has them", () => {
  const c = findConflicts([
    { kind: "npc", name: "Shani", on: "oxenfurt", onName: "Oxenfurt", text: "in the Oxenfurt academy", places: ["oxenfurt academy"], named: true },
    { kind: "npc", name: "Shani", on: "entity:shani", onName: "Shani", text: "Oxenfurt sewers clinic", places: ["oxenfurt sewers"] },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "npc");
});

console.log(`\n${passed} tests passed`);
