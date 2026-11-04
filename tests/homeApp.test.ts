// Run: npm run test:sync   (or: npx tsx tests/homeApp.test.ts)
import assert from "node:assert/strict";
import { pickExample, homeTryLink, homeAppBlock, HOME_APP_JS } from "../scripts/guides/homeApp";
import { GUIDE_UI_EN } from "../scripts/guides/guide-ui";
import { GENERATED } from "../scripts/guides/guide-ui.generated";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("only the example questions that fit: a game shows what its guide really has", () => {
  const all = pickExample({ hasAchievements: true, missablesByArea: [{ name: "Ravaged Beach", n: 2 }, { name: "Emerald Grove", n: 9 }], sectionNames: ["Classes (facts only)"] });
  assert.deepEqual(all, { p: "Emerald Grove", a: 1, b: 1 });
  assert.deepEqual(pickExample({ hasAchievements: true, missablesByArea: [{ name: "A", n: 3 }], sectionNames: ["Characters", "Locations"] }), { p: "A", a: 1 });
  assert.deepEqual(pickExample({ missablesByArea: [{ name: "A", n: 0 }], sectionNames: [] }), {});
  assert.deepEqual(pickExample({ missablesByArea: [], sectionNames: ["Weapons"] }), { b: 1 });
});

const T = Object.fromEntries(Object.keys(GUIDE_UI_EN).filter((k) => k.startsWith("home")).map((k) => [k[4].toLowerCase() + k.slice(5), GUIDE_UI_EN[k]]));

test("every word the script asks for exists, in English and in every language", () => {
  const used = [...new Set([...HOME_APP_JS.matchAll(/\bT\.([a-zA-Z0-9]+)/g)].map((m) => m[1]))];
  const camel = (k: string) => `home${k[0].toUpperCase()}${k.slice(1)}`;
  for (const k of used) assert.ok(T[k], `no English word for ${k}`);
  for (const [lang, words] of Object.entries(GENERATED)) for (const k of used) assert.ok(words[camel(k)], `${lang} has no ${camel(k)}`);
});

test("a translation keeps the placeholders its English has", () => {
  for (const [lang, words] of Object.entries(GENERATED)) {
    for (const k of Object.keys(GUIDE_UI_EN).filter((x) => x.startsWith("home"))) {
      for (const m of GUIDE_UI_EN[k].matchAll(/\{[a-z]+\}/g)) assert.ok(words[k]?.includes(m[0]), `${lang} ${k} lost ${m[0]}`);
    }
  }
});

test("the screenshot line is the agreed wording; the block is the app alone: the logo stays in the hero", () => {
  assert.equal(GUIDE_UI_EN.homeKept, "We don't keep your screenshot.");
  const b = homeAppBlock({ api: "https://x", lang: "en", T, tiles: [{ key: "g", name: 'A "quoted" <game>', art: "a.jpg" }], up: "" });
  assert.doesNotMatch(b, /logo\.svg|qa-logo/);
  assert.equal(homeTryLink("Try <now> ↓"), '<a href="#qc-app" class="qa-try">Try &lt;now> ↓</a>');
  assert.match(b, /id="qc-app"/);
  assert.doesNotMatch(b, /<game>/);
  assert.match(b, /assets\/home-app\.js/);
});

test("answers reach the page as text, never as markup", () => {
  assert.doesNotMatch(HOME_APP_JS, /innerHTML\s*=\s*[^;]*answer/);
  assert.match(HOME_APP_JS, /a\.el\.textContent=a\.text/);
  assert.match(HOME_APP_JS, /class:'qa-a'[^)]*text:a\.text/);
});

test("the question is kept across a redirect, and the script is valid", () => {
  assert.match(HOME_APP_JS, /qc-before-redirect/);
  assert.match(HOME_APP_JS, /qc-home-pending/);
  new Function(HOME_APP_JS);
});

console.log(`\n${passed} tests passed`);
process.exit(process.exitCode || 0);
