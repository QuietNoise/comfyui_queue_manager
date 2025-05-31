import {baseURL} from "@/internals/config";

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
      throw new Error("Network response was not ok");
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
  }
}
