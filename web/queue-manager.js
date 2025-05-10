import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

console.log("Queue Manager JS loaded", app);

/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
  async setup() {
    function onQueueStatusUpdate(event) {
      // api.fetchApi(`/queue_manager/queue`); // save the queue
      console.log("ComfyUI Queue Manager status:", event);

      // if frame is loaded, send message to iframe
      const iframe = document.querySelector(".comfyui-queue-manager iframe");
      if (iframe && iframe.contentWindow) {
        console.log("Sending QM_queueStatusUpdated message to iframe");
        iframe.contentWindow.postMessage({
          type: "QM_queueStatusUpdated",
        });
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
          <div class='comfyui-queue-manager flex flex-col p-1' style="height: calc(100vh - var(--comfy-topbar-height) - 4px);">
            <header class="p-1">Queue Manager</header>
            <section class='app-iframe flex-1 p-2' style="background-color: var(--p-form-field-background);">
              <iframe src="/extensions/comfyui_queue_manager/.gui/index.html" class="w-full h-full border-0"></iframe>
            </section>
          </div>
        `;
      },
    });

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
