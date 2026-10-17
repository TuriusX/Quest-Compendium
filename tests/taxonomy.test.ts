// Run: npm run test:sync   (or: npx tsx tests/taxonomy.test.ts)
import assert from "node:assert/strict";
import { mergeTaxonomy, labelParts, sameKind, resolveType } from "../scripts/guides/taxonomy";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("labels split into normalised parts", () => {
  assert.deepEqual(labelParts("Notable NPCs & Merchants"), ["notable npc", "merchant"]);
  assert.deepEqual(labelParts("Gang Hideouts and Camps"), ["gang hideout", "camp"]);
  assert.deepEqual(labelParts("Bosses & Elite Encounters"), ["boss", "elite encounter"]);
  assert.deepEqual(labelParts("Mind Flayer Parasite Specimens"), ["mind flayer parasite specimen"]);
});

test("the duplicates the site showed are the same kind; different kinds aren't", () => {
  const t = (id: string, label: string, tier?: string) => ({ id, label, tier });
  assert.ok(sameKind(t("companions-and-allies", "Companions & Allies", "people"), t("companions-and-origins", "Companions & Origin Paths", "people")));
  assert.ok(sameKind(t("merchants-and-notables", "Merchants & Notable NPCs", "people"), t("notable-npcs-and-vendors", "Notable NPCs & Merchants", "people")));
  assert.ok(sameKind(t("gang-hideouts-and-camps", "Gang Hideouts and Camps", "locations"), t("gang-hideouts", "Gang Hideouts", "other")));
  assert.ok(!sameKind(t("legendary-animals", "Legendary Animals"), t("legendary-fish", "Legendary Fish")));
  assert.ok(!sameKind(t("bosses", "Bosses", "bosses"), t("bosses-lore", "Bosses", "collectibles")));
  assert.ok(!sameKind(t("main-characters", "Main Characters", "people"), t("side-characters", "Side Characters", "people")));
});

test("merging keeps the first type, aliases the rest, retypes and dedupes the entities", () => {
  const types = [
    { id: "companions-and-allies", label: "Companions & Allies", tier: "people", examples: ["Shadowheart", "Astarion"] },
    { id: "bosses", label: "Bosses", tier: "bosses", examples: ["Ketheric Thorm"] },
    { id: "companions-and-origins", label: "Companions & Origin Paths", tier: "people", examples: ["The Dark Urge", "Astarion"] },
    { id: "gang-hideouts", label: "Gang Hideouts", tier: "other" },
    { id: "gang-hideouts-and-camps", label: "Gang Hideouts and Camps", tier: "locations", examples: ["Shady Belle"] },
  ];
  const entities = [
    { name: "Astarion", slug: "astarion", type: "companions-and-allies" },
    { name: "The Dark Urge", slug: "the-dark-urge", type: "companions-and-origins" },
    { name: "Astarion", slug: "astarion", type: "companions-and-origins" },
    { name: "Shady Belle", slug: "shady-belle", type: "gang-hideouts-and-camps" },
  ];
  const r = mergeTaxonomy(types, entities);
  assert.deepEqual(r.taxonomy.map((t) => t.id), ["companions-and-allies", "bosses", "gang-hideouts"]);
  assert.deepEqual(r.typeAliases, { "companions-and-origins": "companions-and-allies", "gang-hideouts-and-camps": "gang-hideouts" });
  assert.deepEqual(r.taxonomy[0].examples, ["Shadowheart", "Astarion", "The Dark Urge"]);
  // The kept blueprint type takes the real tier from the type merged into it.
  assert.equal(r.taxonomy[2].tier, "locations");
  assert.deepEqual(r.entities.map((e) => `${e.slug}:${e.type}`), ["astarion:companions-and-allies", "the-dark-urge:companions-and-allies", "shady-belle:gang-hideouts"]);
});

test("older aliases follow the merges; an alias that's a type again is dropped", () => {
  const r = mergeTaxonomy(
    [{ id: "merchants", label: "Merchants" }, { id: "notable-npcs-and-vendors", label: "Notable NPCs & Merchants" }],
    [],
    { "merchants-and-notables": "notable-npcs-and-vendors", "merchants": "something-old" },
  );
  assert.deepEqual(r.typeAliases, { "notable-npcs-and-vendors": "merchants", "merchants-and-notables": "merchants" });
  assert.equal(resolveType("merchants-and-notables", r.typeAliases), "merchants");
  assert.equal(resolveType("bosses", r.typeAliases), "bosses");
  // A loop never hangs.
  assert.equal(typeof resolveType("a", { a: "b", b: "a" }), "string");
});

console.log(`\n${passed} tests passed`);
