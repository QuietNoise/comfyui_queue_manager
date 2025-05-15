import { QueueManagerURL } from './config.js';

function theIframe() {
  return document.querySelector(".comfyui-queue-manager iframe");
}

export function postStatusMessageToIframe(event) {
  // console.log("Queue status updated", event);
  const iframe = theIframe();
  if (iframe && iframe.contentWindow) {
    // console.log("Posting message to iframe", event, QueueManagerURL);
    iframe.contentWindow.postMessage({
      type: "QM_queueStatusUpdated",
      message: {
        name: event.type,
        detail: event.detail
      }
    }, QueueManagerURL);
  }
}
