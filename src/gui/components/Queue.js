"use client";           // (keep for app-router; harmless in pages-router)

import React, {useContext, useEffect, useState} from "react";
import {baseURL} from "@/internals/config";
import {apiCall} from "@/internals/functions";
import {AppContext} from "@/internals/app-context";

import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {GripVertical} from "lucide-react";


// take items from parent component
export default function Queue( { data, isLoading, error, progress } ) {
  const {appStatus, setAppStatus} = useContext(AppContext);
  const [state, setState] = useState({
    pending:[],
    running:[],
  })

  // Routes that support bulk selection (checkbox + move)
  const bulkRoutes = ['queue', 'new', 'archive', 'waiting'];
  const showBulk = bulkRoutes.includes(appStatus.route);

  // Selection state for bulk operations
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // Drag-and-drop state
  const [activeId, setActiveId] = useState(null);

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
      const allIds = state.pending
        .filter(item => item[3] && item[3].db_id)
        .map(item => item[3].db_id);
      setSelectedItems(allIds);
    }
    setSelectAll(!selectAll);
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

  function QueueItemRow({item, className, loader, index, mode}) {
    const {appStatus, setAppStatus} = useContext(AppContext)

    async function cancelQueueItem() {
      const route = (mode === 'running' || mode === 'external') ? 'interrupt' : 'queue';

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

    async function moveToCategory(category) {
      await apiCall(`queue_manager/move-to-category`, {items: [item[3].db_id], category: category})
    }

    async function filterByWorkflow() {
      // Post message to parent window to filter by workflow
      setAppStatus(prev => ({...prev, filters: {...appStatus.filters, workflow: {
            type: 'workflow',
            value: item[3].extra_pnginfo.workflow.id,
            valueLabel: item[3].extra_pnginfo.workflow.workflow_name
          }}}));
    }


    const dbId = item[3] && item[3].db_id;
    const isChecked = dbId ? selectedItems.includes(dbId) : false;

    return (
      <tr className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}>
        {/* Drag handle placeholder — running/external items aren't sortable */}
        {appStatus.route === 'queue' && (
          <td className="px-2 py-1 text-center w-8"></td>
        )}
        {showBulk && mode !== 'running' && mode !== 'external' ? (
          <td className="px-3 py-1 text-left checkbox-cell">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => dbId && toggleSelectItem(dbId)}
              className="cursor-pointer"
            />
          </td>
        ) : showBulk ? (
          <td className="px-3 py-1"></td>
        ) : null}
        <td className="px-3 py-1 serial">
          <span>{(index === undefined || !data.info)?'':index+1+data.info.page * data.info.page_size}</span>
          {loader &&
            <span className="loader py-1 ">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </span>
          }
        </td>
        <td className="px-3 py-1 text-left name">
          <button className={'plain'} onClick={filterByWorkflow}>
            {mode === 'external'
              ? "External job"
              : (item[3].extra_pnginfo.workflow.workflow_name ? item[3].extra_pnginfo.workflow.workflow_name : "")
            }
          </button>
        </td>
        <td className={'px-3 py-1 text-right actions'}>
          {item[3].tag && item[3].tag !== 'none1' && (
            item[3].tag === 'priority' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Priority">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                  <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
              </span>
            ) : item[3].tag === 'main' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Main">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </span>
            ) : item[3].tag === 'background' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Background">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
                </svg>
              </span>
            ) : (
              <span className="mr-2 inline-flex items-center text-xs dark:text-neutral-400 text-neutral-500" title={item[3].tag}>{item[3].tag}</span>
            )
          )}
          <Button className={"dark:bg-red-900 bg-rose-200 text-red-900"} onClick={cancelQueueItem} title="Delete">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </Button>

          {mode !== 'external' &&
            <Button className={"dark:bg-green-900 bg-green-300"} onClick={loadQueueItem} title="Load">
              <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </Button>
          }
          {appStatus.route === 'queue' && mode !== 'running' && mode !== 'external' &&
            <Button className={"dark:bg-orange-900 bg-orange-200"} onClick={archiveQueueItem} title="Archive">
              <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8"></path>
                <path d="M1 3h22v5H1z"></path>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
            </Button>
          }
          {appStatus.route === 'archive' &&
            <Button className={"run"} onClick={playItem} title="Run">
              <svg viewBox="0 0 24 24" width="1.2em" height="1.2em">
                <path className={'run'} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
                      strokeWidth="2"
                      d="m6 3l14 9l-14 9z"></path>
                <g className={'run-first'} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                  <path d="M16 12H3m13 6H3m7-12H3m18 12V8a2 2 0 0 0-2-2h-5"></path>
                  <path d="m16 8l-2-2l2-2"></path>
                </g>
              </svg>
            </Button>
          }
          {appStatus.route === 'new' && mode !== 'running' && mode !== 'external' &&
            <>
              <span className="inline-block w-px h-5 mx-1 dark:bg-neutral-600 bg-neutral-400 align-middle"></span>
              <Button className={"dark:bg-purple-900 bg-purple-300"} onClick={() => moveToCategory('priority')} title="Move to Priority">
                <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                  <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
              </Button>
              <Button className={"dark:bg-blue-900 bg-blue-300"} onClick={() => moveToCategory('main')} title="Move to Main">
                <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </Button>
              <Button className={"dark:bg-gray-700 bg-gray-300"} onClick={() => moveToCategory('background')} title="Move to Background">
                <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
                </svg>
              </Button>
            </>
          }
        </td>
      </tr>
    );
  }

  // Sortable wrapper for pending items on the queue route
  function SortableQueueItemRow({item, className, index}) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({id: item[3].db_id});

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
    };

    const dbId = item[3] && item[3].db_id;
    const isChecked = dbId ? selectedItems.includes(dbId) : false;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}
      >
        {/* Drag handle column (only on queue route) */}
        {appStatus.route === 'queue' && (
          <td className="px-2 py-1 text-center w-8 drag-handle" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </td>
        )}
        {showBulk && (
          <td className="px-3 py-1 text-left checkbox-cell">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => dbId && toggleSelectItem(dbId)}
              className="cursor-pointer"
            />
          </td>
        )}
        <td className="px-3 py-1 serial">
          <span>{(index === undefined || !data.info)?'':index+1+data.info.page * data.info.page_size}</span>
        </td>
        <td className="px-3 py-1 text-left name">
          <button className={'plain'}>
            {item[3].extra_pnginfo.workflow.workflow_name ? item[3].extra_pnginfo.workflow.workflow_name : ""}
          </button>
        </td>
        <td className={'px-3 py-1 text-right actions'}>
          {item[3].tag && item[3].tag !== 'none1' && (
            item[3].tag === 'priority' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Priority">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                  <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
              </span>
            ) : item[3].tag === 'main' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Main">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </span>
            ) : item[3].tag === 'background' ? (
              <span className="mr-2 inline-flex items-center dark:text-neutral-400 text-neutral-500" title="Background">
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <rect x="7" y="7" width="10" height="10" rx="1" ry="1"></rect>
                </svg>
              </span>
            ) : (
              <span className="mr-2 inline-flex items-center text-xs dark:text-neutral-400 text-neutral-500" title={item[3].tag}>{item[3].tag}</span>
            )
          )}
          <Button className={"dark:bg-red-900 bg-rose-200 text-red-900"} onClick={async () => {
            await apiCall(`api/queue`, {delete: [item[1]]});
          }} title="Delete">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </Button>
          <Button className={"dark:bg-green-900 bg-green-300"} onClick={async () => {
            window.parent.postMessage(
              { type: "QM_LoadWorkflow", workflow: item[3].extra_pnginfo.workflow, number: item[0] },
              "*"
            );
          }} title="Load">
            <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </Button>
          {appStatus.route === 'queue' &&
            <Button className={"dark:bg-orange-900 bg-orange-200"} onClick={async () => {
              await apiCall(`queue_manager/archive`, {archive: [item[3].db_id]});
            }} title="Archive">
              <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8"></path>
                <path d="M1 3h22v5H1z"></path>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
            </Button>
          }
        </td>
      </tr>
    );
  }

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required to activate drag
      },
    })
  );

  // Compute sortable item IDs from pending items
  const sortableItems = state.pending
    .filter(item => item[3] && item[3].db_id)
    .map(item => item[3].db_id);

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  async function handleDragEnd(event) {
    const {active, over} = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const oldIndex = sortableItems.indexOf(active.id);
    const newIndex = sortableItems.indexOf(over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(sortableItems, oldIndex, newIndex);

    // Optimistically update local state
    setState(prev => {
      const reordered = arrayMove(prev.pending, oldIndex, newIndex);
      return {...prev, pending: reordered};
    });

    // Persist to backend
    await apiCall("queue_manager/reorder", {items: newOrder});
  }

  // Find active item for drag overlay
  const activeItem = activeId
    ? state.pending.find(item => item[3] && item[3].db_id === activeId)
    : null;

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
            {/* Drag handle column header (only on queue route) */}
            {appStatus.route === 'queue' && (
              <th className="px-2 py-2 text-center w-8"></th>
            )}
            {showBulk && (
              <th className="px-3 py-2 text-left w-10">
                <input
                  type="checkbox"
                  checked={selectAll && state.pending.length > 0}
                  onChange={toggleSelectAll}
                  className="cursor-pointer"
                />
              </th>
            )}
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Workflow</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        {appStatus.route === 'queue' && state.pending.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={sortableItems}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {state.running.map(item => (
                  <QueueItemRow item={item} key={item[1]} className={'running'} loader={true} mode={ item[3].extra_pnginfo ? 'running' : 'external'} />
                ))}
                {state.pending.map((item, index) => (
                  <SortableQueueItemRow item={item} key={item[3].db_id} className={'pending'} index={index} />
                ))}
              </tbody>
            </SortableContext>
            <DragOverlay>
              {activeItem ? (
                <tr className="dark:bg-neutral-700 bg-neutral-300 opacity-80">
                  <td className="px-2 py-1 text-center w-8"><GripVertical size={16} /></td>
                  {showBulk && <td className="px-3 py-1"></td>}
                  <td className="px-3 py-1 serial">{activeItem[0]}</td>
                  <td className="px-3 py-1 text-left name">
                    {activeItem[3].extra_pnginfo.workflow.workflow_name || ""}
                  </td>
                  <td className="px-3 py-1 text-right actions">...</td>
                </tr>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <tbody>
            {state.running.map(item => (
              <QueueItemRow item={item} key={item[1]} className={'running'} loader={true} mode={ item[3].extra_pnginfo ? 'running' : 'external'} />
            ))}
            {state.pending.map((item, index) => (
              <QueueItemRow item={item} key={item[3].db_id} className={'pending'} index={index} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
