import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {installWorkflowNameInjection, queuedWorkflowName, resolveWorkflowName} from '../web/js/workflow-name.js';

const cases = JSON.parse(await readFile(new URL('./workflow_name_cases.json', import.meta.url), 'utf8'));
const nameNode = inputs => ({class_type: 'Workflow Name', inputs});

for (const row of cases) {
  test(row.label, () => {
    assert.equal(resolveWorkflowName(row.text, row.workflow), row.expected);
    const inputs = {text: row.text};
    assert.equal(queuedWorkflowName({output: {1: nameNode(inputs)}}, null, row.workflow), row.expected);
    const output = {
      1: nameNode({text: ['2', 0]}),
      2: {class_type: 'PrimitiveString', inputs: {value: row.text}}
    };
    assert.equal(queuedWorkflowName({output}, null, row.workflow), row.expected);
  });
}

test('no Workflow Name node retains the active filename', () => {
  assert.equal(queuedWorkflowName({output: {}}, null, 'original.json'), 'original.json');
  assert.equal(queuedWorkflowName({output: {1: {class_type: 'Other', _meta: {title: 'Workflow Name'}}}}, null, 'original'), 'original');
});

test('linked text primitives resolve from submitted values', () => {
  for (const class_type of ['PrimitiveString', 'PrimitiveStringMultiline']) {
    const output = {
      1: nameNode({text: ['2', 0]}),
      2: {class_type, inputs: {value: 'queued:name '}}
    };
    const graph = {getNodeById: () => ({getOutputData: () => 'old cached name'})};
    assert.equal(queuedWorkflowName({output}, graph, 'original'), 'queued_name_');
    output[2].inputs.value = '';
    assert.equal(queuedWorkflowName({output}, graph, 'original.json'), 'original.json');
    output[2].inputs.value = ' \t';
    assert.equal(queuedWorkflowName({output}, graph, 'original.json'), 'original.json');
  }
});

test('available socket data uses the connected output slot', () => {
  const output = {1: nameNode({text: ['2', 1]})};
  const graph = {getNodeById: id => id === '2' ? {getOutputData: slot => ['wrong', 'current:name'][slot]} : undefined};
  assert.equal(queuedWorkflowName({output}, graph, 'original'), 'current_name');
});

test('reads current link data and respects link ID zero', () => {
  const graph = {getNodeById: () => ({
    inputs: [{name: 'text', link: 0}],
    getInputData: () => 'link:name'
  })};
  assert.equal(queuedWorkflowName({output: {1: nameNode({})}}, graph, 'original'), 'link_name');
});

test('unknown backend output uses empty-connected fallback without guessing its inputs', () => {
  const output = {
    1: nameNode({text: ['2', 0]}),
    2: {class_type: 'TextTransform', inputs: {text: 'not the output'}}
  };
  assert.equal(queuedWorkflowName({output}, null, 'original'), 'original');
  assert.equal(queuedWorkflowName({output}, null, ''), '');
});

test('chained Workflow Name nodes and cycles', () => {
  const output = {1: nameNode({text: ['2', 0]}), 2: nameNode({text: 'inner:name'})};
  assert.equal(queuedWorkflowName({output}, null, 'original'), 'inner_name');
  output[2].inputs.text = ['1', 0];
  assert.equal(typeof queuedWorkflowName({output}, null, 'original'), 'string');
});

test('subgraph execution IDs resolve literals in the submitted prompt', () => {
  const output = {'10:1': nameNode({text: ['10:2', 0]}), '10:2': {class_type: 'PrimitiveString', inputs: {value: 'inner'}}};
  assert.equal(queuedWorkflowName({output}, null, 'original'), 'inner');
});

test('first submitted Workflow Name wins when there are several', () => {
  assert.equal(queuedWorkflowName({output: {1: nameNode({text: 'first'}), 2: nameNode({text: 'second'})}}, null, 'original'), 'first');
});

test('queue wrapper forwards receiver, arguments, results, and updates each submission', async () => {
  const calls = [];
  const app = {
    api: {queuePrompt: async function(...args) { calls.push([this, ...args]); return 'queued'; }},
    extensionManager: {workflow: {activeWorkflow: {filename: 'original.json'}}}
  };
  installWorkflowNameInjection(app);
  const data = {workflow: {nodes: [], extra: {keep: true}}, output: {1: nameNode({text: 'custom:name'})}};
  assert.equal(await app.api.queuePrompt(3, data, {flag: true}), 'queued');
  assert.equal(data.workflow.workflow_name, 'custom_name');
  assert.deepEqual(data.workflow.extra, {keep: true});
  assert.deepEqual(calls[0], [app.api, 3, data, {flag: true}]);
  data.output[1].inputs.text = '';
  app.extensionManager.workflow.activeWorkflow.filename = 'renamed.json';
  await app.api.queuePrompt(0, data);
  assert.equal(data.workflow.workflow_name, 'renamed.json');
  await app.api.queuePrompt(0, {output: {}});
});

test('queue errors propagate unchanged', async () => {
  const error = new Error('queue rejected');
  const app = {api: {queuePrompt: async () => { throw error; }}};
  installWorkflowNameInjection(app);
  await assert.rejects(app.api.queuePrompt(0, {}), received => received === error);
});

test('queue injection uses empty string when no workflow filename is available', async () => {
  const app = {
    api: {queuePrompt: async () => 'queued'},
    extensionManager: {workflow: {activeWorkflow: null}}
  };
  installWorkflowNameInjection(app);
  for (const output of [{}, {1: nameNode({text: ''})}]) {
    const data = {workflow: {}, output};
    assert.equal(await app.api.queuePrompt(0, data), 'queued');
    assert.equal(data.workflow.workflow_name, '');
  }
});
