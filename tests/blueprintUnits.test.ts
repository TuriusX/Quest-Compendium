// Run: npm run test:sync   (or: npx tsx tests/blueprintUnits.test.ts)
import assert from "node:assert/strict";
import { unitsToBuild, sectionLimit, fullPlan } from "../scripts/guides/blueprintBuild";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// RDR2's story missions: estimated at 108 units, capped at 120, planned with 122 names (Epilogue Part 2 last).
const plan = Array.from({ length: 122 }, (_, i) => (i >= 111 ? `Epilogue 2 mission ${i - 110}` : `Mission ${i + 1}`));
const section = { units: 108, cap: 120 };

test("the cap limits a section, not the estimate: 120 of 122 names, not 108", () => {
  const u = unitsToBuild(section, plan, []);
  assert.equal(u.want, 120);
  assert.equal(u.next.length, 120);
  assert.ok(u.next.includes("Epilogue 2 mission 1"));
  assert.deepEqual(u.beyondCap, ["Epilogue 2 mission 10", "Epilogue 2 mission 11"]);
  assert.equal(u.overUnits, true);
  assert.equal(u.complete, false);
});

test("built names are skipped; the section is done only when every planned name is built", () => {
  const built = plan.slice(0, 108).map((name) => ({ name }));
  const u = unitsToBuild(section, plan, built);
  assert.equal(u.next.length, 12);
  assert.equal(u.next[0], "Mission 109");
  assert.equal(u.complete, false);
  // All within the cap built: still not done while two names wait beyond it.
  const capped = unitsToBuild(section, plan, plan.slice(0, 120).map((name) => ({ name })));
  assert.deepEqual(capped.next, []);
  assert.equal(capped.complete, false);
  assert.equal(unitsToBuild({ units: 108, cap: 122 }, plan, plan.map((name) => ({ name }))).complete, true);
});

test("without a cap the estimate limits it; a plan shorter than the limit is built whole", () => {
  assert.equal(sectionLimit({ units: 30 }), 30);
  assert.equal(sectionLimit({ units: 30, cap: 0 }), 0);
  const u = unitsToBuild({ units: 30 }, plan.slice(0, 12), []);
  assert.equal(u.want, 12);
  assert.equal(u.overUnits, false);
  assert.deepEqual(u.beyondCap, []);
  assert.equal(unitsToBuild({ units: 30 }, [], []).complete, false);
});

test("a plan cut to the estimate gets its lost names back from its chapter list, in order", () => {
  const p = { plan: plan.slice(0, 108), planChapters: Object.fromEntries(plan.map((n) => [n, n.startsWith("Epilogue 2") ? "Epilogue Part 2" : "Chapter 1"])) };
  const whole = fullPlan(p);
  assert.equal(whole.length, 122);
  assert.deepEqual(whole.slice(108, 111), ["Mission 109", "Mission 110", "Mission 111"]);
  // Built 108 and marked done: 12 more within the cap, 2 beyond it, so the section isn't complete.
  const u = unitsToBuild(section, whole, p.plan.map((name) => ({ name })));
  assert.equal(u.next.length, 12);
  assert.equal(u.beyondCap.length, 2);
  assert.equal(u.complete, false);
  assert.deepEqual(fullPlan({ plan: ["A", "B"] }), ["A", "B"]);
  assert.deepEqual(fullPlan({}), []);
});

console.log(`\n${passed} tests passed`);
