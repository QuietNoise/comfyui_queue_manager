import { QM_ENVIRONMENT, QM_DEV_URL, QM_PROD_URL, QueueManagerURL } from './js/config.js';
import { postStatusMessageToIframe } from './js/functions.js';

import { app } from '../../scripts/app.js'




/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
  // async init() {
  // },
  async setup() {


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

    // app.api.addEventListener("progress", function (e) {
    //   console.log("Progress event: ", e.detail);
    // })



    /**
     * When workflow is received from iframe then load it into ComfyUI
     */
    window.addEventListener("message", (event) => {
      if (event.origin !== QueueManagerURL) return;
      const { type, workflow, number } = event.data;
      if (type === "QM_LoadWorkflow" && workflow) {
        // e.g. forward into ComfyUI’s API
        app.loadGraphData(workflow, true, true, workflow.workflow_name + ' ' + number);
      }
    }, false);


    app.extensionManager.registerSidebarTab({
      id: "comfyui-queue-manager",
      icon: "pi pi-list-check",
      title: "search",
      tooltip: "Queue Manager",
      type: "custom",
      render: (el) => {
        el.innerHTML = `
          <style>.p-splitter[data-p-resizing="true"] .comfyui-queue-manager {pointer-events: none}</style>
          <div class='comfyui-queue-manager flex flex-col' style="height: calc(100vh - var(--comfy-topbar-height) - 4px);">
            <header class="px-2 py-1 text-sm header">QUEUE MANAGER</header>
            <section class='app-iframe flex-1' style="background-color: var(--p-form-field-background);">
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
