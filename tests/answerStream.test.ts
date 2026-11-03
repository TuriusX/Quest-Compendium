// Run: npm run test:sync   (or: npx tsx tests/answerStream.test.ts)
import assert from "node:assert/strict";
import { visiblePart, nextPiece, collectStream } from "../answerStream";
import { countSearches, searchSources, groundedText } from "../searchGuard";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const reply = 'Pick the lock [g6] of the chest.\nThen leave.\n<qc-title now="no">Loot</qc-title>\n```\n<qc-steps>["a"]</qc-steps>\n```\n<qc-place>{"name":"X"}</qc-place>\n<qc-guide>["g6"]</qc-guide>';

await test("at every point of a reply, none of our lines or tags can be seen", () => {
  for (let i = 0; i <= reply.length; i++) {
    const v = visiblePart(reply.slice(0, i));
    assert.doesNotMatch(v, /<|qc-|\[g|```|Loot|"name"/, `at ${i}: ${v}`);
  }
  assert.equal(visiblePart(reply).trim(), "Pick the lock of the chest.\nThen leave.");
});

await test("what's shown only ever grows, so it reads as being written", () => {
  let last = "";
  for (let i = 0; i <= reply.length; i++) {
    const v = visiblePart(reply.slice(0, i));
    assert.ok(v.trimEnd().startsWith(last.trimEnd()), `at ${i}`);
    last = v;
  }
});

await test("a reply that opens with a search request shows nothing, even with the model working aloud", () => {
  assert.equal(visiblePart("<qc-search/>"), "");
  assert.equal(visiblePart("<qc-search/> direct search? Wait, I must reply with ONLY"), "");
  assert.equal(visiblePart("<qc-sea"), "");
  assert.equal(visiblePart("  <"), "  ");
});

await test("ordinary text with brackets and angle signs isn't held back for good", () => {
  assert.equal(visiblePart("Use [Fire] when HP < 50, then go on."), "Use [Fire] when HP < 50, then go on.");
  assert.equal(visiblePart("Weak to [g"), "Weak to");
});

await test("search citations don't show", () => {
  assert.equal(visiblePart("Go north [PerQueryResult(index=1)] now"), "Go north now");
  assert.equal(visiblePart("Go north [PerQuery"), "Go north");
  // Just the numbers, as the model also writes them (seen Nov 3 2026), whole and while they're being written.
  assert.equal(visiblePart("the Dank Crypt [1.0.25]. She"), "the Dank Crypt. She");
  assert.equal(visiblePart("the helm battle [1.0.7, 1.0.25], their"), "the helm battle, their");
  const reply = "Lae'zel) [1.0.25]: use a scroll [1.0.7, 1.0.25].";
  for (let i = 0; i <= reply.length; i++) assert.doesNotMatch(visiblePart(reply.slice(0, i)), /\[|\d\.\d/);
  assert.equal(visiblePart(reply), "Lae'zel): use a scroll.");
  // Several guide tags in one bracket (seen Nov 3 2026), whole and while they're being written.
  const tagged = "the Dank Crypt [g1024, g1025]. The crash [g4, g5, g6, g1014].";
  for (let i = 0; i <= tagged.length; i++) assert.doesNotMatch(visiblePart(tagged.slice(0, i)), /\[|g\d/);
  assert.equal(visiblePart(tagged), "the Dank Crypt. The crash.");
  // Other brackets and numbers stay.
  assert.equal(visiblePart("Patch 1.0.25 adds [two] rooms and [3 items]."), "Patch 1.0.25 adds [two] rooms and [3 items].");
});

await test("the next piece: what's new, or the whole text when it changed", () => {
  assert.deepEqual(nextPiece("Go", "Go north"), { add: " north" });
  assert.deepEqual(nextPiece("Go north", "Head east"), { replace: "Head east" });
  assert.equal(nextPiece("Go", "Go"), null);
});

await test("a stream reads as one reply: text, usage, and every search across its pieces", async () => {
  async function* pieces() {
    yield { text: "Hello ", candidates: [{ groundingMetadata: { webSearchQueries: ["a"], groundingChunks: [{ web: { title: "wiki" } }] } }] };
    yield { text: "there", candidates: [{ groundingMetadata: { webSearchQueries: ["a", "b"], groundingSupports: [{ segment: { text: "Hello" } }] } }] };
    yield { usageMetadata: { promptTokenCount: 5 }, candidates: [{ finishReason: "STOP" }] };
  }
  const seen: string[] = [];
  const r = await collectStream(pieces(), (t) => seen.push(t));
  assert.deepEqual(seen, ["Hello ", "Hello there"]);
  assert.equal(r.text, "Hello there");
  assert.equal(r.usageMetadata.promptTokenCount, 5);
  assert.equal(r.candidates[0].finishReason, "STOP");
  assert.equal(countSearches(r), 2);
  assert.deepEqual(searchSources(r), ["wiki"]);
  assert.deepEqual(groundedText(r), ["Hello"]);
});

await test("a stream with no search has no search details", async () => {
  async function* pieces() { yield { text: "Hi", candidates: [{ finishReason: "STOP" }] }; }
  const r = await collectStream(pieces(), () => {});
  assert.equal(countSearches(r), 0);
  assert.equal((r.candidates[0] as any).groundingMetadata, undefined);
});

console.log(`\n${passed} tests passed`);
process.exit(process.exitCode || 0);
