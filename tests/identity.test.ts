// Run: npm run test:sync   (or: npx tsx tests/identity.test.ts)
import assert from "node:assert/strict";
import { checkIdentity, IDENTITY_RULES, ANSWER_IDENTITY } from "../answerBar";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("the rules: a name only when it's on screen or unmistakable; otherwise mark the way and say where they are", () => {
  for (const s of ["name label", "hover", "dialogue box", "party companion", "unique character", '"id": "label"', '"unique"', '"guess"', '"generic"', "Enclave Library entrance", "Nettie is inside the", "hovering over a character"]) assert.ok(IDENTITY_RULES.includes(s), s);
  assert.match(IDENTITY_RULES, /named place or object/);
  assert.match(ANSWER_IDENTITY, /don't call someone on screen by a specific name/);
});

test("Nettie/Loic: a guessed 'Talk to Nettie' on a druid who isn't named on screen shows no name", () => {
  // The answer was about the Enclave Library; the model assumed the robed druid nearby was Nettie (it was Loic).
  const r = checkIdentity({ label: "Talk to Nettie", category: "character", id: "guess", generic: "robed druid", note: "Nettie knows the way into the library" });
  assert.deepEqual(r, { label: "Robed druid" }); // the note named her too: gone
  // No description to fall back on: naming her was the point, so no marker at all.
  assert.equal(checkIdentity({ label: "Talk to Nettie", category: "character", id: "guess" }), null);
  // A character marker that doesn't say how it was identified counts as a guess.
  assert.equal(checkIdentity({ label: "Talk to Nettie", category: "character" }), null);
  assert.equal(checkIdentity({ label: "Speak with Loic", generic: "" }), null);
});

test("a name read on screen, or an unmistakable character, keeps the name", () => {
  assert.deepEqual(checkIdentity({ label: "Talk to Nettie", category: "character", id: "label", note: "Name shown above her" }), { label: "Talk to Nettie", note: "Name shown above her", detail: undefined });
  assert.equal(checkIdentity({ label: "Talk to Shadowheart", category: "character", id: "unique" })!.label, "Talk to Shadowheart");
});

test("named places and objects: a guessed name becomes the description; plain markers are untouched", () => {
  assert.deepEqual(checkIdentity({ label: "Enclave Library", category: "place", id: "guess", generic: "Stone archway up the stairs", note: "A quiet room" }), { label: "Stone archway up the stairs", note: "A quiet room" });
  assert.equal(checkIdentity({ label: "Enclave Library", category: "place", id: "label" })!.label, "Enclave Library");
  assert.equal(checkIdentity({ label: "Pull lever", category: "action" })!.label, "Pull lever");
  assert.equal(checkIdentity({ label: "Goblin archer", category: "enemy" })!.label, "Goblin archer");
});

console.log(`\n${passed} tests passed`);
