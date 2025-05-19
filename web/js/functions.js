import { QueueManagerURL } from './config.js';

function theIframe() {
  return document.querySelector(".comfyui-queue-manager iframe");
}

export function postStatusMessageToIframe(event) {
  postMessageToIframe({
      name: event.type,
      detail: event.detail
  }, 'QM_queueStatusUpdated');
}

export function postMessageToIframe(message, type) {
  if (!type) {
    type = 'QM_ParentMessage';
  }

  const iframe = theIframe();
  if (iframe && iframe.contentWindow) {
    // console.log("Posting message to iframe", event, QueueManagerURL);
    iframe.contentWindow.postMessage({
      type: type,
      message: message
    }, QueueManagerURL);
  }
}
