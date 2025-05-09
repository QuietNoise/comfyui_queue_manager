"use client";           // (keep for app-router; harmless in pages-router)

import React from "react";


// take items from parent component
export default function Queue( { data, isLoading, error }) {
  console.log('data', data, isLoading, error);

  if (error)       return <p className="text-red-500">Queue load failed: {error.message}</p>;
  if (isLoading)   return <p>Loading queue…</p>;
  if (!data || !data.queue_running) return <p className="italic">Queue is empty.</p>;

  // optional: sort by `number` so earliest runs first
  const rows = [...data.queue_pending].sort((a, b) => a[0] - b[0]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-neutral-600">
        <thead className="bg-neutral-800 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Prompt ID</th>
            <th className="px-3 py-2">Workflow ID</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Seed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(item => (
            <tr key={item[0]} className="odd:bg-neutral-900">
              <td className="px-3 py-1">{item[0]}</td>
              <td className="px-3 py-1 break-all">{item[1]}</td>
              <td className="px-3 py-1 text-center">{item[3].extra_pnginfo.workflow.id}</td>
              <td className="px-3 py-1">
                {item.created_at
                  ? new Date(item.created_at * 1000).toLocaleTimeString()
                  : "—"}
              </td>
              <td className="px-3 py-1 text-center">
                {item.extra_data?.seed ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
