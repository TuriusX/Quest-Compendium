// Run: npm run test:sync   (or: npx tsx tests/guestHandover.test.ts)
import assert from "node:assert/strict";
import { mergeHandoverSettings, mergeHandoverTabs, unionDone } from "../src/utils/guestHandover";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const tab = (id: string, name = id): any => ({ id, name, messages: [], notes: "", createdAt: 1, lastActive: 1 });

test("conversations: the guest's are added to the account's, none twice, never the welcome tab", () => {
  const h: any = { tabs: [tab("g1", "Elden Ring"), tab("a1"), tab("guest-welcome-compendium", "Welcome, Explorer")], at: Date.now() };
  assert.deepEqual(mergeHandoverTabs([tab("a1"), tab("a2")], h).map((t) => t.id), ["a1", "a2", "g1"]);
  assert.deepEqual(mergeHandoverTabs([tab("a1")], null).map((t) => t.id), ["a1"]);
});

test("quest log progress: places (the guest's newer one wins), done lists combined without repeats", () => {
  const account: any = {
    gameProgress: { "elden ring": { name: "Limgrave", confirmed: true }, "rdr2": { name: "Valentine", confirmed: false } },
    gameDone: { "elden ring": [{ text: "Margit", kind: "fight", at: 5 }] },
  };
  const h: any = {
    tabs: [], at: Date.now(),
    gameProgress: { "elden ring": { name: "Liurnia", confirmed: true } },
    gameDone: { "elden ring": [{ text: "Godrick", kind: "fight", at: 9 }, { text: "margit", kind: "fight", at: 4 }] },
  };
  const m = mergeHandoverSettings(account, h);
  assert.equal(m.gameProgress!["elden ring"].name, "Liurnia");
  assert.equal(m.gameProgress!["rdr2"].name, "Valentine");
  assert.deepEqual(m.gameDone!["elden ring"].map((x) => x.text), ["Godrick", "Margit"]);
});

test("guide ticks: unioned per page", () => {
  assert.deepEqual(unionDone({ "er:limgrave": ["x1", "x2"] }, { "er:limgrave": ["x2", "x3"], "er:caelid": ["s1"] }), { "er:limgrave": ["x1", "x2", "x3"], "er:caelid": ["s1"] });
  const m = mergeHandoverSettings({ guideDone: { "er:limgrave": ["x1"] } } as any, { tabs: [], at: 1, guideDone: { "er:limgrave": ["x9"] } });
  assert.deepEqual(m.guideDone, { "er:limgrave": ["x1", "x9"] });
  // Nothing from the guest: the account's settings unchanged.
  assert.deepEqual(mergeHandoverSettings({ language: "en" } as any, { tabs: [], at: 1 }), { language: "en" });
});

console.log(`\n${passed} tests passed`);
