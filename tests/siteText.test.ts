// Run: npm run test:sync   (or: npx tsx tests/siteText.test.ts)
import assert from "node:assert/strict";
import { shortGame, areaSeo, fitTitle, tidyDescription, relatedQuests, achFlags, finalLinks, redirectLines, entitySegments, fuzzyScore, chapterKey, chapterPage, coveringPage, lintEntity, singularLabel } from "../scripts/guides/siteText";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("game names for titles: no trademark signs or edition suffix", () => {
  assert.equal(shortGame("The Witcher 3: Wild Hunt - Complete Edition"), "The Witcher 3: Wild Hunt");
  assert.equal(shortGame("The Elder Scrolls V: Skyrim Special Edition"), "The Elder Scrolls V: Skyrim");
  assert.equal(shortGame("DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition"), "Dragon Quest XI S: Echoes of an Elusive Age");
  assert.equal(shortGame("Sekiro: Shadows Die Twice - GOTY Edition"), "Sekiro: Shadows Die Twice");
  assert.equal(shortGame("Mass Effect 3 (Legendary Edition)"), "Mass Effect 3");
  assert.equal(shortGame("CHRONO TRIGGER®"), "Chrono Trigger");
  assert.equal(shortGame("Baldur's Gate 3"), "Baldur's Gate 3");
  assert.equal(shortGame("ELDEN RING"), "Elden Ring");
  assert.equal(shortGame("Fallout 3: Game of the Year Edition"), "Fallout 3");
  assert.equal(shortGame("FINAL FANTASY XV WINDOWS EDITION"), "Final Fantasy XV");
  assert.equal(shortGame("DARK SOULS™: REMASTERED"), "Dark Souls Remastered");
  assert.equal(shortGame("FINAL FANTASY X/X-2 HD Remaster"), "Final Fantasy X/X-2 HD Remaster");
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
  assert.ok(fuzzyScore("rolling blok rifles", "Rolling Block Rifle") > 0); // a typo in a short word, and a plural
  assert.equal(fuzzyScore("saint denis", "Chapter 1: Colter"), 0);
  assert.ok(fuzzyScore("colter", "Colter") > fuzzyScore("colter", "Chapter 1: Colter"));
});

test("redirect targets: a held page's chapter note finds the live chapter page", () => {
  const pages = [
    { slug: "chapter-1-colter", name: "Chapter 1: Colter" }, { slug: "chapter-3-clemens-point", name: "Chapter 3: Clemens Point" },
    { slug: "epilogue-part-2-beechers-hope", name: "Epilogue Part 2: Beecher's Hope" },
  ];
  assert.equal(chapterPage("Chapter 3, the region surrounding Rhodes", pages), "chapter-3-clemens-point");
  assert.equal(chapterPage("Epilogue Chapter 2, hunting and missions", pages), "epilogue-part-2-beechers-hope");
  assert.equal(chapterPage("Epilogue Chapter 1, John's employment", pages), "epilogue-part-2-beechers-hope"); // the guide's epilogue page
  assert.equal(chapterPage("Chapter 5, the island", pages), undefined);
  assert.equal(chapterPage("the gang's first camp", pages), undefined);
  assert.equal(chapterKey("Act II: The Underdark"), "act 2");
  // Type labels on one entity's page.
  assert.equal(singularLabel("Characters"), "Character");
  assert.equal(singularLabel("Companions & Allies"), "Companion & Ally");
  assert.equal(singularLabel("Bosses"), "Boss");
  assert.equal(singularLabel("Locations & Settlements"), "Location & Settlement");
  assert.equal(singularLabel("NPCs and Merchants"), "NPC and Merchant");
  assert.equal(singularLabel("Legendary Fish"), "Legendary Fish");
  assert.equal(singularLabel("Key Characters"), "Key Character");
  assert.equal(singularLabel("Stranger Missions"), "Stranger Mission");
  // Entity rejection check.
  const r = lintEntity({ overview: "Popper is an NPC merchant rather than a location, and he sells nothing rare. He runs a stall.", summary: { gettingThere: "Fast-travel to the Grove.", notes: ["Shadowheart is a companion, not a location."] } }, true);
  assert.equal(r.overview, "He runs a stall.");
  assert.equal(r.summary.gettingThere, undefined);
  assert.deepEqual(r.summary.notes, []);
  assert.equal(r.left.length, 0);
  const place = lintEntity({ overview: "Colter is an abandoned mining town.", summary: { gettingThere: "Ride north from Valentine." } }, false);
  assert.equal(place.summary.gettingThere, "Ride north from Valentine.");
  assert.equal(place.removed.length, 0);
  // Covering page: the most named entries, never another chapter number, the same character first.
  const live = [{ slug: "chapter-2", name: "Chapter 2: Intensive Care", text: "Plasma Cutter, Stasis Module, Kinesis Module, Medical Deck" }, { slug: "chapter-10", name: "Chapter 10: End of Days", text: "Plasma Cutter and the Marker" }];
  assert.equal(coveringPage(["Plasma Cutter", "Stasis Module", "Kinesis Module"], live, 3, "Crew Deck Chapter 10"), undefined);
  assert.equal(coveringPage(["Plasma Cutter", "Stasis Module", "Kinesis Module"], live, 3, "Medical Deck"), "chapter-2");
  // A chapter per character: only that character's page.
  const octo = [{ slug: "olberic-chapter-3", name: "Olberic: Chapter 3" }, { slug: "haanit-chapter-3", name: "H'aanit Chapter 3" }];
  assert.equal(chapterPage("H'aanit Chapter 3", octo), "haanit-chapter-3");
  assert.equal(chapterPage("Tressa Chapter 3", octo), undefined);
  assert.equal(chapterPage("Partitio's Chapter 2", [{ slug: "partitio-chapter-2", name: "Partitio Chapter 2" }]), "partitio-chapter-2");
});

