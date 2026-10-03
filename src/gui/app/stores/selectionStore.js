import {create} from 'zustand';
import {selectRow} from '../internals/queueSelection.mjs';

// Deliberately transient: every list fetch ends selection mode.
export const useSelectionStore = create((set) => ({
  active: false,
  selected: new Set(),
  anchor: null,
  toggle: () => set((state) => ({active: !state.active, selected: new Set(), anchor: null})),
  reset: () => set({active: false, selected: new Set(), anchor: null}),
  setSelected: (selected) => set({selected}),
  selectAll: (ids) => set((state) => ({
    selected: ids.every((id) => state.selected.has(id)) ? new Set() : new Set(ids),
    anchor: null,
  })),
  click: (ids, id, modifiers) => set((state) => state.active
    ? selectRow(state.selected, state.anchor, ids, id, modifiers) : state),
}));
