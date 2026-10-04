import {useContext, useEffect, useRef, useState} from 'react';
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

  useEffect(() => {
    if (!enabled || busy || !containerRef.current) return;
    return bindQueueReorder(containerRef.current, useSelectionStore, setPreview, async (move) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        await apiCall('queue_manager/reorder', {...move, route});
      } catch (error) {
        if (routeRef.current === route) setError(error.message === 'Request failed (404)'
          ? 'Restart ComfyUI to enable queue reordering.' : error.message || 'Could not reorder. Try again.');
      } finally {
        await refreshRef.current();
        busyRef.current = false;
        setBusy(false);
      }
    });
  }, [enabled, busy, data, route, containerRef]);
  return {preview, busy, error};
}
