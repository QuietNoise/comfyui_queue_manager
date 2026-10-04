import assert from 'node:assert/strict';
import test from 'node:test';
import {bindQueueReorder, reorderGroup, reorderTarget, keyboardReorder, reorderChangesOrder} from '../src/gui/app/internals/queueReorder.mjs';

const ids = [1, 2, 3, 4];

test('groups follow displayed order, add the dragged row, and ignore invisible selections', () => {
  assert.deepEqual(reorderGroup(ids, 3, {active: false, selected: new Set([1])}), [3]);
  assert.deepEqual(reorderGroup(ids, 3, {active: true, selected: new Set([4, 1, 99])}), [1, 3, 4]);
  assert.deepEqual(reorderGroup(ids, 99, {active: true, selected: new Set(ids)}), []);
});

test('drop targets exclude moved jobs and distinguish boundaries from no-op drops', () => {
  const rows = ids.map((id) => ({id, top: id * 40, bottom: (id + 1) * 40}));
  assert.deepEqual(reorderTarget(rows, [2, 3], 10), {target_id: 1, position: 'before', line: 40, anchorSide: 'bottom'});
  assert.deepEqual(reorderTarget(rows, [2, 3], 250), {target_id: 4, position: 'after', line: 200, anchorSide: 'top'});
  assert.equal(reorderTarget(rows, ids, 100), null);
  assert.equal(reorderChangesOrder(ids, [2, 3], {target_id: 4, position: 'before'}), false);
  assert.equal(reorderChangesOrder(ids, [1, 3], {target_id: 4, position: 'after'}), true);
});

test('keyboard moves one step or leaves boundary groups in place', () => {
  assert.deepEqual(keyboardReorder(ids, [2, 3], 'up'), {ids: [2, 3], target_id: 1, position: 'before'});
  assert.deepEqual(keyboardReorder(ids, [2, 3], 'down'), {ids: [2, 3], target_id: 4, position: 'after'});
  assert.equal(keyboardReorder(ids, [1, 2], 'up'), null);
  assert.equal(keyboardReorder(ids, [3, 4], 'down'), null);
});

function harness() {
  const listeners = new Map(), timers = new Map(), frames = new Map(), subscribers = new Set();
  let serial = 0, dragPreview = null, captured = false;
  let state = {active: false, selected: new Set(), rename: null};
  const change = (patch) => {
    const previous = state;
    state = {...state, ...patch};
    for (const fn of subscribers) fn(state, previous);
  };
  const store = {
    getState: () => ({...state, setSelected: (selected) => change({selected})}),
    subscribe(fn) {subscribers.add(fn); return () => subscribers.delete(fn);},
  };
  const surface = (prefix) => ({
    addEventListener(type, fn) {
      const key = prefix + type;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
    },
    removeEventListener(type, fn) {listeners.get(prefix + type)?.delete(fn);},
  });
  const view = {...surface('window:'),
    requestAnimationFrame(fn) {frames.set(++serial, fn); return serial;},
    cancelAnimationFrame(id) {frames.delete(id);},
    setTimeout(fn) {timers.set(++serial, fn); return serial;},
    clearTimeout(id) {timers.delete(id);},
  };
  const container = {...surface('container:'), ownerDocument: {defaultView: view},
    scrollTop: 0, classList: {add() {}, remove() {}},
    getBoundingClientRect: () => ({top: 0, bottom: 300, height: 300, left: 0, right: 400}),
    querySelectorAll: () => ids.map((id) => ({dataset: {reorderId: String(id)},
      getBoundingClientRect: () => ({top: id * 40 - container.scrollTop, bottom: (id + 1) * 40 - container.scrollTop})})),
    setPointerCapture() {captured = true;}, hasPointerCapture: () => captured,
    releasePointerCapture() {captured = false;},
  };
  const handle = (id, disabled = false) => {
    const result = {dataset: {reorderHandle: String(id)}, disabled, focus() {}};
    result.closest = () => result;
    return result;
  };
  const fire = (name, patch = {}) => {
    const event = {type: name.split(':')[1], target: handle(1), pointerId: 1,
      button: 0, clientX: 200, clientY: 60, isPrimary: true, prevented: false, stopped: false,
      preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}, ...patch};
    for (const fn of [...(listeners.get(name) ?? [])]) {fn(event); if (event.stopped) break;}
    return event;
  };
  const drops = [];
  const dispose = bindQueueReorder(container, store, (preview) => {dragPreview = preview;}, (move) => drops.push(move));
  return {change, fire, handle, drops, dispose, container,
    frame() {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn());},
    timers() {const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn());},
    get preview() {return dragPreview;}, get state() {return state;}, get captured() {return captured;}};
}

