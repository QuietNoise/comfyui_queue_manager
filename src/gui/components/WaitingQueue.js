"use client";

import React, {useContext, useEffect, useState} from "react";
import {baseURL} from "@/internals/config";
import {apiCall} from "@/internals/functions";
import {AppContext} from "@/internals/app-context";


export default function WaitingQueue({data, isLoading, error}) {
  const {appStatus, setAppStatus} = useContext(AppContext);

  // Filter state — track which categories are active (each sets both status and tag)
  const [activeCategories, setActiveCategories] = useState(["priority", "main", "background"]); // all checked by default

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

  // Toggle a category — sets/clears both status and tag at once, and applies immediately
  function toggleCategory(category) {
    setActiveCategories(prev => {
      const newCategories = prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category];

      // Build filter params from the new set
      const statusMap = {priority: 5, main: 6, background: 7};
      const filterParams = {};
      if (newCategories.length > 0 && newCategories.length < 3) {
        filterParams.status = {type: "status", value: newCategories.map(c => statusMap[c])};
        filterParams.tag = {type: "tag", value: [...newCategories]};
      }

      // Apply immediately (no separate Apply button)
      setAppStatus(prev => ({...prev, filters: Object.keys(filterParams).length > 0 ? filterParams : null}));

      return newCategories;
    });
  }

  function Button({children, className, onClick, title}) {
    return (
      <button
        className={"hover:bg-neutral-700 dark:text-neutral-200 rounded inline-flex items-center justify-center" + (className ? ' ' + className : '')}
        onClick={onClick}
        title={title}
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
            item[3].tag === 'priority' ? (
              <span className="inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Priority">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                  <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
              </span>
            ) : item[3].tag === 'main' ? (
              <span className="inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Main">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </span>
            ) : item[3].tag === 'background' ? (
              <span className="inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Background">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
                </svg>
              </span>
            ) : (
              <span className="inline-flex items-center text-xs dark:text-neutral-400 text-neutral-500" title={item[3].tag}>{item[3].tag}</span>
            )
          )}
        </td>
        <td className="px-3 py-1 text-left">
          {item[3].status === 5 ? (
            <span className="inline-flex items-center dark:text-purple-400 text-purple-600" title="Priority">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                <line x1="4" y1="22" x2="4" y2="15"></line>
              </svg>
            </span>
          ) : item[3].status === 6 ? (
            <span className="inline-flex items-center dark:text-blue-400 text-blue-600" title="Main">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </span>
          ) : item[3].status === 7 ? (
            <span className="inline-flex items-center dark:text-gray-400 text-gray-500" title="Background">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
              </svg>
            </span>
          ) : (
            <span className="inline-flex items-center text-xs dark:text-neutral-400 text-neutral-500" title={getStatusLabel(item[3].status)}>{getStatusLabel(item[3].status)}</span>
          )}
        </td>
        <td className={'px-3 py-1 text-right actions'}>
          <Button className={"dark:bg-red-900 bg-rose-200 text-red-900"} onClick={cancelQueueItem} title="Delete">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </Button>
          <Button className={"dark:bg-green-900 bg-green-300"} onClick={loadQueueItem} title="Load">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </Button>
          <Button className={"dark:bg-orange-900 bg-orange-200"} onClick={archiveQueueItem} title="Archive">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8"></path>
              <path d="M1 3h22v5H1z"></path>
              <line x1="10" y1="12" x2="14" y2="12"></line>
            </svg>
          </Button>
          <Button className={"run"} onClick={playItem} title="Run">
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
      {/* Filter Row — toggle buttons that set both status and tag */}
      <div className="filters-row flex items-center gap-2 p-3 dark:bg-neutral-800 bg-neutral-200 rounded mb-2">
        <span className="text-xs uppercase font-semibold dark:text-neutral-400 text-neutral-600 mr-1">Filter:</span>
        <button
          className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer " + (activeCategories.includes("priority")
            ? "dark:bg-purple-900 bg-purple-300 dark:text-purple-200 text-purple-900"
            : "dark:bg-neutral-700 bg-neutral-300 dark:text-neutral-300 text-neutral-700 hover:dark:bg-neutral-600 hover:bg-neutral-400")}
          onClick={() => toggleCategory("priority")}
        >
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
            <line x1="4" y1="22" x2="4" y2="15"></line>
          </svg>
          Priority
        </button>
        <button
          className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer " + (activeCategories.includes("main")
            ? "dark:bg-blue-900 bg-blue-300 dark:text-blue-200 text-blue-900"
            : "dark:bg-neutral-700 bg-neutral-300 dark:text-neutral-300 text-neutral-700 hover:dark:bg-neutral-600 hover:bg-neutral-400")}
          onClick={() => toggleCategory("main")}
        >
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          Main
        </button>
        <button
          className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer " + (activeCategories.includes("background")
            ? "dark:bg-green-900 bg-green-300 dark:text-green-200 text-green-900"
            : "dark:bg-neutral-700 bg-neutral-300 dark:text-neutral-300 text-neutral-700 hover:dark:bg-neutral-600 hover:bg-neutral-400")}
          onClick={() => toggleCategory("background")}
        >
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
          </svg>
          Background
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
