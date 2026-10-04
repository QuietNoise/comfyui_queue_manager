import {create} from 'zustand';
import {beginGroupRename, updateGroupRename, finishGroupRename, reconcileSelection, selectRow} from '../internals/queueSelection.mjs';

let renameSessionId = 0;

// Mode lasts until explicitly exited; selected IDs are scoped to the visible page.
export const useSelectionStore = create((set) => ({
  active: false,
  selected: new Set(),
  anchor: null,
  rename: null,
  toggle: () => set((state) => ({active: !state.active, selected: new Set(), anchor: null, rename: null})),
  enable: () => set({active: true}),
  reset: () => set({active: false, selected: new Set(), anchor: null, rename: null}),
  clear: () => set({selected: new Set(), anchor: null, rename: null}),
  beginRename: (id, name, route) => set((state) => beginGroupRename(state, id, name, route, ++renameSessionId)),
  updateRename: (sessionId, patch) => set((state) => updateGroupRename(state, sessionId, patch)),
  finishRename: (sessionId) => set((state) => finishGroupRename(state, sessionId)),
  reconcile: (ids) => set((state) => reconcileSelection(state, ids)),
  setSelected: (selected) => set((state) => state.rename ? state : {selected}),
  selectAll: (ids) => set((state) => state.rename ? state : ({
    selected: ids.every((id) => state.selected.has(id)) ? new Set() : new Set(ids),
    anchor: null,
  })),
  click: (ids, id, modifiers) => set((state) => state.active && !state.rename
    ? selectRow(state.selected, state.anchor, ids, id, modifiers) : state),
}));
