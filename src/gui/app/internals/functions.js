import {baseURL} from "../internals/config";

export async function apiCall(endpoint, data, method = "POST") {
  // is endpoint an absolute URL
  const url = (endpoint.startsWith("https://") || endpoint.startsWith("http://")) ?
    endpoint :
    `${baseURL}${endpoint}`;


  try {

    let request = {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (method.toLowerCase() !== "get") {
      request.body = JSON.stringify(data);
    }

    const response = await fetch(url, request);
    if (!response.ok) {
      const result = response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : null;
      throw new Error(result?.error || `Request failed (${response.status})`);
    }
    // is response body non empty and json?
    const contentType = response.headers.get("content-type");
    const contentLength = parseInt(response.headers.get("content-length"));


    if (contentLength === 0) {
      return null;
    }
    if (contentType.includes("application/json")) {
      return await response.json();
    } else {
      // plain text response
      return await response.text()
    }
  } catch (error) {
    console.error("Error running apiCall:", error);
    throw error;
  }
}

export const msgLoadWorkflow = (workflow, number) => {
  window.parent.postMessage(
    { type: "QM_LoadWorkflow", workflow, number },
    "*"
  );
}

export function mediaType (outputs) {
  return {
    isImage : (!outputs.animated || outputs.animated[0] !== true),
    isVideo : (outputs.animated && outputs.animated[0] === true) || (outputs.gifs && outputs.gifs.length > 0)
  }
}


export function hasVideos(outputs) {
  for (const nodeID in outputs) {
    const nodeOutputs = outputs[nodeID];
    const { isVideo } = mediaType(nodeOutputs);
    if (isVideo) {
      return true;
    }
  }
  return false;
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
