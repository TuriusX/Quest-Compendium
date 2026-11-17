// Run: npx tsx tests/holidaySchedule.test.ts
import assert from "node:assert/strict";
import { scheduledAllowances, normalizeAllowances } from "../allowances";
import { PLAYER_MONTHLY } from "../searchGuard";
import { activeOffer } from "../offers";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const cfg = { free: { pro: 2, flash: 5 }, schedule: [{ from: "2026-11-26", until: "2027-01-04", free: { pro: 3, flash: 8 } }] };
const at = (day: string) => normalizeAllowances(scheduledAllowances(cfg, day));
test("before, during (first and last day) and after the holidays", () => {
  assert.deepEqual([at("2026-11-25").free.pro, at("2026-11-25").free.flash], [2, 5]);
  assert.deepEqual([at("2026-11-26").free.pro, at("2026-11-26").free.flash], [3, 8]);
  assert.deepEqual([at("2027-01-04").free.pro, at("2027-01-04").free.flash], [3, 8]);
  assert.deepEqual([at("2027-01-05").free.pro, at("2027-01-05").free.flash], [2, 5]);
});
test("guests and Premium unchanged", () => {
  assert.equal(at("2026-12-10").guest.pro, 1);
  assert.equal(at("2026-12-10").premium.flash, 25);
});
test("no schedule, no change", () => assert.equal(normalizeAllowances(scheduledAllowances({}, "2026-12-10")).free.pro, 2));
test("players' search reserve by month", () => {
  process.env.PLAYER_MONTHLY_SEARCHES_BY_MONTH = "2026-12:6000,2027-01:6000";
  assert.equal(PLAYER_MONTHLY("2026-11"), 2000);
  assert.equal(PLAYER_MONTHLY("2026-12"), 6000);
  assert.equal(PLAYER_MONTHLY("2027-01"), 6000);
  assert.equal(PLAYER_MONTHLY("2027-02"), 2000);
});
test("the holiday offer: only between its dates, and only with a coupon", () => {
  const o = { holiday: { from: "2026-11-26", until: "2027-01-04", coupon: "HOLIDAY2026", line: "Holiday offer" } };
  assert.equal(activeOffer(o, "2026-11-25"), null);
  assert.equal(activeOffer(o, "2026-11-26")?.coupon, "HOLIDAY2026");
  assert.equal(activeOffer(o, "2027-01-04")?.line, "Holiday offer");
  assert.equal(activeOffer(o, "2027-01-05"), null);
  assert.equal(activeOffer({ holiday: { ...o.holiday, coupon: "" } }, "2026-12-01"), null);
});
console.log(`\n${passed} tests passed`);