test('handle drag reorders one job without entering selection; release cannot click the row', () => {
  const h = harness();
  h.fire('container:pointerdown');
  assert.equal(h.captured, true);
  h.fire('window:pointermove', {clientY: 155});
  assert.deepEqual(h.preview.ids, [1]);
  assert.equal(h.preview.line, 160);
  assert.equal(h.state.active, false);
  assert.equal(h.fire('container:dragstart').prevented, true);
  h.fire('window:pointerup', {clientY: 155});
  assert.deepEqual(h.drops, [{ids: [1], target_id: 4, position: 'before'}]);
  assert.equal(h.captured, false);
  assert.equal(h.preview, null);
  h.dispose(); // Saving may immediately replace the list and its listeners.
  assert.equal(h.fire('window:click').prevented, true);
  h.timers();
  assert.equal(h.fire('window:click').prevented, false);
});

test('dragging an unselected handle moves it with the selected group in queue order', () => {
  const h = harness();
  h.change({active: true, selected: new Set([1, 99])});
  h.fire('container:pointerdown', {target: h.handle(3), clientY: 140});
  h.fire('window:pointermove', {clientY: 230});
  assert.deepEqual([...h.state.selected], [1, 3]);
  h.fire('window:pointerup', {clientY: 230});
  assert.deepEqual(h.drops, [{ids: [1, 3], target_id: 4, position: 'after'}]);
  assert.equal(h.state.active, true);
  h.dispose();
});

test('clicks, running handles, other controls and name editors never start reordering', () => {
  const h = harness();
  h.fire('container:pointerdown');
  h.fire('window:pointerup');
  assert.equal(h.preview, null);
  for (const patch of [{target: h.handle(1, true)}, {target: {closest: () => null}}, {button: 2}, {isPrimary: false}]) {
    h.fire('container:pointerdown', patch);
    h.fire('window:pointermove', {clientY: 240});
    h.fire('window:pointerup', {clientY: 240});
  }
  h.change({rename: {sourceId: 1}});
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 240});
  h.fire('window:pointerup', {clientY: 240});
  assert.deepEqual(h.drops, []);
  h.dispose();
});

test('Escape cancels drag without exiting selection and consumes the later release click', () => {
  const h = harness();
  h.change({active: true, selected: new Set([1, 2])});
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 240});
  assert.equal(h.fire('window:keydown', {key: 'Escape'}).stopped, true);
  h.fire('window:pointerup', {clientY: 240});
  assert.equal(h.fire('window:click').prevented, true);
  assert.equal(h.state.active, true);
  assert.deepEqual(h.drops, []);
  h.timers();
  assert.equal(h.fire('window:click').prevented, false);
  h.dispose();
});

test('outside drops, pointer cancellation, lost capture and refresh do not submit', () => {
  for (const cancellation of ['outside', 'pointercancel', 'lostpointercapture', 'refresh']) {
    const h = harness();
    h.fire('container:pointerdown');
    h.fire('window:pointermove', {clientY: 240});
    if (cancellation === 'outside') h.fire('window:pointerup', {clientX: 999, clientY: 240});
    if (cancellation === 'pointercancel') h.fire('window:pointercancel');
    if (cancellation === 'lostpointercapture') h.fire('container:lostpointercapture');
    if (cancellation === 'refresh') h.dispose();
    h.fire('window:pointerup');
    assert.deepEqual(h.drops, [], cancellation);
    assert.equal(h.preview, null, cancellation);
    assert.equal(h.captured, false, cancellation);
    h.dispose();
  }
});

test('auto-scroll updates insertion feedback; keyboard submits the same group operation', () => {
  const h = harness();
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 290});
  h.frame();
  assert.equal(h.container.scrollTop, 12);
  assert.equal(h.preview.line, 200);
  h.fire('window:pointerup', {clientY: 290});
  assert.deepEqual(h.drops.pop(), {ids: [1], target_id: 4, position: 'after'});
  h.change({active: true, selected: new Set([2, 3])});
  assert.equal(h.fire('window:keydown', {key: 'ArrowUp', target: h.handle(2)}).prevented, true);
  assert.deepEqual(h.drops.pop(), {ids: [2, 3], target_id: 1, position: 'before'});
  h.dispose();
});


