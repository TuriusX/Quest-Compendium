// Run: node tests/cardReading.test.cjs
// The pop-up card reads the answer itself aloud a part at a time (owner, Nov 23 2026: "read aloud until it feels like
// that's enough ... at a logical end like the end of a sentence or paragraph", and the player chooses to hear more):
// electron/answerCard.cjs spokenParts.
const assert = require('node:assert/strict');
const Module = require('module');
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: function () {}, ipcMain: { on() {} } };
  return realLoad.call(this, req, ...rest);
};
const { spokenParts } = require('../electron/answerCard.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '   -> ' + String(e && e.message).split('\n')[0]); process.exitCode = 1; }
}
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const sentence = (n, w = 12) => Array.from({ length: n }, (_, i) => `${Array.from({ length: w - 1 }, () => 'word').join(' ')} end${i}.`).join(' ');

test('a short answer is read whole, in one part', () => {
  const parts = spokenParts('Pull the **lever** by the door.\n\nThen ride the lift up.');
  assert.deepEqual(parts, ['Pull the lever by the door. Then ride the lift up.']);
});

test('markdown, links and list marks are not read out', () => {
  const [p] = spokenParts('## Getting there\n- Go [north](https://x.y/z) to the `gate`\n1. Open it');
  assert.equal(p, 'Getting there. Go north to the gate Open it');
});

test('a long answer stops where a paragraph ends, after enough has been said', () => {
  const text = [sentence(3), sentence(3), sentence(3), sentence(3)].join('\n\n'); // 36 words a paragraph
  const parts = spokenParts(text);
  assert.ok(parts.length >= 2, `parts: ${parts.length}`);
  for (const p of parts) assert.match(p, /\.$/);
  assert.equal(words(parts[0]), 72); // two whole paragraphs
});

test('one long paragraph is cut at the end of a sentence', () => {
  const parts = spokenParts(sentence(15)); // 180 words, one paragraph
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.match(p, /end\d+\.$/);
  assert.ok(words(parts[0]) >= 60 && words(parts[0]) <= 85, `first part ${words(parts[0])} words`);
});

test('a short last bit goes with the part before it', () => {
  const parts = spokenParts(`${sentence(6)}\n\nThat is all.`);
  assert.match(parts[parts.length - 1], /That is all\.$/);
  assert.ok(words(parts[parts.length - 1]) > 15);
});

test('nothing to read: no parts', () => {
  assert.deepEqual(spokenParts(''), []);
  assert.deepEqual(spokenParts('   \n\n '), []);
});

console.log(`\n${passed} tests passed`);
