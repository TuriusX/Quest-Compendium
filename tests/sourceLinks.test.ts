// Run: npm run test:sync   (or: npx tsx tests/sourceLinks.test.ts)
// Sources under answers (Nov 16 2026): readable page names and site names, never ids.
import assert from "node:assert/strict";
import { siteName, titleFromUrl } from "../sourceLinks";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("site names", () => {
  assert.equal(siteName("eldenring.wiki.fextralife.com"), "Fextralife");
  assert.equal(siteName("bg3.fandom.com"), "Fandom");
  assert.equal(siteName("www.ign.com"), "IGN");
  assert.equal(siteName("bg3.wiki"), "bg3.wiki");
});

test("page names from addresses", () => {
  assert.equal(titleFromUrl("https://eldenring.wiki.fextralife.com/Claw+Talisman"), "Claw Talisman");
  assert.equal(titleFromUrl("https://www.ign.com/wikis/elden-ring/Claw_Talisman"), "Claw Talisman");
  assert.equal(titleFromUrl("https://bg3.wiki/wiki/Emerald_Grove"), "Emerald Grove");
  assert.equal(titleFromUrl("https://www.thegamer.com/elden-ring-claw-talisman-location/"), "Elden Ring Claw Talisman Location");
});

test("ids and blank pages aren't names (the fallback, or nothing)", () => {
  assert.equal(titleFromUrl("https://youtu.be/EfIEzLULfqE"), "");
  assert.equal(titleFromUrl("https://www.youtube.com/watch?v=EfIEzLULfqE"), "");
  assert.equal(titleFromUrl("https://example.com/"), "");
  assert.equal(titleFromUrl("https://example.com/12345678-abcd", "Fallback"), "Fallback");
});

console.log(`\n${passed} passed`);
