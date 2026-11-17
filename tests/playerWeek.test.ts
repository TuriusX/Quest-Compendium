// Run: npm run test:sync   (or: npx tsx tests/playerWeek.test.ts)
import assert from "node:assert/strict";
import { playerWeek } from "../scripts/pipeline/playerWeek";
import { tallyLimits, limitLine } from "../ownerStats";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const today = Date.parse("2026-10-19T15:00:00Z"); // a Monday; the week is Oct 12-18 (Central)
const day = (id: string, x: any = {}) => ({ id, players: [], guests: [], costs: {}, limitHit: {}, owners: [], ...x });
const days = [
  day("2026-10-01", { players: ["old"] }),
  day("2026-10-08", { players: ["a"], guests: ["g0"] }),
  day("2026-10-13", { players: ["old", "new1", "me"], guests: ["g1"], costs: { new1: { dollars: 0.02, questions: 2, tier: "free" }, old: { dollars: 0.1, questions: 1, tier: "premium" }, me: { dollars: 5, questions: 9, tier: "premium" } }, limitHit: { new1: "free" } }),
  day("2026-10-15", { players: ["new2"], costs: { new2: { dollars: 0.01, questions: 1, tier: "free" } }, owners: ["me"] }),
];
test("active, new vs returning, owner left out", () => {
  const w = playerWeek(days, [], today);
  assert.equal(w.now.players.size, 3); // old, new1, new2 (me is the owner)
  assert.equal(w.now.guests.size, 1);
  assert.equal(w.before.players.size + w.before.guests.size, 2);
  assert.equal(w.fresh, 3); // new1, new2, g1
  assert.equal(w.returning, 1); // old
});
test("cost by tier without the owner, and free players who ran out", () => {
  const w = playerWeek(days, [{ hash: "me", dollars: 5 }, { hash: "x", dollars: 21 }], today);
  assert.equal(w.cost.premium.dollars, 0.1);
  assert.equal(w.cost.free.questions, 3);
  assert.equal(w.freePlayers, 2);
  assert.equal(w.hitFree, 1);
  assert.equal(w.monthDollars, 21);
});
test("an owner known from config is left out too", () => {
  const w = playerWeek(days.map((d) => ({ ...d, owners: [] })), [], today, ["me"]);
  assert.equal(w.now.players.has("me"), false);
});
test("daily limit by tier with refused questions, owner and test accounts left out", () => {
  const d = [day("2026-10-14", { limitHit: { f1: "free", g1: "guest", p1: "premium", me: "premium", t1: "guest" }, limitRefused: { f1: 3, g1: 1, p1: 2, me: 9, t1: 4 } }), day("2026-10-16", { limitHit: { f1: "free" }, limitRefused: { f1: 2 } })];
  const w = playerWeek(d, [], today, ["me", "t1"]);
  assert.deepEqual([w.limits.free.players.size, w.limits.free.refused], [1, 5]);
  assert.deepEqual([w.limits.guest.players.size, w.limits.guest.refused], [1, 1]);
  assert.deepEqual([w.limits.premium.players.size, w.limits.premium.refused], [1, 2]);
});
test("/stats limit tally from the hourly counts", () => {
  const hours = [{ lh: { a: { t: "free", n: 2 }, me: { t: "premium", n: 5 } } }, { lh: { a: { t: "free", n: 1 }, g: { t: "guest", n: 1 } } }];
  const l = tallyLimits(hours, new Set(["me"]));
  assert.deepEqual(l, { free: { players: 1, refused: 3 }, guest: { players: 1, refused: 1 }, premium: { players: 0, refused: 0 } });
  assert.equal(limitLine("Last 24 hours", l), "Last 24 hours: free 1 (3 refused) · guests 1 (1 refused) · Premium 0 (0 refused)");
});
console.log(`\n${passed} tests passed`);
