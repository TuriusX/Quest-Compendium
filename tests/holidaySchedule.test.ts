// Run: npx tsx tests/holidaySchedule.test.ts
import assert from "node:assert/strict";
import { scheduledAllowances, normalizeAllowances, ALLOWANCE_DEFAULTS } from "../allowances";
import { PLAYER_MONTHLY } from "../searchGuard";
import { activeOffer, activeTrial, trialEligible, trialStep } from "../offers";

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
  // (Compared with the defaults, so a change to Premium's or guests' amounts doesn't break this test.)
  assert.deepEqual(at("2026-12-10").guest, ALLOWANCE_DEFAULTS.guest);
  assert.deepEqual(at("2026-12-10").premium, ALLOWANCE_DEFAULTS.premium);
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
test("the free trial: off unless on, from its start day, and after Jan 4 too", () => {
  const c = { trial: { on: true, days: 7, from: "2026-11-26" } };
  assert.equal(activeTrial({}, "2026-12-01"), null);
  assert.equal(activeTrial({ trial: { ...c.trial, on: false } }, "2026-12-01"), null);
  assert.equal(activeTrial(c, "2026-11-25"), null);
  assert.equal(activeTrial(c, "2026-11-26")?.days, 7);
  assert.equal(activeTrial(c, "2027-02-01")?.days, 7);
});
test("one trial per player: not after a trial, Premium, or any past subscription", () => {
  assert.equal(trialEligible({}, false), true);
  assert.equal(trialEligible({ trialUsed: true }, false), false);
  assert.equal(trialEligible({ premiumEver: true }, false), false);
  assert.equal(trialEligible({ isPremium: true }, false), false);
  assert.equal(trialEligible({}, true), false);
});
test("trial steps from Stripe's events", () => {
  const t = { id: "sub_1", trial_end: 1000 };
  assert.equal(trialStep("customer.subscription.created", { ...t, status: "trialing" }, null), "started");
  assert.equal(trialStep("customer.subscription.updated", { ...t, status: "active" }, { status: "trialing" }), "converted");
  assert.equal(trialStep("customer.subscription.updated", { ...t, status: "trialing", cancel_at_period_end: true }, { cancel_at_period_end: false }), "cancelled");
  assert.equal(trialStep("customer.subscription.deleted", { ...t, status: "canceled", ended_at: 1000 }, null), "cancelled");
  assert.equal(trialStep("customer.subscription.deleted", { ...t, status: "canceled", ended_at: 999999 }, null), null);
  assert.equal(trialStep("customer.subscription.created", { id: "sub_2", status: "active" }, null), null);
});
console.log(`\n${passed} tests passed`);
