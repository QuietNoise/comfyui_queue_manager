import {create} from 'zustand';
import {reconcileSelection, selectRow} from '../internals/queueSelection.mjs';

// Mode lasts until explicitly exited; selected IDs are scoped to the visible page.
export const useSelectionStore = create((set) => ({
  active: false,
  selected: new Set(),
  anchor: null,
  toggle: () => set((state) => ({active: !state.active, selected: new Set(), anchor: null})),
  reset: () => set({active: false, selected: new Set(), anchor: null}),
  clear: () => set({selected: new Set(), anchor: null}),
  reconcile: (ids) => set((state) => reconcileSelection(state, ids)),
  setSelected: (selected) => set({selected}),
  selectAll: (ids) => set((state) => ({
    selected: ids.every((id) => state.selected.has(id)) ? new Set() : new Set(ids),
    anchor: null,
  })),
  click: (ids, id, modifiers) => set((state) => state.active
    ? selectRow(state.selected, state.anchor, ids, id, modifiers) : state),
}));
