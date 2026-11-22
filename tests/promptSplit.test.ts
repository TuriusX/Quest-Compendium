import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProRules, splitPerQuestion, PROMPT_PERSONA_END } from '../searchPolicy';

const m = (s: string) => `\u0001${s}\u0002`;
const plain = (x: string) => x.replace(/[\u0001\u0002]/g, '');
const base = (q: (s: string) => string) => `intro ${PROMPT_PERSONA_END}\n\n[STORY TIMING]\nold timing\n\n[QUEST TITLE]\nx` + q(`\n\n[NO SCREENSHOT WITH THIS QUESTION]\nold no-shot`) + `\n\n[USER LANGUAGE PREFERENCE]\nEnglish` + q(`\n\n[GUIDE NOTES]\nnotes for this place`) + `\n\nstable tail`;

test('split off: the prompt is exactly what it was without the marks', () => {
  for (const [search, shot, pro] of [[true, false, true], [false, true, false], [true, true, true]] as const) {
    const before = withProRules(base((s) => s), search, shot, pro);
    const after = splitPerQuestion(withProRules(base(m), search, shot, pro), false);
    assert.equal(after.system, before);
    assert.equal(after.perQuestion, '');
  }
});

test('split on: the marked parts leave the system prompt in order, the start is the same for every question', () => {
  const a = splitPerQuestion(withProRules(base(m), true, false, true, m), true);
  const b = splitPerQuestion(withProRules(base(m).replace('notes for this place', 'other notes'), false, true, true, m), true);
  assert.equal(a.system, b.system);
  assert.ok(!a.system.includes('notes for this place') && !a.system.includes('NO SCREENSHOT'));
  assert.ok(a.perQuestion.indexOf('NO SCREENSHOT') < a.perQuestion.indexOf('notes for this place'));
  assert.ok(a.perQuestion.includes('Always run Google Search'));
  assert.ok(!plain(a.system).includes('Always run Google Search'));
});
