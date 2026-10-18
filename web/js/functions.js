import {QueueManagerGalleryURL, QueueManagerOrigin, QueueManagerURL} from './config.js';
import {settings} from './settings.js';
import {installWorkflowNameInjection} from './workflow-name.js';
import {installQueueControls} from './toolbar.js';

import { app } from '../../../scripts/app.js';
import { ComfyButton } from '../../../scripts/ui/components/button.js';

function theIframe() {
  return document.querySelector(".comfyui-queue-manager iframe");
}

export function postStatusMessageToIframe(event) {
  postMessageToIframe({
      name: event.type,
      detail: event.detail
  }, 'QM_queueStatusUpdated');
}

function postMessageToIframe(message, type) {
  if (!type) {
    type = 'QM_ParentMessage';
  }

  const iframe = theIframe();
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({
      type: type,
      message: message
    }, QueueManagerOrigin);
  }
}

export function compareVersions(a, b) {
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

export async function uiSetup () {
  loadManagerStyles();
  const current = typeof __COMFYUI_FRONTEND_VERSION__ !== 'undefined' ? __COMFYUI_FRONTEND_VERSION__ : '0.0.0';
  await installQueueControls(app, ComfyButton, compareVersions(current, '1.33.1') >= 0);
}

function loadManagerStyles() {
  if (document.getElementById('comfyui-queue-manager-stylesheet')) return;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('../styles/manager.css', import.meta.url).href;
  style.id = 'comfyui-queue-manager-stylesheet';
  document.head.appendChild(style);
}

/**
 * When the queue status or workflow progress is updated then tell the iframe
 */
export function handleAPIEvents() {


    app.api.addEventListener("status", function (e) {
      postStatusMessageToIframe(e)
    });

    app.api.addEventListener("reconnected", async function (e) {
      // On reconnect fetch current playback status since it might have changed
      try {
        await fetch(`/queue_manager/playback`);
      } catch (error) {
        console.error("Error fetching playback status:", error);
      }
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
}

/**
 *  Pass parent's key events to iframe
 */
export function handleKeyboardEvents() {

    window.addEventListener('keydown', e => {
      postMessageToIframe({key: e.key, isDown: true}, 'QM_ParentKeypress')
    });
    window.addEventListener('keyup', e => {
      postMessageToIframe({key: e.key, isDown: false}, 'QM_ParentKeypress')
    });
}


export function handleIframeMessages() {
  /**
     * Messages from iframe
     */
    window.addEventListener("message", async (event) => {
      if (event.origin !== QueueManagerOrigin) return;
      const { type, workflow, number } = event.data;

      if (type === "QM_DismissSelectionHints" && event.source === theIframe()?.contentWindow) {
        try {
          await app.extensionManager.setting.set('QueueManager.Basic.ShowSelectionHints', false);
        } catch (error) {
          console.error("Error saving selection hints preference:", error);
          // ComfyUI updates its local value before saving; restore it so a retry works.
          try {
            await app.extensionManager.setting.set('QueueManager.Basic.ShowSelectionHints', true);
          } catch {
            // The local value is restored even if persistence is still unavailable.
          }
          event.source.postMessage({type: "QM_SelectionHintsSaveFailed"}, event.origin);
        }
      }

      // When workflow is received from iframe then load it into ComfyUI
      if (type === "QM_LoadWorkflow" && workflow) {
        // e.g. forward into ComfyUI’s API
        const filename = workflow.workflow_name + ' ' + number;
        if (workflow.api_prompt) {
          await app.loadApiJson(workflow.api_prompt, filename);
        } else {
          await app.loadGraphData(workflow, true, true, filename);
        }
      }

      // Handshake message from iframe
      if (type === "QM_QueueManager_Hello") {
        const settings = extensionSettings('values');
        // send back clientId to iframe
        event.source.postMessage(
          { type: "QM_QueueManager_Hello",
            clientId: app.api.clientId,
            settings
          },
          event.origin
        );
      }

      // Show gallery modal
      if (type === "QM_Gallery_Show") {
        document.body.classList.add('show-qm-fullscreen');
      }

      // Close gallery modal
      if (type === "QM_Gallery_Close") {
        document.body.classList.remove('show-qm-fullscreen');
      }

      // Load workflow from image file
      if (type === "QM_LoadWorkflowFromImage") {
        const filename = event.data.filename;
        const res = await fetch(event.data.fileURL, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const type =  res.headers.get('Content-Type');
        const theFile = new File([blob], filename, {type: type});

        app.handleFile(theFile);
      }
    }, false);
}

export function registerSidebar() {
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
          <section class='app-iframe flex-1'>
            <iframe name="qm_queue_iframe" src="${QueueManagerURL}" class="w-full h-full border-0"></iframe>
          </section>
          <footer>
          </footer>
        </div>
      `;

      loadManagerStyles();

      // resize container
      el.style.height = '100%';
      el.parentElement.style.overflow = 'hidden';
    },
  });
}

export function injectWorkflowName() {
  installWorkflowNameInjection(app);
}

function postSettingToIframe(setting, newVal, oldVal) {
  postMessageToIframe({
    setting: setting,
    newValue: newVal,
    oldValue: oldVal
  }, 'QM_Setting_Changed');
}

export function extensionSettings(mode = 'default') {

  if (mode === 'default') {
    // append onChange handler to every setting
    for (const setting of settings) {
      setting.onChange = function(newVal, oldVal) {
        const id = setting.id.replace('QueueManager.', '');
        postSettingToIframe(id, newVal, oldVal);
      }
    }
    return settings;
  }

  if (mode === 'values') {
    // pull values for all settings and convert to tree object, split by dots in id
    const settingsTree = {};
    for (const setting of settings) {
      const value = app.extensionManager.setting.get(setting.id);
      const idParts = setting.id.split('.');
      let currentLevel = settingsTree;
      for (let i = 0; i < idParts.length; i++) {
        const part = idParts[i];
        if (i === idParts.length - 1) {
          currentLevel[part] = value;
        } else {
          if (!currentLevel[part]) {
            currentLevel[part] = {};
          }
          currentLevel = currentLevel[part];
        }
      }
    }

    return settingsTree.QueueManager;
  }

}


