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

    // /**
    //  * Observe mutation of the [data-pc-section="root"]
    //  */
    // const observer = new MutationObserver((mutations) => {
    //   console.log('mutations');
    //
    //   mutations.forEach((mutation) => {
    //     if (mutation.type === "attributes" && mutation.attributeName === "data-pc-section") {
    //       const target = mutation.target;
    //       if (target.getAttribute("data-pc-section") === "root") {
    //         console.log("Mutation observed on root section");
    //         // Send message to iframe with parent origin
    //         const iframe = theIframe();
    //         if (iframe && iframe.contentWindow) {
    //           // console.log("Sending QM_queueStatusUpdated message to iframe");
    //           iframe.contentWindow.postMessage({
    //             type: "QM_QueueManager_Hello",
    //             origin: window.location.origin,
    //           }, QueueManagerURL);
    //         }
    //       }
    //     }
    //   });
    // });
    //
    // // const targetNode = document.querySelector('[data-pc-section="root"]');
    // const targetNode = document.querySelector('.splitter-overlay-root');
    // const config = { attributes: true, childList: true, subtree: true };
    // observer.observe(targetNode, config);
    //
    // // on event when front end is fully loaded
    // app.api.addEventListener("ready", function (e) {
    //   console.log("ComfyUI Queue Manager ready", e);
    //   // Send message to iframe with parent origin
    //   const iframe = theIframe();
    //   if (iframe && iframe.contentWindow) {
    //     // console.log("Sending QM_queueStatusUpdated message to iframe");
    //     iframe.contentWindow.postMessage({
    //       type: "QM_QueueManager_Hello",
    //       origin: window.location.origin,
    //     }, QueueManagerURL);
    //   }
    // });




    // await app.loadGraphData(
    //       JSON.parse(pngInfo.workflow),
    //       true,
    //       true,
    //       fileName
    // )

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
            <header class="p-2 font-bold">Queue Manager</header>
            <section class='app-iframe flex-1' style="background-color: var(--p-form-field-background);">
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
