// Run: npm run test:sync   (or: npx tsx tests/fights.test.ts)
import assert from "node:assert/strict";
import { extractCombat } from "../answerBar";
import { guideFightNotes, guideNotesForPrompt, fightLine } from "../guidesApi";
import { fightKnown, sameFight, planSummary } from "../missingFights";
import { parseFightLines, FIGHT_FORMAT } from "../scripts/guides/fights";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// The Emerald Grove page as published: a Harpy enemy entry, nothing about the goblin attack on the gate.
const grove = {
  key: "baldurs-gate-3", slug: "emerald-grove", name: "Emerald Grove", verified: true, story: "Act 1", overview: "",
  items: [], shops: [], secrets: [], tips: [], sections: [],
  enemies: [{ id: "x7", name: "Harpy", weakness: "", notes: "Four flying monstrosities with a Luring Song." }],
  fights: [] as any[],
} as any;

test("builders' FIGHT lines become key fights (blank and 'none' fields left out)", () => {
  const f = parseFightLines(
    "FIGHT: Goblin raid on the grove gate | Za'Krug, goblin archers, worg | Archers on the palisade; Za'Krug's greataxe | Weak to fire; none | Take the high ground by the gate, kill the archers first | Grateful tieflings; Zevlor's reward\n" +
    "Some other text\n- FIGHT: **Harpies at the beach** | Harpy x4 | Luring Song | none | Cast Silence | none",
    ["bg3.wiki"],
  );
  assert.equal(f.length, 2);
  assert.equal(f[0].name, "Goblin raid on the grove gate");
  assert.equal(f[0].enemies, "Za'Krug, goblin archers, worg");
  assert.match(f[0].tactics!, /high ground/);
  assert.deepEqual(f[0].sources, ["bg3.wiki"]);
  assert.equal(f[1].name, "Harpies at the beach");
  assert.equal(f[1].weaknesses, undefined);
  assert.equal(f[1].rewards, undefined);
  assert.deepEqual(parseFightLines("NONE"), []);
  assert.match(FIGHT_FORMAT, /tactics and positions/);
});

test("key fights lead the combat notes, in full, and are named in the general notes", () => {
  const page = { ...grove, fights: [{ id: "f1", name: "Goblin raid on the grove gate", enemies: "Za'Krug, goblin archers", tactics: "Hold the high ground; kill the archers first", rewards: "Zevlor's reward" }] };
  const notes = guideFightNotes(page);
  assert.match(notes, /- Key fight: Goblin raid on the grove gate; enemies Za'Krug, goblin archers; tactics Hold the high ground/);
  assert.ok(notes.indexOf("Key fight") < notes.indexOf("Enemy: Harpy"));
  assert.match(guideNotesForPrompt(page), /Key fight: Goblin raid on the grove gate \(Za'Krug, goblin archers\)/);
  assert.equal(fightLine({ name: "Boss" }), "Boss");
});

test("<qc-combat> names the fight and its enemies; the bare flag still works", () => {
  const r = extractCombat('Kill the archer first.\n<qc-combat>{"fight": "Goblin raid on the grove gate", "enemies": ["Za\'Krug", "Goblin archer"]}</qc-combat>');
  assert.deepEqual(r, { text: "Kill the archer first.", combat: true, fight: "Goblin raid on the grove gate", enemies: ["Za'Krug", "Goblin archer"] });
  assert.deepEqual(extractCombat("Kill the archer first.\n<qc-combat/>"), { text: "Kill the archer first.", combat: true });
  // Broken JSON: still a fight, nothing named, nothing left in the text.
  assert.deepEqual(extractCombat("Go.\n<qc-combat>{oops</qc-combat>"), { text: "Go.", combat: true });
  assert.deepEqual(extractCombat("No fight."), { text: "No fight.", combat: false });
});

test("the gate fight at the Emerald Grove isn't on the page: a missing fight; the harpies are", () => {
  assert.equal(fightKnown(grove, { fight: "Goblin raid on the grove gate", enemies: ["Za'Krug", "Goblin archer", "Worg"] }), false);
  assert.equal(fightKnown(grove, { fight: "Harpy ambush", enemies: ["Harpies"] }), true);
  // Once the page has the key fight, the same fight (named differently) is covered.
  const fixed = { ...grove, fights: [{ id: "f1", name: "Defend the Emerald Grove gate", enemies: "Za'Krug, goblin archers, worgs" }] };
  assert.equal(fightKnown(fixed, { fight: "Goblin attack", enemies: ["Goblin archer"] }), true);
  assert.equal(fightKnown(fixed, { fight: "Gate defence", enemies: [] }), true);
  // Nothing named: never a candidate.
  assert.equal(fightKnown(grove, {}), true);
});

test("reports of the same fight are grouped; a different fight isn't", () => {
  const a = { fight: "Goblin raid on the grove gate", enemies: ["Za'Krug", "Goblin archer"] };
  assert.equal(sameFight(a, { fight: "Defending the gate", enemies: [] }), true);
  assert.equal(sameFight(a, { fight: "Emerald Grove battle", enemies: ["Goblin archers", "Za'Krug"] }), true);
  assert.equal(sameFight(a, { fight: "Harpies on the beach", enemies: ["Harpy"] }), false);
});

test("the candidate's plan comes from the quest-log steps only", () => {
  assert.equal(
    planSummary([{ text: "Kill the goblin archer on the palisade first" }, { text: "Hold the high ground by the gate." }]),
    "Kill the goblin archer on the palisade first. Hold the high ground by the gate.",
  );
  assert.equal(planSummary([]), "");
});

console.log(`\n${passed} passed`);
