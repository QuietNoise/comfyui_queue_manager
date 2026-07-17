"use client";

import React, {useContext, useEffect, useState} from "react";
import {baseURL} from "@/internals/config";
import {apiCall} from "@/internals/functions";
import {AppContext} from "@/internals/app-context";


export default function WaitingQueue({data, isLoading, error}) {
  const {appStatus, setAppStatus} = useContext(AppContext);

  // Filter state
  const [filters, setFilters] = useState({
    status: [5, 6, 7],  // all checked by default
    tag: ["priority", "main", "background"],  // all checked by default
  });

  // Selection state for bulk operations
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // Sync selectedItems to AppContext so footer can access them
  useEffect(() => {
    setAppStatus(prev => ({...prev, selectedItems}));
  }, [selectedItems, setAppStatus]);

  // Reset selection when data changes
  useEffect(() => {
    setSelectedItems([]);
    setSelectAll(false);
  }, [data]);

  function toggleSelectItem(dbId) {
    setSelectedItems(prev => {
      if (prev.includes(dbId)) {
        return prev.filter(id => id !== dbId);
      } else {
        return [...prev, dbId];
      }
    });
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelectedItems([]);
    } else {
      const allIds = (data && data.pending
        ? data.pending
        : []
      ).filter(item => item[3] && item[3].db_id)
        .map(item => item[3].db_id);
      setSelectedItems(allIds);
    }
    setSelectAll(!selectAll);
  }

  // Toggle a status value in the filter
  function toggleStatusFilter(value) {
    setFilters(prev => {
      const current = prev.status;
      if (current.includes(value)) {
        return {...prev, status: current.filter(v => v !== value)};
      } else {
        return {...prev, status: [...current, value]};
      }
    });
  }

  // Toggle a tag value in the filter
  function toggleTagFilter(value) {
    setFilters(prev => {
      const current = prev.tag;
      if (current.includes(value)) {
        return {...prev, tag: current.filter(v => v !== value)};
      } else {
        return {...prev, tag: [...current, value]};
      }
    });
  }

  // Apply filters: fetch data with selected filters
  function applyFilters() {
    const filterParams = {};
    if (filters.status.length > 0 && filters.status.length < 3) {
      filterParams.status = {type: "status", value: filters.status};
    }
    if (filters.tag.length > 0 && filters.tag.length < 3) {
      filterParams.tag = {type: "tag", value: filters.tag};
    }

    setAppStatus(prev => ({...prev, filters: Object.keys(filterParams).length > 0 ? filterParams : null}));
  }

  function Button({children, className, onClick}) {
    return (
      <button
        className={"hover:bg-neutral-700 dark:text-neutral-200 rounded inline-flex items-center justify-center" + (className ? ' ' + className : '')}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  function QueueItemRow({item, className, index}) {
    const dbId = item[3] && item[3].db_id;
    const isChecked = dbId ? selectedItems.includes(dbId) : false;

    async function cancelQueueItem() {
      await apiCall(`api/queue`, {
        delete: [item[1]],
      })
    }

    async function loadQueueItem() {
      window.parent.postMessage(
        {type: "QM_LoadWorkflow", workflow: item[3].extra_pnginfo.workflow, number: item[0]},
        "*"
      );
    }

    async function archiveQueueItem() {
      await apiCall(`queue_manager/archive`, {
        archive: [item[3].db_id],
      })
    }

    async function playItem() {
      await apiCall(`queue_manager/play`, {
        items: [item[3].db_id],
        front: appStatus.shiftDown === true,
        clientId: appStatus.clientId
      })
    }

    function getStatusLabel(status) {
      switch (status) {
        case 5:
          return "Priority";
        case 6:
          return "Main";
        case 7:
          return "Background";
        default:
          return "Unknown";
      }
    }

    function getStatusColor(status) {
      switch (status) {
        case 5:
          return "dark:bg-purple-900 bg-purple-300 text-purple-900";
        case 6:
          return "dark:bg-blue-900 bg-blue-300 text-blue-900";
        case 7:
          return "dark:bg-gray-700 bg-gray-300 text-gray-800";
        default:
          return "dark:bg-neutral-700 bg-neutral-200";
      }
    }

    return (
      <tr className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}>
        <td className="px-3 py-1 text-left checkbox-cell">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => dbId && toggleSelectItem(dbId)}
            className="cursor-pointer"
          />
        </td>
        <td className="px-3 py-1 serial">
          <span>{(index === undefined || !data.info) ? '' : index + 1 + data.info.page * data.info.page_size}</span>
        </td>
        <td className="px-3 py-1 text-left name">
          <button className={'plain'}>
            {item[3].extra_pnginfo && item[3].extra_pnginfo.workflow && item[3].extra_pnginfo.workflow.workflow_name
              ? item[3].extra_pnginfo.workflow.workflow_name
              : "Unknown"}
          </button>
        </td>
        <td className="px-3 py-1 text-left">
          {item[3].tag && item[3].tag !== 'none1' && (
            <span
              className={"inline-block text-xs px-2 py-0.5 rounded dark:bg-neutral-700 bg-neutral-200 dark:text-neutral-200 text-neutral-800"}>
              {item[3].tag}
            </span>
          )}
        </td>
        <td className="px-3 py-1 text-left">
          <span className={"inline-block text-xs px-2 py-0.5 rounded " + getStatusColor(item[3].status)}>
            {getStatusLabel(item[3].status)}
          </span>
        </td>
        <td className={'px-3 py-1 text-right actions'}>
          <Button className={"dark:bg-red-900 bg-rose-200 text-red-900"} onClick={cancelQueueItem}>Delete</Button>
          <Button className={"dark:bg-green-900 bg-green-300"} onClick={loadQueueItem}>Load</Button>
          <Button className={"dark:bg-orange-900 bg-orange-200"} onClick={archiveQueueItem}>Archive</Button>
          <Button className={"run"} onClick={playItem}>
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
              <path className={'run'} fill="none" stroke="currentColor" strokeLinecap="round"
                    strokeLinejoin="round" strokeWidth="2"
                    d="m6 3l14 9l-14 9z"></path>
              <g className={'run-first'} fill="none" stroke="currentColor" strokeLinecap="round"
                 strokeLinejoin="round" strokeWidth="2">
                <path d="M16 12H3m13 6H3m7-12H3m18 12V8a2 2 0 0 0-2-2h-5"></path>
                <path d="m16 8l-2-2l2-2"></path>
              </g>
            </svg>
            &nbsp;&nbsp;Run
          </Button>
        </td>
      </tr>
    );
  }

  if (error) return <p className="text-red-500 text-center">Loading failed: {error}</p>;
  if (!isLoading && (!data || !data.pending.length)) return <p className="italic text-center">No items.</p>;
  if (isLoading && !data) return <p className="italic text-center">Loading...</p>;

  return (
    <div className={"overflow-x-auto" + (isLoading ? ' loading' : '')}>
      {/* Filter Row */}
      <div className="filters-row flex items-center gap-4 p-3 dark:bg-neutral-800 bg-neutral-200 rounded mb-2">
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-semibold dark:text-neutral-400 text-neutral-600">Status:</span>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.status.includes(5)}
              onChange={() => toggleStatusFilter(5)}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">Priority</span>
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.status.includes(6)}
              onChange={() => toggleStatusFilter(6)}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">Main</span>
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.status.includes(7)}
              onChange={() => toggleStatusFilter(7)}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">Background</span>
          </label>
        </div>

        <div className="w-px h-6 dark:bg-neutral-600 bg-neutral-400"></div>

        {/* Tag Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-semibold dark:text-neutral-400 text-neutral-600">Tag:</span>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.tag.includes("priority")}
              onChange={() => toggleTagFilter("priority")}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">priority</span>
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.tag.includes("main")}
              onChange={() => toggleTagFilter("main")}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">main</span>
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filters.tag.includes("background")}
              onChange={() => toggleTagFilter("background")}
              className="cursor-pointer"
            />
            <span className="dark:text-neutral-200 text-neutral-800">background</span>
          </label>
        </div>

        {/* Apply Button */}
        <button
          className="ml-auto dark:bg-blue-800 bg-blue-400 dark:text-neutral-200 text-neutral-900 px-3 py-1 rounded text-sm font-medium hover:opacity-80"
          onClick={applyFilters}
        >
          Apply Filters
        </button>
      </div>

      <table className="min-w-full border border-0">
        <thead className="dark:bg-neutral-800 bg-neutral-200 text-xs uppercase">
        <tr>
          <th className="px-3 py-2 text-left w-10">
            <input
              type="checkbox"
              checked={selectAll && data && data.pending && data.pending.length > 0}
              onChange={toggleSelectAll}
              className="cursor-pointer"
            />
          </th>
          <th className="px-3 py-2 text-left">#</th>
          <th className="px-3 py-2 text-left">Workflow</th>
          <th className="px-3 py-2 text-left">Tag</th>
          <th className="px-3 py-2 text-left">Status</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
        </thead>
        <tbody>
        {data.pending.map((item, index) => (
          <QueueItemRow item={item} key={item[3].db_id} className={'pending'} index={index}/>
        ))}
        </tbody>
      </table>
    </div>
  );
}
