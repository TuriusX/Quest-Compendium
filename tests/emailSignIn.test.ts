// Run: npm run test:sync   (or: npx tsx tests/emailSignIn.test.ts)
import assert from "node:assert/strict";
import express from "express";
import { cleanEmail, normalizeEmail, isDisposable, freePoolKeys, poolLeft, registerEmailSignIn } from "../emailSignIn";

let passed = 0;
const results: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  results.push((async () => {
    try { await fn(); passed++; console.log("PASS  " + name); }
    catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
  })());
}

test("addresses are cleaned, junk is refused", () => {
  assert.equal(cleanEmail("  Noah@Example.COM "), "noah@example.com");
  assert.equal(cleanEmail("not an email"), null);
  assert.equal(cleanEmail("a@b"), null);
  assert.equal(cleanEmail(42), null);
});

test("Gmail: dots and +tags are the same address (googlemail too)", () => {
  assert.equal(normalizeEmail("N.a.m.e+1@gmail.com"), "name@gmail.com");
  assert.equal(normalizeEmail("name@googlemail.com"), "name@gmail.com");
});

test("other domains: +tags dropped, dots kept", () => {
  assert.equal(normalizeEmail("first.last+qc@example.com"), "first.last@example.com");
});

test("disposable domains (and their subdomains) are spotted; ordinary ones aren't", () => {
  assert.equal(isDisposable("x@mailinator.com"), true);
  assert.equal(isDisposable("x@sub.mailinator.com"), true);
  assert.equal(isDisposable("x@gmail.com"), false);
  assert.equal(isDisposable("x@outlook.com"), false);
  assert.equal(isDisposable(undefined), false);
});

test("pools: one per real address, one per device; variants of an address share it", () => {
  const a = freePoolKeys("n.a.m.e+2@gmail.com", "dev_abcdefgh12");
  const b = freePoolKeys("name@gmail.com", "dev_abcdefgh12");
  assert.equal(a.length, 2);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], freePoolKeys("other@gmail.com", null)[0]);
  assert.ok(!a.join().includes("name"), "fingerprints only");
});

test("pools: a junk device id is ignored", () => {
  assert.equal(freePoolKeys("a@example.com", "x").length, 1);
  assert.equal(freePoolKeys("a@example.com", "<script>alert(1)</script>").length, 1);
});

test("what's left in a pool today; yesterday's use doesn't count", () => {
  assert.deepEqual(poolLeft({ day: "2026-10-17", pro: 2, flash: 1 }, "2026-10-17", { pro: 2, flash: 5 }), { pro: 0, flash: 4 });
  assert.deepEqual(poolLeft({ day: "2026-10-16", pro: 2, flash: 5 }, "2026-10-17", { pro: 2, flash: 5 }), { pro: 2, flash: 5 });
  assert.deepEqual(poolLeft(undefined, "2026-10-17", { pro: 2, flash: 5 }), { pro: 2, flash: 5 });
});

test("send: the link goes to /email-signin with the device code; 3 per address an hour", async () => {
  const sent: string[] = [];
  const app = express();
  app.use(express.json());
  registerEmailSignIn(app, {
    apiKey: "k",
    requireAuth: (_req, _res, next) => next(),
    getAuth: () => ({ getUserByEmail: async () => ({ uid: "u" }), createCustomToken: async () => "t" }),
    clientIp: () => "1.2.3.4",
    sendLink: async (email, url) => { sent.push(`${email} ${url}`); return { ok: true }; },
  });
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const post = (body: any) => fetch(`http://localhost:${port}/api/email-link/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ email: "nope" })).status, 400);
    assert.equal((await post({ email: "a.b+1@gmail.com", userCode: "abcd-efgh" })).status, 200);
    assert.match(sent[0], /^a\.b\+1@gmail\.com http:\/\/localhost:\d+\/email-signin\?code=ABCD-EFGH$/);
    assert.equal((await post({ email: "ab@gmail.com", lang: "de" })).status, 200);
    assert.match(sent[1], /email-signin\?lang=de$/);
    assert.equal((await post({ email: "AB@gmail.com" })).status, 200);
    // The fourth for the same real address within the hour.
    assert.equal((await post({ email: "a.b+9@gmail.com" })).status, 429);
    assert.equal(sent.length, 3);
    assert.equal((await post({ email: "x@mailinator.com" })).status, 200);
  } finally {
    server.close();
  }
});

Promise.all(results).then(() => console.log(`\n${passed} passed`));
