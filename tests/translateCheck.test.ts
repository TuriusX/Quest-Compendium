// Run: npm run test:sync   (or: npx tsx tests/translateCheck.test.ts)
import assert from "node:assert/strict";
import { untranslated, UNTRANSLATED_LIMIT } from "../scripts/guides/translateCheck";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const src = {
  name: "Inn at the Crossroads", overview: "A busy inn where the road from Novigrad meets the road to Oxenfurt.",
  items: [{ id: "i1", name: "Gwent card: Dandelion", where: "Win a game of Gwent against the innkeeper." }],
  info: { region: "Velen", levels: "Recommended level 4 to 8 for the quests here", quests: ["Bloody Baron"] },
  people: { groups: [{ group: "Merchants", people: [{ name: "Innkeeper", role: "sells food and Gwent cards to travellers", where: "behind the bar on the ground floor" }] }] },
};

test("a fully translated page has no English prose left (names and short labels don't count)", () => {
  const out = JSON.parse(JSON.stringify(src));
  out.overview = "Una posada concurrida donde el camino de Novigrad se cruza con el de Oxenfurt.";
  out.items[0].where = "Gana una partida de Gwent contra el posadero.";
  out.info.levels = "Nivel recomendado de 4 a 8 para las misiones de aquí";
  out.people.groups[0].people[0].role = "vende comida y cartas de Gwent a los viajeros";
  out.people.groups[0].people[0].where = "detrás de la barra en la planta baja";
  const u = untranslated(src, out);
  assert.equal(u.prose, 5);
  assert.equal(u.same, 0);
  assert.equal(u.share, 0);
});

test("fields the reply left empty (kept in English by fit) are counted; a page over the limit is reported", () => {
  const out = JSON.parse(JSON.stringify(src));
  out.overview = "Una posada concurrida donde el camino de Novigrad se cruza con el de Oxenfurt.";
  const u = untranslated(src, out);
  assert.equal(u.same, 4);
  assert.ok(u.share > UNTRANSLATED_LIMIT);
  // Missing in the reply altogether counts too.
  assert.equal(untranslated(src, {}).same, 5);
});

test("a page with no prose is never over the limit", () => {
  assert.deepEqual(untranslated({ name: "Velen", info: { quests: ["Bloody Baron"] } }, {}), { prose: 0, same: 0, share: 0 });
});

console.log(`\n${passed} tests passed`);
