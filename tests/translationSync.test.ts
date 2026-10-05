// Run: npm run test:sync   (or: npx tsx tests/translationSync.test.ts)
import assert from "node:assert/strict";
import { translatableText } from "../scripts/guides/common";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const page = {
  name: "Ravaged Beach", story: "Act 1", overview: "The crash site.",
  items: [{ id: "x1", name: "Harper's Map", where: "Under the Scuffed Rock", missable: true, sources: ["bg3.wiki"] }],
  secrets: [{ id: "s1", text: "A Harper cache" }], enemies: [], shops: [], tips: ["Rest often"],
  sections: [{ title: "Don't miss", check: true, entries: [{ id: "m1", text: "Rescue Shadowheart" }] }],
  fights: [{ id: "f1", name: "Intellect devourers", tactics: "High ground" }],
  updatedAt: 1, status: "published", order: 3,
};

test("only player-facing text counts as a change (sources, order, status and bookkeeping don't)", () => {
  const same = { ...page, updatedAt: 99, status: "draft", order: 7, staged: "copy", review: { score: 90 },
    items: [{ ...page.items[0], sources: ["other site"], updatedFrom: "missables repair" }] };
  assert.equal(translatableText(same), translatableText(page));
});

test("a rewritten missable, a new key fight, a changed tip or a renamed section is a change", () => {
  for (const changed of [
    { ...page, items: [{ ...page.items[0], how: "drag the Scuffed Rock aside" }] },
    { ...page, items: [{ ...page.items[0], lockout: "lost in Act 2" }] },
    { ...page, fights: [...page.fights, { id: "f2", name: "Gate defence" }] },
    { ...page, tips: ["Rest less"] },
    { ...page, sections: [{ ...page.sections[0], title: "Missables" }] },
    { ...page, overview: "The crash site of the Nautiloid." },
  ]) assert.notEqual(translatableText(changed), translatableText(page));
});

console.log(`\n${passed} tests passed`);
