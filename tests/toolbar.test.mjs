import assert from 'node:assert/strict';
import test from 'node:test';
import {installQueueControls} from '../web/js/toolbar.js';

function environment(t) {
  const buttons = [];
  const listeners = new Map();
  const requests = [];
  let cleanCaches = false;
  const app = {
    menu: {actionsGroup: {append: t.mock.fn(button => buttons.push(button))}},
    api: {addEventListener: t.mock.fn((name, listener) => listeners.set(name, listener))},
    extensionManager: {setting: {get: () => cleanCaches}}
  };
  class ComfyButton {
    constructor(options) {
      Object.assign(this, {enabled: true}, options);
      this.element = {setAttribute: t.mock.fn()};
    }
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push([url, options]);
    return {ok: true};
  });
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = {querySelector: t.mock.fn(() => null)};
  Object.defineProperty(globalThis, 'document', {configurable: true, value: document});
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  return {
    app, ComfyButton, buttons, listeners, requests, document,
    setting: value => { cleanCaches = value; },
    emit: (name, detail) => listeners.get(name)({detail})
  };
}

test('compatibility controls are appended once without toolbar DOM lookups or duplicate subscriptions', async t => {
  const env = environment(t);
  await Promise.all([
    installQueueControls(env.app, env.ComfyButton, true),
    installQueueControls(env.app, env.ComfyButton, true)
  ]);
  await installQueueControls(env.app, env.ComfyButton, true);
  assert.deepEqual(env.buttons.map(button => button.icon), ['stop', 'pause']);
  assert.equal(env.buttons[0].enabled, false);
  assert.equal(env.app.menu.actionsGroup.append.mock.callCount(), 2);
  assert.equal(env.app.api.addEventListener.mock.callCount(), 2);
  assert.equal(env.document.querySelector.mock.callCount(), 0);
  assert.deepEqual(env.requests.map(([url]) => url), ['/queue_manager/playback', '/queue_manager/poke_status']);
});

test('pause state updates the native icon, tooltip and accessible label; clicks use the live cache setting', async t => {
  const env = environment(t);
  await installQueueControls(env.app, env.ComfyButton, true);
  const pause = env.buttons[1];
  env.emit('queue-manager-toggle-queue', {paused: true});
  assert.equal(pause.icon, 'play');
  assert.equal(pause.tooltip, 'Resume queue');
  assert.deepEqual(pause.element.setAttribute.mock.calls.at(-1).arguments, ['aria-label', 'Resume queue']);
  env.emit('queue-manager-toggle-queue', {paused: false});
  assert.equal(pause.icon, 'pause');
  assert.equal(pause.tooltip, 'Pause queue');
  assert.deepEqual(pause.element.setAttribute.mock.calls.at(-1).arguments, ['aria-label', 'Pause queue']);
  await pause.action();
  env.setting(true);
  await pause.action();
  assert.deepEqual(env.requests.slice(2).map(([url]) => url), [
    '/queue_manager/toggle?clean_caches=false', '/queue_manager/toggle?clean_caches=true'
  ]);
});

test('stop uses native enabled state even before the sidebar tab exists, and retains the clear request', async t => {
  const env = environment(t);
  await installQueueControls(env.app, env.ComfyButton, true);
  const stop = env.buttons[0];
  env.emit('status', {exec_info: {queue_remaining: 3}});
  assert.equal(stop.enabled, true);
  await stop.action();
  assert.deepEqual(env.requests.at(-1), ['/api/queue', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"clear":true}'
  }]);
  env.emit('status', {exec_info: {queue_remaining: 0}});
  assert.equal(stop.enabled, false);
  env.emit('status', undefined);
  assert.equal(stop.enabled, false);
});

for (const selector of ['.comfyui-queue-manager-tab-button', '[data-testid="comfyui-queue-manager-tab-button"]']) {
  test(`badge creation, updates and removal share the ${selector} tab lookup`, async t => {
    const env = environment(t);
    let badge = null;
    const tab = {querySelector: () => badge, insertAdjacentHTML: t.mock.fn()};
    env.document.querySelector = candidate => candidate === selector ? tab : null;
    await installQueueControls(env.app, env.ComfyButton, true);
    env.emit('status', {exec_info: {queue_remaining: 1200}});
    assert.match(tab.insertAdjacentHTML.mock.calls[0].arguments[1], /title="1200 jobs">999\+<\/span>/);
    badge = {remove: t.mock.fn()};
    env.emit('status', {exec_info: {queue_remaining: 2}});
    assert.equal(badge.textContent, 2);
    assert.equal(badge.title, '2 jobs');
    env.emit('status', {exec_info: {queue_remaining: 0}});
    assert.equal(badge.remove.mock.callCount(), 1);
    assert.equal(tab.insertAdjacentHTML.mock.callCount(), 1);
  });
}

test('older frontends retain their own stop control and receive only Pause/Resume', async t => {
  const env = environment(t);
  await installQueueControls(env.app, env.ComfyButton, false);
  assert.deepEqual(env.buttons.map(button => button.icon), ['pause']);
  assert.equal(env.listeners.has('status'), false);
  assert.deepEqual(env.requests, [['/queue_manager/playback', undefined]]);
});

test('failed actions are reported without losing subsequent queue state updates', async t => {
  const env = environment(t);
  await installQueueControls(env.app, env.ComfyButton, true);
  const errors = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => ({ok: false, status: 500}));
  await env.buttons[0].action();
  await env.buttons[1].action();
  assert.equal(errors.mock.callCount(), 2);
  env.emit('queue-manager-toggle-queue', {paused: true});
  assert.equal(env.buttons[1].icon, 'play');
});
