// Run: npm run test:sync   (or: npx tsx tests/visitSources.test.ts)
import assert from "node:assert/strict";
import { cleanTag, sourceOf } from "../visitSources";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const SELF = "quest-compendium-890629309063.us-east1.run.app";

test("sources: the ?from= tag first, then the referrer, else direct", () => {
  assert.equal(sourceOf("guide", "https://www.google.com/", SELF), "guide");
  assert.equal(sourceOf("HOME", "", SELF), "home");
  assert.equal(sourceOf("nonsense", "", SELF), "direct");
  assert.equal(sourceOf("", "https://questcompendium.com/guides/elden-ring/", SELF), "website");
  assert.equal(sourceOf("", "https://www.google.co.uk/", SELF), "search");
  assert.equal(sourceOf("", "https://discord.com/channels/1/2", SELF), "discord");
  assert.equal(sourceOf("", "https://itch.io/", SELF), "store");
  assert.equal(sourceOf("", "https://old.reddit.com/r/Eldenring", SELF), "social");
  assert.equal(sourceOf("", "https://example.org/", SELF), "other");
  // Moving around inside the app isn't a visit.
  assert.equal(sourceOf("", `https://${SELF}/`, SELF), "");
  assert.equal(cleanTag("store"), "store");
  assert.equal(cleanTag("<script>"), "");
});

console.log(`\n${passed} tests passed`);
