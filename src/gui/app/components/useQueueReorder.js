import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {AppContext} from '../internals/app-context';
import {apiCall} from '../internals/functions';
import {bindQueueReorder} from '../internals/queueReorder.mjs';
import {useSelectionStore} from '../stores/selectionStore';

export function useQueueReorder(containerRef, enabled, data, route) {
  const {refreshQueueItems} = useContext(AppContext);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const refreshRef = useRef(refreshQueueItems);
  const routeRef = useRef(route);
  refreshRef.current = refreshQueueItems;
  routeRef.current = route;
  useEffect(() => {setError('');}, [route]);

  const move = useCallback(async (request) => {
    if (!enabled || !request || busyRef.current || useSelectionStore.getState().rename) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await apiCall('queue_manager/reorder', {...request, route});
    } catch (error) {
      if (routeRef.current === route) setError(error.message === 'Request failed (404)'
        ? 'Restart ComfyUI to enable queue reordering.' : error.message || 'Could not reorder. Try again.');
    } finally {
      try {
        await refreshRef.current();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [enabled, route]);

  useEffect(() => {
    if (!enabled || busy || !containerRef.current) return;
    return bindQueueReorder(containerRef.current, useSelectionStore, setPreview, move);
  }, [enabled, busy, data, route, containerRef, move]);
  return {preview, busy, error, move};
}
