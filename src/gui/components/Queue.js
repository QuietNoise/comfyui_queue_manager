"use client";           // (keep for app-router; harmless in pages-router)

import React, {useContext, useEffect, useState} from "react";
import {baseURL} from "@/internals/config";
import {apiCall} from "@/internals/functions";
import {AppContext} from "@/internals/app-context";


// take items from parent component
export default function Queue( { data, isLoading, error, progress } ) {
  const [state, setState] = useState({
    pending:[],
    running:[],
  })


  function Button({children, className, onClick}) {
    return (
      <button
        className={"hover:bg-neutral-700 text-neutral-200 rounded inline-flex items-center justify-center" + (className ? ' ' + className : '')}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  function QueueItemRow({item, className, loader, index, mode}) {
    const {appStatus} = useContext(AppContext)

    async function cancelQueueItem() {
      const route = mode === 'running' ? 'interrupt' : 'queue';

      await apiCall(`api/${route}`, {
        delete: [item[1]],
      })
    }

    /**
     * Post message to parent window to load workflow stored in pnginfo
     */
    async function loadQueueItem() {
      // console.log("Loading queue item", item);
      window.parent.postMessage(
        { type: "QM_LoadWorkflow", workflow: item[3].extra_pnginfo.workflow, number: item[0] },
        "*"
      );
    }

    // POST to /api/archive with array of item ids to archive
    async function archiveQueueItem() {
      await apiCall(`queue_manager/archive`, {
        archive: [item[3].db_id],
      })
    }

    async function playItem() {
      console.log("Playing item from client: " + appStatus.clientId);
      await apiCall(`queue_manager/play`, {items: [item[3].db_id], front: appStatus.shiftDown === true, clientId: appStatus.clientId})
    }


    return (
      <tr className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}>
        <td className="px-3 py-1 serial">
          <span>{index === undefined?'':index+1+data.info.page * data.info.page_size}</span>
          {loader &&
            <span className="loader py-1 ">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </span>
          }
        </td>
        <td className="px-3 py-1 text-left name">{item[3].extra_pnginfo.workflow.workflow_name ? item[3].extra_pnginfo.workflow.workflow_name : ""}</td>
        <td className={'px-3 py-1 text-right actions'}>
          <Button className={"bg-red-900"} onClick={cancelQueueItem}>Delete</Button>
          <Button className={"bg-green-900"} onClick={loadQueueItem}>Load</Button>
          {appStatus.route === 'queue' &&
            <Button className={"bg-orange-900"} onClick={archiveQueueItem}>Archive</Button>
          }
          {appStatus.route === 'archive' &&
            <Button className={"run"} onClick={playItem}>
              <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
                <path className={'run'} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
                      strokeWidth="2"
                      d="m6 3l14 9l-14 9z"></path>
                <g className={'run-first'} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                  <path d="M16 12H3m13 6H3m7-12H3m18 12V8a2 2 0 0 0-2-2h-5"></path>
                  <path d="m16 8l-2-2l2-2"></path>
                </g>
              </svg>
              &nbsp;&nbsp;Run
            </Button>
          }
        </td>
      </tr>
    );
  }

  useEffect(function () {
    if (!data) return;
    setState({
      pending: data.pending ? data.pending : [],
      running: data.running ? data.running : [],
    });
  }, [data]);

  if (error)       return <p className="text-red-500 text-center">Loading failed: {error}</p>;
  if (!isLoading && (!data || (!data.running.length && !data.pending.length))) return <p className="italic text-center">No items.</p>;
  if (isLoading && !data)  return <p className="italic text-center">Loading...</p>;
  return (
    <div className={"overflow-x-auto" + (isLoading ? ' loading' : '')} style={{"--job-progress": progress + "%"}}>
      <table className="min-w-full border border-0">
        <thead className="dark:bg-neutral-800 bg-neutral-200 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Workflow</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.running.map(item => (
            <QueueItemRow item={item} key={item[1]} className={'running'} loader={true} mode={'running'} />
          ))}
          {state.pending.map((item, index) => (
            <QueueItemRow item={item} key={item[3].db_id} className={'pending'} index={index} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
