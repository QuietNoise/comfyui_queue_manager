"use client";           // (keep for app-router; harmless in pages-router)

import React, {useEffect, useState} from "react";
import {baseURL} from "@/internals/config";


// take items from parent component
export default function Queue( { data, isLoading, error, progress } ) {
  const [state, setState] = useState({
    pending:[],
    running:[],
  })


  function Button({children, className, onClick}) {
    return (
      <button
        className={"hover:bg-neutral-700 text-neutral-200 font-bold py-1 px-2 rounded mr-1" + (className ? ' ' + className : '')}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  function QueueItemRow({item, className, loader}) {
    const [isLoading, setIsLoading] = useState(false);


    async function cancelQueueItem() {
      setIsLoading(true);
      try {
        // POST item[1] as json
        const response = await fetch(`${baseURL}api/queue`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            delete: [item[1]],
          }),
        });
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        setIsLoading(false);
      } catch (error) {
        setIsLoading(false);
        console.error("Error fetching queue items:", error);
      }
    }

    /**
     * Post message to parent window to load workflow stored in pnginfo
     */
    async function loadQueueItem() {
      console.log("Loading queue item", item);
      window.parent.postMessage(
        { type: "QM_LoadWorkflow", workflow: item[3].extra_pnginfo.workflow, number: item[0] },
        "*"
      );
    }


    return (
      <tr className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}>
        <td className="px-3 py-1 serial"><span>{item[0]}</span></td>
        <td className="px-3 py-1 text-left name">{item[3].extra_pnginfo.workflow.workflow_name ? item[3].extra_pnginfo.workflow.workflow_name : ""}</td>
        <td className={'px-3 py-1 text-right actions'}>
          {loader &&
            <span className="loader px-3 py-1 ">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </span>
          }
          <Button className={"bg-red-900"} onClick={cancelQueueItem}>Delete</Button>
          <Button className={"bg-green-900"} onClick={loadQueueItem}>Load</Button>
          <Button className={"bg-orange-900"}>Archive</Button>
        </td>
      </tr>
    );
  }

  useEffect(function () {
    if (!data) return;
    setState({
      pending:data.pending ? [...data.pending].sort((a, b) => a[0] - b[0]) : [],
      running:data.running ? [...data.running].sort((a, b) => a[0] - b[0]) : [],
    });
  }, [data]);

  if (error)       return <p className="text-red-500 text-center">Queue load failed: {error.message}</p>;
  if (!data || (!data.running.length && !data.pending.length)) return <p className="italic text-center">Queue is empty.</p>;
  return (
    <div className={"queue-table overflow-x-auto" + (isLoading ? ' loading' : '')} style={{"--job-progress": progress + "%"}}>
      <table className="min-w-full border border-0">
        <thead className="dark:bg-neutral-800 bg-neutral-200 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.running.map(item => (
            <QueueItemRow item={item} key={item[0]} className={'running'} loader={true} />
          ))}
          {state.pending.map(item => (
            <QueueItemRow item={item} key={item[0]} className={'pending'} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
