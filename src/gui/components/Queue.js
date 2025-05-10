"use client";           // (keep for app-router; harmless in pages-router)

import React, {useEffect, useState} from "react";


// take items from parent component
export default function Queue( { data, isLoading, error }) {
  const [state, setState] = useState({
    pending:[],
    running:[],
  })

  function QueueItemRow({item}) {
    return (
      <tr className="odd:bg-neutral-900">
        <td className="px-3 py-1">{item[0]}</td>
        <td className="px-3 py-1 text-center">{item[3].extra_pnginfo.workflow.workflow_name}</td>
      </tr>
    );
  }

  useEffect(function () {
    console.log("Data changed: ", data);
    if (!data) return;
    setState({
      pending:data.pending ? [...data.pending].sort((a, b) => a[0] - b[0]) : [],
      running:data.running ? [...data.running].sort((a, b) => a[0] - b[0]) : [],
    });
  }, [data]);

  if (error)       return <p className="text-red-500">Queue load failed: {error.message}</p>;
  if (!data || (!data.running.length && !data.pending.length)) return <p className="italic">Queue is empty.</p>;
  return (
    <div className={"overflow-x-auto" + (isLoading ? ' loading' : '')}>
      <table className="min-w-full border border-neutral-600">
        <thead className="bg-neutral-800 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Name</th>
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
