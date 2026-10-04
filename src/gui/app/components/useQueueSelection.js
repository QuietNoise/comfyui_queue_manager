import {useEffect, useRef, useState} from 'react';
import {useSelectionStore} from '../stores/selectionStore';
import {bindQueueSelectionDrag} from '../internals/queueSelectionDrag.mjs';

export function useQueueSelection(containerRef, enabled, ids) {
  const [rectangle, setRectangle] = useState(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      setRectangle(null);
      return;
    }
    // Mode changes during a drag must not detach its pointer listeners.
    return bindQueueSelectionDrag(container, useSelectionStore, setRectangle,
      (value) => {suppressClick.current = value;});
  }, [enabled, containerRef]);

  const onClickCapture = (event) => {
    if (!enabled) return;
    if (suppressClick.current) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (!useSelectionStore.getState().active || event.target.closest('[data-selection-ignore]')) return;
    const row = event.target.closest('tbody tr');
    if (!row) return;
    event.stopPropagation();
    const id = Number(row.dataset.selectionId);
    if (ids.includes(id)) useSelectionStore.getState().click(ids, id, event);
  };
  return {rectangle, onClickCapture};
}
