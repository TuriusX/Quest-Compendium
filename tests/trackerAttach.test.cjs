// Run: npm run test:sync   (or: node tests/trackerAttach.test.cjs)
// The attached quest log (electron/tracker.cjs) against fake Electron windows: where it goes for each dock and screen,
// hiding with the panel, the compact height limit, popping out, and who starts attached.
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
    onLogVisible: (visible, available) => { env.keys = { visible, available }; },
  });
  const data = { id: 'a', quest: 'Find the seed', sections: [{ id: 'answer', title: 'x', items: [{ id: 's:1:0', label: 'Go north', tick: true }] }] };
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
  await test('a new install starts attached, left of a panel docked right, top-aligned', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    assert.deepEqual(win.getBounds(), { x: 1070, y: 0, width: 300, height: 400 });
    assert.equal(win.opacity, 1);
    assert.ok(win.js.some((c) => c.includes('"side":"left"') || c.includes('"attached":true')));
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
    assert.equal(tracker.isLogVisible(), false, 'tick shortcuts off while hidden');
    env.panel = { x: 0, y: 0, width: 550, height: 800 }; tracker.panelShown();
    assert.equal(win.opacity, 1);
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

  await test('tucked in: a bookmark on the panel edge near its top; dragging does nothing; the cycle key brings it out', async () => {
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
    assert.deepEqual(env.keys, { visible: false, available: true }, 'the cycle key stays registered');
    assert.deepEqual(tracker.getEdgeBounds(), win.getBounds(), 'the tuck tab keeps clear of it');
    assert.equal(tracker.getBounds(), null, 'the spine does not step around an attached log');
    assert.equal(await handlers['tracker-key'](null, 'next'), true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(tracker.isLogVisible(), true, 'out again');
    tracker.hide();
  });

  await test('the panel tucked away: the log (or its bookmark) moves to the book spine', async () => {
    const { tracker, win, env } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    env.panel = null; tracker.panelHidden();
    assert.equal(win.opacity, 0, 'nothing to stick to while the panel slides away');
    env.spine = { rect: { x: 1894, y: 344, width: 26, height: 112 }, right: true };
    tracker.anchorChanged();
    assert.equal(win.opacity, 1);
    assert.deepEqual([win.getBounds().x, win.getBounds().y], [1594, 344], 'on the inner side of the spine, level with its top');
    assert.equal(tracker.isLogVisible(), true);
    assert.ok(win.js.some((c) => c.includes('"maxHeight":728')), '70% of the screen beside the spine');
    tracker.hide();
  });

  await test('an existing player keeps popped out with the offer; popping out and attaching are remembered', async () => {
    const { tracker, win, env, handlers, dir } = await setup({ existing: true });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    assert.ok(win.js.some((c) => c.includes('"attached":false') && c.includes('"attachOffer":true')));
    assert.ok(env.told.some((p) => p.type === 'visibility' && p.attached === false));
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'attach', on: true });
    assert.equal(win.getBounds().x, 1070);
    await new Promise((r) => setTimeout(r, 450)); // the store saves after 400 ms
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tracker.json'), 'utf8'));
    assert.equal(saved.g1.attach, true);
    assert.equal(saved._meta.offer, false);
    handlers['tracker-msg']({ sender: win.webContents }, { type: 'attach', on: false });
    env.panel = null; tracker.panelHidden();
    assert.equal(win.opacity, 1, 'popped out: stays over the game');
    tracker.hide();
  });

  await test('the controller keys: focus, move both ways, tick only while the log shows', async () => {
    const { tracker, win, env, handlers } = await setup({ existing: false });
    env.panel = { x: 1370, y: 0, width: 550, height: 800 };
    tracker.panelShown();
    for (const k of ['focus', 'next', 'prev', 'tick', 'blur']) assert.equal(await handlers['tracker-key'](null, k), true, k);
    assert.equal(await handlers['tracker-key'](null, 'nonsense'), false);
    env.panel = null; tracker.panelHidden();
    assert.equal(await handlers['tracker-key'](null, 'tick'), false, 'hidden with the panel');
    tracker.hide();
  });

  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
