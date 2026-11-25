import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsMedium } from '../src/utils/answerEffort';

test('most questions get the light answer, with or without a screenshot', () => {
  for (const q of [
    'how do i get the nagakiba', 'should i take the ritual dagger of shar', 'What is the best heavy armor?', 'Satori',
    'How do I beat Margit?', 'Should I side with the tieflings or the goblins?', 'Who is this and can I trust him?',
    'What is this thing chasing me and can I beat it?', "What is this monster and what's it weak to?", 'How do I deal with these guys?',
    'Is there anything I can miss for good in Act 1?', 'wo kriege ich den kreuzschlüssel', 'Okay, but doesn\'t Zhalk have a nice sword I can get?',
    'What is this place and should I go in now?', 'How do I beat this boss?',
  ]) {
    assert.equal(needsMedium(q), null, q);
    assert.equal(needsMedium(q, { hasImage: true }), null, `${q} (with a screenshot)`);
  }
});

test('what next, puzzles, builds, screen details, long questions and voice get the medium answer', () => {
  assert.equal(needsMedium('What should I do next?'), 'what-next');
  assert.equal(needsMedium('Was soll ich als Nächstes tun?'), 'what-next');
  assert.equal(needsMedium('anything', { quick: 'next' }), 'what-next');
  assert.equal(needsMedium('How do I solve the statue puzzle?'), 'puzzle');
  assert.equal(needsMedium('anything', { quick: 'stuck' }), 'puzzle');
  assert.equal(needsMedium('I am starting an evil dark urge honor mode playthrough. Help me build a character'), 'build');
  assert.equal(needsMedium('Which subclass should I pick for Shadowheart?'), 'build');
  assert.equal(needsMedium('Which of my charms should I equip for boss fights?', { hasImage: true }), 'screen');
  assert.equal(needsMedium('Where am I on the map?', { hasImage: true }), 'screen');
  assert.equal(needsMedium('Is there a trader here? Show me where', { hasImage: true }), 'screen');
  assert.equal(needsMedium('Help me here', { quick: 'here', hasImage: true }), 'screen');
  assert.equal(needsMedium('x'.repeat(3) + ' word'.repeat(40)), 'long');
  assert.equal(needsMedium('', { voice: true }), 'voice');
  assert.equal(needsMedium('Please look at this picture', { standIn: true, hasImage: true }), 'screenshot-only');
});

test('a map or menu word without a screenshot is just a question', () => {
  assert.equal(needsMedium('Where is the map of Limgrave?'), null);
});
