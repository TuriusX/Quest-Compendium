// Run: npm run test:sync   (or: npx tsx tests/searchTitles.test.ts)
import assert from "node:assert/strict";
import { pickPages, beforeWindow, afterWindow, isDue, sumRange, verdict, liveTitles, withBrand, pageWords, rewriteProblems, trialLines, type Trial } from "../scripts/pipeline/searchTitleRules";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const page = (slug: string, impressions: number, clicks: number, position = 9) => ({ key: "g", slug, impressions, clicks, position, ctr: clicks / impressions });

test("the most impressions among pages rarely clicked; good click rates, thin data, far positions and tried pages stay out", () => {
  const pages = [page("few", 50, 0), page("clicked", 2000, 40), page("far", 3000, 0, 35), page("tried", 2500, 0), page("b", 500, 1), page("a", 900, 3)];
  assert.deepEqual(pickPages(pages, new Set(["g/tried"]), 5).map((p) => p.slug), ["a", "b"]);
  assert.equal(pickPages(pages, new Set(), 1).length, 1);
  assert.equal(pickPages(pages, new Set(), -2).length, 0);
});

test("the windows: 28 days each, the days Google needs left out, decided only with final data", () => {
  assert.deepEqual(beforeWindow("2026-11-03"), { start: "2026-10-04", end: "2026-10-31" });
  assert.deepEqual(afterWindow("2026-11-03"), { start: "2026-11-06", end: "2026-12-03" });
  assert.equal(isDue("2026-11-03", "2026-12-05"), false);
  assert.equal(isDue("2026-11-03", "2026-12-06"), true);
});

test("a page's numbers over a range, position weighted", () => {
  const rows = [
    { day: "2026-11-06", id: "g/a", clicks: 1, impressions: 10, position: 10 },
    { day: "2026-11-07", id: "g/a", clicks: 2, impressions: 30, position: 6 },
    { day: "2026-11-05", id: "g/a", clicks: 9, impressions: 90, position: 1 },
    { day: "2026-11-06", id: "g/b", clicks: 9, impressions: 90, position: 1 },
  ];
  assert.deepEqual(sumRange(rows, "g/a", { start: "2026-11-06", end: "2026-11-30" }), { impressions: 40, clicks: 3, position: 7 });
});

test("a change stays unless clicks dropped; a page put back shows its old title again", () => {
  assert.equal(verdict({ clicks: 3 }, { clicks: 3 }), "kept");
  assert.equal(verdict({ clicks: 0 }, { clicks: 0 }), "kept");
  assert.equal(verdict({ clicks: 3 }, { clicks: 2 }), "put back");
  const t = (status: Trial["status"]) => ({ title: "T", description: "D", status }) as Trial;
  assert.deepEqual(liveTitles({ "g/a": t("testing"), "g/b": t("kept"), "g/c": t("put back") }), { "g/a": { title: "T", description: "D" }, "g/b": { title: "T", description: "D" } });
  assert.deepEqual(liveTitles(undefined), {});
});

test("the site's name only when the title still fits", () => {
  assert.equal(withBrand("Vault 81 Fallout 4: Location"), "Vault 81 Fallout 4: Location | Quest Compendium");
  assert.equal(withBrand("x".repeat(45)), "x".repeat(45));
});

const doc = { name: "Vault 81", overview: "A sealed vault under Boston with a secret lab.", walkthrough: [{ title: "Enter the vault" }], shops: [], sources: ["fextralife"], summary: { whereToFind: ["Boston"] } };
const check = { name: "Vault 81", game: "Fallout 4", oldTitle: "Vault 81 – Fallout 4 | Quest Compendium", queries: ["fallout 4 vault 81", "fo4 vault 81"], words: pageWords(doc) };
const good = { title: "Vault 81 FO4: Walkthrough and Secret Lab", description: "Where to find Vault 81 in Fallout 4, how to enter the sealed vault under Boston, and its secret lab." };

test("an accurate rewrite passes", () => assert.deepEqual(rewriteProblems(good, check), []));

test("a title can't promise what the page doesn't have, or oversell", () => {
  assert.match(rewriteProblems({ ...good, title: "Vault 81 FO4: Shops and Secret Lab" }, check).join(), /not on the page: shops/);
  assert.match(rewriteProblems({ ...good, description: good.description.replace("its secret lab", "its Fextralife lab") }, check).join(), /not on the page: fextralife/);
  assert.match(rewriteProblems({ ...good, description: good.description.replace("its secret lab", "its shops") }, check).join(), /not on the page: shop/);
  assert.deepEqual(rewriteProblems({ ...good, description: `Explore ${good.description.replace("Where", "where")}` }, check), []);
  assert.match(rewriteProblems({ ...good, title: "Best Vault 81 FO4 Walkthrough" }, check).join(), /overselling/);
  assert.match(rewriteProblems({ ...good, description: `${good.description} Enter now!` }, check).join(), /overselling/);
});

test("the title needs the page's name and game, within Google's lengths, and must change", () => {
  assert.match(rewriteProblems({ ...good, title: "Fallout 4: The Sealed Vault Under Boston" }, check).join(), /page's name/);
  assert.match(rewriteProblems({ ...good, title: "Vault 81: Walkthrough and Secret Lab" }, check).join(), /name the game/);
  assert.match(rewriteProblems({ ...good, title: `${good.title} ${"vault ".repeat(6)}` }, check).join(), /15-60/);
  assert.match(rewriteProblems({ ...good, description: "Vault 81." }, check).join(), /70-158/);
  assert.match(rewriteProblems({ ...good, title: "Vault 81 FO4: Secret Lab" }, { ...check, oldTitle: "Vault 81 FO4: Secret Lab | Quest Compendium" }).join(), /same as before/);
});

test("Monday: each page's click rate before and after, and the week's decisions", () => {
  const base = { key: "g", name: "Vault 81", game: "Fallout 4", before: { impressions: 1000, clicks: 2, position: 11, start: "", end: "" } };
  const after = { impressions: 500, clicks: 5, position: 9, start: "", end: "", days: 14 };
  const now = 1_800_000_000_000;
  const lines = trialLines({
    "g/a": { ...base, slug: "a", status: "testing", after } as Trial,
    "g/b": { ...base, slug: "b", status: "testing" } as Trial,
    "g/c": { ...base, slug: "c", status: "put back", decidedAt: now - 1000, after: { ...after, clicks: 1, days: 28 } } as Trial,
    "g/d": { ...base, slug: "d", status: "kept", decidedAt: now - 30 * 86_400_000, after } as Trial,
  }, now);
  assert.match(lines[0], /2 page\(s\) on trial, 1 kept, 1 put back/);
  assert.match(lines[1], /click rate 0\.20% → 1\.00%, clicks 2 in 28 days → 5 in 14/);
  assert.match(lines[2], /no data after the change yet/);
  assert.match(lines[3], /^↩️ Put back: Vault 81/);
  assert.equal(lines.length, 4);
  assert.deepEqual(trialLines({}), []);
});

console.log(`${passed} passed`);
