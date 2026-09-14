import {QueueManagerGalleryURL, QueueManagerOrigin, QueueManagerURL} from './config.js';
import {settings} from './settings.js';
import {installWorkflowNameInjection} from './workflow-name.js';

import { app } from '../../../scripts/app.js';

function theIframe() {
  return document.querySelector(".comfyui-queue-manager iframe");
}

export function postStatusMessageToIframe(event) {
  postMessageToIframe({
      name: event.type,
      detail: event.detail
  }, 'QM_queueStatusUpdated');
}

function postMessageToIframe(message, type) {
  if (!type) {
    type = 'QM_ParentMessage';
  }

  const iframe = theIframe();
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({
      type: type,
      message: message
    }, QueueManagerOrigin);
  }
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Keep the same elements (and their state/listeners) when ComfyUI redraws the toolbar.
let queuePauseButton = null;
let queueStopButton = null;


export async function AddPlayPauseButton(actionsContainer) {
  if (actionsContainer.querySelector('.pause-button')) return;
  if (queuePauseButton) {
    actionsContainer.appendChild(queuePauseButton);
    return;
  }

  const pauseButtonHTML = `
    <button class="pause-button infline-flex justify-center items-center p-button p-component p-button-icon-only p-button-danger p-button-text outline-hidden rounded-lg cursor-pointer p-0 size-8 text-xs !rounded-md border-none relative ml-2 mr-2 transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background" type="button" aria-label="Pause queue" title="Pause queue" data-pc-name="button" data-pd-tooltip="true">
      <span class="p-button-icon pi pi-pause" data-pc-section="icon"></span>
    </button>`;

  let pauseButton = null;
  let buttonIcon = null;
  // Add pause button if not already present
  if (!actionsContainer.querySelector('.pause-button')) {
    actionsContainer.insertAdjacentHTML('beforeend', pauseButtonHTML);
    pauseButton = actionsContainer.querySelector('.pause-button');
    queuePauseButton = pauseButton;
    buttonIcon = actionsContainer.querySelector('.pause-button .p-button-icon');
    pauseButton.addEventListener('click', async function () {
      try {
        // POST item[1] as json
        const response = await fetch(`/queue_manager/toggle`);
      } catch (error) {
        console.error("Error fetching queue items:", error);
      }
    });
  }

  app.api.addEventListener("queue-manager-toggle-queue", function (event) {
    if (!pauseButton || !buttonIcon) return;

    const paused = !!event.detail.paused;

    if (paused) {
      // show "play" icon and set labels to "Resume"
      buttonIcon.classList.remove('pi-pause');
      buttonIcon.classList.add('pi-caret-right');
      pauseButton.title = 'Resume queue';
      pauseButton.setAttribute('aria-label', 'Resume queue');
    } else {
      // show "pause" icon and set labels to "Pause"
      buttonIcon.classList.remove('pi-caret-right');
      buttonIcon.classList.add('pi-pause');
      pauseButton.title = 'Pause queue';
      pauseButton.setAttribute('aria-label', 'Pause queue');
    }
  });

  // Check if queue is paused (will trigger the event to update the button icon)
  try {
    const response = await fetch(`/queue_manager/playback`);
  } catch (error) {
    console.error("Error fetching playback status:", error);
  }
}

/**
 * Adds legacy-like stop button and pending jobs counter to tab button
 */
