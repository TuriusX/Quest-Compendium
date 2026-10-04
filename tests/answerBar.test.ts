// Run: npm run test:sync   (or: npx tsx tests/answerBar.test.ts)
import assert from "node:assert/strict";
import { isTrivialMarker, isFillerStep, WORTH_POINTING_OUT } from "../answerBar";
import { extractSteps, STEPS_RULES } from "../steps";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// A sample answer like the real BG3 crash-site one: an obvious corpse in plain view with minor supplies, next to things
// that do matter (a hidden cache, a missable item, a choice).
const SAMPLE = `### 1. Loot the Dead Abductee
Search the corpse lying in the pool of blood just ahead on the path. It holds minor camp supplies and some gold.

### 2. The Harper cache
Under the Scuffed Rock on the lower ledge is a hidden Ornate Chest with Harper's Map.

<qc-points>[
 {"y": 520, "x": 410, "label": "Search corpse", "where": "in the pool of blood ahead", "category": "consumable", "note": "Minor camp supplies and gold"},
 {"y": 300, "x": 700, "label": "Harper's Map", "where": "under the scuffed rock", "category": "secret", "note": "Hidden chest under the rock"},
 {"y": 610, "x": 150, "label": "Thieves' Tools", "where": "crate by the dock", "category": "consumable", "note": "Lost once you leave", "missable": true}
]</qc-points>
<qc-steps>[
 {"kind": "step", "text": "Search the dead abductee on the sand path ahead", "detail": "Search the corpse lying in the pool of blood just ahead on the path. It holds minor camp supplies and some gold."},
 {"kind": "step", "text": "Move the Scuffed Rock to reach the hidden Harper cache", "detail": "Under the Scuffed Rock on the lower ledge is a hidden Ornate Chest with Harper's Map."},
 {"kind": "step", "text": "Explore the area"},
 {"kind": "choice", "text": "Fight the Intellect Devourers or climb the rock wall to avoid them"}
]</qc-steps>`;

/** The markers the server keeps from the sample (the same filter extractScreenPoints applies after parsing). */
const keptMarkers = () => {
  const raw = SAMPLE.match(/<qc-points>([\s\S]*?)<\/qc-points>/)![1];
  return (JSON.parse(raw) as any[]).filter((p) => !isTrivialMarker(p)).map((p) => p.label);
};

test("an obvious low-value corpse never becomes a marker; hidden, missable and valuable things stay", () => {
  assert.deepEqual(keptMarkers(), ["Harper's Map", "Thieves' Tools"]);
});

test("the same bar for the quest log: no corpse-loot step, no filler; real steps and choices stay", () => {
  const { steps } = extractSteps(SAMPLE.replace(/<qc-points>[\s\S]*?<\/qc-points>/, ""));
  assert.deepEqual(steps.map((s) => s.text), [
    "Move the Scuffed Rock to reach the hidden Harper cache",
    "Fight the Intellect Devourers or climb the rock wall to avoid them",
  ]);
});

test("conservative: a corpse or chest with something that matters is kept", () => {
  assert.equal(isTrivialMarker({ label: "Search corpse", note: "Carries the cell key", category: "key" }), false);
  assert.equal(isTrivialMarker({ label: "Loot chest", note: "Rare amulet inside" }), false);
  assert.equal(isTrivialMarker({ label: "Search body", note: "Letter needed for the quest" }), false);
  assert.equal(isTrivialMarker({ label: "Barrel", note: "Some gold", missable: true }), false);
  assert.equal(isTrivialMarker({ label: "Talk to Shadowheart", category: "character" }), false);
  assert.equal(isTrivialMarker({ label: "Pull lever", note: "Opens the gate", category: "action" }), false);
  // Routine loot in plain view: dropped.
  assert.equal(isTrivialMarker({ label: "Search remains", note: "Random loot" }), true);
  assert.equal(isTrivialMarker({ label: "Crate", note: "A few common potions and coins" }), true);
});

test("filler steps are recognised; specific ones aren't", () => {
  for (const t of ["Explore the area", "Look around", "Be careful", "Keep exploring the beach"]) assert.equal(isFillerStep(t), true, t);
  for (const t of ["Explore the hidden cave behind the waterfall to find the Moonblade", "Search the chest left of the crashed pod"]) assert.equal(isFillerStep(t), false, t);
});

test("the prompt carries the bar for markers and steps (0 to 3 normal, 0 is fine)", () => {
  assert.match(WORTH_POINTING_OUT, /0 to 3 is normal, and 0 is fine/);
  assert.match(WORTH_POINTING_OUT, /corpse right in front of the\s+player holding minor supplies and gold/);
  assert.ok(STEPS_RULES.includes(WORTH_POINTING_OUT));
});

console.log(`\n${passed} tests passed`);
