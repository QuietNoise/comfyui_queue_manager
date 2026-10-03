import assert from 'node:assert/strict';
import test from 'node:test';
import {getWorkflowFilter, readWorkflowFilterMode, saveWorkflowFilterMode, withWorkflowFilter} from '../src/gui/app/internals/workflowFilters.mjs';

test('legacy workflow filters switch to an exact name and back without losing the selected workflow', () => {
  const original = {
    workflow: {type: 'workflow', value: 'workflow-id', valueLabel: 'dog21'},
    checkpoint: {type: 'checkpoint', value: 'model'}
  };
  const byName = withWorkflowFilter(original, getWorkflowFilter(original), 'workflow_name');
  assert.deepEqual(byName, {
    checkpoint: original.checkpoint,
    workflow_name: {type: 'workflow_name', value: 'dog21', valueLabel: 'dog21', workflowId: 'workflow-id'}
  });
  assert.deepEqual(withWorkflowFilter(byName, getWorkflowFilter(byName), 'workflow'), original);
  assert.equal(original.workflow.value, 'workflow-id');
});

test('clicking a row respects name mode and updates the workflow used when switching back', () => {
  const first = withWorkflowFilter(null, {id: 'first-workflow', name: 'shared'});
  assert.equal(getWorkflowFilter(first).mode, 'workflow');
  const byName = withWorkflowFilter(first, getWorkflowFilter(first), 'workflow_name');
  const clicked = withWorkflowFilter(byName, {id: 'second-workflow', name: 'shared'});
  assert.equal(clicked.workflow_name.value, 'shared');
  assert.equal(clicked.workflow_name.workflowId, 'second-workflow');
  assert.equal(withWorkflowFilter(clicked, getWorkflowFilter(clicked), 'workflow').workflow.value, 'second-workflow');
});

test('names are sent verbatim, including empty names, case, whitespace and query characters', () => {
  for (const name of ['', 'Dog_100% + & 猫 ', "O'Brien"]) {
    const filters = withWorkflowFilter({}, {id: 'workflow', name}, 'workflow_name');
    const query = new URLSearchParams({filters: JSON.stringify(filters)});
    const decoded = JSON.parse(query.get('filters'));
    assert.equal(decoded.workflow_name.value, name);
    assert.equal(getWorkflowFilter(decoded).name, name);
  }
});

test('a name filter without an ID cannot broaden to all workflows', () => {
  assert.equal(getWorkflowFilter({}), null);
  assert.equal(getWorkflowFilter(null), null);
  const nameOnly = {workflow_name: {type: 'workflow_name', value: 'name', valueLabel: 'name'}};
  assert.equal(withWorkflowFilter(nameOnly, getWorkflowFilter(nameOnly), 'workflow'), nameOnly);
  const byWorkflow = withWorkflowFilter({}, {id: 'id', name: 'name'});
  assert.equal(getWorkflowFilter(byWorkflow).mode, 'workflow');
});

test('saved filter mode is reused for new selections after clearing or reloading', () => {
  const values = new Map();
  const storage = {getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value)};
  assert.equal(readWorkflowFilterMode(storage), 'workflow');

  for (const mode of ['workflow_name', 'workflow']) {
    saveWorkflowFilterMode(mode, storage);
    for (const clearedFilters of [{}, null]) {
      const filters = withWorkflowFilter(clearedFilters, {id: 'new-workflow', name: 'new name'}, readWorkflowFilterMode(storage));
      assert.equal(getWorkflowFilter(filters).mode, mode);
      assert.equal(filters[mode].value, mode === 'workflow_name' ? 'new name' : 'new-workflow');
    }
  }
  assert.equal(values.size, 1);
});

test('invalid or unavailable browser storage uses the default without breaking filtering', () => {
  assert.equal(readWorkflowFilterMode({getItem: () => 'invalid-mode'}), 'workflow');
  const blockedStorage = {
    getItem: () => {throw new Error('Storage blocked');},
    setItem: () => {throw new Error('Storage blocked');}
  };
  assert.equal(readWorkflowFilterMode(blockedStorage), 'workflow');
  assert.doesNotThrow(() => saveWorkflowFilterMode('workflow_name', blockedStorage));
});
