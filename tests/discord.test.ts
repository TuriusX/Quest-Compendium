// Run: npm run test:sync   (or: npx tsx tests/discord.test.ts)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyDiscordSignature, closestMatch } from "../discord";

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

test("typed names find the closest guide, area and entry; unclear ones offer suggestions", () => {
  const games = [{ name: "Baldur's Gate 3", value: "baldur-s-gate-3" }, { name: "Baldur's Gate", value: "baldur-s-gate" }, { name: "Dead Space", value: "dead-space" }, { name: "FINAL FANTASY VI", value: "final-fantasy-vi" }];
  assert.equal(closestMatch("baldur-s-gate-3", games).match?.name, "Baldur's Gate 3"); // a picked suggestion's value
  assert.equal(closestMatch("baldurs gate 3", games).match?.name, "Baldur's Gate 3");
  assert.equal(closestMatch("final fantasy 6", games).match?.name, "FINAL FANTASY VI");
  assert.equal(closestMatch("dead spcae", games).match?.name, "Dead Space"); // a typo
  const areas = [{ name: "Ravaged Beach", value: "ravaged-beach" }, { name: "Overgrown Ruins", value: "overgrown-ruins" }, { name: "Emerald Grove", value: "emerald-grove" }];
  assert.equal(closestMatch("ravaged beech", areas).match?.value, "ravaged-beach");
  const entries = [{ name: "Harper's Map", value: "x2" }, { name: "Harper's Notebook", value: "x3" }, { name: "Thieves' Tools", value: "x1" }];
  assert.equal(closestMatch("harpers map", entries).match?.value, "x2");
  // Ambiguous ("harper's" fits both) or nonsense: no match, but the closest names to offer.
  const amb = closestMatch("harper's", entries);
  assert.equal(amb.match, null);
  assert.equal(amb.suggestions.length, 3);
  assert.equal(closestMatch("qwzx", games).match, null);
});

console.log(`\n${passed} tests passed`);
