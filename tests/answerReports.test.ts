// Run: npm run test:sync   (or: npx tsx tests/answerReports.test.ts)
import assert from "node:assert/strict";
import { reportAllowed, entriesInAnswer, REPORT_REASONS } from "../answerReports";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("the three report reasons", () => {
  assert.deepEqual([...REPORT_REASONS], ["harmful", "wrong", "other"]);
});

test("reports are rate-limited per reporter: 10 an hour, 30 a day", () => {
  const t0 = Date.UTC(2026, 9, 5, 12);
  for (let i = 0; i < 10; i++) assert.ok(reportAllowed("p1", t0 + i));
  assert.equal(reportAllowed("p1", t0 + 20), false);
  assert.ok(reportAllowed("p2", t0 + 20)); // another player isn't affected
  // An hour later the hourly limit has passed; the day still counts.
  for (let h = 1; h <= 2; h++) for (let i = 0; i < 10; i++) assert.ok(reportAllowed("p1", t0 + h * 3_700_000 + i));
  assert.equal(reportAllowed("p1", t0 + 4 * 3_700_000), false); // 30 today
});

const page = {
  items: [{ id: "i1", name: "Harper's Map", where: "Under the Scuffed Rock" }, { id: "i2", name: "Ring", where: "x" }],
  fights: [{ id: "f1", name: "Emerald Grove Gate Battle", enemies: "Za'krug", tactics: "High ground" }],
  secrets: [{ id: "s1", text: "A hidden lever behind the altar opens the crypt." }],
  sections: [{ title: "Checklist", check: true, entries: [{ id: "c1", text: "Talk to Zevlor before the raid ends." }] }],
} as any;

test("a wrong-answer report finds the guide entries the answer names", () => {
  const found = entriesInAnswer(page, "Harper's Map is not under the rock. For the Emerald Grove Gate Battle, a hidden lever behind the altar helps.");
  assert.deepEqual(found.map((e) => `${e.kind}:${e.id}`), ["item:i1", "fight:f1", "secret:s1"]);
  // Short names don't match inside other words ("Ring" in "during").
  assert.deepEqual(entriesInAnswer(page, "During the fight, nothing else."), []);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
setTimeout(() => process.exit(process.exitCode || 0), 100);
