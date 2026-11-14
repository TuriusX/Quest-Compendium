// Run: node tests/gameScreen.test.cjs
// The screenshot (and markers) come from the screen showing the game, not the one under the mouse.
const assert = require('node:assert/strict');
const { pickCaptureDisplay } = require('../electron/gameScreen.cjs');

const left = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } };
const right = { id: 2, bounds: { x: 2560, y: 0, width: 1920, height: 1080 } };
const displays = [left, right];

// Game full screen on the right, mouse on the left (on the chat): the right screen.
assert.equal(pickCaptureDisplay(displays, { x: 2560, y: 0, width: 1920, height: 1080 }, left), right);
// A window straddling both: the screen with most of it.
assert.equal(pickCaptureDisplay(displays, { x: 2000, y: 100, width: 1600, height: 900 }, right), right);
assert.equal(pickCaptureDisplay(displays, { x: 1200, y: 100, width: 1600, height: 900 }, right), left);
// No game window, a tiny one (a launcher), or one off every screen: the mouse's screen.
assert.equal(pickCaptureDisplay(displays, null, right), right);
assert.equal(pickCaptureDisplay(displays, { x: 10, y: 10, width: 120, height: 80 }, right), right);
assert.equal(pickCaptureDisplay(displays, { x: -5000, y: -5000, width: 800, height: 600 }, right), right);

console.log('gameScreen: all passed');
