// Run: npm run test:sync   (or: npx tsx tests/allowances.test.ts)
import assert from "node:assert/strict";
import { summarizeCosts } from "../playerCosts";
import { ALLOWANCE_DEFAULTS as A, applyDay, daysBetween, dayIn, nextReset, normalizeAllowances, pickBucket, safeTimeZone, wantedBucket } from "../allowances";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const bal = (b: any) => [b.proQueriesAvailable, b.flashQueriesAvailable];

test("allowances: the defaults are 8 Pro + 25 Fast (Premium, carry-over capped at 100) and 2 + 5 (free)", () => {
  assert.deepEqual(A.premium, { pro: 8, flash: 25, rollover: true, cap: 100 });
  assert.deepEqual(A.free, { pro: 2, flash: 5, rollover: false, cap: 0 });
  assert.deepEqual(normalizeAllowances({ premium: { pro: "10", cap: -3 }, free: { flash: 7, rollover: "yes" } }).premium, { pro: 10, flash: 25, rollover: true, cap: 100 });
  assert.deepEqual(normalizeAllowances({ free: { flash: 7, rollover: "yes" } }).free, { pro: 2, flash: 7, rollover: false, cap: 0 });
});

test("first day on two models: today's allowance, whatever the old single count was", () => {
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 60, flashQueriesAvailable: 60, lastResetDate: "2026-10-08" }, A, true, "2026-10-08")), [8, 25]);
  assert.deepEqual(bal(applyDay({}, A, false, "2026-10-08")), [2, 5]);
});

test("Premium rollover: unused questions carry over at the reset", () => {
  const b = applyDay({ proQueriesAvailable: 3, flashQueriesAvailable: 10, lastResetDate: "2026-10-07", allowancePlan: "premium" }, A, true, "2026-10-08");
  assert.deepEqual(bal(b), [11, 35]);
  assert.equal(b.lastResetDate, "2026-10-08");
  // Three days away: three days' allowance added.
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 0, flashQueriesAvailable: 0, lastResetDate: "2026-10-05", allowancePlan: "premium" }, A, true, "2026-10-08")), [24, 75]);
});

test("Premium rollover: each model's bank is capped at 100", () => {
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 97, flashQueriesAvailable: 90, lastResetDate: "2026-10-07", allowancePlan: "premium" }, A, true, "2026-10-08")), [100, 100]);
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 0, flashQueriesAvailable: 0, lastResetDate: "2026-01-01", allowancePlan: "premium" }, A, true, "2026-10-08")), [100, 100]);
});

test("free (and guests): a fresh 2 + 5 each day, nothing carried over", () => {
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 2, flashQueriesAvailable: 5, lastResetDate: "2026-10-01", allowancePlan: "free" }, A, false, "2026-10-08")), [2, 5]);
});

test("same day: nothing changes; balances never go up by asking again", () => {
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 1, flashQueriesAvailable: 0, lastResetDate: "2026-10-08", allowancePlan: "free" }, A, false, "2026-10-08")), [1, 0]);
});

test("plan changes the same day: upgrading tops up to Premium's day once; Premium ending keeps at most the free day", () => {
  const up = applyDay({ proQueriesAvailable: 0, flashQueriesAvailable: 1, lastResetDate: "2026-10-08", allowancePlan: "free" }, A, true, "2026-10-08");
  assert.deepEqual(bal(up), [8, 25]);
  assert.deepEqual(bal(applyDay({ ...up, proQueriesAvailable: 7 }, A, true, "2026-10-08")), [7, 25]); // no second top-up
  assert.deepEqual(bal(applyDay({ proQueriesAvailable: 60, flashQueriesAvailable: 90, lastResetDate: "2026-10-08", allowancePlan: "premium" }, A, false, "2026-10-08")), [2, 5]);
});

test("time zones: midnight where the player is; switching zones never resets twice in a day", () => {
  const t = Date.parse("2026-10-08T03:30:00Z");
  assert.equal(dayIn("America/Chicago", t), "2026-10-07");
  assert.equal(dayIn("Asia/Tokyo", t), "2026-10-08");
  assert.equal(safeTimeZone("Not/AZone"), "UTC");
  // Reset in Tokyo, then the device says Chicago (still yesterday there): no reset, the day stays.
  const b = applyDay({ proQueriesAvailable: 1, flashQueriesAvailable: 1, lastResetDate: "2026-10-08", allowancePlan: "premium" }, A, true, dayIn("America/Chicago", t));
  assert.deepEqual(bal(b), [1, 1]);
  assert.equal(b.lastResetDate, "2026-10-08");
  assert.equal(daysBetween("2026-10-07", "2026-10-08"), 1);
  assert.equal(daysBetween("2026-10-08", "2026-10-07"), 0);
  // The next reset: Chicago midnight (05:00 UTC in October).
  assert.equal(new Date(nextReset("America/Chicago", t)).toISOString(), "2026-10-08T05:00:00.000Z");
  assert.equal(new Date(nextReset("UTC", t)).toISOString(), "2026-10-09T00:00:00.000Z");
});

test("the toggle: the picked model if it has questions, else the other (switched), else none", () => {
  assert.deepEqual(pickBucket("pro", { pro: 3, flash: 0 }), { bucket: "pro", switched: false });
  assert.deepEqual(pickBucket("pro", { pro: 0, flash: 4 }), { bucket: "flash", switched: true });
  assert.deepEqual(pickBucket("flash", { pro: 2, flash: 0 }), { bucket: "pro", switched: true });
  assert.deepEqual(pickBucket("flash", { pro: 0, flash: 0 }), { bucket: null, switched: false });
  assert.equal(wantedBucket({ answerModel: "fast" }), "flash");
  assert.equal(wantedBucket({ preferredModel: "flash" }), "flash"); // older apps
  assert.equal(wantedBucket({}), "pro");
});

test("player costs: Premium vs free vs guests, average and max per player, the heaviest first", () => {
  const c = summarizeCosts([
    { uid: "a", dollars: 1.2, questions: 40, searches: 3, premium: true, guest: false },
    { uid: "b", dollars: 0.4, questions: 10, searches: 0, premium: true, guest: false },
    { uid: "c", dollars: 0.05, questions: 7, searches: 1, premium: false, guest: false },
    { uid: "guest_x", dollars: 0.02, questions: 5, searches: 0, premium: false, guest: true },
  ], 2);
  assert.equal(c.premium.players, 2);
  assert.equal(c.premium.avg.toFixed(2), "0.80");
  assert.equal(c.premium.max, 1.2);
  assert.equal(c.free.players, 1);
  assert.equal(c.guests.players, 1);
  assert.deepEqual(c.heaviest.map((r) => r.uid), ["a", "b"]);
  assert.equal(c.all.perQuestion.toFixed(4), (1.67 / 62).toFixed(4));
});

console.log(`\n${passed} tests passed`);
