"use client";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.scss";
import {useEffect, useState} from "react";
import Queue from "@/components/Queue";
import {baseURL} from "@/internals/config";
import useEvent from "react-use-event-hook";

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
    loading: true,
    error: null,
    queue: null,
    route: 'queue', // queue, archive, bin
    shiftDown: false,
  });

  const [ currentJob, setProgress ] = useState({
    id:null,
    nodes:{
      // [node_id]: string|boolean - true executed, node id - not executed
    },
    integrity: true, // false if events about workflow execution are received before the workflow data is loaded
    progress: 0.0,
  });

  const fetchQueueItems = async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    try {
      // console.log("Fetching queue items from", baseURL);

      const response = await fetch(`${baseURL}queue_manager/queue`);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const queue = await response.json();
      setStatus(prev => ({ ...prev, loading: false, error: null, queue }));

    } catch (error) {
      setStatus(prev => ({...prev,  loading: false, error: error.message, queue: null }));
      console.error("Error fetching queue items:", error);
    }
  };

  function getNodeIDs(nodes) {
    const nodeIDs = {};
    for (const node of nodes) {
      if (node.id) {
        nodeIDs[node.id] = node.id;
      }
    }

    // console.log("Node IDs", nodeIDs);
    return nodeIDs;
  }

  function getTheJob(jobID, queue) {
    if (!queue) {
      // console.log("No queue data yet, skipping");
      return null;
    }

    // check if the job is running
    for (const item of queue.running) {
      if (item[1] === jobID) {
        return item;
      }
    }

    // check if the job is in the queue
    for (const item of queue.pending) {
      if (item[1] === jobID) {
        return item;
      }
    }

    return null;
  }

  function archiveAll() {

  }

  const onQueueStatusUpdated = (event) => {
    // console.log("Queue progress: ", event.data.message);
    switch (event.data.message.name) {
      case "status":
        fetchQueueItems();
        break;
      case "execution_start":
        const { prompt_id } = event.data.message.detail;
        // console.log("Execution started: ", status.queue, prompt_id);

        const theJob = getTheJob(prompt_id, status.queue);

        if (theJob) {
          // console.log("Job found: ", theJob);
          const nodeIDs = getNodeIDs(theJob[3].extra_pnginfo.workflow.nodes);
          // set the current job
          setProgress(prev => ({
            ...prev,
            id: prompt_id,
            nodes: nodeIDs,
            integrity: true
          }));

          break;
        }

        // set the current job with the prompt id and false integrity flag
        // we don't have the workflow data yet, so set integrity to false so we can pick up progress later when we get the workflow data
        setProgress(prev => ({ ...prev, id: prompt_id, integrity: false, nodes: {} }));

        break;

        case 'execution_cached':
          // console.log("Execution cached: ", event.data.message);
          // set cached node ids as executed
          const { nodes } = event.data.message.detail; // array of node id strings

          if (!nodes || nodes.length === 0) {
            return;
          }

          const newNodes = {};
          for (const node of nodes) {
            newNodes[node] = true;
          }

          // console.log("newNodes: ", newNodes);

          setProgress(prev => ({
            ...prev,
            nodes: {
              ...prev.nodes,
              ...newNodes
            }
          }));
          break;

      case "executing":
        console.log("Executing: ", event.data.message);
        // set executed node id as executed
        const  node_id  = event.data.message.detail;
        if (!node_id) {
          return;
        }

        setProgress(prev => ({
          ...prev,
          nodes: {
            ...prev.nodes,
            [node_id]: true
          }
        }));
        break;
    }
  }

  const onParentKeypress = (keypress) => {
    if (!keypress) {
      return;
    }

    if (keypress.key === "Shift") {
      console.log("Shift key pressed: ", keypress.isDown);
      setStatus(prev => ({...prev, shiftDown: keypress.isDown}));
    }
  }

  const handleMessage = useEvent((event) => {
    // console.log("Received message from parent", event,event.data.type, event.data.message);
    // SIML: check if event.origin is the same as baseURL
    switch (event.data.type) {
      case "QM_queueStatusUpdated":
        onQueueStatusUpdated(event);
        break;
      case "QM_ParentKeypress":
        onParentKeypress(event.data.message);
        break;
    }
  });

  // when progress data is updated
  useEffect(() => {
    const progress =
      Object.values(currentJob.nodes).length > 0 ?
        Math.round(
          Math.max(
              (Object.values(currentJob.nodes).filter(v => typeof v === 'boolean').length - 1),
              0
            ) / Object.values(currentJob.nodes).length * 100,
          2
        )
        :
        0;
    // console.log("Job progress updated: ",
    //   currentJob,
    //   progress,
    //   Object.values(currentJob.nodes).filter(v => typeof v === 'boolean').length,
    //   Object.values(currentJob.nodes).length);

    setProgress(prev => ({
      ...prev,
      progress: progress
    }));

  }, [currentJob.nodes]);

  // when new queue items are added to the queue
  useEffect(() => {
    // Are we already tracking a job but have not saved the workflow data yet?
    if (currentJob.id && currentJob.integrity === false) {
      // console.log("New Queue loaded. Already tracking a job. Checking for workflow data...");
      const theJob = getTheJob(currentJob.id, status.queue);
      if (theJob) {
        // console.log("Job found: ", theJob);
        const nodeIDs = getNodeIDs(theJob[3].extra_pnginfo.workflow.nodes);

        // if we already marked some nodes as executed do not overwrite them
        for (const nodeID in currentJob.nodes) {
          if (currentJob.nodes[nodeID] === true) {
            nodeIDs[nodeID] = true;
          }
        }

        // set the current job
        setProgress(prev => ({
          ...prev,
          nodes: nodeIDs,
          integrity: true
        }));
      }
    }
  }, [status.queue]);

  // on mount get the queue items from the server
  useEffect(() => {
    fetchQueueItems();

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
      <div className="tabs">
        <button
          className={"tab" + (status.route === 'queue' ? ' dark:bg-neutral-800 bg-neutral-200 active' : '')}
          onClick={() => {
            setStatus(prev => ({ ...prev, route: 'queue' }));
          }}
        >Queue</button>
        <button
          className={"tab" + (status.route === 'archive' ? ' dark:bg-neutral-800 bg-neutral-200 active' : '')}
          onClick={() => {
            setStatus(prev => ({ ...prev, route: 'archive' }));
          }}
        >Archive</button>
      </div>
      <div className={'queue-table' + (status.shiftDown ? ' shift-down' : '')}>
        {/* Tabs for Queue and Archive */}
        <Queue data={status.queue} error={status.error} isLoading={status.loading} progress={currentJob.progress} route={status.route} />
      </div>
      <footer className={"footer"}>
        <div className="p-2">
          {status.queue && (status.queue.running.length > 0 || status.queue.pending.length > 0) && status.route === 'queue' &&
            <button onClick={archiveAll}
                    className="hover:bg-neutral-700 text-neutral-200 font-bold py-1 px-2 rounded mr-1 border-0 bg-green-900">Archive
              All
            </button>
          }

        </div>
      </footer>
      </body>
    </html>
  );
}
