// Run: npm run test:sync   (or: npx tsx tests/questLogView.test.ts)
import assert from "node:assert/strict";
import { buildLogView, isGoalAnswer, objectiveForRequest, nextLogState, taskOf, placeIsCurrent, matchDoing, matchFoe, areaFromDoing, isNowQuestion, isCuriosityQuestion, properNames, questionDoing, heldIds } from "../src/utils/questLogView";
import { disagreeingEntries } from "../src/utils/guideAgree";
import { missablesThin, missableCount } from "../src/utils/missablesCheck";
import type { TrackerData } from "../src/utils/trackerPayload";
import { mergeTabState, sanitizeTabsForCloud } from "../src/hooks/tabMerge";
import { gameSpacesOn } from "../src/utils/learnedGames";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const opts = { gameKey: "g", accent: "#a87ffb" };
const answer = (doneSteps: number[] = []) => ({
  id: "a1", role: "assistant", text: "You need both halves.", timestamp: 1, title: "Reach the Haligtree",
  steps: [
    { kind: "step", text: "Get the left half from Albus", label: "Left half from Albus", where: "Village of the Albinaurics" },
    { kind: "step", text: "Get the right half at Castle Sol" },
    { kind: "warning", text: "Burning the Erdtree turns Leyndell to ash", label: "Finish Leyndell first" },
    { kind: "step", text: "Use both halves on the Grand Lift of Rold" },
    { kind: "step", text: "Light the candles in Ordina" },
  ],
  doneSteps,
}) as any;
const tab = (extra: any = {}) => ({ id: "t", name: "Elden Ring", messages: [{ id: "q1", role: "user", text: "How do I get to the Haligtree?", timestamp: 0 }, answer()], ...extra }) as any;
const guide: TrackerData = {
  id: "", accent: "#a87ffb", quest: "Reach Godrick at the top of the castle", place: { name: "Stormveil Castle", sure: true },
  sections: [
    { id: "answer", title: "From your last answer", items: [{ id: "s:a1:0", label: "x", tick: true }] },
    { id: "missable", title: "Missable here", tone: "amber", items: [{ id: "g:sv:m1", label: "Talk to Gostoc", tick: true, detail: { missable: "He leaves after Godrick" } }] },
    { id: "collect", title: "To collect", items: [
      { id: "g:sv:c1", label: "Liftside Chamber grace", tick: true, done: true },
      { id: "g:sv:c2", label: "Secluded Cell grace", tick: true },
      { id: "g:sv:c3", label: "Golden Seed", tick: true, icon: "item" },
      { id: "g:sv:c4", label: "Smithing Stone", tick: true },
    ] },
  ],
};

const walk = {
  slug: "stormveil-castle",
  done: new Set(["walk:w1"]),
  steps: [
    { id: "w1", title: "Castle Approach", text: "After overcoming Margit, the Fell Omen at the castle entryway, you will reach the Stormveil Main Gate Site of Grace." },
    { id: "w2", title: "Southwestern Cliffs and Tombs", text: "Cross the narrow rock bridge beyond Zamor Ruins past Shabriri to reach the Giant-Conquering Hero's Grave, where you can rest." },
    { id: "w3", title: "Cross the Bridge and Claim the Bat", text: "Head across the river bridge west of Hello Work." },
    { id: "w4", title: "The Secluded Cell", text: "Returning to the upper castle grounds, locate Nepheli Loux inside an interior room." },
  ],
};

