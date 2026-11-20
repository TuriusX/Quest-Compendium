// Run: npm run test:sync   (or: node tests/fanLayout.test.cjs)
// The quick menu's fan from the orb (owner, Nov 19 2026, step 2): its layout from each corner (electron/fanLayout.cjs),
// pointing at it (mouse, sticks, the shoulder buttons' rings), and the hard rule: opening the menu (the keyboard
// shortcut, the controller's combo, the mouse resting on the orb, the orb's menu) never picks anything; only an explicit
// pick does. The quick menu's window (electron/wheel.cjs) and the orb's dwell (electron/answerCard.cjs) run against
// fake Electron windows.
const assert = require('node:assert/strict');
const Module = require('module');
const { mock } = require('node:test');
const Fan = require('../electron/fanLayout.cjs');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '   -> ' + String(e && e.message).split('\n')[0]); process.exitCode = 1; }
}
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
// The orb's centre in each corner (the card's window at 24 px from the edges, the orb's 104 px box in its corner).
const HUB = { tr: { x: 1920 - 24 - 52, y: 24 + 52 }, tl: { x: 24 + 52, y: 24 + 52 }, br: { x: 1920 - 24 - 52, y: 1040 - 24 - 52 }, bl: { x: 24 + 52, y: 1040 - 24 - 52 } };

