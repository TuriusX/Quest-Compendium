import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksWhatNext } from '../src/utils/whatNext';

test('"what next" questions get the rule, in the test set\'s wordings and languages', () => {
  for (const q of [
    'I got Shadowheart on the ravaged beach. What do I do next?', 'Finally beat Margit. What now?', 'Ya maté a Vordt. ¿Qué hago ahora?',
    "It's day 10 of spring, what should I focus on?", 'Beat Gyoubu. Where do I go now?', 'I have full iron armor and a few diamonds. What now?',
    'Made it to Last Light Inn. What next?', 'Gave Farengar the Dragonstone. What now?', 'Done with that mission, what should I do next?',
    'Just got the Normandy and became a Spectre. What should I do first?', 'Okay I\'m inside the grove now. What should I do next?',
    'Was soll ich jetzt machen?', 'O que eu faço agora?', 'Et maintenant, où aller ?', '次は何をすればいい？',
  ]) assert.ok(asksWhatNext(q), q);
});

test('lookups, fights and puzzles go without it', () => {
  for (const q of ['Where is the Mantis Claw?', 'How do I beat Margit?', 'Which weapon is best for a Samurai?', 'How do I open the claw door?', 'Is the Eldritch Rune worth reading?'])
    assert.ok(!asksWhatNext(q), q);
});

test('the app\'s own "What next?" and "what\'s after?" quick questions always do', () => {
  assert.ok(asksWhatNext('', 'next'));
  assert.ok(asksWhatNext('', 'after'));
  assert.ok(!asksWhatNext('', 'fight'));
});