test("nothing set as Now, the player seen at a walkthrough step: Now is that step as a task (ticked like the walkthrough), never the area's description", () => {
  const v = buildLogView(tab(), guide, { ...opts, walk, doing: { names: ["Zamor Ruins"], activity: "crossing a rock bridge" } })!;
  assert.equal(v.now?.seen, "Zamor Ruins", "what on screen picked it");
  assert.equal(v.here, undefined);
  assert.equal(v.now?.source, "guide");
  assert.equal(v.now?.id, "w:stormveil-castle:w2", "the walkthrough's own tick");
  assert.equal(v.now?.tick, true);
  assert.equal(v.now?.text, "Reach the Giant-Conquering Hero's Grave: cross the narrow rock bridge beyond Zamor Ruins past Shabriri");
  assert.equal(v.now?.sub, "Southwestern Cliffs and Tombs");
  assert.deepEqual(v.next.map((s) => s.text), ["Cross the Bridge and Claim the Bat: head across the river bridge west of Hello Work", "Locate Nepheli Loux inside an interior room"]);
  assert.ok(![v.now?.text, ...v.next.map((s) => s.text)].includes(guide.quest), "not the story line");
});

test("not knowing what the player is doing: no Now from the guide, \"In <place> (from the guide)\": what's here and its missables", () => {
  const v = buildLogView(tab(), guide, { ...opts, walk })!;
  assert.equal(v.now, null, "never the area's first unticked step");
  assert.deepEqual(v.next, []);
  assert.equal(v.here?.place, "Stormveil Castle");
  assert.deepEqual(v.here?.items.map((s) => s.text), ["Southwestern Cliffs and Tombs", "Cross the Bridge and Claim the Bat", "The Secluded Cell"], "the walkthrough's parts not ticked yet, by title");
  assert.equal(v.here?.items[0].id, "w:stormveil-castle:w2", "ticked like the walkthrough");
  assert.deepEqual(v.here?.missables.map((m) => m.text), ["Talk to Gostoc"]);
  assert.equal(v.watch, null, "the missable is in the list, not twice");
  // Doing seen, but nothing in the guide fits: the same.
  assert.equal(buildLogView(tab(), guide, { ...opts, walk, doing: { activity: "in dialogue" } })!.now, null);
});

test("the matched step is ticked already: Now is the next open one after it, never one behind", () => {
  const w = { ...walk, done: new Set(["walk:w1", "walk:w2"]) };
  const v = buildLogView(tab(), guide, { ...opts, walk: w, doing: { names: ["Zamor Ruins"] } })!;
  assert.equal(v.now?.id, "w:stormveil-castle:w3");
  const n = buildLogView(tab(), guide, { ...opts, walk, doing: { talkingTo: "Nepheli Loux" } })!;
  assert.equal(n.now?.id, "w:stormveil-castle:w4", "the steps before it are behind the player");
  assert.deepEqual(n.next, []);
});

test("which step: the objective on screen, who they're talking to, names on screen; weak or common clues don't count", () => {
  const steps = [
    { title: "Arrival and Refugee Camp", text: "As you journey north from Reithwin Town into Rivington, inspect the small camp near your initial descent." },
    { title: "Arfur's Mansion", text: "Follow the road north to Arfur's Mansion in Rivington, where Arfur Gregorio argues with Ben Golewits." },
    { title: "Circus of the Last Days", text: "Make your way to the Circus of the Last Days in Rivington, where the necromancer Lucretious manages a troupe." },
    { title: "Rivington General and Angleiron's Cellar", text: "Visit Rivington General to browse wares, then seek out the blacksmith Gyldro Angleiron." },
  ];
  assert.deepEqual(matchDoing(steps, { talkingTo: "Lucretious", activity: "in dialogue" }, "Rivington"), { index: 2, matched: "Lucretious" });
  assert.deepEqual(matchDoing(steps, { names: ["Rivington General"] }, "Rivington"), { index: 3, matched: "Rivington General" });
  assert.deepEqual(matchDoing(steps, { objective: "Help Arfur Gregorio reclaim his mansion" }, "Rivington")?.index, 1);
  assert.equal(matchDoing(steps, { names: ["Rivington"], activity: "walking down a street" }, "Rivington"), null, "the area's own name is in every step");
  assert.equal(matchDoing(steps, { activity: "in dialogue" }, "Rivington"), null);
  assert.equal(matchDoing(steps, { objective: "Find the camp" }, "Rivington"), null, "one common word isn't enough");
  assert.equal(matchDoing(steps, null), null);
});

