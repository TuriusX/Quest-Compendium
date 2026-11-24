// Run: npm run test:sync   (or: node tests/orbState.test.cjs)
// The orb (owner, Nov 19 2026): its state (electron/orbState.cjs), and the pop-up card's window driving it
// (electron/answerCard.cjs) against fake Electron windows: shown only while the panel is away, cards growing out of it
// and folding back, the dot for a card whose time ran out, a left click bringing the last card back without reading it
// aloud (or the how-to-ask line), the menu, Hide until next answer, and the setting off bringing the old card back.
const assert = require('node:assert/strict');
const Module = require('module');
const { mock } = require('node:test');
const { createOrbState, reduce, look, clickAction, orbGeometry } = require('../electron/orbState.cjs');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '   -> ' + String(e && e.message).split('\n')[0]); process.exitCode = 1; }
}
const run = (s, ...evs) => evs.reduce(reduce, s);

(async () => {
  // ---- The state ----------------------------------------------------------------------------------------------------
  await test('the orb shows only while it is on and the panel is away', () => {
    const s = createOrbState();
    assert.equal(look(s).orb, false); // the panel starts open
    assert.equal(look(run(s, { type: 'away', away: true })).orb, true);
    assert.equal(look(run(s, { type: 'away', away: true }, { type: 'pref', on: false })).orb, false);
    assert.equal(look(run(s, { type: 'away', away: true }, { type: 'away', away: false })).window, false);
  });

  await test('a card is the orb opened: it shows, then folds back into the orb', () => {
    let s = run(createOrbState(), { type: 'away', away: true }, { type: 'show', kind: 'thinking' });
    assert.deepEqual(look(s), { window: true, orb: false, card: true, dot: false, menu: false });
    s = run(s, { type: 'show', kind: 'answer' }, { type: 'fold', reason: 'close' });
    assert.deepEqual(look(s), { window: true, orb: true, card: false, dot: false, menu: false });
  });

  await test('no dot on the orb (owner, Nov 23 2026: "pointless"), however a card went back in', () => {
    const away = run(createOrbState(), { type: 'away', away: true });
    for (const reason of ['timer', 'close', 'other']) assert.equal(look(run(away, { type: 'show', kind: 'answer' }, { type: 'fold', reason })).dot, false);
  });

  await test('the menu opens only on a resting orb, and closes with a card, the panel or Hide', () => {
    const away = run(createOrbState(), { type: 'away', away: true });
    assert.equal(look(run(away, { type: 'menu', open: true })).menu, true);
    assert.equal(look(run(away, { type: 'menu', open: true }, { type: 'show', kind: 'answer' })).menu, false);
    assert.equal(look(run(away, { type: 'menu', open: true }, { type: 'away', away: false }, { type: 'away', away: true })).menu, false);
    assert.equal(look(run(away, { type: 'show', kind: 'answer' }, { type: 'menu', open: true })).menu, false);
    assert.equal(look(run(createOrbState(), { type: 'menu', open: true })).menu, false); // the panel is open
  });

  await test('Hide until next answer: gone, through panel visits, until a card comes', () => {
    let s = run(createOrbState(), { type: 'away', away: true }, { type: 'menu', open: true }, { type: 'hide' });
    assert.deepEqual(look(s), { window: false, orb: false, card: false, dot: false, menu: false });
    s = run(s, { type: 'away', away: false }, { type: 'away', away: true });
    assert.equal(look(s).orb, false);
    s = run(s, { type: 'show', kind: 'answer' }, { type: 'fold', reason: 'close' });
    assert.equal(look(s).orb, true);
    // A card that's out isn't hidden by it.
    assert.equal(look(run(createOrbState(), { type: 'away', away: true }, { type: 'show', kind: 'answer' }, { type: 'hide' })).card, true);
  });

  await test('the setting off: no orb, no dot, no menu; cards still show', () => {
    const s = run(createOrbState(), { type: 'away', away: true }, { type: 'show', kind: 'answer' }, { type: 'fold', reason: 'timer' }, { type: 'pref', on: false });
    assert.deepEqual(look(s), { window: false, orb: false, card: false, dot: false, menu: false });
    assert.equal(look(run(s, { type: 'show', kind: 'answer' })).card, true);
  });

  await test('a left click: the last card, or how to ask', () => {
    assert.equal(clickAction(true), 'recall');
    assert.equal(clickAction(false), 'hint');
  });

  await test('the orb scales with the card size and keeps its glow room', () => {
    const m = orbGeometry(1), l = orbGeometry(1.3);
    assert.ok(l.d > m.d && l.box > m.box);
    assert.equal(m.pad * 2 + m.d, m.box);
    assert.ok(m.pad >= 12);
    // Medium (owner, Nov 19 2026): a 40 px sphere, 13 px from the screen's edges (the window sits on the corner).
    assert.equal(m.d, 40);
    assert.equal(m.pad, 13);
  });

  // ---- The card's window --------------------------------------------------------------------------------------------
  const wins = [];
  const handlers = {};
  let cursor = { x: 0, y: 0 };
  class FakeWin {
    constructor(o) {
      this.b = { x: 0, y: 0, width: o.width, height: o.height };
      this.visible = false; this.destroyed = false; this.sent = []; this.ignore = []; this.events = {};
      const self = this;
      this.webContents = {
        send: (c, p) => self.sent.push([c, p]),
        once: (ev, cb) => { if (ev === 'did-finish-load') setTimeout(cb, 0); },
        invalidate: () => {},
        on: () => {},
      };
      wins.push(this);
    }
    setAlwaysOnTop() {} setContentProtection() {} loadFile() {}
    setIgnoreMouseEvents(on, o) { this.ignore.push([on, !!(o && o.forward)]); }
    on(ev, cb) { this.events[ev] = cb; }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
    isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; }
    getBounds() { return { ...this.b }; } setBounds(b) { this.b = { ...b }; }
  }
  const realLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { BrowserWindow: FakeWin, ipcMain: { on: (n, f) => { handlers[n] = f; } }, screen: { getCursorScreenPoint: () => cursor } };
    return realLoad.call(this, req, ...rest);
  };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { createAnswerCard } = require('../electron/answerCard.cjs');
  const spoken = [], orbAsked = [], actions = [];
  const card = createAnswerCard({
    display: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    strings: () => ({}),
    onAction: (what) => actions.push(what),
    onSpeak: (s) => spoken.push(s),
    onSpeakPref: () => {},
    onOrb: (what) => orbAsked.push(what),
  });
  const tick = (ms) => mock.timers.tick(ms);
  const win = () => wins[wins.length - 1];
  const lastOrb = () => [...win().sent].reverse().find(([c]) => c === 'orb-state')[1];
  const fromPage = (name, payload) => handlers[name]({ sender: win().webContents }, payload);
  const ANSWER = { id: 'a1', title: 'The lift', text: 'Pull the lever by the door.', summary: 'Pull the lever by the door, then ride up.', steps: [] };

  await test('the panel away: the window shows the orb in the card corner, at the card\'s full room', () => {
    card.setPrefs({ size: 'm', corner: 'tr', speak: true });
    card.setAway(true);
    tick(1);
    assert.equal(win().visible, true);
    assert.deepEqual(win().getBounds(), { x: 1920 - 520 - 24, y: 0, width: 520 + 24, height: 1040 - 48 + 24 }); // nearly the screen's height: More grows the card down (Nov 23 2026)
    assert.equal(lastOrb().orb, true);
    // Click-through without forwarding: the watch lets the mouse in.
    assert.deepEqual(win().ignore[win().ignore.length - 1], [true, false]);
    assert.deepEqual(card.anchor().rect, { x: 1920 - 66, y: 0, width: 66, height: 66 });
  });

  await test('the mouse gets in only over a part the page reported', () => {
    fromPage('orb-hits', [{ id: 'orb', x: 544 - 66 + 11, y: 11, w: 44, h: 44 }]);
    const b = win().getBounds();
    cursor = { x: b.x + 10, y: b.y + 300 }; tick(40);
    assert.deepEqual(win().ignore[win().ignore.length - 1], [true, false]);
    cursor = { x: b.x + 544 - 33, y: b.y + 33 }; tick(40);
    assert.deepEqual(win().ignore[win().ignore.length - 1], [false, false]);
    assert.ok(win().sent.some(([c, p]) => c === 'orb-hover' && p === 'orb'));
    cursor = { x: 0, y: 0 }; tick(40);
  });

  await test('no answer yet: a left click opens the fan of the quick menu (owner, Nov 20 2026), no lingering hint card', () => {
    fromPage('orb-action', 'click');
    assert.equal(orbAsked[orbAsked.length - 1], 'fan-click');
    assert.equal(card.isShowing(), false);
    tick(7001);
    assert.equal(lastOrb().orb, true);
    assert.equal(lastOrb().dot, false);
    assert.equal(win().visible, true); // the orb stays
  });

  await test('an answer grows out of the orb and is read aloud; its time runs out: back in (no dot)', () => {
    spoken.length = 0;
    card.thinking({ question: 'Where now?', mode: 'keys' });
    card.answer(ANSWER);
    assert.equal(lastOrb().card, true);
    assert.equal(spoken.length, 1);
    tick(90001);
    assert.equal(card.isShowing(), false);
    assert.ok(win().sent.some(([c]) => c === 'card-hide'));
    assert.equal(lastOrb().dot, false);
    assert.equal(win().visible, true);
  });

  await test('a left click brings the last card back, not read aloud', () => {
    spoken.length = 0;
    fromPage('orb-action', 'click');
    const shown = [...win().sent].reverse().find(([c]) => c === 'card-show')[1];
    assert.equal(shown.state, 'answer');
    assert.equal(shown.id, 'a1');
    assert.equal(spoken.filter(Boolean).length, 0);
    assert.equal(lastOrb().dot, false);
    assert.equal(card.hasLast(), false); // it's on the card now
    fromPage('card-action', 'close');
    assert.equal(lastOrb().dot, false); // closed: no dot
    assert.equal(card.hasLast(), true); // still there for "Last card"
    assert.equal(card.recall(), true);
    card.hide();
  });

  await test('the menu: its items go to the app; Mute read-aloud flips the speaker setting; Hide until next answer', () => {
    fromPage('orb-action', 'menu');
    assert.equal(lastOrb().menu, true);
    fromPage('orb-action', 'ask');
    // (clicks and the menu opening tell the app a fan the mouse opened makes way: step 2, Nov 19 2026)
    assert.deepEqual(orbAsked.filter((w) => w !== 'busy' && w !== 'fan-click'), ['ask']);
    assert.deepEqual(orbAsked.slice(-2), ['busy', 'ask']);
    assert.equal(lastOrb().menu, false);
    fromPage('orb-action', 'mute'); // the menu is closed: nothing
    assert.equal(lastOrb().speak, true);
    fromPage('orb-action', 'menu');
    fromPage('orb-action', 'mute');
    assert.equal(lastOrb().speak, false);
    fromPage('orb-action', 'menu');
    fromPage('orb-action', 'hide');
    tick(600);
    assert.equal(win().visible, false);
    // The next answer brings it back.
    card.answer({ ...ANSWER, id: 'a2' });
    assert.equal(win().visible, true);
    assert.equal(spoken.filter(Boolean).length, 0); // muted
    card.hide();
    tick(600);
    assert.equal(lastOrb().orb, true);
    assert.equal(win().visible, true);
  });

  await test('the menu closes by itself once the mouse has left it', () => {
    fromPage('orb-action', 'menu');
    assert.equal(lastOrb().menu, true);
    cursor = { x: 0, y: 0 };
    tick(1500);
    assert.equal(lastOrb().menu, false);
  });

  await test('the panel comes in: the orb goes (its window closed); away again, it is back in a fresh one', () => {
    card.setAway(false);
    tick(1);
    assert.equal(win().visible, false);
    assert.equal(win().destroyed, true); // closed, not hidden: a window hidden and shown again loses button-downs
    assert.equal(card.anchor(), null);
    card.setAway(true);
    assert.equal(win().visible, true);
  });

  await test('the orb off: no orb, and the card is as before (its height, gone after its fade)', () => {
    card.setPrefs({ size: 'm', corner: 'tr', speak: true, orb: false });
    assert.equal(card.orbOn(), false);
    assert.equal(win().visible, false);
    card.answer({ ...ANSWER, id: 'a3' });
    fromPage('card-size', 300);
    assert.equal(win().getBounds().height, 302);
    // Its buttons: the mouse gets in over the card (hit-tested here, not by the page's mouseenter), and its time waits.
    fromPage('orb-hits', [{ id: 'card', x: 0, y: 0, w: 520, h: 300 }]);
    const b = win().getBounds();
    cursor = { x: b.x + 400, y: b.y + 20 }; tick(40);
    assert.deepEqual(win().ignore[win().ignore.length - 1], [false, false]);
    assert.ok(win().sent.some(([c, p]) => c === 'card-timer' && p.paused));
    cursor = { x: 0, y: 0 }; tick(40);
    assert.deepEqual(win().ignore[win().ignore.length - 1], [true, false]);
    card.hide();
    tick(300);
    assert.equal(win().visible, false);
    fromPage('orb-action', 'click'); // no orb, no click
    assert.equal(card.isShowing(), false);
  });

  await test('a video found after the card went: the card comes back with it, not read from the start again', () => {
    spoken.length = 0;
    card.answer({ ...ANSWER, id: 'v1' });
    assert.equal(spoken.filter(Boolean).length, 1);
    tick(90001);
    assert.equal(card.isShowing(), false);
    card.answer({ ...ANSWER, id: 'v1', picture: { url: 'https://i.ytimg.com/vi/abcdefgh/hqdefault.jpg', video: true, videoId: 'abcdefgh' } });
    const shown = [...win().sent].reverse().find(([c]) => c === 'card-show')[1];
    assert.equal(shown.picture.videoId, 'abcdefgh');
    assert.equal(spoken.filter(Boolean).length, 1);
    // Over a newer question's card it waits instead (the card keeps thinking).
    card.thinking({ question: 'And then?', mode: 'keys' });
    card.answer({ ...ANSWER, id: 'v1', picture: null });
    assert.equal(card.isThinking(), true);
    card.hide();
  });

  mock.timers.reset();
  Module._load = realLoad;
  console.log(`\n${passed} tests passed`);
  process.exit(process.exitCode || 0);
})();
