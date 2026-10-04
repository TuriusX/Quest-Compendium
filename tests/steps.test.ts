// Run: npm run test:sync   (or: npx tsx tests/steps.test.ts)
import assert from "node:assert/strict";
import { extractSteps, STEPS_RULES } from "../steps";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("the <qc-steps> line is read and always removed from the answer", () => {
  const answer = "You've just crawled out of the nautiloid wreck.\n\nSearch the chest by the pod first.\n\n" +
    '<qc-steps>[{"kind": "step", "text": "Search the chest left of the crashed pod", "detail": "Search the chest by the pod first."},' +
    ' {"kind": "choice", "text": "Fight the Intellect Devourers or climb the rock wall to avoid them"},' +
    ' {"kind": "warning", "text": "Loot the pod before you leave the beach"}]</qc-steps>';
  const r = extractSteps(answer);
  assert.equal(r.text.includes("qc-steps"), false);
  assert.equal(r.text.endsWith("Search the chest by the pod first."), true);
  assert.deepEqual(r.steps.map((s) => s.kind), ["step", "choice", "warning"]);
  assert.equal(r.steps[0].detail, "Search the chest by the pod first.");
  assert.equal(r.steps[1].detail, undefined);
});

test("at most 4 steps; unknown kinds become steps; empty, overlong and broken lines are cleaned", () => {
  const many = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ kind: i === 1 ? "quest" : "step", text: `Step ${i + 1}` })));
  const r = extractSteps(`Answer <qc-steps>${many}</qc-steps>`);
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[1].kind, "step");
  const long = extractSteps(`A <qc-steps>[{"kind":"step","text":"${"x".repeat(300)}"},{"kind":"step","text":"  "}]</qc-steps>`);
  assert.equal(long.steps.length, 1);
  assert.ok(long.steps[0].text.length <= 140);
  const broken = extractSteps("Answer\n<qc-steps>[not json</qc-steps>");
  assert.deepEqual(broken.steps, []);
  assert.equal(broken.text, "Answer");
  // A fenced block, as models sometimes write it.
  assert.equal(extractSteps('Answer\n```json\n<qc-steps>[{"kind":"warning","text":"Save first"}]</qc-steps>\n```').steps[0].kind, "warning");
  // No block: nothing changes.
  assert.deepEqual(extractSteps("Just an answer").steps, []);
});

test("the rules ask for 1-4 imperative items with a one-line choice format", () => {
  assert.match(STEPS_RULES, /<qc-steps>/);
  assert.match(STEPS_RULES, /1 to 4/);
  assert.match(STEPS_RULES, /90 characters/);
  assert.match(STEPS_RULES, /Fight the Intellect Devourers or\s+climb the rock wall/);
});

console.log(`\n${passed} tests passed`);
