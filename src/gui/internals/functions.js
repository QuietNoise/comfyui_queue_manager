import {baseURL} from "@/internals/config";

export async function apiCall(endpoint, data) {
  // is endpoint an absolute URL
  const url = (endpoint.startsWith("https://") || endpoint.startsWith("http://")) ?
    endpoint :
    `${baseURL}${endpoint}`;


  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
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
