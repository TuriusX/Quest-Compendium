// Run: npm run test:sync   (or: npx tsx tests/premium.test.ts)
import assert from "node:assert/strict";
import { decidePremium } from "../premium";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a live Stripe subscription: Premium, and the customer id and renewal are saved", () => {
  const d = decidePremium({ isPremium: false }, { customerId: "cus_1", active: true, periodEnd: 1_800_000_000_000 });
  assert.equal(d.isPremium, true);
  assert.equal(d.source, "stripe");
  assert.deepEqual(d.save, { stripeCustomerId: "cus_1", isPremium: true, subscriptionStatus: "active", premiumPeriodEnd: 1_800_000_000_000 });
});

test("cancelled in the portal: still Premium until the period ends, marked as ending", () => {
  const d = decidePremium({ isPremium: true, subscriptionStatus: "active", stripeCustomerId: "cus_1" }, { customerId: "cus_1", active: true, periodEnd: 5, cancelAtPeriodEnd: true });
  assert.equal(d.isPremium, true);
  assert.equal(d.save.premiumCancelAtPeriodEnd, true);
});

test("the subscription ended: Premium turns off for a Stripe customer (the old bug: it stayed on)", () => {
  const d = decidePremium({ isPremium: true, subscriptionStatus: "active", stripeCustomerId: "cus_1" }, { customerId: "cus_1", active: false });
  assert.equal(d.isPremium, false);
  assert.deepEqual(d.save, { isPremium: false, subscriptionStatus: "inactive" });
});

test("a paid-before player found by email (no saved id yet): turned off, and the id is saved", () => {
  const d = decidePremium({ isPremium: true, subscriptionStatus: "active" }, { customerId: "cus_9", active: false });
  assert.equal(d.isPremium, false);
  assert.equal(d.save.stripeCustomerId, "cus_9");
});

test("manual grants and owner accounts are never turned off", () => {
  assert.equal(decidePremium({ isPremium: true, premiumGrant: true, stripeCustomerId: "cus_1" }, { customerId: "cus_1", active: false }).isPremium, true);
  assert.equal(decidePremium({ isPremium: true }, { customerId: "cus_1", active: false }, { owner: true }).isPremium, true);
  assert.equal(decidePremium({ isPremium: true }, { customerId: "cus_1", active: false }, { owner: true }).source, "grant");
});

test("Premium set by hand before grants existed (never a Stripe customer) stands", () => {
  const d = decidePremium({ isPremium: true }, { customerId: null, active: false });
  assert.equal(d.isPremium, true);
  assert.deepEqual(d.save, {});
});

test("a free player: free, nothing saved", () => {
  const d = decidePremium({ isPremium: false }, { customerId: null, active: false });
  assert.equal(d.isPremium, false);
  assert.deepEqual(d.save, {});
});

test("Stripe can't be reached: the saved status stands, nothing saved", () => {
  assert.equal(decidePremium({ isPremium: true, stripeCustomerId: "cus_1" }, null).isPremium, true);
  assert.equal(decidePremium({ isPremium: false }, null).isPremium, false);
  assert.deepEqual(decidePremium({ isPremium: true }, null).save, {});
});

console.log(`\n${passed} passed`);
