// The Worth importance bar (owner, Nov 16 2026): common gear only with a real reason; every entry has its why; no
// sentence fragments as names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worthKeeping } from '../scripts/guides/worthIt';

test('common gear needs a quest, missable or upgrade reason', () => {
  assert.equal(worthKeeping('ITEM', ['ITEM', 'Longsword', 'Common', 'A versatile weapon', 'the helm', 'loot', 'REASON: standout']), false);
  assert.equal(worthKeeping('ITEM', ['ITEM', 'Githyanki Half Plate', 'Common', '15 AC, the best medium armour here', 'the deck', 'loot', 'REASON: upgrade']), true);
  assert.equal(worthKeeping('ITEM', ['ITEM', 'Everburn Blade', 'Uncommon', 'Extra fire damage', 'Zhalk', 'Command: Drop', 'REASON: standout']), true);
});

test('every entry needs its why, and a fragment is no name', () => {
  assert.equal(worthKeeping('ITEM', ['ITEM', 'Everburn Blade', 'Uncommon', '', 'Zhalk', '', '']), false);
  assert.equal(worthKeeping('NPC', ['NPC', 'A friendly intellect devourer named Us can be extracted from', 'surgery room', 'A companion']), false);
  assert.equal(worthKeeping('NPC', ['NPC', 'Shadowheart', 'her pod', 'A cleric companion']), true);
  assert.equal(worthKeeping('DO', ['DO', 'Read the rune slates', '']), false);
});
