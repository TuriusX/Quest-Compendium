// Run: npm run test:sync   (or: npx tsx tests/padCombo.test.ts)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { comboFor, createComboDetector, createHoldToTalk, BITS } = require("../electron/padCombo.cjs");
const { createControllerService } = require("../electron/controller.cjs");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const VM = BITS.back | BITS.start;

test("presets and older settings", () => {
  assert.deepEqual(comboFor("hold-view-menu").buttons, ["back", "start"]);
  assert.equal(comboFor(undefined).mode, "hold");
  assert.equal(comboFor("double-view").mode, "double");
  assert.deepEqual(comboFor("back+start").buttons, ["back", "start"]);
  assert.deepEqual(comboFor("lb+rb+back").buttons, ["lb", "rb", "back"]);
  assert.equal(comboFor("off"), null);
  assert.equal(comboFor("custom", { buttons: ["a"], mode: "hold" }), null, "a single face button clashes with games");
  assert.equal(comboFor("custom", { buttons: ["rs"], mode: "double" }).mode, "double");
  assert.deepEqual(comboFor("custom", { buttons: ["lb", "x", "zz"], mode: "hold" }).buttons, ["lb", "x"]);
});

test("hold: fires once after a full second, never on a normal press", () => {
  const d = createComboDetector(comboFor("hold-view-menu"));
  assert.equal(d.step(VM, 0).fire, false);
  assert.equal(d.step(VM, 500).fire, false);
  assert.equal(d.step(0, 600).fire, false); // let go at 600 ms: nothing
  assert.equal(d.step(VM, 1000).fire, false);
  assert.equal(d.step(VM, 2000).fire, true);
  assert.equal(d.step(VM, 3000).fire, false, "once per hold");
});

test("double-tap: two quick clean taps fire; one tap, slow taps or a held press don't", () => {
  const one = createComboDetector(comboFor("double-view"));
  let fired = false;
  for (const [b, t] of [[BITS.back, 0], [0, 100], [0, 1000]] as const) fired = one.step(b, t).fire || fired;
  assert.equal(fired, false, "a single tap");
  const two = createComboDetector(comboFor("double-view"));
  two.step(BITS.back, 0); two.step(0, 100);
  assert.equal(two.step(BITS.back, 300).fire, true, "second tap within 350 ms");
  const slow = createComboDetector(comboFor("double-view"));
  slow.step(BITS.back, 0); slow.step(0, 100); slow.step(0, 600);
  assert.equal(slow.step(BITS.back, 700).fire, false, "second tap too late");
  const held = createComboDetector(comboFor("double-view"));
  held.step(BITS.back, 0); held.step(BITS.back, 500); held.step(0, 550);
  assert.equal(held.step(BITS.back, 650).fire, false, "a long press isn't a tap");
  const mixed = createComboDetector(comboFor("double-view"));
  mixed.step(BITS.back, 0); mixed.step(0, 100); mixed.step(BITS.a, 150);
  assert.equal(mixed.step(BITS.back, 250).fire, false, "another button in between");
});

test("hold to talk: a tap is the button's press; a long press starts and the release sends", () => {
  const h = createHoldToTalk(BITS.y);
  assert.equal(h.step(BITS.y, 0), null);
  assert.equal(h.step(0, 100), "tap");
  assert.equal(h.step(BITS.y, 200), null);
  assert.equal(h.step(BITS.y, 600), "start");
  assert.equal(h.step(BITS.y, 900), null);
  assert.equal(h.step(0, 1000), "end");
});

/** The controller service with a fake pad and clock. */
function rig(config: any, visible = true) {
  let buttons = 0, lt = 0, t = 0;
  const events: any[] = [];
  let toggles = 0;
  const svc = createControllerService({
    readPad: (i: number) => (i === 0 ? { wButtons: buttons, bLeftTrigger: lt, bRightTrigger: 0, sThumbLX: 0, sThumbLY: 0, sThumbRY: 0 } : null),
    now: () => t, isVisible: () => visible, onToggle: () => toggles++, onInput: (e: any) => events.push(e),
  });
  svc.stop();
  svc.setConfig(config);
  svc.stop();
  const at = (ms: number, b: number, trig = 0) => { t = ms; buttons = b; lt = trig; svc._tick(); };
  return { at, events, toggles: () => toggles };
}

test("service: View pressed alone still works (after release); the 1-second hold toggles without it", () => {
  const r = rig({ toggle: "hold-view-menu" });
  r.at(0, BITS.back); r.at(100, 0);
  assert.deepEqual(r.events.filter((e) => e.type === "button").map((e) => e.button), ["back"]);
  assert.equal(r.toggles(), 0);
  const h = rig({ toggle: "hold-view-menu" });
  h.at(0, VM); h.at(1100, VM); h.at(1200, 0);
  assert.equal(h.toggles(), 1);
  assert.equal(h.events.filter((e) => e.type === "button").length, 0, "the combo's buttons don't act");
});

test("service: double-tap View toggles; a single View press reports once the double-tap can't happen", () => {
  const r = rig({ toggle: "double-view" });
  r.at(0, BITS.back); r.at(100, 0); r.at(250, BITS.back); r.at(300, 0); r.at(1000, 0);
  assert.equal(r.toggles(), 1);
  assert.equal(r.events.filter((e) => e.button === "back").length, 0);
  const s = rig({ toggle: "double-view" });
  s.at(0, BITS.back); s.at(100, 0); s.at(200, 0);
  assert.equal(s.events.filter((e) => e.button === "back").length, 0, "still waiting");
  s.at(600, 0);
  assert.equal(s.events.filter((e) => e.button === "back").length, 1);
});

test("service: hold Y to talk, tap Y for quick questions; triggers page", () => {
  const r = rig({ toggle: "hold-view-menu", talk: "y" });
  r.at(0, BITS.y); r.at(100, 0);
  r.at(200, BITS.y); r.at(700, BITS.y); r.at(1500, 0);
  r.at(2000, 0, 200);
  assert.deepEqual(r.events.map((e) => e.type === "talk" ? `talk:${e.state}` : e.button), ["y", "talk:start", "talk:end", "lt"]);
  const hidden = rig({ talk: "y" }, false);
  hidden.at(0, BITS.y); hidden.at(800, BITS.y); hidden.at(900, 0);
  assert.equal(hidden.events.length, 0, "no talking while the overlay is hidden");
});

console.log(`\n${passed} passed`);