test("a place name or a map screen's labels aren't what the player is doing; a boss fought in one area only suggests it", () => {
  const steps = [
    { title: "Gaining Entry at the Main Gate", text: "Approach from Rivington to the circus gate, where Lucretious greets you." },
    { title: "The Fortune Teller", text: "Inside, visit Mystic Carrion's tent and the fortune teller." },
    { title: "The Hall of Wonders", text: "Head on to the Hall of Wonders past the stage." },
  ];
  assert.equal(matchDoing(steps, { names: ["Rivington"] }, "Circus of the Last Days", ["Rivington", "Circus of the Last Days"]), null, "another area's name");
  assert.equal(matchDoing(steps, { activity: "reading the map", names: ["Hall of Wonders"] }, "Circus of the Last Days"), null, "a label on the map");
  assert.equal(matchDoing(steps, { activity: "exploring", names: ["Hall of Wonders"] }, "Circus of the Last Days")?.index, 2);
  const areas = [{ slug: "limgrave", name: "Limgrave" }, { slug: "stormveil", name: "Stormveil Castle" }, { slug: "liurnia", name: "Liurnia" }];
  const pages = {
    limgrave: { enemies: [{ id: "e1", name: "Tree Sentinel" }] },
    stormveil: { enemies: [{ id: "e2", name: "Grafted Scion" }], walkthrough: [{ title: "The Scion's Dining Hall", text: "Defeat the Grafted Scion in the banquet hall." }] },
    liurnia: null,
  };
  assert.equal(areaFromDoing(areas, pages, { activity: "fighting Grafted Scion", names: ["Grafted Scion"] }), "Stormveil Castle");
  assert.equal(areaFromDoing(areas, { ...pages, liurnia: { enemies: [{ id: "e3", name: "Grafted Scion" }] } }, { activity: "fighting Grafted Scion" }), null, "fought in two areas: no suggestion");
  assert.equal(areaFromDoing(areas, pages, { activity: "in a menu" }), null);
});

test("a fight on screen (guides without a walkthrough): Now is \"Defeat X\", only when it's a fight", () => {
  const foes = [{ id: "e1", name: "Margit, the Fell Omen", tactics: "Roll into his delayed swings." }, { id: "e2", name: "Margit" }, { id: "e3", name: "Godrick Soldier" }];
  assert.equal(matchFoe(foes, { activity: "fighting Margit, the Fell Omen" })?.id, "e1", "the longest name first");
  assert.equal(matchFoe(foes, { activity: "boss fight", names: ["Margit, the Fell Omen"] })?.id, "e1");
  assert.equal(matchFoe(foes, { activity: "talking", names: ["Margit, the Fell Omen"] }), null, "a name on screen isn't a fight");
  const v = buildLogView(tab(), guide, { ...opts, labels: { logDefeat: "Defeat {name}" }, foes: { slug: "limgrave", list: foes }, doing: { activity: "fighting Margit, the Fell Omen" } })!;
  assert.equal(v.now?.text, "Defeat Margit, the Fell Omen");
  assert.equal(v.now?.sub, "Roll into his delayed swings.");
  assert.equal(v.now?.tick, false);
  assert.equal(v.here, undefined);
});

test("without a walkthrough, nothing seen: what's here is the guide's unticked tasks, never a pickup on its own (those are in Show more)", () => {
  const v = buildLogView(tab(), guide, { ...opts, labels: { logGetItem: "Get {item}" } })!;
  assert.equal(v.now, null);
  assert.deepEqual(v.here?.items.map((s) => s.text), ["Secluded Cell grace", "Smithing Stone"]);
  assert.ok(v.more.some((x) => x.items.some((it) => it.label === "Golden Seed")), "the Golden Seed is in Show more");
  assert.equal(v.here?.missables[0]?.text, "Talk to Gostoc", "the area's missable is listed with it");
  assert.equal(v.invite, false, "something was asked");
  assert.ok(!v.more.some((x) => x.id === "answer"), "the answer's old section is gone; the guide's lists are behind Show more");
  assert.equal(v.bookmark, 4, "unticked entries here");
});

