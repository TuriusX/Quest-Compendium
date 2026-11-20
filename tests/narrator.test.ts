// Run: npx tsx tests/narrator.test.ts
import assert from "node:assert/strict";
import { parseNarrator, narratorFor, narratorKey, narratorNotes, narratorRequest, GOOGLE_VOICES } from "../narrator";
import { ROLEPLAY_PERSONA, ROLEPLAY_PERSONA_END } from "../searchPolicy";

let passed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => Promise<void> | void) {
  pending.push((async () => {
    try { await fn(); passed++; console.log("PASS  " + name); }
    catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
  })());
}
const reply = (o: any) => "```json\n" + JSON.stringify(o) + "\n```";

test("all 30 Google voices, both genders, in the request", () => {
  assert.equal(GOOGLE_VOICES.length, 30);
  const r = narratorRequest("Hades II");
  assert.match(r, /Sulafat \(woman, warm\)/);
  assert.match(r, /Algenib \(man, gravelly\)/);
});
test("a reply becomes a narrator; a voice of the wrong gender or unknown falls back to the right gender", () => {
  const n = parseNarrator(reply({ who: "a Valentine telegraph clerk", accent: "frontier", voice: "woman, husky", delivery: "brisk", gender: "f", google: "Erinome" }))!;
  assert.equal(n.google, "Erinome");
  assert.equal(parseNarrator(reply({ who: "x", gender: "f", google: "Charon" }))!.google, "Kore");
  assert.equal(parseNarrator(reply({ who: "x", gender: "m", google: "Nope" }))!.google, "Charon");
  assert.equal(parseNarrator("not json"), null);
  assert.equal(parseNarrator(reply({ gender: "m" })), null);
});
test("director's notes end in the transcript heading (only what follows is read)", () => {
  const n = parseNarrator(reply({ who: "a shade", accent: "Aegean", voice: "man", delivery: "dry", gender: "m", google: "Iapetus" }))!;
  assert.match(narratorNotes(n), /# AUDIO PROFILE: a shade\n[\s\S]*#### TRANSCRIPT$/);
});
test("made once per game and kept: the store first, one call for many askers", async () => {
  const kept = new Map<string, any>();
  let calls = 0;
  const store = { get: async (k: string) => kept.get(k) || null, set: async (k: string, n: any) => { kept.set(k, n); } };
  const write = async () => { calls++; return reply({ who: "a Limgrave road-merchant", gender: "m", google: "Charon" }); };
  const [a, b] = await Promise.all([narratorFor("ELDEN RING", store, write), narratorFor("Elden Ring", store, write)]);
  assert.equal(calls, 1);
  assert.equal(a!.who, b!.who);
  assert.ok(kept.has(narratorKey("ELDEN RING")));
  const other = await narratorFor("Hollow Knight", { get: async () => ({ who: "a Hallownest bug", accent: "", voice: "", delivery: "", gender: "f", google: "Leda" }), set: async () => {} }, write);
  assert.equal(other!.google, "Leda");
  assert.equal(calls, 1);
});
test("the persona speaks as the game's narrator when there is one, and keeps its last line", () => {
  assert.match(ROLEPLAY_PERSONA("Hades II", "a shade of the Mourning Fields"), /You are a shade of the Mourning Fields\. Always speak as this same person/);
  assert.match(ROLEPLAY_PERSONA("Hades II"), /Pick one narrator/);
  assert.ok(ROLEPLAY_PERSONA("Hades II", "x").endsWith(ROLEPLAY_PERSONA_END));
});
Promise.all(pending).then(() => console.log(`\n${passed} tests passed`));
