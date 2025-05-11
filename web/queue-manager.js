const QM_ENVIRONMENT = "development"; // Any other value will be treated as production

const QM_DEV_URL = "http://localhost:3001"; // The URL of the development server for nextjs project. Check front end README for Cross-Origin issues
const QM_PROD_URL = "/extensions/comfyui_queue_manager/.gui"; // The path where the build sits in the comfyui frontend

import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'
// import { ui } from '../../scripts/ui.js'




/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
  async setup() {
    // Envo dependant manager URL
    const QueueManagerURL = QM_ENVIRONMENT === "development" ? QM_DEV_URL : QM_PROD_URL;

    function theIframe() {
      return document.querySelector(".comfyui-queue-manager iframe");
    }

    /**
     * When the queue status is updated tell iframe to refresh queue items
     * @param event
     */
    function onQueueStatusUpdate(event) {

      // if frame is loaded, send message to iframe
      const iframe = theIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "QM_queueStatusUpdated"
        }, QueueManagerURL);
      }
    }
    app.api.addEventListener("status", onQueueStatusUpdate);

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
              <header class="p-2 text-sm">Current Worflow</header>
              <div class="p-2">
                <button onclick={onQueueStatusUpdate} class="hover:bg-neutral-700 text-neutral-200 font-bold py-1 px-2 rounded mr-1 border-0 bg-green-900">Add to archive</button>
              </div>
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
            console.log("Queue Manager stylesheet loaded");
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
    // app.api.addEventListener("executing", function (e) {
    //   console.log("Executing app.api", e);
    // })

    // console.log("Attempt to restore queue.");
    // api.fetchApi(`/queue_manager/restore`);
  }
})
