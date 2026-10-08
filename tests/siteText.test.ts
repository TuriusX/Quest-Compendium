// Run: npm run test:sync   (or: npx tsx tests/siteText.test.ts)
import assert from "node:assert/strict";
import { shortGame, relatedQuests, achFlags, finalLinks, redirectLines, entitySegments, fuzzyScore } from "../scripts/guides/siteText";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("game names for titles: no trademark signs or edition suffix", () => {
  assert.equal(shortGame("The Witcher 3: Wild Hunt - Complete Edition"), "The Witcher 3: Wild Hunt");
  assert.equal(shortGame("The Elder Scrolls V: Skyrim Special Edition"), "The Elder Scrolls V: Skyrim");
  assert.equal(shortGame("DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition"), "DRAGON QUEST XI S: Echoes of an Elusive Age");
  assert.equal(shortGame("Sekiro: Shadows Die Twice - GOTY Edition"), "Sekiro: Shadows Die Twice");
  assert.equal(shortGame("Mass Effect 3 (Legendary Edition)"), "Mass Effect 3");
  assert.equal(shortGame("CHRONO TRIGGER®"), "CHRONO TRIGGER");
  assert.equal(shortGame("Baldur's Gate 3"), "Baldur's Gate 3");
  assert.equal(shortGame("ELDEN RING"), "ELDEN RING");
});

test("related quests: quoted names next to a quest word, once each", () => {
  const a: any = {
    name: "Mulbrydale", overview: "A small village.", tips: ["Take the contract \"Missing Brother\" from the notice board."],
    items: [
      { id: "x1", name: "In Beast's Clothing", where: "Awarded inside the lone cottage after the secondary quest \"Man's Best Friend\".", missable: true },
      { id: "x2", name: "Sword", where: "In a chest near the \"Old Mill\" sign" }, // not a quest
    ],
    secrets: [{ id: "s1", text: "Finishing \"Man's Best Friend\" quest unlocks the dog." }],
    enemies: [], shops: [], sections: [],
  };
  assert.deepEqual(relatedQuests(a), ["Man's Best Friend", "Missing Brother"]); // in page order: items, secrets, tips
  assert.deepEqual(relatedQuests({ ...a, tips: [], items: [], secrets: [] }), []);
});

test("achievement labels: the builder's own, plus what the text makes plain", () => {
  assert.deepEqual(achFlags({ desc: "Collect all Gwent cards.", missable: true }), ["missable", "collectible"]);
  assert.deepEqual(achFlags({ desc: "Kill 100 drowners." }), ["cumulative"]);
  assert.deepEqual(achFlags({ desc: "Finish the game on Death March difficulty." }), ["difficulty"]);
  assert.deepEqual(achFlags({ desc: "Win a match.", how: "Play an online co-op session." }), ["online"]);
  assert.deepEqual(achFlags({ desc: "Open the door.", how: "Known bug: may not unlock; reload the save." }), ["buggy"]);
  assert.deepEqual(achFlags({ desc: "Reach the Grove.", labels: ["collectible", "nonsense"] }), ["collectible"]);
  assert.deepEqual(achFlags({ desc: "Defeat the dragon." }), []);
});

test("redirects: a page with no replacement goes to the guide's front page", () => {
  const S = "https://questcompendium.com";
  const live = new Set([`${S}/guides/rdr2/`, `${S}/guides/rdr2/chapter-2/`]);
  assert.deepEqual(redirectLines([{ key: "rdr2", from: "valentine", to: "chapter-2" }, { key: "rdr2", from: "lakay", to: "" }], live, ["en"], S),
    ["/guides/rdr2/valentine/ /guides/rdr2/chapter-2/ 301", "/guides/rdr2/lakay/ /guides/rdr2/ 301"]);
});

