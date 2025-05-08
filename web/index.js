import { app } from '../../scripts/app.js'

console.log("Queue Manager JS loaded", app);

/**
 * Main function wrapping plugin's core functionality
 */
app.registerExtension({
	name: "ComfyUIQueueManager",
    async setup() {
        // Load front end UI into iframe
        function messageHandler(event) { console.log("ComfyUI Queue Manager status:", event.detail); }
        app.api.addEventListener("status", messageHandler);

        const el = document.createElement("iframe");
        el.src = "/extensions/comfyui_queue_manager/.gui/index.html";
        el.style.cssText =
          "position:fixed;right:0;top:0;height:100%;width:380px;z-index:3000;border:none;";
        document.body.appendChild(el);
    },
})
