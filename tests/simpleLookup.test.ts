import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimpleLookup } from '../src/utils/simpleLookup';

test('single-fact lookups are recognised, in the test set\'s wordings and languages', () => {
  for (const q of [
    'How much Strength do I need for the Greatsword?', 'Where can I buy a Lantern?', 'What does the Shabriri Grape do?',
    'Where do I get the Everburn Blade?', 'What Smithing level do I need for Daedric Smithing?', 'Where is the Ebony Blade?',
    'How much does the Lumafly Lantern cost?', '¿Dónde consigo la Campanilla de invocación de espíritus?', 'Wo finde ich Meridias Leuchtfeuer?',
  ]) assert.ok(isSimpleLookup(q), q);
});

test('questions that need judgement, several steps or a screenshot are not lookups', () => {
  for (const q of [
    'What should I do next?', 'How do I beat Margit?', 'Which weapon is best for a Samurai?', 'How do I get into the City of Tears?',
    'What do I need to do to get the Temperance ending?', 'Should I side with the tieflings or the goblins?', 'Where do I go after beating Godrick?',
    'Is there anything I can miss for good in Act 1?', 'How do I find the Legendary Bear in chapter 2 and what do I get for it?',
  ]) assert.ok(!isSimpleLookup(q), q);
  assert.ok(!isSimpleLookup('Where is this?', true));
});
