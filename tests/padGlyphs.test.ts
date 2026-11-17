// Run: npx tsx tests/padGlyphs.test.ts   (part of npm run test:sync)
// Controller mode step 4 (src/utils/padGlyphs.ts): the buttons as the player's controller names them.
import assert from "node:assert/strict";
import { glyph, styleFromId } from "../src/utils/padGlyphs";

assert.equal(styleFromId("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "playstation");
assert.equal(styleFromId("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"), "playstation");
assert.equal(styleFromId("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "nintendo");
assert.equal(styleFromId("Xbox 360 Controller (XInput STANDARD GAMEPAD)"), "xbox");
assert.equal(styleFromId("Steam Deck Controller (Vendor: 28de Product: 1205)"), "deck");
assert.equal(styleFromId("Unknown pad"), null, "can't tell: the setting decides");
assert.equal(styleFromId(""), null);

assert.equal(glyph("a").text, "A");
assert.equal(glyph("a", "playstation").text, "✕", "the bottom button is ✕ on PlayStation");
assert.equal(glyph("b", "playstation").text, "○");
assert.equal(glyph("a", "nintendo").text, "B", "the bottom button is B on a Switch controller");
assert.equal(glyph("b", "nintendo").text, "A");
assert.equal(glyph("lb", "playstation").text, "L1");
assert.equal(glyph("rt", "nintendo").text, "ZR");
assert.equal(glyph("menu", "deck").text, "☰");
assert.equal(glyph("l3", "playstation").text, "L3", "old names still work");
assert.equal(glyph("a").round, true);
assert.equal(glyph("lb").round, false);

console.log("padGlyphs: all passed");
