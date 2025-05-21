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
    return await response.json();
  } catch (error) {
    console.error("Error archiving item:", error);
  }
}
