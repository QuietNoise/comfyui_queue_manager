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
