// Reordering uses an anchor, never a replacement list from a filtered page.
export function reorderGroup(ids, sourceId, selection) {
  if (!ids.includes(sourceId)) return [];
  return ids.filter((id) => id === sourceId || (selection.active && selection.selected.has(id)));
}

export function reorderTarget(rows, moving, y, direction = 'down') {
  const remaining = rows.filter((row) => !moving.includes(row.id));
  if (!remaining.length) return null;
  const nextIndex = remaining.findIndex((row) => y < (row.top + row.bottom) / 2);
  // At either end only one anchor exists. Between rows, choose the anchor
  // on the side we are moving toward; this matters when filters hide jobs.
  if (nextIndex === -1 || (direction === 'up' && nextIndex > 0)) {
    const previous = nextIndex === -1 ? remaining.at(-1) : remaining[nextIndex - 1];
    return {target_id: previous.id, position: 'after', line: previous.bottom, anchorSide: 'top'};
  }
  const next = remaining[nextIndex];
  return {target_id: next.id, position: 'before', line: next.top, anchorSide: 'bottom'};
}

export function keyboardReorder(ids, moving, direction) {
  const index = direction === 'up' ? ids.indexOf(moving[0]) - 1 : ids.indexOf(moving.at(-1)) + 1;
  return ids[index] == null ? null : {ids: moving, target_id: ids[index], position: direction === 'up' ? 'before' : 'after'};
}

export function reorderChangesOrder(ids, moving, target) {
  if (!target) return false;
  const remaining = ids.filter((id) => !moving.includes(id));
  const index = remaining.indexOf(target.target_id);
  if (index < 0) return false;
  remaining.splice(index + (target.position === 'after' ? 1 : 0), 0, ...moving);
  return remaining.some((id, i) => id !== ids[i]);
}

export function moveSelectionTo(ids, selected, destination) {
  const moving = ids.filter((id) => selected.has(id));
  if (!moving.length) return null;
  if (destination === 'start' || destination === 'end') return {ids: moving, destination};
  if (destination !== 'page_top' && destination !== 'page_bottom') return null;
  const remaining = ids.filter((id) => !selected.has(id));
  if (!remaining.length) return null;
  const target = destination === 'page_top'
    ? {target_id: remaining[0], position: 'before'}
    : {target_id: remaining.at(-1), position: 'after'};
  return reorderChangesOrder(ids, moving, target) ? {ids: moving, ...target} : null;
}

