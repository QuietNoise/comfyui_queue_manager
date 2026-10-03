import { create } from 'zustand';
import {getWorkflowFilter, readWorkflowFilterMode, saveWorkflowFilterMode} from '../internals/workflowFilters.mjs';

export const useAppStore = create((set) => ({
  filters : null,
  workflowFilterMode: readWorkflowFilterMode(),
  route : "queue",
  mode: 'queue',
  clientId: null,
  shiftDown: false,
  setFilters : (filters) => set((state) => {
    const workflowFilterMode = getWorkflowFilter(filters)?.mode ?? state.workflowFilterMode;
    if (workflowFilterMode !== state.workflowFilterMode) {
      saveWorkflowFilterMode(workflowFilterMode);
    }
    return {...state, filters, workflowFilterMode};
  }),
  setRoute : (route) => set((state) => ({...state, route: route})),
  setMode : (mode) => set((state) => ({...state, mode: mode})),
  setClientId : (clientId) => set((state) => ({...state, clientId: clientId})),
  setShiftDown : (shiftDown) => set((state) => ({...state, shiftDown: shiftDown})),
}));