test("nothing asked yet: the log invites a question", () => {
  assert.equal(buildLogView({ ...tab(), messages: [] }, guide, opts)!.invite, true);
});

test("Set as Now: the answer's steps (warnings aside), Now the first unticked, Next the 2-3 after, its warning first in Watch out", () => {
  const v = buildLogView(tab({ messages: [tab().messages[0], answer([0])], questLog: { now: "a1" } }), guide, opts)!;
  assert.equal(v.now?.source, "question");
  assert.equal(v.now?.id, "s:a1:1", "the same tick ids as under the answer");
  assert.equal(v.now?.goal, "Reach the Haligtree");
  assert.deepEqual([v.now?.doneCount, v.now?.total], [1, 4]);
  assert.deepEqual(v.next.map((s) => s.id), ["s:a1:3", "s:a1:4"]);
  assert.equal(v.watch?.text, "Finish Leyndell first");
  assert.equal(v.bookmark, 3, "steps left on the goal");
});

test("labels with a where line; ✕ hides a warning for good, the next one shows", () => {
  const v = buildLogView(tab({ questLog: { now: "a1", hidden: ["s:a1:2"] } }), guide, opts)!;
  assert.equal(v.now?.text, "Left half from Albus");
  assert.equal(v.now?.sub, "Village of the Albinaurics");
  assert.equal(v.watch?.text, "Talk to Gostoc");
});

test("every step ticked: Done with the goal, no Now", () => {
  const v = buildLogView(tab({ messages: [answer([0, 1, 3, 4])], questLog: { now: "a1" } }), null, opts)!;
  assert.equal(v.now, null);
  assert.deepEqual(v.done, { goal: "Reach the Haligtree", msgId: "a1" });
});

test("loaded guide steps are Now when no question is set; pins list their answers' titles", () => {
  const v = buildLogView(tab({ questLog: { pins: ["a1", "gone"] } }), guide, { ...opts, loaded: { title: "Stranger: Duncan", items: [{ id: "quest:x:0", label: "Meet Duncan", tick: true, done: true }, { id: "quest:x:1", label: "Ride to the camp", tick: true }], warning: "Don't kill Duncan" } })!;
  assert.equal(v.now?.source, "loaded");
  assert.equal(v.now?.text, "Ride to the camp");
  assert.equal(v.watch?.text, "Don't kill Duncan");
  assert.deepEqual(v.pins, [{ id: "a1", title: "Reach the Haligtree" }], "a pin whose answer is gone is left out");
});

test("a goal is two things to do or more; a battle plan isn't one", () => {
  assert.equal(isGoalAnswer(answer()), true);
  assert.equal(isGoalAnswer({ ...answer(), combat: true }), false);
  assert.equal(isGoalAnswer({ ...answer(), steps: [{ kind: "step", text: "One thing" }] }), false);
});

test("what a newer question could tick: the objective's unticked steps", () => {
  const o = objectiveForRequest(tab({ messages: [answer([0])], questLog: { now: "a1" } }))!;
  assert.equal(o.title, "Reach the Haligtree");
  assert.deepEqual(o.steps.map((s) => s.i), [1, 3, 4]);
  assert.equal(objectiveForRequest(tab()), null);
});

test("the state stays small", () => {
  assert.equal(nextLogState({ now: "a1" }, { now: undefined }), undefined);
  assert.deepEqual(nextLogState(undefined, { pins: ["a1"] }), { pins: ["a1"] });
});

