// Run: npx tsx tests/learnedGames.test.ts
import assert from "node:assert/strict";
import { learn, resolveProgram, LEARNED_MAX, type ProgramGame } from "../src/utils/learnedGames";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const prog = (o: Partial<ProgramGame>): ProgramGame => ({ source: "unknown", name: null, sure: false, key: "game.exe|game", exe: "game.exe", ...o });

test("a launcher's game is used as detected; a Steam library game keeps its app id", () => {
  const v = resolveProgram(prog({ source: "steam", name: "Hades", sure: true, storeId: "1145360" }), {});
  assert.equal(v.state, "game");
  assert.equal(v.state === "game" && v.game.appId, 1145360);
  assert.equal(resolveProgram(prog({ source: "epic", name: "Hades", sure: true }), {}).state, "game");
});

test("an emulator's game, another installer's or an unknown program is asked once", () => {
  const v = resolveProgram(prog({ source: "emulator", emulator: "Dolphin", name: "Super Mario Sunshine", key: "dolphin|supermariosunshine" }), {});
  assert.deepEqual(v, { state: "ask", guess: "Super Mario Sunshine", via: "Dolphin" });
  assert.deepEqual(resolveProgram(prog({}), {}), { state: "ask", guess: null, via: "game.exe" });
});

test("the player's answer is remembered: the game, or not a game; and it beats the launcher's name", () => {
  const p = prog({ source: "emulator", emulator: "Dolphin", name: "Super Mario Sunshine", key: "dolphin|sms" });
  const yes = learn({}, p.key, "Super Mario Sunshine");
  const v = resolveProgram(p, yes);
  assert.equal(v.state === "game" && v.game.name, "Super Mario Sunshine");
  assert.equal(resolveProgram(p, learn(yes, p.key, null)).state, "ignore");
  const renamed = resolveProgram(prog({ source: "epic", name: "Hades II Early Access", sure: true }), learn({}, "game.exe|game", "Hades II"));
  assert.equal(renamed.state === "game" && renamed.game.name, "Hades II");
});

test("at most LEARNED_MAX answers, the newest kept", () => {
  let l = {};
  for (let i = 0; i < LEARNED_MAX + 5; i++) l = learn(l, `k${i}`, `Game ${i}`);
  const keys = Object.keys(l);
  assert.equal(keys.length, LEARNED_MAX);
  assert.equal(keys[0], "k5");
  // Answering again moves it to the newest.
  l = learn(l, "k5", "Game 5");
  assert.equal(Object.keys(l).pop(), "k5");
});

console.log(`\n${passed} passed`);
