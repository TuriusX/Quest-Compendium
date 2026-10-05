// Run: npm run test:sync   (or: npx tsx tests/areaInfo.test.ts)
import assert from "node:assert/strict";
import { parseInfoFields, parseWayFields, hasInfo, INFO_FORMAT, WAY_FORMAT } from "../scripts/guides/common";
import { parseInfoReply } from "../scripts/guides/areaInfo";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("the formats ask for what the summary box and directions need", () => {
  for (const s of ["region or parent area", "level range", "quests here", "services and important NPCs", "enemy types"]) assert.ok(INFO_FORMAT.includes(s), s);
  for (const s of ["named neighbouring place", "connects to", "map coordinates if the game shows them"]) assert.ok(WAY_FORMAT.includes(s), s);
});

test("INFO and WAY lines: lists split on ;, empty and 'none' fields left out, coordinates only with numbers", () => {
  const i = parseInfoFields(["Velen", "8-12", "Man's Best Friend; Missing Brother", "Notice board; Blacksmith", "Drowners; Wolves"]);
  assert.deepEqual(i, { region: "Velen", levels: "8-12", quests: ["Man's Best Friend", "Missing Brother"], services: ["Notice board", "Blacksmith"], enemyTypes: ["Drowners", "Wolves"] });
  const w = parseWayFields(["North-east of Mulbrydale, over the stone bridge", "Mulbrydale; Hanged Man's Tree", "none"], i);
  assert.equal(w.directions, "North-east of Mulbrydale, over the stone bridge");
  assert.deepEqual(w.connected, ["Mulbrydale", "Hanged Man's Tree"]);
  assert.equal(w.coords, undefined);
  assert.equal(parseWayFields(["", "", "X: 262, Y: 481"]).coords, "X: 262, Y: 481");
  assert.equal(parseWayFields(["", "", "the big tree"]).coords, undefined);
  assert.deepEqual(parseInfoFields(["", "none", "", "", ""]), {});
  assert.equal(hasInfo({}), false);
  assert.equal(hasInfo(w), true);
});

test("a reply's two lines become the page's info, with sources for searched pages", () => {
  const r = parseInfoReply("Some intro\nINFO: Act 1, Wilderness | none | Save Arabella; Rescue the Grand Duke | Dammon (smith); Arron (trader) | Goblins; Harpies\nWAY: From the Roadside Cliffs waypoint, follow the road west | Roadside Cliffs; Druid Grove | X: 262, Y: 481", ["bg3.wiki"]);
  assert.equal(r!.region, "Act 1, Wilderness");
  assert.equal(r!.levels, undefined);
  assert.deepEqual(r!.quests, ["Save Arabella", "Rescue the Grand Duke"]);
  assert.equal(r!.coords, "X: 262, Y: 481");
  assert.deepEqual(r!.sources, ["bg3.wiki"]);
  assert.equal(parseInfoReply("Nothing useful here."), null);
});

console.log(`\n${passed} tests passed`);
