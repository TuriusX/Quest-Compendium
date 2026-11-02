// Run: npm run test:sync   (or: npx tsx tests/budgetRules.test.ts)
import assert from "node:assert/strict";
import { afterFailedTry, stopPage, worstCost, startNeed, rollingDayCap, upkeepRoom, guideWalkCheck, BIG_STEP_MIN, RETRY_DAYS, TRANSLATE_SHARE, WALK_START } from "../scripts/pipeline/budgetRules";
import { parseSteamAchievements } from "../scripts/guides/steamAchievements";
import { languageWeights, rankTranslations } from "../scripts/guides/translateBackfill";
import { namesToLookUp } from "../scripts/guides/officialNames";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a failed repair comes back a week later, and the second failure stops it", () => {
  const now = 1000;
  const first = afterFailedTry({ game: "Starfield" }, now);
  assert.equal(first.stopped, false);
  assert.equal(first.item.tries, 1);
  assert.equal(first.item.retryAfter, now + RETRY_DAYS * 86_400_000);
  assert.equal(afterFailedTry(first.item, now).stopped, true);
});

test("a page attempt stops at $0.75, and Dawnshore's $1.15 fits a re-verification's worst case", () => {
  assert.equal(stopPage(0.74), false);
  assert.equal(stopPage(0.75), true);
  assert.ok(worstCost("reverify") >= 1.15);
  assert.ok(worstCost("walkthrough") >= 0.75);
  assert.ok(worstCost("anything new") > 0);
});

test("the day's cap: what's left over the days left, so unused days roll over and the month ends at its cap", () => {
  assert.equal(rollingDayCap(60, 30, 15), 2);
  assert.equal(rollingDayCap(60, 0, 30), 2);
  assert.ok(rollingDayCap(60, 10, 25) > rollingDayCap(60, 10, 26));
  assert.equal(rollingDayCap(60, 70, 5), 0);
  // Spending each day's cap ends the month exactly at the cap.
  let spent = 8.3;
  for (let left = 29; left >= 1; left--) spent += rollingDayCap(60, spent, left);
  assert.ok(Math.abs(spent - 60) < 1e-9);
  assert.ok(BIG_STEP_MIN >= 2.79);
});

test("upkeep: 20% of the day, or what has built up so one re-verification can fit", () => {
  const u = { dayCap: 1.78, monthCap: 60, daysInMonth: 30 };
  assert.ok(Math.abs(upkeepRoom({ ...u, spentMonth: 50, spentToday: 0, dayOfMonth: 2 }) - 0.356) < 1e-9);
  assert.ok(Math.abs(upkeepRoom({ ...u, spentMonth: 1, spentToday: 0, dayOfMonth: 10 }) - 3) < 1e-9);
  assert.ok(upkeepRoom({ ...u, spentMonth: 50, spentToday: 0.4, dayOfMonth: 2 }) < 0);
});

test("a walkthrough starts at $0.30: its worst case still fits the day's cap, with translations' share behind it", () => {
  assert.equal(WALK_START, 0.3);
  assert.equal(startNeed("walkthrough"), WALK_START);
  assert.ok(WALK_START + TRANSLATE_SHARE >= worstCost("walkthrough"));
  assert.equal(startNeed("reverify"), worstCost("reverify"));
  assert.equal(startNeed("place"), worstCost("place"));
});

const walk = (statuses: string[]) => statuses.map((status, i) => ({ status, at: i + 1, dollars: 0.3 }));
test("a guide's walkthroughs: fewer than 7 of 10 live pauses it; four not live settles it early", () => {
  assert.equal(guideWalkCheck(walk(Array(9).fill("live"))).verdict, "wait");
  assert.deepEqual(guideWalkCheck(walk([...Array(7).fill("live"), ...Array(3).fill("not live")])), { verdict: "ok", live: 7, tried: 10, through: 10 });
  assert.equal(guideWalkCheck(walk(["not live", "live", "not live", "not live"])).verdict, "wait");
  assert.deepEqual(guideWalkCheck(walk(["not live", "live", "not live", "not live", "not live"])), { verdict: "pause", live: 1, tried: 5, through: 5 });
  // A daily limit isn't the guide's fault.
  assert.equal(guideWalkCheck(Array.from({ length: 5 }, (_, i) => ({ status: "error", at: i, dollars: 0 }))).verdict, "wait");
  assert.equal(guideWalkCheck([{ status: "error", at: 1, dollars: 0.2 }]).tried, 1);
});