export function bindQueueReorder(container, store, onPreview, onDrop) {
  const view = container.ownerDocument.defaultView;
  let drag = null, frame, clickTimer;
  const rows = () => [...container.querySelectorAll('[data-reorder-id]')].map((row) => {
    const {top, bottom} = row.getBoundingClientRect();
    return {id: Number(row.dataset.reorderId), top, bottom};
  });
  const stop = () => {
    const previous = drag;
    if (previous?.moved) suppressRelease();
    drag = null;
    view.cancelAnimationFrame(frame);
    if (previous && container.hasPointerCapture(previous.pointerId)) container.releasePointerCapture(previous.pointerId);
    container.classList.remove('reordering');
    onPreview(null);
    return previous;
  };
  const blockClick = (event) => {event.preventDefault(); event.stopImmediatePropagation();};
  const clearClickGuard = () => {
    view.clearTimeout(clickTimer);
    view.removeEventListener('click', blockClick, {capture: true});
    view.removeEventListener('pointerup', releaseClickGuard);
    view.removeEventListener('pointercancel', releaseClickGuard);
    view.removeEventListener('pointerdown', clearClickGuard, {capture: true});
  };
  const releaseClickGuard = () => {
    clickTimer = view.setTimeout(clearClickGuard, 0);
  };
  const suppressRelease = () => {
    // This guard outlives cancelled drags and controller cleanup until release.
    view.addEventListener('click', blockClick, {capture: true});
    view.addEventListener('pointerup', releaseClickGuard);
    view.addEventListener('pointercancel', releaseClickGuard);
    view.addEventListener('pointerdown', clearClickGuard, {capture: true});
  };
  const update = () => {
    if (!drag?.moved) return;
    const bounds = container.getBoundingClientRect();
    const inside = drag.pointer.clientX >= bounds.left && drag.pointer.clientX <= bounds.right &&
      drag.pointer.clientY >= bounds.top && drag.pointer.clientY <= bounds.bottom;
    const target = inside ? reorderTarget(rows(), drag.ids, drag.pointer.clientY, drag.direction) : null;
    drag.target = reorderChangesOrder(drag.order, drag.ids, target) ? target : null;
    onPreview({ids: drag.ids, anchorId: drag.target?.target_id, anchorSide: drag.target?.anchorSide,
      position: drag.target?.position, line: drag.target ? target.line - bounds.top + container.scrollTop : null,
      top: Math.max(0, Math.min(bounds.height - 28, drag.pointer.clientY - bounds.top)) + container.scrollTop});
  };
  const scroll = () => {
    if (!drag?.moved) return;
    const bounds = container.getBoundingClientRect();
    if (drag.pointer.clientX >= bounds.left && drag.pointer.clientX <= bounds.right) {
      if (drag.pointer.clientY < bounds.top + 40) container.scrollTop -= 12;
      else if (drag.pointer.clientY > bounds.bottom - 32) container.scrollTop += 12;
    }
    update();
    frame = view.requestAnimationFrame(scroll);
  };
  const down = (event) => {
    const handle = event.target.closest('[data-reorder-handle]');
    if (!handle || handle.disabled || event.button !== 0 || event.isPrimary === false || store.getState().rename) return;
    event.preventDefault();
    const order = rows().map((row) => row.id);
    const ids = reorderGroup(order, Number(handle.dataset.reorderHandle), store.getState());
    if (!ids.length) return;
    handle.focus({preventScroll: true});
    drag = {ids, order, pointerId: event.pointerId, pointer: event, direction: 'down', startY: event.clientY, startX: event.clientX, moved: false};
    container.setPointerCapture(event.pointerId);
  };
  const trackPointer = (event) => {
    // Use the latest vertical movement, not the displacement from the start.
    // Horizontal movement and stationary releases keep the last direction.
    if (event.clientY < drag.pointer.clientY) drag.direction = 'up';
    else if (event.clientY > drag.pointer.clientY) drag.direction = 'down';
    drag.pointer = event;
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    trackPointer(event);
    if (!drag.moved && Math.hypot(event.clientY - drag.startY, event.clientX - drag.startX) >= 4) {
      if (store.getState().active) store.getState().setSelected(new Set(drag.ids));
      drag.moved = true;
      container.classList.add('reordering');
      frame = view.requestAnimationFrame(scroll);
    }
    if (drag.moved) {event.preventDefault(); update();}
  };
  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    trackPointer(event);
    if (drag.moved) update();
    const previous = stop();
    if (event.type === 'pointerup' || event.type === 'pointercancel') releaseClickGuard();
    if (event.type === 'pointerup' && previous.moved && previous.target) {
      onDrop({ids: previous.ids, target_id: previous.target.target_id, position: previous.target.position});
    }
  };
  const key = (event) => {
    if (drag && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressRelease();
      stop();
      return;
    }
    if (drag) return;
    const handle = event.target.closest?.('[data-reorder-handle]');
    if (!handle || handle.disabled || store.getState().rename || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const order = rows().map((row) => row.id);
    const ids = reorderGroup(order, Number(handle.dataset.reorderHandle), store.getState());
    const target = keyboardReorder(order, ids, event.key === 'ArrowUp' ? 'up' : 'down');
    if (!target) return;
    if (store.getState().active) store.getState().setSelected(new Set(ids));
    onDrop(target);
  };
  const nativeDrag = (event) => {if (drag) event.preventDefault();};
  const unsubscribe = store.subscribe((state, previous) => {
    if (drag && (state.active !== previous.active || state.rename)) stop();
  });
  container.addEventListener('pointerdown', down);
  container.addEventListener('dragstart', nativeDrag);
  container.addEventListener('lostpointercapture', end);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('keydown', key, {capture: true});
  return () => {
    unsubscribe();
    stop();
    container.removeEventListener('pointerdown', down);
    container.removeEventListener('dragstart', nativeDrag);
    container.removeEventListener('lostpointercapture', end);
    view.removeEventListener('pointermove', move);
    view.removeEventListener('pointerup', end);
    view.removeEventListener('pointercancel', end);
    view.removeEventListener('keydown', key, {capture: true});
  };
}
