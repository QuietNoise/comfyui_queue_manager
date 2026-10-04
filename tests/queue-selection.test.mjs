import assert from 'node:assert/strict';
import test from 'node:test';
import {consumeRenameGesture} from '../src/gui/app/internals/renameGesture.mjs';
import {bindQueueSelectionDrag} from '../src/gui/app/internals/queueSelectionDrag.mjs';
import {beginGroupRename, updateGroupRename, finishGroupRename, reconcileSelection, selectRow, selectRectangle} from '../src/gui/app/internals/queueSelection.mjs';

test('refresh retains visible selected jobs, drops missing IDs and does not select new rows', () => {
  const state = {active: true, selected: new Set([1, 3, 5]), anchor: 3};
  const next = reconcileSelection(state, [1, 4, 5, 6]);
  assert.deepEqual([...next.selected], [1, 5]);
  assert.equal(next.anchor, null);
  assert.deepEqual([...state.selected], [1, 3, 5]);
  assert.equal(reconcileSelection(state, [3, 5, 1]).anchor, 3);
});

test('refresh with no remaining selected jobs stays active, but cannot reactivate an exited selection', () => {
  const state = {active: true, selected: new Set([1]), anchor: 1};
  const next = {...state, ...reconcileSelection(state, [])};
  assert.equal(next.active, true);
  assert.equal(next.selected.size, 0);
  assert.equal(next.anchor, null);
  const exited = {active: false, selected: new Set(), anchor: null};
  assert.equal(reconcileSelection(exited, [1, 2]), exited);
});

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

// Minimal pointer surfaces: exercise the real drag controller without React or browser dependencies.
function dragHarness() {
  const listeners = new Map();
  const surface = (prefix) => ({
    addEventListener: (name, fn) => listeners.set(prefix + name, fn),
    removeEventListener: (name) => listeners.delete(prefix + name),
  });
  let rectangle = null, suppressed = false, captured = false;
  const subscribers = new Set();
  let state = {active: false, selected: new Set(), anchor: null};
  const change = (patch) => {
    const previous = state;
    state = {...state, ...patch};
    for (const fn of subscribers) fn(state, previous);
  };
  const store = {
    getState: () => ({...state, enable: () => change({active: true}), setSelected: (selected) => change({selected})}),
    subscribe: (fn) => {subscribers.add(fn); return () => subscribers.delete(fn);},
  };
  const rows = [1, 2, 3].map((id) => ({dataset: {selectionId: String(id)},
    getBoundingClientRect: () => ({left: 0, right: 300, top: (id - 1) * 40, bottom: id * 40})}));
  const view = {...surface('window:'), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, getSelection: () => null};
  const container = {...surface('container:'), ownerDocument: {defaultView: view},
    scrollTop: 0, scrollLeft: 0, classList: {add() {}, remove() {}},
    getBoundingClientRect: () => ({left: 0, right: 300, top: 0, bottom: 200}),
    querySelector: () => rows[0], querySelectorAll: () => rows,
    setPointerCapture: () => {captured = true;}, hasPointerCapture: () => captured,
    releasePointerCapture: () => {captured = false;}};
  const name = {closest: (selector) => selector.includes('button:not(.workflow-name-label)') ? null : name};
  const action = {closest: () => action};
  const fire = (name, overrides = {}) => {
    const type = name.split(':')[1];
    const event = {type, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 20,
      target: {closest: () => null}, prevented: false, preventDefault() {this.prevented = true;}, ...overrides};
    listeners.get(name)?.(event);
    return event;
  };
  const dispose = bindQueueSelectionDrag(container, store, (value) => {rectangle = value;}, (value) => {suppressed = value;});
  return {fire, change, dispose, rows, name, action, get state() {return state;},
    get rectangle() {return rectangle;}, get suppressed() {return suppressed;}, get captured() {return captured;}};
}

