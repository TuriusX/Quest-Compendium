// Run: npm run test:sync   (or: node tests/trackerAttach.test.cjs)
// The attached quest log (electron/tracker.cjs) against fake Electron windows: where it goes for each dock and screen,
// hiding with the panel, the compact height limit, popping out, and who starts attached. Since the quest log redesign
// (Oct 30 2026), docked and out it's the column inside the panel (src/components/QuestLog.tsx): this window is then
// invisible and shows only as the bookmark, the popped-out log, or a heads-up beside the spine.
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wins = [];
class FakeWin {
  constructor(o) {
    this.b = { x: o.x, y: o.y, width: o.width, height: o.height };
    this.visible = false; this.opacity = 1; this.destroyed = false; this.handlers = {}; this.js = [];
    const self = this;
    this.webContents = {
      executeJavaScript: (code) => { self.js.push(code); return Promise.resolve(); },
      once: (ev, cb) => { if (ev === 'did-finish-load') setTimeout(cb, 0); },
      on: () => {},
    };
    wins.push(this);
  }
  setAlwaysOnTop() {} setContentProtection() {} setIgnoreMouseEvents() {} moveTop() {} loadFile() {}
  on(ev, cb) { this.handlers[ev] = cb; } once(ev, cb) { this.handlers[ev] = cb; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  isVisible() { return this.visible; } showInactive() { this.visible = true; }
  setOpacity(v) { this.opacity = v; }
  getBounds() { return { ...this.b }; }
  setBounds(b) { this.b = { ...this.b, ...b }; }
  setPosition(x, y) { this.b.x = x; this.b.y = y; }
}
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: FakeWin };
  return realLoad.call(this, req, ...rest);
};

// Two screens side by side: 1920x1080 on the left (the primary), 2560x1440 on the right.
const SCREENS = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];
const screenOf = (r) => (r.x >= 1920 ? SCREENS[1] : SCREENS[0]);

async function setup({ existing }) {
  delete require.cache[require.resolve('../electron/tracker.cjs')];
  const tracker = require('../electron/tracker.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-trk-'));
  if (existing) fs.writeFileSync(path.join(dir, 'tracker.json'), JSON.stringify({ old: { x: 100, y: 100, shown: true } }));
  const handlers = {};
  const env = { panel: null, dock: 'top-right', compact: false, told: [], spine: null, keys: null };
  tracker.init({
    app: { getPath: () => dir, on: () => {} },
    ipcMain: { on: (n, f) => { handlers[n] = f; }, handle: (n, f) => { handlers[n] = f; } },
    screen: { getDisplayMatching: screenOf, getDisplayNearestPoint: () => SCREENS[0], getCursorScreenPoint: () => ({ x: 10, y: 10 }) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (c, p) => env.told.push(p) } }),
    getPanelRect: () => env.panel,
    getDock: () => env.dock,
    isCompact: () => env.compact,
    getSpineAnchor: () => env.spine,
    onOpenPanel: () => env.onOpenPanel && env.onOpenPanel(),
    onLogVisible: (visible, available) => { env.keys = { visible, available }; },
  });
  const data = { id: 'a', quest: 'Find the seed', sections: [{ id: 'answer', title: 'x', items: [{ id: 's:1:0', label: 'Go north', tick: true }] }],
    log: { now: { id: 's:1:0', text: 'Go north', tick: true, source: 'question', goal: 'Find the seed', doneCount: 0, total: 2 }, next: [{ id: 's:1:1', text: 'Dig', tick: true }], bookmark: 2 } };
  await tracker.show(data, 'g1');
  const win = wins[wins.length - 1];
  // The page reports its size (300 x 400): the window shows.
  handlers['tracker-msg']({ sender: win.webContents }, { type: 'size', width: 300, height: 400, view: 'full', hasData: true });
  await new Promise((r) => setTimeout(r, 5));
  return { tracker, win, env, handlers, dir };
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '   -> ' + String(e.message).split('\n')[0]); process.exitCode = 1; }
}

