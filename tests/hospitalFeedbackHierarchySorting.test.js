import assert from 'node:assert/strict';
import test from 'node:test';

import { naturalOptionCompare } from '../src/utils/naturalSort.js';

test('hospital feedback hierarchy sorting keeps Block 10 after Block 2', () => {
  const labels = ['Block 1', 'Block 10', 'Block 2', 'Block 3']
    .map((label) => ({ value: label, label }))
    .sort(naturalOptionCompare)
    .map((option) => option.label);
  assert.deepEqual(labels, ['Block 1', 'Block 2', 'Block 3', 'Block 10']);
});

test('hospital feedback hierarchy sorting keeps Floor 10 after Floor 9', () => {
  const labels = ['Floor 1', 'Floor 10', 'Floor 9', 'Floor 2']
    .map((label) => ({ value: label, label }))
    .sort(naturalOptionCompare)
    .map((option) => option.label);
  assert.deepEqual(labels, ['Floor 1', 'Floor 2', 'Floor 9', 'Floor 10']);
});

test('hospital feedback hierarchy sorting keeps Toilet 6 after Toilet 5', () => {
  const labels = ['Toilet 1', 'Toilet 6', 'Toilet 5', 'Toilet 2']
    .map((label) => ({ value: label, label }))
    .sort(naturalOptionCompare)
    .map((option) => option.label);
  assert.deepEqual(labels, ['Toilet 1', 'Toilet 2', 'Toilet 5', 'Toilet 6']);
});
