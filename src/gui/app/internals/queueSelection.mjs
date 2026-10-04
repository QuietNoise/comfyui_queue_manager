export function reconcileSelection(state, ids) {
  if (!state.active) return state;
  const visible = new Set(ids);
  return {
    selected: new Set([...state.selected].filter((id) => visible.has(id))),
    anchor: visible.has(state.anchor) ? state.anchor : null,
    rename: state.rename && visible.has(state.rename.sourceId)
      ? {...state.rename, ids: state.rename.ids.filter((id) => visible.has(id))} : null,
  };
}

export function selectRow(selected, anchor, ids, id, {shiftKey = false, altKey = false} = {}) {
  const end = ids.indexOf(id);
  if (end < 0) return {selected, anchor};
  const start = shiftKey ? ids.indexOf(anchor) : -1;
  const affected = start < 0 ? [id] : ids.slice(Math.min(start, end), Math.max(start, end) + 1);
  const next = new Set(selected);
  const remove = altKey || (!shiftKey && next.has(id));
  for (const value of affected) {
    if (remove) next.delete(value);
    else next.add(value);
  }
  return {selected: next, anchor: start < 0 ? id : anchor};
}

export function selectRectangle(selected, rows, rectangle, deselect = false) {
  const next = new Set(selected);
  for (const {id, left, right, top, bottom} of rows) {
    if (left <= rectangle.right && right >= rectangle.left && top <= rectangle.bottom && bottom >= rectangle.top) {
      if (deselect) next.delete(id);
      else next.add(id);
    }
  }
  return next;
}

export function beginGroupRename(state, sourceId, name, route, sessionId) {
  if (!state.active || state.rename) return state;
  const selected = new Set(state.selected).add(sourceId);
  return {selected, rename: {
    sessionId, sourceId, ids: [...selected], route,
    initialName: name, draftName: name, saving: false, error: "",
  }};
}

export function updateGroupRename(state, sessionId, patch) {
  return state.rename?.sessionId === sessionId ? {rename: {...state.rename, ...patch}} : state;
}

export function finishGroupRename(state, sessionId) {
  return state.rename?.sessionId === sessionId ? {rename: null} : state;
}
