const installedApps = new WeakSet();

/** Let ComfyUI mount and restore the controls through its compatibility menu API. */
export async function installQueueControls(app, ComfyButton, includeStopButton) {
  if (installedApps.has(app)) return;

  const pauseButton = new ComfyButton({
    icon: 'pause',
    tooltip: 'Pause queue',
    classList: 'comfyui-button qm-toolbar-button pause-button',
    action: async () => {
      try {
        // Read the live setting because ComfyUI may still be saving it.
        const cleanCaches = app.extensionManager.setting.get('QueueManager.Basic.CleanCachesOnPause') === true;
        const response = await fetch(`/queue_manager/toggle?clean_caches=${cleanCaches}`);
        if (!response.ok) throw new Error(`Queue playback request failed (${response.status})`);
      } catch (error) {
        console.error('Error toggling queue playback:', error);
      }
    }
  });
  let stopButton;
  if (includeStopButton) {
    stopButton = new ComfyButton({
      icon: 'stop',
      tooltip: 'Clear all pending',
      enabled: false,
      classList: 'comfyui-button qm-toolbar-button stop-button',
      action: async () => {
        try {
          const response = await fetch('/api/queue', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({clear: true})
          });
          if (!response.ok) throw new Error(`Queue clear request failed (${response.status})`);
        } catch (error) {
          console.error('Error clearing pending queue items:', error);
        }
      }
    });
    app.menu.actionsGroup.append(stopButton);
  }
  app.menu.actionsGroup.append(pauseButton);
  installedApps.add(app);

  app.api.addEventListener('queue-manager-toggle-queue', event => {
    const paused = !!event.detail.paused;
    pauseButton.icon = paused ? 'play' : 'pause';
    pauseButton.tooltip = paused ? 'Resume queue' : 'Pause queue';
    // ComfyButton updates title through tooltip, but sets aria-label only at creation.
    pauseButton.element.setAttribute('aria-label', pauseButton.tooltip);
  });

  if (stopButton) {
    app.api.addEventListener('status', event => {
      const queueRemaining = event.detail?.exec_info?.queue_remaining;
      stopButton.enabled = queueRemaining > 0;
      const tabButton = document.querySelector('.comfyui-queue-manager-tab-button') ||
        document.querySelector('[data-testid="comfyui-queue-manager-tab-button"]');
      if (!tabButton) return;

      const badge = tabButton.querySelector('.counter-badge');
      if (queueRemaining > 0) {
        const displayCount = queueRemaining > 999 ? '999+' : queueRemaining;
        if (badge) {
          badge.textContent = displayCount;
          badge.title = `${queueRemaining} jobs`;
        } else {
          tabButton.insertAdjacentHTML('beforeend', `<span class="counter-badge absolute pl-1 pr-1.5 text-black text-xxs font-bold rounded-full" style="color: var(--bg-color); background: var(--fg-color); top:-2px; right:-3px" title="${queueRemaining} jobs">${displayCount}</span>`);
        }
      } else {
        badge?.remove();
      }
    });
  }

  const requests = ['/queue_manager/playback'];
  if (stopButton) requests.push('/queue_manager/poke_status');
  await Promise.all(requests.map(async url => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Queue status request failed (${response.status})`);
    } catch (error) {
      console.error('Error fetching queue status:', error);
    }
  }));
}
