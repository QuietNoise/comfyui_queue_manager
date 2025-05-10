"use client";           // (keep for app-router; harmless in pages-router)

import React from "react";


// take items from parent component
export default function Queue( { data, isLoading, error }) {
  console.log('Queue data: ', data, isLoading, error);

  if (error)       return <p className="text-red-500">Queue load failed: {error.message}</p>;
  if (isLoading)   return <p>Loading queue…</p>;
  if (!data || (!data.running && !data.pending)) return <p className="italic">Queue is empty.</p>;

  // optional: sort by `number` so earliest show first
  const pending = data.pending ? [...data.pending].sort((a, b) => a[0] - b[0]) : [];
  const running = data.running ? [...data.running].sort((a, b) => a[0] - b[0]) : [];

  function QueueItemRow({item}) {
    return (
      <tr className="odd:bg-neutral-900">
        <td className="px-3 py-1">{item[0]}</td>
        <td className="px-3 py-1 break-all">{item[1]}</td>
        <td className="px-3 py-1 text-center">{item[3].extra_pnginfo.workflow.id}</td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-neutral-600">
        <thead className="bg-neutral-800 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Prompt ID</th>
            <th className="px-3 py-2">Workflow ID</th>
          </tr>
        </thead>
        <tbody>
          {running.map(item => (
            <QueueItemRow item={item} key={item[0]} />
          ))}
          {pending.map(item => (
            <QueueItemRow item={item} key={item[0]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