test("area titles: what the page answers, within 60 characters, compact game name when needed", () => {
  const a: any = { name: "Fyke Isle", overview: "Geralt travels across the lake to Fyke Isle. More.", items: [{ id: "i1", name: "Bones", missable: true }, { id: "i2", name: "Notes", missable: true }], secrets: [{ id: "s1", text: "x" }], enemies: [], shops: [], tips: [], walkthrough: [{ title: "a" }, { title: "b" }], choices: [{}], info: { region: "Velen", quests: ["A Towerful of Mice", "For the Advancement of Learning"] } };
  const s = areaSeo(a, "The Witcher 3: Wild Hunt");
  assert.equal(s.title, "Fyke Isle – Witcher 3: Walkthrough, Missables & Loot");
  assert.ok(s.description.startsWith("Fyke Isle in The Witcher 3: Wild Hunt: location, quests (A Towerful of Mice, For the Advancement of Learning), step-by-step walkthrough"), s.description);
  assert.ok(!/\b1 item/.test(s.description));
  assert.ok(s.description.length <= 158);
  const thin: any = { name: "Mulbrydale", overview: "A village.", items: [], secrets: [], enemies: [{ name: "Drowner" }], shops: [], tips: [] };
  assert.equal(areaSeo(thin, "Elden Ring").title, "Mulbrydale – Elden Ring: Enemies");
});

test("fitTitle drops parts from the end, then shortens the game", () => {
  assert.equal(fitTitle("Land of a Thousand Fables", "The Witcher 3: Wild Hunt", ["Walkthrough", "Missables", "Loot"]), "Land of a Thousand Fables – Witcher 3: Walkthrough");
});

test("entity descriptions tidied", () => {
  assert.equal(tidyDescription("Dutch in RDR2: 8 mission(s), collectibles."), "Dutch in RDR2: 8 missions, collectibles.");
  assert.equal(tidyDescription("Mary-Beth in RDR2: 1 mission(s). She is"), "Mary-Beth in RDR2: 1 mission. She is");
  assert.equal(tidyDescription("Karen Jones in Red Dead Redemption 2: . Karen is"), "Karen Jones in Red Dead Redemption 2. Karen is");
});

console.log(`\n${passed} tests passed`);