test("with the current tabs (game spaces off): Now, pins and hidden warnings live on the tab, go to the cloud with it, and the newer device wins", () => {
  assert.equal(gameSpacesOn(), false, "game spaces are off here (no flag, no VITE_GAME_SPACES)");
  const mine = { ...tab({ questLog: { now: "a1", pins: ["a1"], hidden: ["s:a1:2"] } }), notes: "", createdAt: 1, lastActive: 5000 };
  const cloud = sanitizeTabsForCloud([mine])[0] as any;
  assert.deepEqual(cloud.questLog, { now: "a1", pins: ["a1"], hidden: ["s:a1:2"] }, "kept in what's written to the account");
  const other = { ...mine, questLog: { now: "a1" }, lastActive: 4000 }; // another device, older
  const r = mergeTabState({ tabs: [mine], deleted: {} }, { tabs: [other], deleted: {} });
  assert.deepEqual(r.merged.tabs[0].questLog, mine.questLog, "this device's newer log is kept");
  assert.equal(r.cloudChanged, true, "and uploaded");
  // Next session: the same tab, from storage, gives the same log.
  const again = buildLogView(JSON.parse(JSON.stringify(r.merged.tabs[0])), null, opts)!;
  assert.equal(again.now?.id, "s:a1:0");
  assert.deepEqual(again.pins.map((p) => p.id), ["a1"]);
});

test("walkthrough steps as tasks (real guide sentences)", () => {
  const t = (title: string, text: string) => { const r = taskOf(title, text); return r.sub ? `${r.text} [${r.sub}]` : r.text; };
  assert.equal(t("Gatefront and Agheel Lake", "Rest at the Gatefront Site of Grace to meet Melina, who gives you Torrent."), "Meet Melina: rest at the Gatefront Site of Grace [Gatefront and Agheel Lake]");
  assert.equal(t("Castle Approach", "After overcoming Margit, the Fell Omen at the castle entryway, you will reach the Stormveil Main Gate Site of Grace."), "Reach the Stormveil Main Gate Site of Grace [Castle Approach]");
  assert.equal(t("East Limgrave", "Find D, Hunter of the Dead resting west of Summonwater Village, then search the ruins."), "Find D, Hunter of the Dead resting west of Summonwater Village [East Limgrave]");
  assert.equal(t("Waking on the Riverbank", "From the crash site (X: 230, Y: 208), head north along the sand to find Shadowheart unconscious at the shore."), "Find Shadowheart unconscious at the shore: head north along the sand [Waking on the Riverbank]");
  assert.equal(t("Coastal Cave", "You can also give the needle to Boc at the cave entrance."), "Give the needle to Boc at the cave entrance [Coastal Cave]");
  assert.equal(t("Battle the Street Thugs", "Immediately after Kasuga draws the weapon, you are forced into combat on the bridge."), "Battle the Street Thugs [You are forced into combat on the bridge]");
  assert.equal(t("Southern Peaks", "Head south to reach the Whiteridge Road Site of Grace and clear the Guardians' Garrison fort."), "Reach the Whiteridge Road Site of Grace: head south [Southern Peaks]");
});

// ---- Where the player is (owner, Oct 31 2026): never the guide for a place the player may not be in ----
test("the place is known only when set or confirmed, or a sure answer or Locate me found it, since it was last due", () => {
  assert.equal(placeIsCurrent(undefined), false);
  assert.equal(placeIsCurrent({ name: "Emerald Grove", confirmed: false }), false, "a guess is a suggestion at most");
  assert.equal(placeIsCurrent({ name: "Rivington", confirmed: false, sure: true, checkedAt: 100 }), true);
  assert.equal(placeIsCurrent({ name: "Emerald Grove", confirmed: true }), true, "no game running: the playthrough's own place");
  // The game started (or the tab was opened or switched to): an older place has to be checked again.
  assert.equal(placeIsCurrent({ name: "Emerald Grove", confirmed: true, checkedAt: 50 }, 100), false, "a resumed save");
  assert.equal(placeIsCurrent({ name: "Emerald Grove", confirmed: true }, 100), false, "a place from before checks were kept");
  assert.equal(placeIsCurrent({ name: "Rivington", confirmed: false, sure: true, checkedAt: 150 }, 100), true);
});

