// Run: npm run test:sync   (or: npx tsx tests/combat.test.ts)
import assert from "node:assert/strict";
import { combatRules, extractCombat, isTrivialMarker, clipWords } from "../answerBar";
import { extractSteps } from "../steps";
import { guideFightNotes } from "../guidesApi";
import { placeAfterMove } from "../src/utils/placeName";
import { buildTrackerPayload, clipWords as clipForTracker } from "../src/utils/trackerPayload";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a fight on screen: the rules say how to spot it (game-agnostic) and how to answer", () => {
  const r = combatRules(true);
  for (const cue of ["turn-order", "End Turn", "health bars over enemies"]) assert.ok(r.includes(cue), cue);
  assert.match(r, /whose turn it is now/);
  assert.match(r, /kill order/);
  assert.match(r, /Mark up to 5/);
  assert.match(r, /<qc-combat\/>/);
  // Markers off: no marker instructions at all.
  assert.equal(combatRules(false).includes("Mark up to 5"), false);
});

test("the <qc-combat/> flag is read and always removed", () => {
  assert.deepEqual(extractCombat("Kill the archer first.\n<qc-combat/>"), { text: "Kill the archer first.", combat: true });
  assert.equal(extractCombat("Kill the archer first.\n```\n<qc-combat />\n```").combat, true);
  assert.deepEqual(extractCombat("No fight here."), { text: "No fight here.", combat: false });
});

test("combat markers and steps are never dropped as low-value", () => {
  // Enemy and tactical markers clear the bar on their own.
  assert.equal(isTrivialMarker({ label: "Goblin archer", note: "Kill first: shoots the gate defenders", category: "enemy" }), false);
  assert.equal(isTrivialMarker({ label: "Explosive barrel", note: "Throw to hit the group", category: "action" }), false);
  assert.equal(isTrivialMarker({ label: "Jump (Z) here", note: "High ground: +2 to hit", category: "action" }), false);
  // A battle plan step that happens to mention a body and some gold still stays (server: no low-value filter in combat).
  const text = 'Kill the archer.\n<qc-steps>[{"kind":"step","text":"Shove the goblin off the barrel by the body with some gold"}]</qc-steps>';
  assert.equal(extractSteps(text).steps.length, 0);
  assert.equal(extractSteps(text, { combat: true }).steps.length, 1);
});

test("the guide's fights for the area go into the prompt in full", () => {
  const page = {
    key: "bg3", slug: "emerald-grove", name: "Emerald Grove", verified: true,
    overview: "Druids and tiefling refugees clash under the threat of a goblin army that attacks the gate.",
    items: [], shops: [],
    enemies: [{ id: "x7", name: "Harpy", weakness: "", notes: "Four flying monstrosities that mesmerize targets with their Luring Song." }],
    secrets: [{ id: "s1", text: "The hidden Tiefling Hideout behind the concealed hatch." }],
    tips: ["Cast Silence before confronting the Harpies so the party is immune to the song.", "Buy potions from Arron."],
    sections: [{ title: "Gate defence", check: false, entries: [{ id: "g1", text: "Wyll and Zevlor hold the gate; the goblin archers stand on the palisade." }] }],
  } as any;
  const notes = guideFightNotes(page);
  assert.match(notes, /GUIDE: FIGHTS AND ENEMIES IN Emerald Grove/);
  assert.match(notes, /Enemy: Harpy; Four flying monstrosities/);
  assert.match(notes, /Gate defence: Wyll and Zevlor hold the gate/);
  assert.match(notes, /Tip: Cast Silence before confronting the Harpies/);
  assert.match(notes, /Overview: Druids and tiefling refugees clash/);
  assert.equal(notes.includes("Buy potions"), false); // not about fighting
  assert.equal(notes.includes("Tiefling Hideout"), false);
  assert.equal(guideFightNotes({ ...page, enemies: [], sections: [], tips: [], overview: "", secrets: [] }), "");
});

test("the quest log titles a combat answer's steps as the battle plan", () => {
  const msg = { id: "m1", role: "assistant", text: "", timestamp: 0, combat: true, place: { name: "Emerald Grove", sure: true, options: [] },
    steps: [{ kind: "step", text: "Kill the goblin archer on the palisade first" }, { kind: "step", text: "Jump (Z) to the high ground by the gate" }] } as any;
  const p = buildTrackerPayload({ id: "t", name: "BG3", messages: [msg], place: { name: "Emerald Grove", confirmed: true } } as any, msg, null, null, { secBattle: "Battle plan" }, { accent: "#a87ffb", gameKey: "g" })!;
  assert.equal(p.data.sections[0].title, "Battle plan");
  assert.deepEqual(p.data.sections[0].items.map((i) => i.label), ["Kill the goblin archer on the palisade first", "Jump (Z) to the high ground by the gate"]);
});

test("moving to another area never keeps the old area's story beat", () => {
  const prev = { name: "Ravaged Beach", confirmed: true, story: "Exploring the Nautiloid crash site", storyConfirmed: true };
  assert.deepEqual(placeAfterMove(prev, "Emerald Grove", "Defending the grove gate", true),
    { name: "Emerald Grove", confirmed: true, story: "Defending the grove gate", storyConfirmed: true });
  // The new area has no beat: none (not the beach's).
  const none = placeAfterMove(prev, "Emerald Grove", "", false);
  assert.equal(none.story, undefined);
  assert.equal((none as any).storyConfirmed, undefined);
  // Same area, no new beat: it stays.
  assert.equal(placeAfterMove(prev, "Ravaged Beach", "", true).story, "Exploring the Nautiloid crash site");
});

test("text is never cut mid-word", () => {
  const secret = "The hidden Tiefling Hideout; talk to Doni or rescue Mirkon from the Secluded Cove to be shown the secret concealed entrance hatch to Mol's refuge.";
  for (const clip of [clipWords, clipForTracker]) {
    const c = clip(secret, 140);
    assert.ok(c.endsWith("…"), c);
    assert.ok(c.length <= 140);
    assert.equal(c.includes("Mol's r…"), false);
    assert.ok(secret.startsWith(c.slice(0, -1)), c); // a clean prefix, ending on a whole word
    assert.equal(/\s$/.test(c.slice(0, -1)), false);
    assert.equal(clip(secret, 400), secret); // within the limit: whole
  }
});

console.log(`\n${passed} tests passed`);
