"use client";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.scss";
import {useEffect, useState} from "react";
import Queue from "@/components/Queue";
import {baseURL} from "@/internals/config";
import useEvent from "react-use-event-hook";
import {AppContext} from "@/internals/app-context";
import {apiCall} from "@/internals/functions";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


export default function RootLayout({children}) {
  const [appStatus, setAppStatus] = useState({
    loading: true,
    error: null,
    queue: null,
    route: 'queue', // queue, archive, bin
    shiftDown: false,
    clientId: null,
    filters: null
  });

  const [currentJob, setProgress] = useState({
    id: null,
    nodes: {
      // [node_id]: string|boolean - true executed, node id - not executed
    },
    integrity: true, // false if events about workflow execution are received before the workflow data is loaded
    progress: 0.0,
  });


  const fetchQueueItems = async (page) => {
    setAppStatus(prev => ({...prev, loading: true, error: null}));
    try {
      // console.log("Fetching queue items from", baseURL);
      let queryArgs = '';
      if (page) {
        queryArgs = "?page=" + page;
      }

      queryArgs = appendFilters(queryArgs);
      queryArgs = appendRoute(queryArgs);


      const response = await fetch(`${baseURL}queue_manager/queue` + queryArgs);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const queue = await response.json();
      setAppStatus(prev => ({...prev, loading: false, error: null, queue}));

    } catch (error) {
      setAppStatus(prev => ({...prev, loading: false, error: error.message, queue: null}));
      console.error("Error fetching " + appStatus.route + " items:", error);
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

  function appendFilters(queryArgs) {
    if (isFilterOn()) {
      queryArgs += (queryArgs ? '&filters=' : '?filters=') + encodeURIComponent(JSON.stringify(appStatus.filters));
    }
    return queryArgs;
  }

  function appendRoute(queryArgs) {
    if (appStatus.route) {
      queryArgs += (queryArgs ? '&route=' : '?route=') + appStatus.route;
    }
    return queryArgs;
  }

  async function archiveAll() {
    try {
      let queryArgs = appendFilters("");

      const response = await fetch(`${baseURL}queue_manager/archive-queue${queryArgs}`);
    } catch (error) {
      console.error("Error fetching queue items:", error);
    }
  }

  async function playAllArchive() {
    await apiCall('queue_manager/play-archive', {
      client_id: appStatus.clientId,
      filters: isFilterOn() ? appStatus.filters : null,
    })
  }

  async function deleteFromQueue() {
    let queryArgs = appendFilters("?route=" + appStatus.route);

    try {
      const response = await fetch(`${baseURL}queue_manager/queue${queryArgs}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error(`Error deleting items from ${appStatus.route}:`, error);
    }
  }

  function isFilterOn() {
    return appStatus.filters && Object.keys(appStatus.filters).length > 0;
  }

  const onQueueStatusUpdated = (event) => {

    switch (event.data.message.name) {
      case "status":
        if (appStatus.route === 'queue') {
          fetchQueueItems((appStatus.queue && appStatus.queue.info) ? appStatus.queue.info.page : 0);
        }
        break;
      case "execution_start":
        const {prompt_id} = event.data.message.detail;
        // console.log("Execution started: ", status.queue, prompt_id);

        const theJob = getTheJob(prompt_id, appStatus.queue);

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
        setProgress(prev => ({...prev, id: prompt_id, integrity: false, nodes: {}}));

        break;

      case 'execution_cached':
        // console.log("Execution cached: ", event.data.message);
        // set cached node ids as executed
        const {nodes} = event.data.message.detail; // array of node id strings

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
        // set executed node id as executed
        const node_id = event.data.message.detail;
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

      case "queue-manager-archive-updated":
        console.log("Queue archive updated: ", event.data.message);
        fetchQueueItems()
        break;
    }
  }

  const onParentKeypress = (keypress) => {
    if (!keypress) {
      return;
    }

    if (keypress.key === "Shift") {
      setAppStatus(prev => ({...prev, shiftDown: keypress.isDown}));
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
      case "QM_QueueManager_Hello":
        setAppStatus(prev => ({ ...prev, clientId: event.data.clientId }));
        break;
    }
  });

  const uploadQueue = useEvent( async (e) => {
    // if empty value then bounce
    if (!e.target.files || !e.target.files.length === 0) {
      return;
    }

    const file = e.target.files[0];


    const formData = new FormData();
    formData.append("queue_json", file);
    formData.append("client_id", appStatus.clientId);

    if (appStatus.route === 'archive') {
      formData.append("archive", true);
    }


    try {
      const response = await fetch(`${baseURL}queue_manager/import`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();
      console.log("Queue imported successfully", data);

      e.target.value = "";

    } catch (error) {
      console.error("Error importing queue:", error);
    }
  });

  useEffect(() => {
    fetchQueueItems()
  }, [appStatus.filters]);

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
      const theJob = getTheJob(currentJob.id, appStatus.queue);
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
  }, [appStatus.queue]);

  useEffect(() => {
    setAppStatus(prev => ({ ...prev, queue: null }));
    fetchQueueItems();
  }, [appStatus.route]);

  // on mount get the queue items from the server
  useEffect(() => {
    fetchQueueItems();

    window.addEventListener("message", handleMessage);

    window.addEventListener('keydown', e => {
      setAppStatus(prev => ({...prev, shiftDown: true}));
    });
    window.addEventListener('keyup', e => {
      setAppStatus(prev => ({...prev, shiftDown: false}));
    });

    window.parent.postMessage(
      { type: "QM_QueueManager_Hello" },
      "*"
    );

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <AppContext.Provider value={{appStatus, setAppStatus}}>
      <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Queue Manager</title>
        <meta name="description" content="ComfyUI Queue Manager frontend"/>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} route-${appStatus.route}`}>
      {/*{children}*/}
      <div className="tabs">
        <button
          className={"tab" + (appStatus.route === 'queue' ? ' dark:bg-neutral-800 bg-neutral-200 active' : '')}
          onClick={() => {
            setAppStatus(prev => ({...prev, route: 'queue'}));
          }}
        >Queue
        </button>
        <button
          className={"tab archive" + (appStatus.route === 'archive' ? ' active' : '')}
          onClick={() => {
            setAppStatus(prev => ({...prev, route: 'archive'}));
          }}
        >Archive
        </button>
      </div>
      {isFilterOn() &&
        <div className="filters flex items-center p-2">
          <span className="text-neutral-500">Filters:</span>
          {Object.values(appStatus.filters).map(filter =>
            <div className="filter flex items-center" key={filter.type}>
                <span
                  className="inline-flex text-neutral-800 dark:text-neutral-200 close label"><span
                  className={'type'}>{filter.type + ": "}&nbsp;</span>{filter.valueLabel}</span>
              <button
                className="dark:bg-neutral-700 bg-neutral-400 text-neutral-200 light:text-neutral-800 close hover:bg-neutral-500"
                onClick={() => {
                  // remove the filter from the filters object
                  setAppStatus(prev => ({...prev, filters: (({[filter.type]: _, ...f}) => f)(prev.filters)}));
                }}
              >
                <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
                  <path fill="currentColor"
                        d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"></path>
                </svg>
              </button>
            </div>
          )}

          {/*  Clear all  */}
          <button
            className="dark:bg-neutral-700 bg-neutral-400 text-neutral-200 light:text-neutral-800 close close-all hover:bg-neutral-500 ml-auto"
            onClick={() => {
              setAppStatus(prev => ({...prev, filters: null}));
            }}
          >
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
              <path fill="currentColor"
                    d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"></path>
            </svg>
            Clear filters
          </button>
        </div>
      }
      <div className={'queue-table' + (appStatus.shiftDown ? ' shift-down' : '')}>
        {/* Tabs for Queue and Archive */}
        <Queue data={appStatus.queue}
               error={appStatus.error}
               isLoading={appStatus.loading}
               progress={currentJob.progress}
               route={appStatus.route}
               shiftDown={appStatus.shiftDown}
        />
      </div>
      <footer className={"footer"}>
        <div className={"paging flex"}>
          {appStatus.queue && appStatus.queue.info && (appStatus.queue.info.last_page > 0) &&
            <>
              {/* Previous page if needed */}
              <button
                className={"page" + (appStatus.queue.info.page === 0 ? ' disabled' : '')}
                onClick={() => {
                  setAppStatus(prev => ({...prev, queue: null}));
                  fetchQueueItems(appStatus.queue.info.page - 1);
                }}
                disabled={appStatus.queue.info.page === 0}
              > &lt;&lt; </button>
              <div className={'pages flex justify-center flex-1'}>
                {Array.from({length: (appStatus.queue.info.last_page + 1)}, (_, i) => (
                  <button
                    key={i}
                    className={"page" + (appStatus.queue.info.page === i ? ' active' : '')}
                    onClick={() => {
                      setAppStatus(prev => ({...prev, queue: null}));
                      fetchQueueItems(i);
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              {/* Next page if needed */}
              <button
                className={"page" + (appStatus.queue.info.page === appStatus.queue.info.last_page ? ' disabled' : '')}
                onClick={() => {
                  setAppStatus(prev => ({...prev, queue: null}));
                  fetchQueueItems(appStatus.queue.info.page + 1);
                }}
                disabled={appStatus.queue.info.page === appStatus.queue.info.last_page}
              > &gt;&gt; </button>
            </>
          }
        </div>
        <div className="p-2 flex actions">
          {appStatus.queue && (appStatus.queue.running.length > 0 || appStatus.queue.pending.length > 0) &&
            <>
              {appStatus.route === 'queue' &&
                <>
                  <button onClick={archiveAll}
                          className="hover:bg-neutral-700 bg-orange-200 py-1 px-2 rounded mr-1 border-0 dark:bg-orange-900">Archive
                    All {isFilterOn() ? "*" : "Pending"}
                  </button>
                  <a href={baseURL + "queue_manager/export" + appendFilters("")}
                     className="hover:bg-neutral-700 dark:bg-teal-700 bg-teal-200 text-neutral-900 py-1 px-2 rounded mr-1 border-0 ">📤
                    Export {isFilterOn() ? "*" : "Queue"}
                  </a>
                  {isFilterOn() &&
                    <button onClick={deleteFromQueue}
                            className="hover:bg-neutral-700 dark:bg-gray-800 bg-gray-200 dark:text-neutral-200 text-neutral-800 py-1 px-2 rounded mr-1 border-0 order-last ml-auto">
                      🗑️ Delete All *
                    </button>
                  }
                </>
              }
              {appStatus.route === 'archive' &&
                <>
                  <button onClick={playAllArchive}
                          className="hover:bg-neutral-700 text-neutral-200 dark:text-neutral-900 py-1 px-2 rounded mr-1 border-0 run run-all">
                  <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
                      <path className={'run'} fill="none" stroke="currentColor" strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="m6 3l14 9l-14 9z"></path>
                    </svg>
                    Run All {isFilterOn() ? "*" : ""}
                  </button>
                  <a href={baseURL + "queue_manager/export" + appendFilters("?archive=true")}
                     className="hover:bg-neutral-700 dark:bg-teal-700 bg-teal-200 text-neutral-900  py-1 px-2 rounded mr-1 border-0">📤
                    Export {isFilterOn() ? "*" : "Archive"}
                  </a>
                  <button onClick={deleteFromQueue}
                          className="hover:bg-neutral-700 dark:bg-gray-800 bg-gray-200 dark:text-neutral-200 text-neutral-800 py-1 px-2 rounded mr-1 border-0 order-last ml-auto">
                    🗑️ Delete {isFilterOn() ? "All *" : "All Archive"}
                  </button>
                </>
              }
            </>

          }


          <form
            method="post"
            encType="multipart/form-data"
            className={"import-form"}
          >
            <input
              id="uploadQueueForm"
              type="file"
              name="queue_json"
              accept=".json"
              required
              hidden
              onChange={uploadQueue}
            />
            <label htmlFor={"uploadQueueForm"}
                   className={"hover:bg-neutral-700 py-1 px-2 rounded mr-1 border-0 dark:bg-teal-900 bg-teal-300"}>📁
              Import {appStatus.route === 'queue' ? 'Queue' : 'Archive'}</label>
          </form>
        </div>
      </footer>
      </body>
      </html>
    </AppContext.Provider>
  );
}