test("place unknown: no Now, Next or Watch out from the guide (never its start), only Where are you?", () => {
  const where = { locating: false, suggestion: "Rivington", last: "Emerald Grove", areas: ["Emerald Grove", "Rivington"] };
  const fresh = { id: "t", name: "Baldur's Gate 3", messages: [] } as any;
  const v = buildLogView(fresh, guide, { ...opts, walk, where })!;
  assert.equal(v.now, null);
  assert.deepEqual(v.next, []);
  assert.equal(v.watch, null);
  assert.deepEqual(v.more, []);
  assert.equal(v.place, undefined);
  assert.deepEqual(v.where, where);
  // A resumed tab with its own objective still shows it: the player's question isn't the guide.
  const t = tab({ questLog: { now: "a1" } });
  const r = buildLogView(t, guide, { ...opts, walk, where })!;
  assert.equal(r.now?.source, "question");
  assert.ok(r.where);
});

test("the guide's missables are labelled as the guide's (never a complete list)", () => {
  const v = buildLogView({ id: "t", name: "Elden Ring", messages: [] } as any, guide, { ...opts })!;
  assert.equal(v.here?.missables[0]?.text, "Talk to Gostoc");
  assert.equal(v.here?.missables[0]?.fromGuide, true);
  const q = buildLogView({ id: "t", name: "Elden Ring", messages: [answer()], questLog: { now: "a1" } } as any, guide, { ...opts })!;
  assert.ok(q.watch, "with the player's objective: one Watch out");
});

test("a thin missable list: none in 5+ things, one in 10+, under 12% in 20+; a small area isn't", () => {
  const items = (n: number, miss = 0) => Array.from({ length: n }, (_, i) => ({ missable: i < miss }));
  assert.equal(missablesThin({ items: items(12, 1) }), true);
  assert.equal(missablesThin({ items: items(12, 3) }), false);
  assert.equal(missablesThin({ items: items(4, 0) }), false, "a small area");
  assert.equal(missablesThin({ items: items(6, 0) }), true, "none at all in six things");
  assert.equal(missablesThin({ items: items(30, 3) }), true, "a big area with three");
  const page = { items: items(10, 1), sections: [{ title: "Don't miss", check: true, entries: [1, 2] }], walkthrough: [{ warn: "Point of no return" }] };
  assert.equal(missableCount(page), 4);
  assert.equal(missablesThin(page), false);
});

