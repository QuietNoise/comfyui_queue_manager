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

async function AddPlayPauseButton(actionsContainer) {
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
      console.error("Error fetching queue items:", error);
    }
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
        await AddPlayPauseButton(actionsContainer);
        return;
      }

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.matches(nodeSelector)) {
                observer.disconnect();
                AddPlayPauseButton(node);
                return;
              }

              const foundActionbar = node.querySelector(nodeSelector);
              if (foundActionbar) {
                observer.disconnect();
                AddPlayPauseButton(foundActionbar);
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
