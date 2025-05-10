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
    // Envo dependant values
    const QueueManagerURL = QM_ENVIRONMENT === "development" ? QM_DEV_URL : QM_PROD_URL;

    function onQueueStatusUpdate(event) {
      // api.fetchApi(`/queue_manager/queue`); // save the queue
      console.log("ComfyUI Queue Manager status:", event);

      // if frame is loaded, send message to iframe
      const iframe = document.querySelector(".comfyui-queue-manager iframe");
      if (iframe && iframe.contentWindow) {
        console.log("Sending QM_queueStatusUpdated message to iframe");
        iframe.contentWindow.postMessage({
          type: "QM_queueStatusUpdated"
        }, QueueManagerURL);
      }
    }
    app.api.addEventListener("status", onQueueStatusUpdate);

    app.extensionManager.registerSidebarTab({
      id: "comfyui-queue-manager",
      icon: "pi pi-list-check",
      title: "search",
      tooltip: "Queue Manager",
      type: "custom",
      render: (el) => {
        el.innerHTML = `
          <style>.p-splitter[data-p-resizing="true"] .comfyui-queue-manager {pointer-events: none}</style>
          <div class='comfyui-queue-manager flex flex-col p-1' style="height: calc(100vh - var(--comfy-topbar-height) - 4px);">
            <header class="p-1">Queue Manager</header>
            <section class='app-iframe flex-1 p-2' style="background-color: var(--p-form-field-background);">
              <iframe src="${QueueManagerURL}" class="w-full h-full border-0"></iframe>
            </section>
          </div>
        `;
      },
    });


    const _apiQueuePrompt = app.api.queuePrompt;

    app.api.queuePrompt = function(n, data) {
      // Inject workflow name
      // SIML: Perhaps add a setting to enable/disable this behaviour (privacy concern? the workflow name will travel all the way to the generated PNG)
      data.workflow.workflow_name = app.extensionManager.workflow.activeWorkflow.filename;

      return _apiQueuePrompt(n, data);
    };

    //// Load front end UI into iframe
    // const el = document.createElement("iframe");
    // el.src = "/extensions/comfyui_queue_manager/.gui/index.html";
    // el.style.cssText =
    //   "position:fixed;right:0;top:0;height:100%;width:380px;z-index:3000;border:none;";
    // document.body.appendChild(el);


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