test("a question's objective: the guide step it is about (question, answer, else the screen) with its details and missables; nothing when none matches", () => {
  const w = {
    slug: "stormveil-castle", done: new Set<string>(),
    steps: [
      { id: "w1", title: "Castle Approach", text: "After overcoming Margit, you will reach the Stormveil Main Gate Site of Grace." },
      { id: "w2", title: "Gostoc and the Side Path", text: "Talk to Gostoc by the gate to take the side path through the Rampart Tower.", entries: ["m1"], warn: "Gostoc leaves after Godrick." },
      { id: "w3", title: "The Secluded Cell", text: "Locate Nepheli Loux inside an interior room." },
    ],
  };
  const ans = { id: "a2", role: "assistant", text: "Go round.", timestamp: 3, title: "Take the Side Path", steps: [
    { kind: "step", text: "Talk to Gostoc by the main gate", label: "Talk to Gostoc" },
    { kind: "step", text: "Go through the Rampart Tower", label: "Through the Rampart Tower" },
  ] } as any;
  const t = (now = "a2") => ({ id: "t", name: "Elden Ring", questLog: { now }, messages: [{ id: "q2", role: "user", text: "How do I get past the gate without fighting?", timestamp: 2 }, ans] }) as any;
  const v = buildLogView(t(), guide, { ...opts, walk: w })!;
  assert.equal(v.now?.source, "question", "the question's steps stay Now");
  assert.equal(v.now?.text, "Talk to Gostoc");
  assert.deepEqual(v.next.map((s) => s.text), ["Through the Rampart Tower"], "the answer's steps are Next");
  assert.equal(v.now?.guide?.id, "w:stormveil-castle:w2", "the step the question is about");
  assert.match(v.now?.guide?.detail || "", /Rampart Tower/);
  assert.equal(v.watch?.text, "Gostoc leaves after Godrick.", "the step's own warning first");
  assert.equal(v.here, undefined);
  // A question that matches no step: no guide step, the area's missables as before.
  const other = { ...ans, title: "Upgrade Your Flask", steps: [{ kind: "step", text: "Bring Golden Seeds to a grace" }, { kind: "step", text: "Rest" }] };
  const v2 = buildLogView({ ...t(), messages: [{ id: "q2", role: "user", text: "How do I upgrade my flask?", timestamp: 2 }, other] } as any, guide, { ...opts, walk: w })!;
  assert.equal(v2.now?.guide, undefined, "never the area's first step");
  // Nothing in the question, but the screen shows the step: that one.
  const v3 = buildLogView({ ...t(), messages: [{ id: "q2", role: "user", text: "What now?", timestamp: 2 }, other] } as any, guide, { ...opts, walk: w, doing: { talkingTo: "Nepheli Loux" } })!;
  assert.equal(v3.now?.guide?.id, "w:stormveil-castle:w3");
  // The place isn't known: nothing from the guide.
  const v4 = buildLogView(t(), guide, { ...opts, walk: w, where: { locating: false, areas: [] } })!;
  assert.equal(v4.now?.guide, undefined);
});

test("which questions are about what the player is doing now (when the server doesn't say), and names in a question", () => {
  for (const q of ["How do I get into the Lower City?", "where do i find the key to the cellar", "I'm stuck at the gate", "how do I beat Margit", "Can't find the way into the castle"]) assert.equal(isNowQuestion(q), true, q);
  for (const q of ["What does the Rusty Key do?", "Who is Ranni?", "What's the best build for a mage?", "Is the DLC worth it?", "Tell me the lore of the Erdtree", "How long is the game?"]) assert.equal(isNowQuestion(q), false, q);
  assert.deepEqual(properNames("How do I get into the Lower City? Talk to Gostoc at the Gate of Divinity."), ["Lower City", "Gostoc", "Gate of Divinity"]);
  const d = questionDoing("How do I find Lucretious?", { id: "a", role: "assistant", text: "", timestamp: 0, title: "Find Lucretious", steps: [{ kind: "step", text: "Enter the Circus of the Last Days", label: "Enter the circus" }] } as any);
  assert.match(d.objective || "", /Find Lucretious · How do I find Lucretious/);
  assert.deepEqual(d.names, ["Lucretious", "Circus of the Last Days"]);
});

test("a step's places (RDR2's chapters): a place seen picks the step, and the one chapter it is in", () => {
  const steps = [{ title: "Rob the Doctor's Backroom", text: "Go to the back of the doctor's office.", places: ["Valentine"] }, { title: "Hunt", text: "Track a deer.", places: ["Big Valley"] }];
  assert.equal(matchDoing(steps, { names: ["Valentine"] })?.index, 0);
  const pages = { c2: { walkthrough: steps }, c3: { walkthrough: [{ title: "Meet Strauss", text: "Collect a debt.", places: ["Rhodes"] }] } };
  assert.equal(areaFromDoing([{ slug: "c2", name: "Chapter 2" }, { slug: "c3", name: "Chapter 3" }], pages, { names: ["Valentine"] }), "Chapter 2");
  const both = { ...pages, c3: { walkthrough: [{ title: "Back in town", text: "Buy supplies.", places: ["Valentine"] }] } };
  assert.equal(areaFromDoing([{ slug: "c2", name: "Chapter 2" }, { slug: "c3", name: "Chapter 3" }], both, { names: ["Valentine"] }), null, "a place in two chapters: ask");
});

