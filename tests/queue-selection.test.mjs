import assert from 'node:assert/strict';
import test from 'node:test';
import {selectRow, selectRectangle} from '../src/gui/app/internals/queueSelection.mjs';

test('row clicks toggle; Shift adds a range and Shift+Alt removes it without changing the anchor', () => {
  const ids = [11, 24, 39, 48, 52];
  let state = selectRow(new Set([52]), null, ids, 24);
  state = selectRow(state.selected, state.anchor, ids, 48, {shiftKey: true});
  assert.deepEqual([...state.selected].sort(), [24, 39, 48, 52]);
  assert.equal(state.anchor, 24);
  state = selectRow(state.selected, state.anchor, ids, 39, {shiftKey: true, altKey: true});
  assert.deepEqual([...state.selected].sort(), [48, 52]);
  state = selectRow(state.selected, state.anchor, ids, 48);
  assert.deepEqual([...state.selected], [52]);
});

test('reverse ranges and missing anchors stay within the visible selectable IDs', () => {
  const ids = [4, 8, 15];
  assert.deepEqual([...selectRow(new Set(), 15, ids, 4, {shiftKey: true}).selected], ids);
  assert.deepEqual([...selectRow(new Set(), 999, ids, 8, {shiftKey: true}).selected], [8]);
  assert.equal(selectRow(new Set(), 8, ids, 999).anchor, 8);
});

test('rectangle includes touched edges and gallery rows, preserving selections outside it', () => {
  const rows = [
    {id: 1, left: 0, right: 200, top: 0, bottom: 30},
    {id: 2, left: 0, right: 200, top: 30, bottom: 60},
    {id: 2, left: 0, right: 200, top: 60, bottom: 100},
    {id: 3, left: 0, right: 200, top: 100, bottom: 130},
  ];
  const box = {left: 100, right: 150, top: 30, bottom: 90};
  const initial = new Set([3]);
  assert.deepEqual([...selectRectangle(initial, rows, box)].sort(), [1, 2, 3]);
  assert.deepEqual([...initial], [3]);
  assert.deepEqual([...selectRectangle(new Set([1, 2, 3]), rows, box, true)], [3]);
  assert.deepEqual([...selectRectangle(initial, rows, {...box, left: 201, right: 250})], [3]);
});