async function AddStopButton(actionsContainer) {
  if (actionsContainer.querySelector('.stop-button')) return;
  if (queueStopButton) {
    actionsContainer.appendChild(queueStopButton);
    return;
  }

  const stopButtonHTML = `
    <button class="stop-button justify-center items-center p-button p-component p-button-icon-only p-button-danger p-button-text outline-hidden rounded-lg cursor-pointer p-0 size-8 text-xs !rounded-md border-none relative ml-2 transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background p-button-disabled"  type="button" aria-label="Stop queue" title="Clear all pending" data-pc-name="button" data-pd-tooltip="true">
      <span class="p-button-icon pi pi-stop" data-pc-section="icon"></span>
    </button>`;

  // Add stop button if not already present
  if (!actionsContainer.querySelector('.stop-button')) {
    actionsContainer.insertAdjacentHTML('beforeend', stopButtonHTML);
    const stopButton = actionsContainer.querySelector('.stop-button');
    queueStopButton = stopButton;
    stopButton.addEventListener('click', async function () {
      try {
        const response = await fetch(`/api/queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({clear: true})
        });
      } catch (error) {
        console.error("Error fetching queue items:", error);
      }
    });
  }

  // listen to status updates to enable/disable stop button
  // and at the same time create / update the counter badge for tab button
  app.api.addEventListener("status", function (event) {
    const stopButton = queueStopButton;
    if (!stopButton) return;

    //if event.detail.exec_info.queue_remaining is set and greater than 0 then enable stop button
    const queueRemaining = event.detail?.exec_info?.queue_remaining;
    // Badge container
    const tabButton = document.querySelector('.comfyui-queue-manager-tab-button') ||
      document.querySelector('[data-testid="comfyui-queue-manager-tab-button"]');
    if (!tabButton) return;

    if (queueRemaining && queueRemaining > 0) {
      stopButton.disabled = false;
      stopButton.classList.remove('p-button-disabled');

      const displayCount = queueRemaining > 999 ? '999+' : queueRemaining;
      // Add a badge to show number of pending jobs


      const existingBadge = tabButton.querySelector('.counter-badge');
      if (existingBadge) {
        // Update existing badge
        existingBadge.textContent = displayCount;
        existingBadge.title = `${queueRemaining} jobs`;
      } else {
        const badgeHtml = `<span class="counter-badge absolute pl-1 pr-1.5 text-black text-xxs font-bold rounded-full" style="color: var(--bg-color); background: var(--fg-color); top:-2px; right:-3px" title="${queueRemaining} jobs">${displayCount}</span>`;

        tabButton.insertAdjacentHTML('beforeend', badgeHtml);
      }
    } else {
      stopButton.disabled = true;
      stopButton.classList.add('p-button-disabled');

      // Remove badge if present
      const badge = tabButton?.querySelector('.counter-badge');
      if (badge) {
        badge.remove();
      }
    }
  });

  // Check current status to set initial state of stop button
  try {
    const response = await fetch(`/queue_manager/poke_status`);
  } catch (error) {
    console.error("Error fetching status:", error);
  }

}

async function AddButtons(actionsContainer) {
  const current = typeof __COMFYUI_FRONTEND_VERSION__ !== 'undefined' ? __COMFYUI_FRONTEND_VERSION__ : '0.0.0';
  const pending = [];
  if (compareVersions(current, '1.33.1') >= 0) {
    // the new ui version has no stop button, and no counter, so we add our own
    pending.push(AddStopButton(actionsContainer));
  }
  pending.push(AddPlayPauseButton(actionsContainer));
  await Promise.all(pending);
}

export async function uiSetup () {
  let nodeSelector = null;

  const current = typeof __COMFYUI_FRONTEND_VERSION__ !== 'undefined' ? __COMFYUI_FRONTEND_VERSION__  : '0.0.0';

  if (compareVersions(current, '1.33.1') >= 0) {
    nodeSelector = '.actionbar > .p-panel-content-container > .p-panel-content > div';
  } else {
    nodeSelector = '.execution-actions';
  }

  const restoreButtons = () => {
      // Look up the live container: the previous one may have been replaced.
      const actionsContainer = document.querySelector(nodeSelector);
      if (actionsContainer) {
        AddButtons(actionsContainer);
      }
    };

    // Watch the canvas container for button removal and toolbar replacement.
    let graphContainer = document.getElementById('graph-canvas-container');
    let restoreScheduled = false;
    const observer = new MutationObserver(() => {
      if (restoreScheduled) return;
      restoreScheduled = true;

      // Merge DOM changes into one check per frame, including our own insertions.
      requestAnimationFrame(() => {
        restoreScheduled = false;
        if (!graphContainer) {
          graphContainer = document.getElementById('graph-canvas-container');
          if (graphContainer) {
            observer.disconnect();
            observer.observe(graphContainer, { childList: true, subtree: true });
          }
        }
        restoreButtons();
      });
    });

    // Only watch the body while waiting for the canvas container to mount.
    observer.observe(graphContainer || document.body, { childList: true, subtree: true });
    restoreButtons();
}

/**
 * When the queue status or workflow progress is updated then tell the iframe
 */
export function handleAPIEvents() {


    app.api.addEventListener("status", function (e) {
      postStatusMessageToIframe(e)
    });

    app.api.addEventListener("reconnected", async function (e) {
      // On reconnect fetch current playback status since it might have changed
      try {
        await fetch(`/queue_manager/playback`);
      } catch (error) {
        console.error("Error fetching playback status:", error);
      }
    });

    app.api.addEventListener("execution_start", function (e) {
      postStatusMessageToIframe(e)
    });

    app.api.addEventListener("execution_cached", function (e) {
      postStatusMessageToIframe(e)
    });

    app.api.addEventListener("executing", function (e) {
      postStatusMessageToIframe(e)
    })

    app.api.addEventListener("queue-manager-queue-updated", function (e) {
      postStatusMessageToIframe(e)
    })
}

/**
 *  Pass parent's key events to iframe
 */
export function handleKeyboardEvents() {

    window.addEventListener('keydown', e => {
      postMessageToIframe({key: e.key, isDown: true}, 'QM_ParentKeypress')
    });
    window.addEventListener('keyup', e => {
      postMessageToIframe({key: e.key, isDown: false}, 'QM_ParentKeypress')
    });
}


export function handleIframeMessages() {
  /**
     * Messages from iframe
     */
    window.addEventListener("message", async (event) => {
      if (event.origin !== QueueManagerOrigin) return;
      const { type, workflow, number } = event.data;

      // When workflow is received from iframe then load it into ComfyUI
      if (type === "QM_LoadWorkflow" && workflow) {
        // e.g. forward into ComfyUI’s API
        app.loadGraphData(workflow, true, true, workflow.workflow_name + ' ' + number);
      }

      // Handshake message from iframe
      if (type === "QM_QueueManager_Hello") {
        const settings = extensionSettings('values');
        // send back clientId to iframe
        event.source.postMessage(
          { type: "QM_QueueManager_Hello",
            clientId: app.api.clientId,
            settings
          },
          event.origin
        );
      }

      // Show gallery modal
      if (type === "QM_Gallery_Show") {
        document.body.classList.add('show-qm-fullscreen');
      }

      // Close gallery modal
      if (type === "QM_Gallery_Close") {
        document.body.classList.remove('show-qm-fullscreen');
      }

      // Load workflow from image file
      if (type === "QM_LoadWorkflowFromImage") {
        const filename = event.data.filename;
        const res = await fetch(event.data.fileURL, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const type =  res.headers.get('Content-Type');
        const theFile = new File([blob], filename, {type: type});

        app.handleFile(theFile);
      }
    }, false);
}

export function registerSidebar() {
  app.extensionManager.registerSidebarTab({
    id: "comfyui-queue-manager",
    icon: "pi pi-list-check",
    title: "Q Manager",
    tooltip: "Queue Manager",
    type: "custom",
    render: (el) => {
      el.innerHTML = `
        <style>
          .p-splitter[data-p-resizing="true"] .comfyui-queue-manager {pointer-events: none;}
          .comfyui-queue-manager { height: 100% }
        </style>
        <div class='comfyui-queue-manager flex flex-col'>
          <section class='app-iframe flex-1'>
            <iframe name="qm_queue_iframe" src="${QueueManagerURL}" class="w-full h-full border-0"></iframe>
          </section>
          <footer>
          </footer>
        </div>
      `;

      // append stylesheet to this document
      if (!document.getElementById("comfyui-queue-manager-stylesheet")) {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = `/extensions/comfyui_queue_manager/styles/manager.css`;
        style.type = "text/css";
        style.id = "comfyui-queue-manager-stylesheet";
        style.onload = function() {

        };
        document.head.appendChild(style);
      }

      // resize container
      el.style.height = '100%';
      el.parentElement.style.overflow = 'hidden';
    },
  });
}

export function injectWorkflowName() {
  installWorkflowNameInjection(app);
}

function postSettingToIframe(setting, newVal, oldVal) {
  postMessageToIframe({
    setting: setting,
    newValue: newVal,
    oldValue: oldVal
  }, 'QM_Setting_Changed');
}

export function extensionSettings(mode = 'default') {

  if (mode === 'default') {
    // append onChange handler to every setting
    for (const setting of settings) {
      setting.onChange = function(newVal, oldVal) {
        const id = setting.id.replace('QueueManager.', '');
        postSettingToIframe(id, newVal, oldVal);
      }
    }
    return settings;
  }

  if (mode === 'values') {
    // pull values for all settings and convert to tree object, split by dots in id
    const settingsTree = {};
    for (const setting of settings) {
      const value = app.extensionManager.setting.get(setting.id);
      const idParts = setting.id.split('.');
      let currentLevel = settingsTree;
      for (let i = 0; i < idParts.length; i++) {
        const part = idParts[i];
        if (i === idParts.length - 1) {
          currentLevel[part] = value;
        } else {
          if (!currentLevel[part]) {
            currentLevel[part] = {};
          }
          currentLevel = currentLevel[part];
        }
      }
    }

    return settingsTree.QueueManager;
  }

}