test("the answer wins: a general question about here is about now; a guide entry the answer advises against is found; the guide list waits after a question here; pickups are never objectives", () => {
  assert.equal(isNowQuestion("I just arrived in south figaro after escaping kefka torching figaro castle. Walk me through this"), true);
  for (const q of ["What should I do in town?", "what's next?", "What should I do here?", "now what"]) assert.equal(isNowQuestion(q), true, q);
  assert.equal(isCuriosityQuestion("Is the Clown Hammer any good?"), true);
  const steps = [
    { kind: "warning", text: "Do not open outdoor barrels and crates; they upgrade to better items later in the game.", label: "Leave outdoor containers" },
    { kind: "step", text: "Purchase Sprint Shoes to double your walking speed.", label: "Buy Sprint Shoes", where: "Relic Shop" },
    { kind: "step", text: "Don't miss the Cafe scene with Shadow", label: "Meet Shadow" },
  ] as any;
  const entries = [
    { id: "x1", name: "Potion", where: "upper barrel directly to the left of the Chocobo Stables near the entrance" },
    { id: "x2", name: "Green Cherry", where: "top wooden crate situated to the right of the Chocobo Stables" },
    { id: "x9", name: "Elixir", where: "grandfather clock inside the storeroom behind the mansion" },
    { id: "x10", name: "Shadow's dog", where: "Cafe" },
  ];
  assert.deepEqual(disagreeingEntries(entries, steps).map((d) => d.entry.id), ["x1", "x2"], "barrels and crates; not the clock, and \"don't miss\" isn't advice against");
  const town: TrackerData = { id: "", accent: "#a87ffb", quest: "", place: { name: "South Figaro", sure: true }, sections: [
    { id: "collect", title: "To collect", items: [
      { id: "g:sf:x1", label: "Potion", tick: true, icon: "item" }, { id: "g:sf:x2", label: "Green Cherry", tick: true, icon: "item" },
      { id: "g:sf:s1", label: "Talk to the old man in the mansion basement", tick: true },
    ] },
  ] } as any;
  const t0 = { id: "t", name: "FF6", messages: [{ id: "q", role: "user", text: "hi", timestamp: 0 }] } as any;
  const v0 = buildLogView(t0, town, opts)!;
  assert.deepEqual(v0.here?.items.map((s) => s.text), ["Talk to the old man in the mansion basement"], "no \"Get Potion\" as an objective");
  assert.ok(v0.more.some((x) => x.items.some((it) => it.label === "Potion")), "pickups stay in Show more");
  const answered = { ...t0, questLog: { hidden: ["g:sf:x1", "g:sf:x2"] }, messages: [...t0.messages, { id: "a", role: "assistant", text: "Leave the barrels.", timestamp: 1, place: { name: "South Figaro", sure: true } }] };
  const v1 = buildLogView(answered, town, opts)!;
  assert.equal(v1.here, undefined, "after a question here, the guide's list is behind Show more");
  assert.ok(!v1.more.some((x) => x.items.some((it) => it.id === "g:sf:x1" || it.id === "g:sf:x2")), "the entries the answer advised against are hidden");
});

test("an entry an answer advised against is held back only for a while, never for good on the answer's word", () => {
  const day = 86_400_000, now = Date.now();
  const st = { held: [{ id: "g:sf:x1", group: "ff6__sf__x1", at: now - day }, { id: "g:sf:x2", group: "ff6__sf__x2", at: now - 15 * day }] } as any;
  assert.deepEqual(heldIds(st, now), ["g:sf:x1"], "older than 14 days: back");
  assert.equal(nextLogState({ held: [] } as any, {}), undefined, "an empty list isn't kept");
});

console.log(`\n${passed} passed`);