(async () => {
  // ---- The layout ---------------------------------------------------------------------------------------------------
  await test('the first 5 items go on the inner ring, the rest on the outer one; nothing is dropped', () => {
    assert.deepEqual(Fan.split(3), { inner: 3, outer: 0 });
    assert.deepEqual(Fan.split(5), { inner: 5, outer: 0 });
    assert.deepEqual(Fan.split(12), { inner: 5, outer: 7 });
    assert.deepEqual(Fan.split(16), { inner: 5, outer: 11 });
    for (const n of [1, 3, 5, 6, 12, 16]) {
      const L = Fan.layout(n, 'tr', 1);
      assert.equal(L.items.length, n);
      assert.deepEqual(L.items.map((it) => it.i), [...Array(n).keys()]);
      assert.ok(L.items.every((it) => it.ring === (it.i < 5 ? 0 : 1)));
    }
  });

  await test('the fan flares toward the screen\'s centre from each corner', () => {
    const toward = { tr: [-1, 1], tl: [1, 1], br: [-1, -1], bl: [1, -1] };
    for (const [corner, [sx, sy]] of Object.entries(toward)) {
      const L = Fan.layout(12, corner, 1);
      for (const it of L.items) {
        assert.ok(Math.sign(it.x) === sx || it.x === 0, `${corner} item ${it.i} x ${it.x}`);
        assert.ok(Math.sign(it.y) === sy || it.y === 0, `${corner} item ${it.i} y ${it.y}`);
        // Toward the centre, never back toward the screen's edges.
        const toCentre = (it.x * sx + it.y * sy) / Math.hypot(it.x, it.y);
        assert.ok(toCentre > 0.6, `${corner} item ${it.i} points ${toCentre}`);
      }
      // The first item lies along the screen's top / bottom edge, the last of a ring along its side.
      assert.ok(Math.abs(L.items[0].x) > Math.abs(L.items[0].y) * 3);
      assert.ok(Math.abs(L.items[4].y) > Math.abs(L.items[4].x) * 3);
    }
    // Mirror images: the same distances from the hub whatever the corner.
    const a = Fan.layout(12, 'tr', 1), b = Fan.layout(12, 'bl', 1);
    a.items.forEach((it, i) => { assert.equal(Math.abs(it.x), Math.abs(b.items[i].x)); assert.equal(Math.abs(it.y), Math.abs(b.items[i].y)); });
  });

  await test('items never touch, the outer ring sits outside the inner one, and Large scales it all', () => {
    for (const n of [2, 5, 7, 12, 16]) {
      for (const s of [0.85, 1, 1.3]) {
        const L = Fan.layout(n, 'tr', s);
        for (const p of L.items) for (const q of L.items) {
          if (p.i >= q.i) continue;
          assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= (p.size + q.size) / 2 + 4, `n=${n} s=${s} items ${p.i},${q.i} touch`);
        }
        // Clear of the orb (its glow is ~52 px from the hub at Medium).
        assert.ok(L.r1 - L.items[0].size / 2 >= 70 * s);
        if (L.outer) assert.ok(L.r2 > L.r1);
      }
    }
    const m = Fan.layout(12, 'tr', 1), l = Fan.layout(12, 'tr', 1.3);
    assert.ok(l.reach > m.reach && l.items[0].size > m.items[0].size);
  });

  await test('its window sits in the orb\'s corner, holds the whole fan, and stays on the screen', () => {
    for (const corner of ['tr', 'tl', 'br', 'bl']) {
      const L = Fan.layout(16, corner, 1);
      const w = Fan.windowFor(HUB[corner], L, AREA);
      assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.width <= 1920 && w.y + w.height <= 1040, `${corner} off screen`);
      for (const it of L.items) {
        const x = w.hub.x + it.x, y = w.hub.y + it.y;
        assert.ok(x - it.size / 2 >= 0 && x + it.size / 2 <= w.width && y - it.size / 2 >= 0 && y + it.size / 2 <= w.height, `${corner} item ${it.i} outside`);
      }
      assert.equal(w.x + w.hub.x, HUB[corner].x);
      assert.equal(w.y + w.hub.y, HUB[corner].y);
      // The middle of the game stays clear: the window keeps to the corner's side of the screen.
      assert.ok(w.width < 1920 / 2 + 80 && w.height < 1040 * 0.75, `${corner} window ${w.width}x${w.height}`);
    }
  });

  // ---- Pointing -------------------------------------------------------------------------------------------------------
  await test('the mouse points along the fan; back toward the corner, or barely moved, it points at nothing', () => {
    const L = Fan.layout(12, 'tr', 1);
    assert.equal(Fan.aimAt(-120, 0, L), 0); // left, along the top edge: the first item
    assert.equal(Fan.aimAt(0, 120, L), 4); // down, along the side: the last inner item
    assert.equal(Fan.aimAt(-100, 100, L), 2); // the middle
    assert.equal(Fan.aimAt(-10, 10, L), null); // under the dead zone
    assert.equal(Fan.aimAt(120, -60, L), null); // back toward the corner
    // Past the middle of the rings: the outer ring.
    const far = Fan.aimAt(-L.r2, 0, L);
    assert.ok(far >= 5 && L.items[far].ring === 1);
    // From the bottom-left: up and right.
    const B = Fan.layout(12, 'bl', 1);
    assert.equal(Fan.aimAt(120, 0, B), 0);
    assert.equal(Fan.aimAt(0, -120, B), 4);
    assert.equal(Fan.aimAt(-120, 60, B), null);
  });

  await test('a stick points on its ring; the shoulder buttons move to the nearest item on the other ring', () => {
    const L = Fan.layout(12, 'tr', 1);
    assert.equal(Fan.stickAt(-1, 0, L, 0), 0); // left
    assert.equal(Fan.stickAt(0, -1, L, 0), 4); // down (y up)
    assert.equal(Fan.stickAt(0.2, 0.1, L, 0), null); // let go
    assert.equal(Fan.stickAt(1, 1, L, 0), null); // up-right: away from the fan
    assert.equal(Fan.stickAt(-1, 0, L, 1), 5); // the outer ring's first
    assert.equal(Fan.stickAt(0, -1, L, 1), 11); // and its last
    assert.equal(L.items[Fan.otherRing(L, 2)].ring, 1);
    assert.equal(Fan.otherRing(L, 8) < 5, true);
    assert.equal(Fan.otherRing(Fan.layout(4, 'tr', 1), 1), null); // one ring
  });

  await test('the mouse over the fan or the orb keeps it; off to the side it doesn\'t', () => {
    const L = Fan.layout(12, 'tr', 1);
    assert.equal(Fan.inFan(0, 0, L), true); // the orb
    assert.equal(Fan.inFan(-150, 150, L), true);
    assert.equal(Fan.inFan(-L.reach, 10, L), true);
    assert.equal(Fan.inFan(-(L.reach + 120), 0, L), false);
    assert.equal(Fan.inFan(200, -100, L), false);
  });

  // ---- The hard rule: opening never picks ------------------------------------------------------------------------------
  await test('letting go of the shortcut picks only what is pointed at, after a real hold', () => {
    const base = { aimed: true, sel: 2, inList: false, listening: false, heldMs: 600, tapMs: 250 };
    assert.equal(Fan.releasePicks(base), true);
    assert.equal(Fan.releasePicks({ ...base, aimed: false }), false); // never pointed (or pointed, then back to the middle)
    assert.equal(Fan.releasePicks({ ...base, sel: -1 }), false); // the fan, nothing pointed at
    assert.equal(Fan.releasePicks({ ...base, heldMs: 120 }), false); // a tap: it stays open
    assert.equal(Fan.releasePicks({ ...base, inList: true }), false);
    assert.equal(Fan.releasePicks({ ...base, listening: true }), false);
    assert.equal(Fan.releasePicks(null), false);
  });

  // ---- The quick menu's window and the orb, against fake Electron -------------------------------------------------------
  const wins = [];
  const handlers = {};
  const shortcuts = new Map();
  let cursor = { x: 0, y: 0 };
  class FakeWin {
    constructor(o) {
      this.b = { x: 0, y: 0, width: o.width, height: o.height };
      this.visible = false; this.destroyed = false; this.sent = []; this.ignore = []; this.focused = false; this.focusable = o.focusable !== false; this.opacity = 1;
      const self = this;
      this.webContents = { send: (c, p) => self.sent.push([c, p]), once: (ev, cb) => { if (ev === 'did-finish-load') setTimeout(cb, 0); }, invalidate: () => {} };
      wins.push(this);
    }
    setAlwaysOnTop() {} setContentProtection() {} loadFile() {} on() {}
    setIgnoreMouseEvents(on) { this.ignore.push(on); }
    setFocusable(on) { this.focusable = on; }
    setOpacity(o) { this.opacity = o; }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
    isVisible() { return this.visible; } showInactive() { this.visible = true; } show() { this.visible = true; } hide() { this.visible = false; }
    focus() { if (this.focusable) this.focused = true; }
    getBounds() { return { ...this.b }; } setBounds(b) { this.b = { ...b }; }
  }
  const realLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') {
      return {
        BrowserWindow: FakeWin,
        ipcMain: { on: (n, f) => { handlers[n] = f; } },
        screen: { getCursorScreenPoint: () => cursor },
        globalShortcut: { isRegistered: (k) => shortcuts.has(k), register: (k, f) => { shortcuts.set(k, f); return true; }, unregister: (k) => shortcuts.delete(k) },
      };
    }
    return realLoad.call(this, req, ...rest);
  };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  // In 40 ms steps (the watches' pace): the mocked clock only moves between ticks.
  const tick = (ms) => { for (let t = ms; t > 0; t -= 40) mock.timers.tick(Math.min(40, t)); };
  const flush = () => new Promise((r) => setImmediate(r));

  const { createWheel } = require('../electron/wheel.cjs');
  const chosen = [], talked = [], taken = [];
  const wheel = createWheel({
    focusHelper: { other: () => 'game', take: (w) => { taken.push(w); return 'game'; }, restore: () => {} },
    display: () => ({ workArea: AREA }),
    whenReleased: () => Promise.resolve(),
    onChoose: (k) => chosen.push(k),
    onTalk: (s) => talked.push(s),
  });
  const ITEMS = ['panel', 'help', 'recap', 'shot', 'speak', 'questions', 'find', 'log', 'model', 'games', 'type', 'settings'].map((key) => ({ key, label: key }));
  wheel.setItems(ITEMS, { title: 'Quick menu', questions: [{ key: 'where', label: 'Where now?' }] });
  const win = () => wins.filter((w) => !w.destroyed).pop();
  const lastOpen = () => [...win().sent].reverse().find(([c]) => c === 'wheel-open')[1];
  const FAN_TR = { hub: HUB.tr, corner: 'tr', scale: 1, dot: false };

  await test('opening the menu, every way, picks nothing and asks nothing', async () => {
    const ways = [
      { mode: 'pad' }, { mode: 'keys', keys: ['alt', 'q'] },
      { mode: 'pad', fan: FAN_TR }, { mode: 'keys', keys: ['alt', 'q'], fan: FAN_TR },
      { mode: 'mouse', from: 'hover', fan: FAN_TR }, { mode: 'mouse', from: 'menu', fan: { ...FAN_TR, corner: 'bl', hub: HUB.bl } },
    ];
    for (const how of ways) {
      wheel.show(null, how);
      tick(1);
      cursor = how.fan ? how.fan.hub : { x: 960, y: 520 }; // resting where it opened
      tick(2000);
      if (wheel.isOpen()) await wheel.close();
      await flush();
      tick(100);
    }
    assert.deepEqual(chosen, []);
    assert.deepEqual(talked, []);
    // Nothing the page could take as pointed: the fan opens with nothing highlighted (wheel.html: sel -1).
  });

  await test('the fan: its window in the orb\'s corner, click-through except where the page says, the hub and corner sent', async () => {
    wheel.show(null, { mode: 'keys', keys: ['alt', 'q'], fan: FAN_TR });
    const w = win();
    const L = Fan.layout(ITEMS.length, 'tr', 1);
    const want = Fan.windowFor(HUB.tr, L, AREA);
    assert.deepEqual(w.getBounds(), { x: want.x, y: want.y, width: want.width, height: want.height });
    assert.ok(w.getBounds().x > 960); // the right side, not the middle
    assert.deepEqual(lastOpen().fan.hub, want.hub);
    assert.equal(lastOpen().fan.corner, 'tr');
    assert.equal(w.ignore[w.ignore.length - 1], true);
    // The page reports its items; the mouse over one is let in, and the page hears which.
    const it = L.items[3];
    handlers['wheel-hits']({ sender: w.webContents }, [{ id: 'item', i: 3, x: want.hub.x + it.x - 27, y: want.hub.y + it.y - 27, w: 54, h: 54 }]);
    cursor = { x: HUB.tr.x + it.x, y: HUB.tr.y + it.y };
    tick(40);
    assert.equal(w.ignore[w.ignore.length - 1], false);
    assert.ok(w.sent.some(([c, p]) => c === 'wheel-input' && p.type === 'hover' && p.i === 3));
    assert.deepEqual(chosen, []); // pointing isn't picking
    // Picking is the page's explicit choice.
    handlers['wheel-choose']({ sender: w.webContents }, 'help');
    assert.deepEqual(chosen, ['help']);
    chosen.length = 0;
    await wheel.close();
    await flush();
    assert.equal(w.destroyed, true); // closed for good; a fresh one waits
    tick(60);
    assert.ok(win() && win() !== w && !win().visible);
  });

  await test('opened by the mouse: never focused, Esc closes it, and it goes once the mouse leaves the fan', async () => {
    taken.length = 0;
    cursor = HUB.tr;
    wheel.show(null, { mode: 'mouse', from: 'hover', fan: FAN_TR });
    const w = win();
    assert.equal(w.visible, true);
    assert.equal(w.focused, false);
    assert.equal(w.focusable, false);
    assert.deepEqual(taken, []);
    assert.equal(wheel.fanMode(), 'mouse');
    assert.ok(shortcuts.has('Escape'));
    // Moving through the fan (between items) keeps it.
    cursor = { x: HUB.tr.x - 150, y: HUB.tr.y + 150 };
    tick(2000);
    assert.equal(wheel.isOpen(), true);
    // Away from it: gone after a moment, nothing picked.
    cursor = { x: 600, y: 700 };
    tick(400);
    assert.equal(wheel.isOpen(), true);
    tick(400);
    assert.equal(wheel.isOpen(), false);
    assert.equal(shortcuts.has('Escape'), false);
    assert.deepEqual(chosen, []);
    // Esc.
    cursor = HUB.tr;
    wheel.show(null, { mode: 'mouse', from: 'hover', fan: FAN_TR });
    shortcuts.get('Escape')();
    assert.equal(wheel.isOpen(), false);
    assert.deepEqual(chosen, []);
    await flush();
  });

  await test('opened from the orb\'s menu: the mouse has a moment to reach the fan first', () => {
    cursor = { x: 600, y: 700 };
    wheel.show(null, { mode: 'mouse', from: 'menu', fan: FAN_TR });
    tick(1200);
    assert.equal(wheel.isOpen(), true);
    tick(1200);
    assert.equal(wheel.isOpen(), false);
    assert.deepEqual(chosen, []);
  });

  await test('the orb off (no fan): the full ring in the middle, focused, as before', async () => {
    wheel.show(null, { mode: 'pad' });
    tick(1);
    const w = win();
    assert.deepEqual(w.getBounds(), { x: (1920 - 560) / 2, y: (1040 - 560) / 2, width: 560, height: 560 });
    assert.equal(w.focused, true);
    assert.equal(lastOpen().fan, null);
    assert.equal(w.ignore[w.ignore.length - 1], false);
    await wheel.close();
    await flush();
    assert.equal(w.destroyed, false); // its window is kept, as before
    assert.deepEqual(chosen, []);
  });

  // ---- The orb: resting the mouse on it opens the fan (and nothing else) -------------------------------------------------
  const { createAnswerCard } = require('../electron/answerCard.cjs');
  const orbAsked = [], cardActions = [];
  const card = createAnswerCard({
    display: () => ({ workArea: AREA }),
    strings: () => ({}),
    onAction: (what) => cardActions.push(what),
    onSpeak: () => {}, onSpeakPref: () => {},
    onOrb: (what) => orbAsked.push(what),
  });
  const cwin = () => wins.filter((w) => !w.destroyed && w.b.width === 520).pop();
  const fromCard = (name, payload) => handlers[name]({ sender: cwin().webContents }, payload);

  await test('the mouse resting on the orb for about half a second opens the fan once; passing over it does not', () => {
    card.setPrefs({ size: 'm', corner: 'tr', speak: true });
    card.setAway(true);
    tick(1);
    const b = cwin().getBounds();
    fromCard('orb-hits', [{ id: 'orb', x: 520 - 104 + 20, y: 20, w: 64, h: 64 }]);
    const on = { x: b.x + 520 - 52, y: b.y + 52 };
    // Passing over: 3 watch ticks.
    cursor = on; tick(120);
    cursor = { x: 10, y: 900 }; tick(80);
    assert.deepEqual(orbAsked, []);
    // Resting.
    cursor = on; tick(400);
    assert.deepEqual(orbAsked, []);
    tick(200);
    assert.deepEqual(orbAsked, ['fan']);
    tick(3000); // still resting: not again
    assert.deepEqual(orbAsked, ['fan']);
    assert.deepEqual(cardActions, []); // nothing asked of the app
    assert.equal(card.isShowing(), false);
    // Leave and come back: once more.
    cursor = { x: 10, y: 900 }; tick(80);
    cursor = on; tick(600);
    assert.deepEqual(orbAsked, ['fan', 'fan']);
    cursor = { x: 10, y: 900 }; tick(80);
  });

  await test('the fan\'s hub: the orb\'s centre in its corner; with a card out, the card\'s inner corner', () => {
    const a = card.fanAnchor();
    assert.deepEqual(a.hub, HUB.tr);
    assert.equal(a.corner, 'tr');
    assert.equal(a.dot, false);
    card.setFan(true);
    assert.ok(cwin().sent.some(([c, p]) => c === 'orb-fan' && p === true));
    card.setFan(false);
    // A card out (the page reports where it is): the fan comes from its bottom-left corner, with its own hub.
    card.answer({ id: 'a1', title: 'T', text: 'Pull the lever.', steps: [] });
    fromCard('orb-hits', [{ id: 'card', x: 0, y: 0, w: 520, h: 300 }]);
    const c = card.fanAnchor();
    const b = cwin().getBounds();
    assert.deepEqual(c.hub, { x: b.x - 10, y: b.y + 310 });
    assert.equal(c.dot, true);
    card.hide();
    tick(600);
    // Bottom-left.
    card.setPrefs({ size: 'm', corner: 'bl', speak: true });
    assert.deepEqual(card.fanAnchor().hub, HUB.bl);
    // The panel in: no fan.
    card.setAway(false);
    assert.equal(card.fanAnchor(), null);
  });

  mock.timers.reset();
  Module._load = realLoad;
  console.log(`\n${passed} tests passed`);
  process.exit(process.exitCode || 0);
})();
