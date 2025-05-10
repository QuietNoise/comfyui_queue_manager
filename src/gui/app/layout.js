"use client";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {useEffect, useState} from "react";
import Queue from "@/components/Queue";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


export default function RootLayout({ children }) {
  const [ status, setStatus ] = useState({
    loading: false,
    error: null,
    data: null,
  });


  // on mount get the queue items from the server
  useEffect(() => {
    // in dev we cross origin to localhost:8188
    const baseURL = (process.env.NODE_ENV === "development") ? "http://127.0.0.1:8188/" : "/";

    const fetchQueueItems = async () => {
      setStatus({ loading: true, error: null, data: null });
      try {
        const response = await fetch(`${baseURL}queue_manager/queue`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        setStatus({ loading: false, error: null, data });
        console.log("Queue items:", data);
      } catch (error) {
        setStatus({ loading: false, error: error.message, data: null });
        console.error("Error fetching queue items:", error);
      }
    };

    fetchQueueItems();

    // listen for postMessage from the parent window
    const handleMessage = (event) => {
      if (event.data.type === "QM_queueStatusUpdated") {
        console.log("QM_queueStatusUpdated", event.data);
        fetchQueueItems();
      }
    };
    window.addEventListener("message", handleMessage);

  }, []);

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Queue Manager</title>
        <meta name="description" content="ComfyUI Queue Manager frontend" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/*{children}*/}
        <Queue data={status.data} error={status.error} isLoading={status.isLoading} />
      </body>
    </html>
  );
}