test('dragging from a workflow name activates mode and selects through pointer release', () => {
  const h = dragHarness();
  h.fire('container:pointerdown', {target: h.name});
  h.fire('window:pointermove', {clientX: 12, clientY: 21});
  assert.equal(h.state.active, false);
  h.fire('window:pointermove', {clientX: 30, clientY: 65});
  assert.equal(h.state.active, true);
  assert.equal(h.captured, true);
  assert.deepEqual([...h.state.selected], [1, 2]);
  assert.equal(h.fire('container:dragstart').prevented, true);
  h.fire('window:pointermove', {clientX: 40, clientY: 95});
  h.fire('window:pointerup', {clientX: 40, clientY: 95});
  assert.deepEqual([...h.state.selected], [1, 2, 3]);
  assert.equal(h.state.active, true);
  assert.equal(h.rectangle, null);
  assert.equal(h.captured, false);
  assert.equal(h.suppressed, true); // The release must not filter or open the row.
  h.dispose();
});

test('normal clicks, action controls, touch scrolling and empty lists do not activate mode', () => {
  const h = dragHarness();
  h.fire('container:pointerdown', {target: h.name});
  h.fire('window:pointerup');
  assert.equal(h.state.active, false);
  assert.equal(h.suppressed, false);
  for (const overrides of [{target: h.action}, {pointerType: 'touch'}, {button: 2}, {isPrimary: false}]) {
    h.fire('container:pointerdown', overrides);
    h.fire('window:pointermove', {clientY: 90});
    h.fire('window:pointerup', {clientY: 90});
    assert.equal(h.state.active, false);
  }
  h.rows.length = 0;
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 90});
  assert.equal(h.state.active, false);
  h.dispose();
});

test('Alt drag subtracts and pointer cancellation restores the original selection', () => {
  const h = dragHarness();
  h.change({active: true, selected: new Set([1, 2, 3])});
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 65, altKey: true});
  assert.deepEqual([...h.state.selected], [3]);
  h.fire('window:pointercancel', {clientY: 65});
  assert.deepEqual([...h.state.selected], [1, 2, 3]);
  assert.equal(h.state.active, true);
  assert.equal(h.rectangle, null);
  h.dispose();
});

test('explicit exit during dragging stays off, and disposing listeners stops later pointer updates', () => {
  const h = dragHarness();
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 65});
  h.change({active: false, selected: new Set(), anchor: null});
  h.fire('window:pointermove', {clientY: 95});
  h.fire('window:pointerup', {clientY: 95});
  assert.equal(h.state.active, false);
  assert.equal(h.state.selected.size, 0);
  assert.equal(h.rectangle, null);
  assert.equal(h.captured, false);
  h.fire('container:pointerdown', {target: h.action});
  assert.equal(h.suppressed, false); // A later action click still works after Escape.
  h.fire('window:pointerup');
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 65});
  const before = [...h.state.selected];
  h.dispose();
  h.fire('window:pointermove', {clientY: 95});
  h.fire('window:pointerup', {clientY: 95});
  assert.deepEqual([...h.state.selected], before);
  assert.equal(h.captured, false);
  assert.equal(h.rectangle, null);
});


test('group rename adds the edited row and freezes the target IDs for the shared draft', () => {
  const initial = {active: true, selected: new Set([1, 2]), rename: null};
  let state = {...initial, ...beginGroupRename(initial, 3, 'source', 'queue', 7)};
  assert.deepEqual([...state.selected], [1, 2, 3]);
  assert.deepEqual(state.rename.ids, [1, 2, 3]);
  assert.deepEqual([...initial.selected], [1, 2]);
  state = {...state, ...updateGroupRename(state, 7, {draftName: 'shared name'})};
  assert.equal(state.rename.draftName, 'shared name');
  assert.equal(state.rename.initialName, 'source');
  state.selected = new Set([2, 4]);
  assert.deepEqual(state.rename.ids, [1, 2, 3]);
});

