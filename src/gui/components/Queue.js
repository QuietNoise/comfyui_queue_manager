"use client";           // (keep for app-router; harmless in pages-router)

import React, {useEffect, useState} from "react";
import {baseURL} from "@/internals/config";


// take items from parent component
export default function Queue( { data, isLoading, error }) {
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

  function QueueItemRow({item, className}) {
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
        'http://127.0.0.1:8188'
      );
    }



    return (
      <tr className={"odd:bg-neutral-900" + (className ? ' ' + className : '')}>
        <td className="px-3 py-1">{item[0]}</td>
        <td className="px-3 py-1 text-left">{item[3].extra_pnginfo.workflow.workflow_name ? item[3].extra_pnginfo.workflow.workflow_name : ""}</td>
        <td className={'p-1 px-3 py-1'}>
          <Button className={"bg-red-900"} onClick={cancelQueueItem}>Cancel</Button>
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
    <div className={"overflow-x-auto" + (isLoading ? ' loading' : '')}>
      <table className="min-w-full border border-neutral-600">
        <thead className="bg-neutral-800 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.running.map(item => (
            <QueueItemRow item={item} key={item[0]} />
          ))}
          {state.pending.map(item => (
            <QueueItemRow item={item} key={item[0]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
