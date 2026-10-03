import {useEffect, useRef, useState} from 'react';
import {useSelectionStore} from '../stores/selectionStore';
import {selectRectangle} from '../internals/queueSelection.mjs';

export function useQueueSelection(containerRef, active, ids) {
  const [rectangle, setRectangle] = useState(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) {
      setRectangle(null);
      return;
    }
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
      useSelectionStore.getState().setSelected(selectRectangle(drag.initial, rows, box, drag.pointer.altKey));
    };
    const autoScroll = () => {
      if (!drag?.moved) return;
      const bounds = container.getBoundingClientRect();
      const y = drag.pointer.clientY;
      const previousScrollTop = container.scrollTop;
      if (y < bounds.top + 32) container.scrollTop -= 12;
      else if (y > bounds.bottom - 32) container.scrollTop += 12;
      if (previousScrollTop !== container.scrollTop) update();
      frame = requestAnimationFrame(autoScroll);
    };
    const down = (event) => {
      if (event.button !== 0 || event.target.closest('[data-selection-ignore], thead, input, button')) return;
      suppressClick.current = false;
      drag = {start: point(event), pointer: event, initial: useSelectionStore.getState().selected, moved: false};
    };
    const move = (event) => {
      if (!drag) return;
      drag.pointer = event;
      if (!drag.moved && Math.hypot(point(event).x - drag.start.x, point(event).y - drag.start.y) >= 4) {
        drag.moved = true;
        container.setPointerCapture(event.pointerId);
        frame = requestAnimationFrame(autoScroll);
      }
      if (drag.moved) {
        event.preventDefault();
        update();
      }
    };
    const end = (event) => {
      if (!drag) return;
      if (drag.moved && event.type === 'pointerup') {
        drag.pointer = event;
        update();
      }
      if (event.type === 'pointercancel') useSelectionStore.getState().setSelected(drag.initial);
      suppressClick.current = drag.moved;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      drag = null;
      cancelAnimationFrame(frame);
      setRectangle(null);
      clickTimer = setTimeout(() => {suppressClick.current = false;}, 0);
    };
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      if (drag && container.hasPointerCapture(drag.pointer.pointerId)) container.releasePointerCapture(drag.pointer.pointerId);
      cancelAnimationFrame(frame);
      clearTimeout(clickTimer);
      suppressClick.current = false;
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [active, containerRef]);

  const onClickCapture = (event) => {
    if (!active || event.target.closest('[data-selection-ignore]')) return;
    const row = event.target.closest('tbody tr');
    if (!row && !suppressClick.current) return;
    event.stopPropagation();
    if (suppressClick.current) {
      event.preventDefault();
      return;
    }
    const id = Number(row?.dataset.selectionId);
    if (ids.includes(id)) useSelectionStore.getState().click(ids, id, event);
  };
  return {rectangle, onClickCapture};
}