test('direction chooses opposite anchors for the same gap, including noncontiguous groups', () => {
  const rows = ids.map((id) => ({id, top: id * 40, bottom: (id + 1) * 40}));
  assert.deepEqual(reorderTarget(rows, [4], 120, 'up'),
    {target_id: 2, position: 'after', line: 120, anchorSide: 'top'});
  assert.deepEqual(reorderTarget(rows, [4], 120, 'down'),
    {target_id: 3, position: 'before', line: 120, anchorSide: 'bottom'});
  assert.deepEqual(reorderTarget(rows, [2, 3], 120, 'up'),
    {target_id: 1, position: 'after', line: 80, anchorSide: 'top'});
  assert.deepEqual(reorderTarget(rows, [2, 3], 120, 'down'),
    {target_id: 4, position: 'before', line: 160, anchorSide: 'bottom'});
  for (const direction of ['up', 'down']) {
    assert.deepEqual(reorderTarget(rows, [2, 3], 10, direction),
      {target_id: 1, position: 'before', line: 40, anchorSide: 'bottom'});
    assert.deepEqual(reorderTarget(rows, [2, 3], 250, direction),
      {target_id: 4, position: 'after', line: 200, anchorSide: 'top'});
  }
});

test('reversing just one pixel switches anchors immediately, even on the same side of the start', () => {
  const h = harness();
  h.fire('container:pointerdown', {target: h.handle(4), clientY: 180});
  h.fire('window:pointermove', {clientY: 119});
  assert.equal(h.preview.anchorId, 2);
  assert.equal(h.preview.anchorSide, 'top');
  assert.equal(h.preview.position, 'after');
  h.fire('window:pointermove', {clientY: 120});
  assert.equal(h.preview.anchorId, 3);
  assert.equal(h.preview.anchorSide, 'bottom');
  assert.equal(h.preview.position, 'before');
  h.fire('window:pointermove', {clientY: 119});
  assert.equal(h.preview.anchorId, 2);
  assert.equal(h.preview.anchorSide, 'top');
  h.fire('window:pointermove', {clientX: 210, clientY: 119});
  h.frame(); // Horizontal movement and stationary frames keep the last direction.
  assert.equal(h.preview.anchorId, 2);
  h.fire('window:pointerup', {clientX: 210, clientY: 119});
  assert.deepEqual(h.drops, [{ids: [4], target_id: 2, position: 'after'}]);
  assert.equal(h.preview, null);
  h.dispose();
});

test('a downward reversal commits before the lower anchor, including a final release movement', () => {
  for (const reverseOnRelease of [false, true]) {
    const h = harness();
    h.fire('container:pointerdown', {target: h.handle(4), clientY: 180});
    h.fire('window:pointermove', {clientY: 119});
    if (!reverseOnRelease) h.fire('window:pointermove', {clientY: 120});
    h.fire('window:pointerup', {clientY: 120});
    assert.deepEqual(h.drops, [{ids: [4], target_id: 3, position: 'before'}]);
    h.dispose();
  }
});

test('upward reversal while dragging down also switches anchors without crossing the source', () => {
  const h = harness();
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 160});
  assert.equal(h.preview.anchorId, 4);
  assert.equal(h.preview.anchorSide, 'bottom');
  h.fire('window:pointermove', {clientY: 159});
  assert.equal(h.preview.anchorId, 3);
  assert.equal(h.preview.anchorSide, 'top');
  h.fire('window:pointerup', {clientY: 159});
  assert.deepEqual(h.drops, [{ids: [1], target_id: 3, position: 'after'}]);
  h.dispose();
});

test('invalid/no-op drops remove the highlighted anchor as well as the insertion line', () => {
  const h = harness();
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 155});
  assert.equal(h.preview.anchorId, 4);
  h.fire('window:pointermove', {clientX: 999, clientY: 155});
  assert.equal(h.preview.anchorId, undefined);
  assert.equal(h.preview.anchorSide, undefined);
  assert.equal(h.preview.line, null);
  h.fire('window:pointermove', {clientX: 200, clientY: 20});
  assert.equal(h.preview.anchorId, undefined); // Already before the first remaining row.
  h.dispose();
  assert.equal(h.preview, null);
});
