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

test('questions about one named thing go light too (Nov 24 2026), with or without a screenshot', () => {
  for (const q of [
    'how do i get the nagakiba', "How do I get Eleonora's Poleblade?", 'should i take the ritual dagger of shar',
    'Should I take the Blood of Lathander?', 'What is the best heavy armor?', 'What is the best strength longbow?',
    'wo kriege ich den kreuzschlüssel', 'Satori', 'Barcus rucksack', 'Evelyn Andrews antiques', 'Who is Withers?',
    'What is the Shadow Curse?', '¿Cómo consigo la Espada Maestra?', 'Como eu consigo a Chave Enferrujada?',
  ]) {
    assert.ok(isSimpleLookup(q), q);
    assert.ok(isSimpleLookup(q, true), `${q} (with a screenshot)`);
  }
});

test('questions that need judgement, several steps, the screen or the conversation stay medium', () => {
  for (const q of [
    'What should I do next?', 'How do I beat Margit?', 'Which weapon is best for a Samurai?', 'How do I get into the City of Tears?',
    'What do I need to do to get the Temperance ending?', 'Should I side with the tieflings or the goblins?', 'Where do I go after beating Godrick?',
    'Is there anything I can miss for good in Act 1?', 'How do I find the Legendary Bear in chapter 2 and what do I get for it?',
    // About the screen (medium read menus and maps clearly better in the Nov 24 2026 screenshot test)
    'Where is this?', 'What is this thing chasing me and can I beat it?', 'Which of my charms should I equip for boss fights?',
    'Where am I on the map and where should I go next?', 'Who is this and what do I do here?', 'Please look at this picture',
    // Follow-ups and choices
    'should i take it', 'Should I kill Ketheric?', 'Should I take the dagger or the mace?', 'What is the best build for a paladin?',
    'how do i get to the guy with the big armor and dragon tooth as a weapon?', 'Should I trust Astarion?',
    // Chat, not a name
    'thanks', 'hello there', 'ok', 'Can you help me', 'nere', 'donde', 'ayuda',
  ]) {
    assert.ok(!isSimpleLookup(q), q);
    assert.ok(!isSimpleLookup(q, true), `${q} (with a screenshot)`);
  }
});
