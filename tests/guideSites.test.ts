// Run: npx tsx tests/guideSites.test.ts   (part of npm run test:sync)
// The Guides tab's browser: the address bar, suggested sites, favourites (src/utils/guideSites.ts).
import assert from "node:assert/strict";
import { addressToUrl, hostOf, samePage, suggestedSites } from "../src/utils/guideSites";

assert.equal(addressToUrl("gamefaqs.gamespot.com"), "https://gamefaqs.gamespot.com");
assert.equal(addressToUrl("https://example.com/a b"), "https://example.com/a b", "an address stays as typed");
assert.equal(addressToUrl("eldenring.wiki.fextralife.com/Margit"), "https://eldenring.wiki.fextralife.com/Margit");
assert.equal(addressToUrl("ornstein and smough", "Dark Souls"), "https://www.google.com/search?q=Dark%20Souls%20ornstein%20and%20smough", "a search gets the game's name");
assert.equal(addressToUrl("dark souls ornstein", "Dark Souls"), "https://www.google.com/search?q=dark%20souls%20ornstein", "not twice");
assert.equal(addressToUrl("margit", ""), "https://www.google.com/search?q=margit");
assert.equal(addressToUrl("   "), "");
assert.equal(addressToUrl("v1.2 patch notes", "X"), "https://www.google.com/search?q=X%20v1.2%20patch%20notes", "words with dots are a search");

const s = suggestedSites("Elden Ring", 1245620);
assert.equal(s[0].url, "https://steamcommunity.com/app/1245620/guides/", "Steam guides first when the game is on Steam");
assert.ok(s.some((x) => x.key === "fandom" && x.url.includes("Elden%20Ring")));
assert.ok(!suggestedSites("Zelda").some((x) => x.key === "steam"), "no Steam id, no Steam guides");
assert.deepEqual(suggestedSites(""), [], "no game, no suggestions");

assert.equal(hostOf("https://www.reddit.com/r/x"), "reddit.com");
assert.equal(hostOf("nope"), "");
assert.ok(samePage("https://a.com/x/", "https://a.com/x#top"));
assert.ok(!samePage("", ""));
console.log("guideSites: all passed");
