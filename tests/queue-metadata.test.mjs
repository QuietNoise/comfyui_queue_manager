import assert from 'node:assert/strict';
import test from 'node:test';
import {queueWorkflow, queueNodeIDs} from '../src/gui/app/internals/queueMetadata.mjs';

const apiPrompt = {'10:0': {class_type: 'Input', inputs: {}}, '10:1': {class_type: 'Output', inputs: {source: ['10:0', 0]}}};
const job = extra => [1, '12345678-api', apiPrompt, extra, ['10:1']];

test('API prompts load through the API loader without adding PNG workflow data', () => {
  const item = job({queue_manager: {name: 'API render', workflow_id: 'api-identity'}});
  const original = structuredClone(item);
  assert.deepEqual(queueWorkflow(item), {id: 'api-identity', workflow_name: 'API render', api_prompt: apiPrompt});
  assert.deepEqual(queueNodeIDs(item), {'10:0': '10:0', '10:1': '10:1'});
  assert.deepEqual(item, original);
});

test('GUI workflows keep their nodes, layout, groups and normal Load path', () => {
  const workflow = {id: 'gui', workflow_name: 'GUI render', nodes: [{id: 0, pos: [50, 80]}, {id: 2}], groups: [{title: 'Group'}]};
  const item = job({extra_pnginfo: {workflow}});
  assert.deepEqual(queueWorkflow(item), workflow);
  assert.deepEqual(queueNodeIDs(item), {0: 0, 2: 2});
  assert.equal(queueWorkflow(item).api_prompt, undefined);
});

test('missing or incomplete canvas metadata still allows rendering and loading', () => {
  for (const extra of [{}, {extra_pnginfo: null}, {extra_pnginfo: {workflow: null}}, {extra_pnginfo: {workflow: []}}, {extra_pnginfo: {workflow: {id: 'provided'}}}]) {
    const item = job(extra);
    const workflow = queueWorkflow(item);
    assert.equal(workflow.workflow_name, 'API job 12345678');
    assert.equal(workflow.api_prompt, apiPrompt);
    assert.equal(workflow.id, extra.extra_pnginfo?.workflow?.id ?? 'api:12345678-api');
    assert.deepEqual(queueNodeIDs(item), {'10:0': '10:0', '10:1': '10:1'});
  }
});

test('separate display names work alongside real canvas metadata', () => {
  const workflow = {id: 'gui', workflow_name: 'original', nodes: []};
  const item = job({extra_pnginfo: {workflow}, queue_manager: {name: 'renamed', workflow_id: 'provided'}});
  assert.deepEqual(queueWorkflow(item), {id: 'provided', workflow_name: 'renamed', nodes: []});
  assert.equal(workflow.workflow_name, 'original');
});