test("links use final URLs: no index.html, trailing slash kept, anchors kept", () => {
  assert.equal(finalLinks('<a href="../limgrave/index.html#items">'), '<a href="../limgrave/#items">');
  assert.equal(finalLinks('<a href="index.html">'), '<a href="./">');
  assert.equal(finalLinks('<a href="index.html#download">'), '<a href="./#download">');
  assert.equal(finalLinks('<a href="../../de/guides/index.html">'), '<a href="../../de/guides/">');
  assert.equal(finalLinks('<a href="guides/elden-ring/index.html">'), '<a href="guides/elden-ring/">');
  assert.equal(finalLinks('<a href="https://questcompendium.com/guides/index.html">'), '<a href="https://questcompendium.com/guides/">');
  assert.equal(finalLinks('<a href="/index.html">'), '<a href="/">');
  // Other sites and other files are left alone.
  assert.equal(finalLinks('<a href="https://example.com/index.html">'), '<a href="https://example.com/index.html">');
  assert.equal(finalLinks('<a href="privacy.html">'), '<a href="privacy.html">');
});

test("redirects: moved pages 301 to their replacement, per language, never from a live page", () => {
  const S = "https://questcompendium.com";
  const live = new Set([`${S}/guides/ff6/thamasa/`, `${S}/de/guides/ff6/thamasa/`, `${S}/guides/ff6/tzen/`, `${S}/guides/ff6/narshe/`]);
  const lines = redirectLines([
    { key: "ff6", from: "burning-home", to: "thamasa" },
    { key: "ff6", from: "crumbling-house", to: "tzen" },
    { key: "ff6", from: "narshe", to: "tzen" }, // live again in English: only the German URL redirects
    { key: "ff6", from: "gone", to: "not-on-site" },
  ], live, ["en", "de", "fr"], S); // fr: the guide isn't in French, so no French redirects
  assert.deepEqual(lines, [
    "/guides/ff6/burning-home/ /guides/ff6/thamasa/ 301",
    "/de/guides/ff6/burning-home/ /de/guides/ff6/thamasa/ 301",
    "/guides/ff6/crumbling-house/ /guides/ff6/tzen/ 301",
    "/de/guides/ff6/crumbling-house/ /guides/ff6/tzen/ 301",
    "/de/guides/ff6/narshe/ /guides/ff6/tzen/ 301",
  ]);
});

test("entity links: every mention, apostrophes optional, longest names first, whole words only", () => {
  const ents = [{ name: "Thieves' Landing", slug: "thieves-landing" }, { name: "Colter", slug: "colter" }, { name: "Saint Denis", slug: "saint-denis" }];
  const segs = entitySegments("Ride from Colter to Thieves Landing, then on to Saint  Denis. Colterville isn't Colter.", ents);
  assert.deepEqual(segs.filter((s) => s.slug).map((s) => `${s.text}>${s.slug}`), ["Colter>colter", "Thieves Landing>thieves-landing", "Saint  Denis>saint-denis", "Colter>colter"]);
  assert.equal(segs.map((s) => s.text).join(""), "Ride from Colter to Thieves Landing, then on to Saint  Denis. Colterville isn't Colter.");
  assert.deepEqual(entitySegments("No mentions here.", ents), [{ text: "No mentions here." }]);
});

test("guide search: forgiving matches (apostrophes, plurals, one typo), exact names first, no false hits", () => {
  assert.ok(fuzzyScore("thieves landing", "Thieves' Landing") > 0);
  assert.ok(fuzzyScore("rdr2 thieves landing".replace("rdr2 ", ""), "Thieves’ Landing") > 0);
  assert.ok(fuzzyScore("keira metz house", "Keira Metz's House") > 0);
  assert.ok(fuzzyScore("legendary bears", "Legendary Bharati Grizzly Bear") > 0);
  assert.ok(fuzzyScore("wreckers cave", "Wrecker's Cave") > 0);
  assert.ok(fuzzyScore("tumblweed", "Tumbleweed") > 0); // one typo
  assert.equal(fuzzyScore("saint denis", "Chapter 1: Colter"), 0);
  assert.ok(fuzzyScore("colter", "Colter") > fuzzyScore("colter", "Chapter 1: Colter"));
});

console.log(`\n${passed} tests passed`);
