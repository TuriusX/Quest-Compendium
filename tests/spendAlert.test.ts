// Run: npx tsx tests/spendAlert.test.ts
import assert from "node:assert/strict";
import { daySpendFrom, spendLine } from "../scripts/pipeline/spendAlert";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const base = { day: "2026-11-16", leaveOut: new Set(["me"]) };
test("today's totals, owner left out, yesterday's numbers ignored", () => {
  const s = daySpendFrom({ ...base, pipeline: { spend: { day: "2026-11-16", dollars: 3 } }, flagship: { day: "2026-11-15", spentToday: 9 },
    stats: { costs: { a: { dollars: 0.5 }, me: { dollars: 4 }, t: { dollars: 1 } }, owners: ["t"] }, searchDay: { total: 400, pipeline: 380, players: 20 }, monthCount: 6832 });
  assert.equal(s.pipeline, 3); assert.equal(s.flagship, 0); assert.equal(s.players, 0.5); assert.equal(s.total, 3.5);
  assert.equal(Math.round(s.searchDollars * 100), 560);
});
test("searches within the month's free 5,000 cost nothing", () => {
  const s = daySpendFrom({ ...base, pipeline: {}, flagship: {}, stats: {}, searchDay: { total: 300 }, monthCount: 5100 });
  assert.equal(Math.round(s.searchDollars * 1000), 1400); // 100 of the 300 past the free 5,000
});
test("the line", () => {
  const s = daySpendFrom({ ...base, pipeline: { spend: { day: "2026-11-16", dollars: 2 } }, flagship: {}, stats: {}, searchDay: { total: 10, pipeline: 10 }, monthCount: 100 });
  assert.match(spendLine(s, 10), /^📊 AI spend today: \$2\.00 \(pipeline \$2\.00, flagship \$0\.00, players \$0\.00\) · 10 search queries/);
});
console.log(`\n${passed} tests passed`);
