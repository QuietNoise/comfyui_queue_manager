import {QM_ENVIRONMENT, QM_DEV_URL, QM_PROD_URL, QueueManagerURL, QueueManagerOrigin} from './js/config.js';
import {postMessageToIframe, postStatusMessageToIframe} from './js/functions.js';

import { app } from '../../scripts/app.js';

function compareVersions(a, b) {
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

export async function AddPlayPauseButton(actionsContainer) {
  const pauseButtonHTML = `
    <button class="pause-button p-button p-component p-button-icon-only p-button-danger p-button-text outline-hidden rounded-lg cursor-pointer p-0 size-8 text-xs !rounded-md border-none relative ml-2 mr-2 transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background" type="button" aria-label="Pause queue" title="Pause queue" data-pc-name="button" data-pd-tooltip="true">
      <span class="p-button-icon pi pi-pause" data-pc-section="icon"></span>
      <span class="p-button-label" data-pc-section="label">&nbsp;</span>
    </button>`;

  let pauseButton = null;
  let buttonIcon = null;
  // Add pause button if not already present
  if (!actionsContainer.querySelector('.pause-button')) {
    actionsContainer.insertAdjacentHTML('beforeend', pauseButtonHTML);
    pauseButton = actionsContainer.querySelector('.pause-button');
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
  const stopButtonHTML = `
    <button class="stop-button p-button p-component p-button-icon-only p-button-danger p-button-text outline-hidden rounded-lg cursor-pointer p-0 size-8 text-xs !rounded-md border-none relative ml-2 transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background p-button-disabled"  type="button" aria-label="Stop queue" title="Clear all pending" data-pc-name="button" data-pd-tooltip="true">
      <span class="p-button-icon pi pi-stop" data-pc-section="icon"></span>
      <span class="p-button-label" data-pc-section="label">&nbsp;</span>
    </button>`;

  // Add stop button if not already present
  if (!actionsContainer.querySelector('.stop-button')) {
    actionsContainer.insertAdjacentHTML('beforeend', stopButtonHTML);
    const stopButton = actionsContainer.querySelector('.stop-button');
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
    const stopButton = actionsContainer.querySelector('.stop-button');
    if (!stopButton) return;

    //if event.detail.exec_info.queue_remaining is set and greater than 0 then enable stop button
    const queueRemaining = event.detail.exec_info && event.detail.exec_info.queue_remaining;
    if (queueRemaining && queueRemaining > 0) {
      stopButton.disabled = false;
      stopButton.classList.remove('p-button-disabled');

      const displayCount = queueRemaining > 999 ? '999+' : queueRemaining;
      // Add a badge to show number of pending jobs
      const tabButton = document.querySelector('.comfyui-queue-manager-tab-button');

      const existingBadge = tabButton.querySelector('.counter-badge');
      if (existingBadge) {
        // Update existing badge
        existingBadge.textContent = displayCount;
        existingBadge.title = `${queueRemaining} jobs`;
      } else {
        const badgeHtml = `<span class="counter-badge absolute pl-1 pr-2 text-black text-xxs font-bold rounded-full px-1.5" style="color: var(--p-button-primary-color); background: var(--p-button-primary-background); top:-2px; right:-3px" title="${queueRemaining} jobs">${displayCount}</span>`;

        tabButton.insertAdjacentHTML('beforeend', badgeHtml);
      }
    } else {
      stopButton.disabled = true;
      stopButton.classList.add('p-button-disabled');

      // Remove badge if present
      const badge = document.querySelector('.comfyui-queue-manager-tab-button .counter-badge');
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
  if (compareVersions(__COMFYUI_FRONTEND_VERSION__, '1.33.1') >= 0) {
    // the new ui version has no stop button, and no counter, so we add our own
    await AddStopButton(actionsContainer);
  }
  await AddPlayPauseButton(actionsContainer);
}


/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
  // async init() {
  // },
  async setup() {
    setTimeout(async function () {
      let nodeSelector = null;

      const current = typeof __COMFYUI_FRONTEND_VERSION__ !== 'undefined' ? __COMFYUI_FRONTEND_VERSION__  : '0.0.0';

      if (compareVersions(current, '1.33.1') >= 0) {
        nodeSelector = '.actionbar > .p-panel-content-container > .p-panel-content > div';
      } else {
        nodeSelector = '.execution-actions';
      }

      const actionsContainer = document.querySelector(nodeSelector);

      if (actionsContainer) {
        console.log("Actions container found", actionsContainer);
        await AddButtons(actionsContainer);
        return;
      }

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.matches(nodeSelector)) {
                observer.disconnect();
                AddButtons(node);
                return;
              }

              const foundActionbar = node.querySelector(nodeSelector);
              if (foundActionbar) {
                observer.disconnect();
                AddButtons(foundActionbar);
                return;
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });





    /**
     * When the queue status or workflow progress is updated then tell the iframe
     * @param event
     */

    app.api.addEventListener("status", function (e) {
      postStatusMessageToIframe(e)
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



    // Pass parent's key events to iframe
    window.addEventListener('keydown', e => {
      postMessageToIframe({key: e.key, isDown: true}, 'QM_ParentKeypress')
    });
    window.addEventListener('keyup', e => {
      postMessageToIframe({key: e.key, isDown: false}, 'QM_ParentKeypress')
    });



    /**
     * When workflow is received from iframe then load it into ComfyUI
     */
    window.addEventListener("message", async (event) => {
      if (event.origin !== QueueManagerOrigin) return;
      const { type, workflow, number } = event.data;

      if (type === "QM_LoadWorkflow" && workflow) {
        // e.g. forward into ComfyUI’s API
        app.loadGraphData(workflow, true, true, workflow.workflow_name + ' ' + number);
      }

      if (type === "QM_QueueManager_Hello") {
        event.source.postMessage(
          { type: "QM_QueueManager_Hello", clientId: app.api.clientId },
          event.origin
        );
      }
    }, false);


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
            <header class="px-2 py-1 text-sm header">
              QUEUE MANAGER
            </header>
            <section class='app-iframe flex-1'>
              <iframe src="${QueueManagerURL}" class="w-full h-full border-0"></iframe>
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
            // console.log("Queue Manager stylesheet loaded");
          };
          document.head.appendChild(style);
        }

        // resize container
        el.style.height = '100%';
        el.parentElement.style.overflow = 'hidden';
      },
    });


    const _apiQueuePrompt = app.api.queuePrompt;

    app.api.queuePrompt = async function(n, data, ...args) {
      // Inject workflow name
      // SIML: Perhaps add a setting to enable/disable this behaviour (privacy concern? the workflow name will travel all the way to the generated PNG)
      data.workflow.workflow_name = app.extensionManager.workflow.activeWorkflow.filename;


      return await _apiQueuePrompt.call(app.api, n, data, ...args);
    };

    // app.api.addEventListener("promptQueued", function (e) {
    //   console.log("PromptQueued app.api", e);
    // })
    //
  }
})
