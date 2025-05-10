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
    const baseURL = process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8188/"
    : "/";

    const fetchQueueItems = async () => {
      setStatus(prev => ({ ...prev, loading: true, error: null }));
      try {
        const response = await fetch(`${baseURL}queue_manager/queue`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        setStatus(prev => ({ ...prev, loading: false, error: null, data }));
      } catch (error) {
        setStatus({ loading: false, error: error.message, data: null });
        console.error("Error fetching queue items:", error);
      }
    };

    fetchQueueItems();

    const handleMessage = (event) => {
      if (event.data.type === "QM_queueStatusUpdated") {
        fetchQueueItems();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
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
