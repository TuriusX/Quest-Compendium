// Run: npm run test:sync   (or: npx tsx tests/discord.test.ts)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyDiscordSignature } from "../discord";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// A key pair standing in for Discord's: the public key in the raw hex form the Developer Portal shows.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
const sign = (ts: string, body: string) => crypto.sign(null, Buffer.from(ts + body), privateKey).toString("hex");

test("Discord's request signature is checked over the timestamp and the raw body", () => {
  const body = JSON.stringify({ type: 1 });
  const ts = "1791100000";
  assert.equal(verifyDiscordSignature(Buffer.from(body), sign(ts, body), ts, publicHex), true);
  // A changed body, another timestamp, another key, or nothing at all: rejected.
  assert.equal(verifyDiscordSignature(Buffer.from(body + " "), sign(ts, body), ts, publicHex), false);
  assert.equal(verifyDiscordSignature(Buffer.from(body), sign(ts, body), "1791100001", publicHex), false);
  assert.equal(verifyDiscordSignature(Buffer.from(body), sign(ts, body), ts, "47090ca2ad8559dc49c14a20b4f06d389a7d8b1403124a9dfe301e94eab69b62"), false);
  assert.equal(verifyDiscordSignature(Buffer.from(body), "", ts, publicHex), false);
  assert.equal(verifyDiscordSignature(Buffer.from(body), "zz", ts, publicHex), false);
});

console.log(`\n${passed} tests passed`);
