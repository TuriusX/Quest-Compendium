// Run: npx tsx tests/gameNamedIn.test.ts
import assert from "node:assert/strict";
import { gameNamedIn } from "../visualServer";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const games = [{ game: "ELDEN RING" }, { game: "Elden Ring Nightreign" }, { game: "Control" }, { game: "Baldur's Gate 3" }, { game: "Hades" }];
test("names a game in any case", () => assert.equal(gameNamedIn("how to get the nagakiba in elden ring?", games), "ELDEN RING"));
test("the longest name wins", () => assert.equal(gameNamedIn("best class in Elden Ring Nightreign", games), "Elden Ring Nightreign"));
test("punctuation in names", () => assert.equal(gameNamedIn("where is Karlach in baldurs gate 3", games), ""));
test("apostrophes kept as spaces", () => assert.equal(gameNamedIn("where is Karlach in Baldur's Gate 3", games), "Baldur's Gate 3"));
test("one-word names only when capitalized", () => {
  assert.equal(gameNamedIn("how do I control the camera", games), "");
  assert.equal(gameNamedIn("best weapon in Control?", games), "Control");
});
test("no game named", () => assert.equal(gameNamedIn("how to get the Nagakiba", games), ""));
console.log(`\n${passed} tests passed`);
