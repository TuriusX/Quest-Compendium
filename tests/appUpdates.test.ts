// Run: npm run test:sync   (or: npx tsx tests/appUpdates.test.ts)
import assert from "node:assert/strict";
import { newerVersion } from "../src/components/AppUpdates";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("\"What's new\" shows only after moving to a newer version", () => {
  assert.equal(newerVersion("0.5.7", "0.5.6"), true);
  assert.equal(newerVersion("0.5.10", "0.5.9"), true);
  assert.equal(newerVersion("0.6.0", "0.5.12"), true);
  assert.equal(newerVersion("0.5.6", "0.5.6"), false);
  assert.equal(newerVersion("0.5.6", "0.5.7"), false, "never after a downgrade");
});

console.log(`\n${passed} tests passed`);
