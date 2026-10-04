import {selectRectangle} from './queueSelection.mjs';

export function bindQueueSelectionDrag(container, store, setRectangle, suppressClick) {
  const view = container.ownerDocument.defaultView;
  let drag = null;
  let frame;
  let clickTimer;
  const point = (event) => {
    const bounds = container.getBoundingClientRect();
    return {x: event.clientX - bounds.left + container.scrollLeft,
      y: event.clientY - bounds.top + container.scrollTop};
  };
  const update = () => {
    if (!drag?.moved) return;
    const end = point(drag.pointer);
    const box = {left: Math.min(drag.start.x, end.x), right: Math.max(drag.start.x, end.x),
      top: Math.min(drag.start.y, end.y), bottom: Math.max(drag.start.y, end.y)};
    const bounds = container.getBoundingClientRect();
    const rows = [...container.querySelectorAll('[data-selection-id]')].map((row) => {
      const rect = row.getBoundingClientRect();
      return {id: Number(row.dataset.selectionId), left: rect.left - bounds.left + container.scrollLeft,
        right: rect.right - bounds.left + container.scrollLeft, top: rect.top - bounds.top + container.scrollTop,
        bottom: rect.bottom - bounds.top + container.scrollTop};
    });
    setRectangle(box);
    store.getState().setSelected(selectRectangle(drag.initial, rows, box, drag.pointer.altKey));
  };
  const autoScroll = () => {
    if (!drag?.moved) return;
    const bounds = container.getBoundingClientRect();
    const y = drag.pointer.clientY;
    const previousScrollTop = container.scrollTop;
    if (y < bounds.top + 32) container.scrollTop -= 12;
    else if (y > bounds.bottom - 32) container.scrollTop += 12;
    if (previousScrollTop !== container.scrollTop) update();
    frame = view.requestAnimationFrame(autoScroll);
  };
  const stop = () => {
    const previous = drag;
    drag = null;
    view.cancelAnimationFrame(frame);
    if (previous && container.hasPointerCapture(previous.pointer.pointerId)) {
      container.releasePointerCapture(previous.pointer.pointerId);
    }
    container.classList.remove('drag-selecting');
    setRectangle(null);
    return previous;
  };
  const down = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    view.clearTimeout(clickTimer);
    suppressClick(false);
    if (event.target.closest(
      '[data-selection-ignore], thead, input, textarea, select, [contenteditable="true"], button:not(.workflow-name-label), video[controls]'
    )) return;
    // Keep normal touch scrolling available until selection is explicitly enabled.
    if (event.pointerType === 'touch' && !store.getState().active) return;
    if (!container.querySelector('[data-selection-id]')) return;
    drag = {start: point(event), pointer: event, initial: store.getState().selected, moved: false};
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.pointer.pointerId) return;
    drag.pointer = event;
    if (!drag.moved && Math.hypot(point(event).x - drag.start.x, point(event).y - drag.start.y) >= 4) {
      drag.moved = true;
      container.setPointerCapture(event.pointerId);
      container.classList.add('drag-selecting');
      const selection = view.getSelection();
      if (selection?.anchorNode && container.contains(selection.anchorNode)) selection.removeAllRanges();
      store.getState().enable();
      frame = view.requestAnimationFrame(autoScroll);
    }
    if (drag.moved) {
      event.preventDefault();
      update();
    }
  };
  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointer.pointerId) return;
    if (drag.moved && event.type === 'pointerup') {
      drag.pointer = event;
      update();
    }
    if (event.type === 'pointercancel' && store.getState().active) store.getState().setSelected(drag.initial);
    suppressClick(drag.moved);
    stop();
    clickTimer = view.setTimeout(() => suppressClick(false), 0);
  };
  const preventNativeDrag = (event) => {
    if (drag) event.preventDefault();
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (previous.active && !state.active && drag) {
      suppressClick(drag.moved);
      stop();
    }
  });
  container.addEventListener('pointerdown', down);
  container.addEventListener('dragstart', preventNativeDrag);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  return () => {
    unsubscribe();
    stop();
    view.clearTimeout(clickTimer);
    suppressClick(false);
    container.removeEventListener('pointerdown', down);
    container.removeEventListener('dragstart', preventNativeDrag);
    view.removeEventListener('pointermove', move);
    view.removeEventListener('pointerup', end);
    view.removeEventListener('pointercancel', end);
  };
}