// As Steam's page has it now: JSON in a script string, with a quote inside a description.
const page = String.raw`<script>self.__next_f.push([1,"{\"language\":\"english\",\"groups\":[{\"id\":0,\"achievements\":[{\"internal_key\":256,\"api_name\":\"ACH00\",\"name\":\"Elden Ring\",\"description\":\"Obtained all achievements\",\"hidden\":false,\"archived\":false,\"icon_achieved\":\"a.jpg\"},{\"internal_key\":257,\"api_name\":\"ACH01\",\"name\":\"Elden Lord\",\"description\":\"Achieved the \\\"Elden Lord\\\" ending\",\"hidden\":true,\"archived\":false,\"icon_achieved\":\"b.jpg\"},{\"internal_key\":258,\"name\":\"Old one\",\"description\":\"\",\"hidden\":false,\"archived\":true}]}]},{\"percentages\":{\"256\":10.5,\"257\":23.899999618530273}}"])</script>`;

test("Steam's new page: names, descriptions, hidden flags and rarity from its data; archived ones left out", () => {
  const list = parseSteamAchievements(page, 1245620);
  assert.deepEqual(list.map((a) => a.name), ["Elden Ring", "Elden Lord"]);
  assert.equal(list[1].desc, 'Achieved the "Elden Lord" ending');
  assert.equal(list[1].hidden, true);
  assert.equal(list[1].rarity, 23.9);
  assert.match(list[0].icon, /apps\/1245620\/a\.jpg$/);
});

test("Steam's old markup is still read", () => {
  const list = parseSteamAchievements('<div class="achieveRow "><img src="i.jpg"><div class="achievePercent">12.5%</div><h3>Old &amp; Gold</h3><h5>Do it</h5></div>', 1);
  assert.deepEqual(list, [{ name: "Old & Gold", desc: "Do it", rarity: 12.5, icon: "i.jpg", hidden: false }]);
});

test("a page with no achievements is an empty list", () => {
  assert.deepEqual(parseSteamAchievements("<html></html>", 1), []);
});

test("translations: the most-visited guide and the most-used languages first; none left out", () => {
  const w = languageWeights({ questions: { "Brazilian Portuguese": 21, French: 13, English: 213 }, settings: { es: 4, en: 17 }, impressions: { de: 500 } });
  assert.equal(w.pt, 22);
  assert.equal(w.es, 5);
  assert.equal(w.de, 6);
  assert.equal(w.ko, 1);
  const r = rankTranslations([{ key: "small", game: "S", demand: 10, languages: [] }, { key: "big", game: "B", demand: 1000, languages: ["pt"] }], w);
  assert.deepEqual([r[0].key, r[0].lang], ["big", "fr"]);
  assert.equal(r.length, 15);
  assert.ok(!r.some((g) => g.key === "big" && g.lang === "pt"));
});

test("official names to look up: places first, then what's named most; no generic containers", () => {
  const names = namesToLookUp([{ name: "Port Hanshan", items: [{ name: "Storage Locker" }, { name: "Garage Pass" }, { name: "Garage Pass" }], fights: [{ name: "Benezia" }] }]);
  assert.deepEqual(names, ["Port Hanshan", "Garage Pass", "Benezia"]);
  assert.equal(namesToLookUp(Array.from({ length: 200 }, (_, i) => ({ name: `Place ${i}` }))).length, 60);
});

console.log(`\n${passed} tests passed`);
