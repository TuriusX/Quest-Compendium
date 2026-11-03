// Run: npm run test:sync   (or: npx tsx tests/siteAnswers.test.ts)
import assert from "node:assert/strict";
import { plainAnswer, refLink, siteReference, siteSituation, appLanguage, namedArea, missingText, previewKeyOk } from "../siteAsk";
import { GUIDE_REFERENCE, extractGuideRefs } from "../guidesApi";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const ctx = {
  selfText: "[THE PAGE BEING READ: Lae'zel]\n- [p1] About her",
  matchLines: "- [r1] item: Gloves of Missile Snaring",
  otherPages: [{ slug: "emerald-grove", text: "[PAGE: Emerald Grove]\n- [o1_1] Arron's shop" }, { slug: "the-hollow", text: "[PAGE: Hollow]\n- [o2_1] The inner sanctum" }],
  placeSlug: "emerald-grove",
  refs: { p1: { label: "Lae'zel", href: "/guides/g/laezel/" }, r1: { label: "Gloves", href: "/guides/g/emerald-grove/#e-1" }, o1_1: { label: "Arron", href: "/guides/g/emerald-grove/" }, o2_1: { label: "Hollow", href: "/guides/g/the-hollow/" } },
};

test("the guide is reference in the app's own words, never a limit", () => {
  const r = siteReference(ctx, "");
  for (const block of [r.withPage, r.withoutPage]) {
    assert.ok(block.includes(GUIDE_REFERENCE));
    assert.doesNotMatch(block, /at most|words|short and practical|base the answer on|do not contradict/i);
  }
  assert.match(GUIDE_REFERENCE, /Answer from everything you know about this game first/);
  assert.match(GUIDE_REFERENCE, /never limit the answer/);
});

test("the place's own page isn't sent twice when the app's notes for it are there", () => {
  const r = siteReference(ctx, "");
  assert.doesNotMatch(r.withPage, /\[PAGE: Emerald Grove\]/);
  assert.match(r.withPage, /\[PAGE: Hollow\]/);
  assert.doesNotMatch(r.withPage, /THE PAGE BEING READ/);
  assert.match(r.withoutPage, /\[PAGE: Emerald Grove\]/);
  assert.match(r.withoutPage, /THE PAGE BEING READ/);
});

test("the tags are ones the app's parser reads, and lead back to the guide's links", () => {
  const r = siteReference(ctx, "");
  assert.doesNotMatch(r.withoutPage, /\[(p1|r1|o1_1)\]/);
  const tag = r.withoutPage.match(/\[(g\d+)\] item: Gloves/)![1];
  const out = extractGuideRefs(`Buy them from Arron [${tag}].\n<qc-guide>["${tag}"]</qc-guide>`, r.refs);
  assert.equal(out.text, "Buy them from Arron.");
  assert.equal(refLink(out.used[0], "g", "en")!.href, "/guides/g/emerald-grove/#e-1");
});

test("a page with no guide lines still asks for the page-subject line, and an empty one adds nothing", () => {
  const empty = { selfText: "", matchLines: "", otherPages: [], placeSlug: "", refs: {} };
  assert.equal(siteReference(empty, "").withoutPage, "");
  assert.match(siteReference(empty, "Hollow").withoutPage, /<qc-about>/);
});

test("links to the app's tagged entries use the pages' anchors, and the page's language", () => {
  assert.equal(refLink({ key: "g", slug: "a", entry: "7", kind: "item", name: "X" }, "g", "en")!.href, "/guides/g/a/#e-7");
  assert.equal(refLink({ key: "g", slug: "a", entry: "s3", kind: "step", name: "X" }, "g", "de")!.href, "/de/guides/g/a/#s3");
  assert.equal(refLink({ key: "g", slug: "a", entry: "f1", kind: "boss", name: "X" }, "g", "en")!.href, "/guides/g/a/#f1");
  assert.equal(refLink({ key: "g", slug: "a", area: "A" }, "g", "en")!.href, "/guides/g/a/");
  assert.equal(refLink({ name: "no page" }, "g", "en"), null);
});

test("the plain text keeps every word and line of a long answer", () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  assert.equal(plainAnswer(long), long);
  assert.equal(plainAnswer("## Items\n**Sorrow:** in the vault\n* first\n- second\n\n\n\nEnd"), "Items\nSorrow: in the vault\n• first\n• second\n\nEnd");
  assert.equal(plainAnswer("Fire deals 2*3 damage"), "Fire deals 2*3 damage");
  assert.equal(plainAnswer("First part.\n\n---\n\nSecond *Lesser Restoration* at `X: 262, Y: 481`."), "First part.\n\nSecond Lesser Restoration at X: 262, Y: 481.");
});

test("the website's note says where the question comes from, not how to answer", () => {
  const s = siteSituation("Emerald Grove", "Baldur's Gate 3");
  assert.match(s, /reading the guide page "Emerald Grove" for Baldur's Gate 3/);
  assert.match(s, /may not be at that place/);
  assert.doesNotMatch(s, /short|brief|only|limit/i);
  assert.doesNotMatch(siteSituation("X", "X"), /page "/);
});

test("a place comes from the question only when it names the area, never from loose matches", () => {
  const areas = [{ name: "Emerald Grove" }, { name: "Moonrise Towers" }, { name: "Moonrise Towers Prison" }, { name: "The Hollow" }];
  assert.equal(namedArea("What can I miss in the Emerald Grove?", areas)?.name, "Emerald Grove");
  assert.equal(namedArea("how do i get out of moonrise towers prison", areas)?.name, "Moonrise Towers Prison");
  assert.equal(namedArea("What's in the hollow?", areas)?.name, "The Hollow");
  assert.equal(namedArea("What is the best class for a first run?", areas), undefined);
  assert.equal(namedArea("Is the grove worth it?", areas), undefined);
});

test("a long answer goes to the nightly check as whole sentences; a short one as it is", () => {
  assert.equal(missingText("Short fact."), "Short fact.");
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} here.`).join(" ");
  const out = missingText(long);
  assert.ok(out.length <= 800 && out.endsWith("here."));
});

test("the preview needs the whole key; no key set means no preview", () => {
  const key = "k".repeat(40);
  assert.equal(previewKeyOk(key, key), true);
  assert.equal(previewKeyOk(key.slice(1), key), false);
  assert.equal(previewKeyOk("x".repeat(40), key), false);
  assert.equal(previewKeyOk("", ""), false);
  assert.equal(previewKeyOk(undefined, undefined), false);
  assert.equal(previewKeyOk("short", "short"), false);
});

test("every site language maps to one the app's route accepts", () => {
  assert.equal(appLanguage("pt"), "Brazilian Portuguese");
  assert.equal(appLanguage("zh"), "Simplified Chinese");
  assert.equal(appLanguage("xx"), "English");
});

console.log(`\n${passed} tests passed`);
process.exit(process.exitCode || 0);