test('group rename prunes vanished targets on refresh and cancels if its editor disappears', () => {
  const initial = {active: true, selected: new Set([1, 2, 3])};
  const state = {...initial, ...beginGroupRename(initial, 1, 'name', 'archive', 8)};
  assert.deepEqual(reconcileSelection(state, [1, 3, 4]).rename.ids, [1, 3]);
  assert.equal(reconcileSelection(state, [2, 3, 4]).rename, null);
});

test('finishing, cancelling and late save responses cannot overwrite a newer group edit', () => {
  const initial = {active: true, selected: new Set([1])};
  const state = {...initial, ...beginGroupRename(initial, 1, 'name', 'queue', 9)};
  assert.equal(updateGroupRename(state, 8, {error: 'old response'}), state);
  assert.equal(finishGroupRename(state, 8), state);
  const cancelled = {...state, ...finishGroupRename(state, 9)};
  assert.equal(cancelled.rename, null);
  assert.deepEqual([...cancelled.selected], [1]);
  assert.equal(cancelled.active, true);
  const saving = {...state, ...updateGroupRename(state, 9, {saving: true})};
  assert.equal(beginGroupRename(saving, 2, 'other', 'queue', 10), saving);
});


test('another rename pencil cannot move an active editor, even before saving', () => {
  const initial = {active: true, selected: new Set([1, 2])};
  const state = {...initial, ...beginGroupRename(initial, 1, 'first', 'queue', 21)};
  assert.equal(beginGroupRename(state, 3, 'third', 'queue', 22), state);
  assert.deepEqual([...state.selected], [1, 2]);
  const finished = {...state, ...finishGroupRename(state, 21)};
  assert.deepEqual([...beginGroupRename(finished, 3, 'third', 'queue', 22).selected], [1, 2, 3]);
});

test('dragging outside a group editor cannot change the selected group', () => {
  const h = dragHarness();
  h.change({active: true, selected: new Set([1, 3]), rename: {sourceId: 1}});
  h.fire('container:pointerdown');
  h.fire('window:pointermove', {clientY: 65});
  h.fire('window:pointerup', {clientY: 65});
  assert.deepEqual([...h.state.selected], [1, 3]);
  assert.equal(h.rectangle, null);
  assert.equal(h.captured, false);
  h.dispose();
});

function renameGestureHarness() {
  const document = new EventTarget();
  const timers = new Map();
  let nextTimer = 0;
  document.defaultView = {
    setTimeout(fn) {timers.set(++nextTimer, fn); return nextTimer;},
    clearTimeout(id) {timers.delete(id);},
  };
  const fire = (type) => {
    const event = new Event(type, {cancelable: true});
    Object.defineProperty(event, 'pointerId', {value: 1});
    document.dispatchEvent(event);
    return event;
  };
  const begin = () => {
    const down = fire('pointerdown');
    consumeRenameGesture(down, document);
    assert.equal(down.defaultPrevented, true);
  };
  const settle = () => {for (const fn of [...timers.values()]) fn();};
  return {document, fire, begin, settle};
}

test('the outside gesture is consumed after a fast rename closes the editor; the next click works', () => {
  const h = renameGestureHarness();
  h.begin();
  let rowClicks = 0;
  h.document.addEventListener('click', () => {rowClicks++;});
  h.fire('pointerup');
  assert.equal(h.fire('click').defaultPrevented, true);
  assert.equal(rowClicks, 0);
  h.settle();
  h.fire('pointerdown');
  assert.equal(h.fire('click').defaultPrevented, false);
  assert.equal(rowClicks, 1);
});

test('a disabled pencil or cancelled pointer cannot leave the next gesture blocked', () => {
  const h = renameGestureHarness();
  h.begin();
  h.fire('pointerup'); // Disabled controls may never emit click.
  h.settle();
  assert.equal(h.fire('click').defaultPrevented, false);
  h.begin();
  h.fire('pointercancel');
  h.settle();
  assert.equal(h.fire('click').defaultPrevented, false);
  h.begin();
  h.fire('pointerdown'); // Also recover if release occurred outside this document.
  assert.equal(h.fire('click').defaultPrevented, false);
});
