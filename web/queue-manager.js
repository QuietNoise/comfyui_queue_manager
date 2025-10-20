import {QM_ENVIRONMENT, QM_DEV_URL, QM_PROD_URL, QueueManagerURL, QueueManagerOrigin} from './js/config.js';
import {postMessageToIframe, postStatusMessageToIframe} from './js/functions.js';

import { app } from '../../scripts/app.js'



/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
  // async init() {
  // },
  async setup() {
    const pauseButtonHTML = `
      <button data-v-43776fb9="" class="pause-button p-button p-component p-button-icon-only p-button-danger p-button-text" type="button" aria-label="Pause queue" data-pc-name="button" data-pd-tooltip="true">
        <span class="p-button-icon pi pi-pause" data-pc-section="icon"></span>
        <span class="p-button-label" data-pc-section="label">&nbsp;</span>
      </button>`

    // when window fully loaded
    let pauseButton = null;
    let buttonIcon = null;
    setTimeout(async function () {
      const actionsContainer = document.querySelector('.execution-actions');
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
          if (event.detail.paused) { // remove pi-play and add pi-pause to buttonIcon
            buttonIcon.classList.remove('pi-pause');
            buttonIcon.classList.add('pi-caret-right');
          } else {
            buttonIcon.classList.remove('pi-caret-right');
            buttonIcon.classList.add('pi-pause');
          }
        });

        // WebSocket messages
        // app.api.socket.addEventListener('message', (event) => {
        //   console.log(event.data);
        // });

        // Check if queue is paused (will trigger the event to update the button icon)
        try {
          const response = await fetch(`/queue_manager/playback`);
        } catch (error) {
          console.error("Error fetching queue items:", error);
        }

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
    window.addEventListener("message", (event) => {
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
      },
    });


    const _apiQueuePrompt = app.api.queuePrompt;

    app.api.queuePrompt = function(n, data) {
      // Inject workflow name
      // SIML: Perhaps add a setting to enable/disable this behaviour (privacy concern? the workflow name will travel all the way to the generated PNG)
      data.workflow.workflow_name = app.extensionManager.workflow.activeWorkflow.filename;


      return _apiQueuePrompt.call(app, n, data);
    };

    // app.api.addEventListener("promptQueued", function (e) {
    //   console.log("PromptQueued app.api", e);
    // })
    //
  }
})