(async () => {
  await test('docked by default: out, it is the column inside the panel, so this window is invisible beside it', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.deepEqual(win.getBounds(), { x: 1070, y: 0, width: 300, height: 400 }, 'still kept beside the panel (for the bookmark)');
    assert.equal(win.opacity, 0, 'the panel shows the log');
    assert.ok(env.told.some((p) => p.type === 'visibility' && p.visible === true && p.attached === true), 'the app is told to show its column');
    assert.ok(win.js.some((c) => c.includes('"attached":true')));
    tracker.hide();
  });

  await test('existing players docked too (no offer); a game popped out keeps its choice', async () => {
    const { tracker, win, env, handlers, dir } = await setup({ existing: true });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.ok(win.js.some((c) => c.includes('"attached":true') && c.includes('"attachOffer":false')));
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'attach', on: false });
    await new Promise((r) => setTimeout(r, 450)); // the store saves after 400 ms
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tracker.json'), 'utf8')).g1.attach, false);
    assert.equal(win.opacity, 1, 'popped out: its own window over the game');
    tracker.hide();
  });

  await test('docked left: on the panel\'s right; the panel hiding hides it, showing brings it back', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.dock = 'top-left'; env.panel = { x: 0, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.equal(win.getBounds().x, 550);
    env.panel = null; tracker.panelHidden();
    assert.equal(win.opacity, 0, 'invisible with the panel away');
    assert.equal(tracker.getBounds(), null, 'not an obstacle for the markers while invisible');
    assert.equal(env.keys.visible, true, 'the tick / next keys stay on while there is a log (a tick out of sight gets a heads-up)');
    env.panel = { x: 0, y: 0, width: 550, height: 800 }; tracker.panelShown();
    assert.equal(win.opacity, 0, 'out: the column inside the panel');
    // Tucked in: the bookmark on the panel's edge.
    assert.equal(await tracker.toggle(null), 'away');
    assert.equal(win.opacity, 1, 'the bookmark');
    tracker.hide();
  });

  await test('undocked on the second screen: the side with more room, kept on that screen', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.dock = 'undocked'; env.panel = { x: 2500, y: 100, width: 550, height: 800 };
    tracker.follow();
    assert.deepEqual([win.getBounds().x, win.getBounds().y], [3050, 100], 'more room on the right');
    env.panel = { x: 3900, y: 1300, width: 550, height: 800 }; // dragged to the far right and low
    tracker.follow();
    const b = win.getBounds();
    assert.equal(b.x, 3600, 'left of the panel');
    assert.equal(b.y, 1000, 'kept on the screen (1400 - 400)');
    assert.equal(b.width, 300, 'the reported size, not one rescaled by the move');
    tracker.hide();
  });

  await test('the height limit: the panel\'s height, or 70% of its screen in the compact view', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.ok(win.js.some((c) => c.includes('"maxHeight":800')));
    env.compact = true; env.panel = { x: 1370, y: 0, width: 550, height: 176 };
    tracker.follow();
    assert.ok(win.js.some((c) => c.includes('"maxHeight":728')), '0.7 x 1040');
    tracker.hide();
  });

  await test('tucked in: a bookmark on the panel edge near its top; dragging does nothing; the quest log shortcut brings it out', async () => {
    const { tracker, win, env, handlers } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'drag', dx: 50, dy: 50 });
    assert.equal(win.getBounds().x, 1070);
    assert.equal(await tracker.toggle(null), 'away');
    // The page reports the bookmark's size.
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'size', width: 72, height: 40, view: 'away', hasData: true });
    assert.deepEqual(win.getBounds(), { x: 1298, y: 8, width: 72, height: 40 }, 'flush with the panel, 8 px down');
    assert.equal(win.opacity, 1, 'the bookmark shows');
    assert.ok(win.js.some((c) => c.includes('"edge":"right"')), 'anchored on the side facing the panel');
    assert.equal(tracker.getBounds(), null, 'the spine does not step around an attached log');
    assert.equal(await handlers['tracker-key'](null, 'next'), true, 'next goes to the app (it moves the pick, or shows it as a heads-up)');
    assert.ok(env.told.some((p) => p.type === 'log-key' && p.action === 'next' && p.onScreen === false), 'tucked in: not on screen');
    assert.equal(tracker.isLogVisible(), false, 'next does not bring the log back');
    assert.equal(await tracker.toggle(null), 'shown', 'the quest log shortcut (and the bookmark, the menu) brings it out');
    assert.equal(tracker.isLogVisible(), true, 'out again');
    // The panel's keyboard stop and the controller reach the bookmark.
    await tracker.toggle(null);
    assert.ok(env.told.some((p) => p.type === 'visibility' && p.tucked === true), 'the panel is told it is tucked in (its keyboard stop shows)');
    assert.equal(await handlers['tracker-key'](null, 'bookmark-focus'), true);
    assert.ok(win.js.some((c) => c.includes('"bmFocus":true')), 'a ring on the bookmark');
    assert.equal(await handlers['tracker-key'](null, 'focus'), true, 'RB from Ask reaches a tucked-in log');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(tracker.isLogVisible(), true, 'slid out for the controller');
    assert.ok(win.js.some((c) => c.includes("qcTrackerKey('focus')")), 'and the controller is in it');
    tracker.hide();
  });

  await test('the panel tucked away: the docked log goes with it; the shortcut opens the panel with it; a heads-up by the book', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    let opened = 0;
    env.onOpenPanel = () => { opened++; };
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    env.panel = null; tracker.panelHidden();
    assert.equal(win.opacity, 0, 'nothing to stick to while the panel slides away');
    env.spine = { rect: { x: 1894, y: 344, width: 26, height: 112 }, right: true };
    tracker.anchorChanged();
    assert.equal(win.opacity, 0, 'docked: the log is in the panel, nothing beside the book');
    // Tucked in (with the panel open), then the panel away: the count on the book (steps left on Now's goal).
    env.spine = null; env.panel = { x: 1370, y: 0, width: 550, height: 800 }; tracker.panelShown();
    assert.equal(await tracker.toggle(null), 'away');
    env.panel = null; tracker.panelHidden();
    env.spine = { rect: { x: 1894, y: 344, width: 26, height: 112 }, right: true }; tracker.anchorChanged();
    assert.equal(win.opacity, 0, 'no bookmark beside the book');
    assert.equal(tracker.badgeCount(), 2, "the log's number for the book");
    // A tick with the log out of sight: the new Now beside the spine for a few seconds.
    assert.equal(tracker.heads('Dig'), true);
    assert.equal(win.opacity, 1);
    assert.deepEqual([win.getBounds().x, win.getBounds().y], [1594, 344], 'on the inner side of the spine, level with its top');
    assert.ok(win.js.some((c) => c.includes('qcTrackerHeads("Dig"')));
    // The quest log shortcut: the panel opens with the log out.
    assert.equal(await tracker.toggle(null), 'shown');
    assert.equal(opened, 1, 'the panel opens');
    assert.equal(tracker.badgeCount(), 0);
    // Tucked in again, then the panel opens: the bookmark is back on the panel's edge and the book's badge goes.
    await tracker.toggle(null);
    env.spine = null; env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.equal(win.opacity, 1, 'the bookmark on the open panel');
    assert.equal(tracker.badgeCount(), 0);
    tracker.hide();
  });

  await test('pop out and put back (from the app or the window); popped out it stays over the game', async () => {
    const { tracker, win, env, handlers, dir } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.equal(await handlers['tracker-attach'](null, false), true, "the docked log's ⇱");
    assert.equal(win.opacity, 1);
    env.panel = null; tracker.panelHidden();
    assert.equal(win.opacity, 1, 'popped out: stays over the game');
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'attach', on: true }); // its ⤓
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tracker.json'), 'utf8')).g1.attach, true);
    assert.ok(env.told.some((p) => p.type === 'visibility' && p.attached === true && p.visible === true), 'back in the overlay, out');
    tracker.hide();
  });

  await test('the tick and next keys go to the app, which owns the log, with or without it on screen', async () => {
    const { tracker, win, env, handlers } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    for (const k of ['next', 'prev', 'tick']) assert.equal(await handlers['tracker-key'](null, k), true, k);
    assert.ok(env.told.some((p) => p.type === 'log-key' && p.action === 'tick' && p.onScreen === true), 'docked with the panel open: on screen');
    assert.equal(await handlers['tracker-key'](null, 'nonsense'), false);
    env.panel = null; tracker.panelHidden();
    env.told.length = 0;
    assert.equal(await handlers['tracker-key'](null, 'tick'), true, 'still ticks with the panel away');
    assert.ok(env.told.some((p) => p.type === 'log-key' && p.onScreen === false), 'out of sight: the app sends a heads-up');
    tracker.hide();
  });

  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
