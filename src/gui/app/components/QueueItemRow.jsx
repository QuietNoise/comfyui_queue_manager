// `src/gui/app/components/QueueItemRow.jsx`
"use client";

import React, { memo, useCallback, useContext, useMemo } from "react";
import { apiCall, msgLoadWorkflow } from "../internals/functions";
import { AppContext } from "../internals/app-context";
import { MediaItem } from "../components/MediaItem";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import { MediaOutputs } from "../models/MediaOutputs";
import { LoaderSpinner } from "../components/LoaderSpinner";
import {useAppStore} from "@/app/stores/appStore";
import { QueueItemName } from "./QueueItemName";
import {withWorkflowFilter} from "../internals/workflowFilters.mjs";

export const QueueItemRow = memo(
  function QueueItemRow({
    item,
    className,
    loader,
    index,
    mode,
    info,

    route,
    thumbMode,
    galleryOptions,
    filters,
    workflowFilterMode,
    selecting,
    selected,
  }) {
    const { onMediaItemClick, fetchQueueItems, refreshQueueItems } = useContext(AppContext);

    const dbId = item?.[3]?.db_id;
    const workflow = item?.[3]?.extra_pnginfo?.workflow;
    const selectable = !!dbId && mode !== "running" && mode !== "external";

    const mediaOutputs = useMemo(() => {
      if (item?.[3]?.outputs && route === "completed") {
        return new MediaOutputs(item[3], galleryOptions);
      }
      return null;
    }, [item, route, galleryOptions]);

    const cancelQueueItem = useCallback(async () => {
      const cancelRoute = mode === "running" || mode === "external" ? "interrupt" : "queue";
      await apiCall(`api/${cancelRoute}`, { delete: [item[1]] });
    }, [mode, item]);

    const loadQueueItem = useCallback(() => {
      if (workflow) {
        msgLoadWorkflow(workflow, item[0]);
      }
    }, [workflow, item]);

    const archiveQueueItem = useCallback(async () => {
      await apiCall(`queue_manager/archive`, { archive: [dbId] });
    }, [dbId]);

    const playItem = useCallback(async () => {
      const { shiftDown, clientId } = useAppStore.getState();

      await apiCall(`queue_manager/play`, {
        items: [dbId],
        front: shiftDown === true,
        clientId,
      });
    }, [dbId]);

    const filterByWorkflow = useCallback(() => {
      if (!workflow || selecting) return;

      const nextFilters = withWorkflowFilter(filters, {id: workflow.id, name: workflow.workflow_name ?? ""}, workflowFilterMode);
      if (nextFilters === filters) return;

      fetchQueueItems({
        page: 0,
        filters: nextFilters,
        reload: true,
      });
    }, [fetchQueueItems, filters, workflow, workflowFilterMode, selecting]);

const executionTimeLabel = useMemo(() => {
  const t = item?.[3]?.execution_time;
  if (t == null) return null;

  const rawSeconds = Number(t);
  if (!Number.isFinite(rawSeconds) || rawSeconds < 0) return null;

  const totalSeconds = rawSeconds >= 60 ? Math.round(rawSeconds) : rawSeconds;

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const secondsLabel = rawSeconds >= 60 ? `${seconds}s` : `${seconds.toFixed(2)}s`;

  if (days > 0) return ` ${days}d ${hours}h ${minutes}m ${secondsLabel}`;
  if (hours > 0) return ` ${hours}h ${minutes}m ${secondsLabel}`;
  if (minutes > 0) return ` ${minutes}m ${secondsLabel}`;
  return ` ${rawSeconds.toFixed(2)}s`;
}, [item?.[3]?.execution_time]);

    const showCover =
      route === "completed" &&
      thumbMode === "cover" &&
      (galleryOptions.ShowImages || galleryOptions.ShowVideos);

    const showGrid =
      item?.[3]?.total_files > 0 &&
      route === "completed" &&
      thumbMode === "grid" &&
      (galleryOptions.ShowImages || galleryOptions.ShowVideos);

    const rowIndex =
      index === undefined || !info ? "" : index + 1 + info.page * info.page_size;

    return (
      <>
        {/*
        *
        * Queue Item Details
        *
        */}
        <tr className={(className ?? "") + (selected ? " selected" : "")}
            data-selection-id={selectable ? dbId : undefined}
            aria-selected={selecting && selectable ? selected : undefined}>
          <td className="px-3 py-1 serial">
            <span>{rowIndex}</span>
            {loader ? <LoaderSpinner /> : null}
          </td>

          {/* Thumbnail in Cover mode */}
          {showCover ? (
            <td className="px-3 py-1 cover">
              {mediaOutputs?.cover ? (
                <MediaItem
                  file={mediaOutputs.cover}
                  controls={false}
                  autoplay={false}
                  onClick={() => onMediaItemClick({ dbID: dbId, fileIndex: 0 })}
                  className="play-button"
                  title="Open gallery"
                />
              ) : null}
            </td>
          ) : null}

          {/* Workflow Name */}
          <td className="px-3 py-1 text-left name">
            <div className="name-cell">
              {mediaOutputs && item[3].total_files > 0 ? (
                <span
                  className="total shiny-button"
                  title={`Total file outputs: ${mediaOutputs.total}`}
                  onClick={() => onMediaItemClick({ dbID: dbId, fileIndex: 0 })}
                >
                  {mediaOutputs.total}
                </span>
              ) : null}

              <QueueItemName
                name={mode === "external" ? "External job" : workflow?.workflow_name ?? ""}
                dbId={dbId}
                selecting={selecting}
                route={route}
                canRename={!!dbId && mode !== "running" && mode !== "external" && (route === "queue" || route === "archive")}
                onFilter={filterByWorkflow}
                filterTitle={workflowFilterMode === "workflow_name" ? "Filter view by this exact workflow name" : "Filter view by the workflow"}
                onRenamed={refreshQueueItems}
              />
            </div>
          </td>

          {route === "completed" &&
            <td className={'meta-info'}>
              {executionTimeLabel ? (
                <div className="execution-time" title="Execution time">
                  {executionTimeLabel}
                </div>
              ) : null}
            </td>
          }


          {/* Item Actions */}
          <td className="px-3 py-1 text-right actions">
            <div style={{ justifyContent: "flex-end" }}  className="buttons">
              <button
                className="delete red-button shiny-button"
                onClick={cancelQueueItem}
                title="Delete workflow from queue"
                data-selection-ignore
              >
                Delete
              </button>

              {mode !== "external" ? (
                <button
                  className="load green-button shiny-button"
                  onClick={loadQueueItem}
                  title="Load workflow"
                  data-selection-ignore
                >
                  Load
                </button>
              ) : null}

              {route === "queue" && mode !== "running" ? (
                <button
                  className="archive yellow-button shiny-button"
                  onClick={archiveQueueItem}
                  title="Move to the archive"
                  data-selection-ignore
                >
                  Archive
                </button>
              ) : null}

              {route === "archive" ? (
                <button
                  className="run blue-button shiny-button"
                  onClick={playItem}
                  title="Move to queue"
                  data-selection-ignore
                >
                  <PlayArrowOutlinedIcon fontSize="small" />
                  Run
                </button>
              ) : null}

              {route === "completed" ? (
                <button

                  className="view violet-button shiny-button"
                  onClick={() => onMediaItemClick({ dbID: dbId, fileIndex: 0 })}
                  title="View outputs in gallery"
                  data-selection-ignore
                >
                  View
                </button>
              ) : null}
              {selecting && <input type="checkbox" className="row-selection"
                aria-label={`Select ${workflow?.workflow_name || "job"}`}
                title={selectable ? "Select job (Shift: range, Alt: deselect)" : "Running and external jobs cannot be selected"}
                disabled={!selectable} checked={selected} onChange={() => {}} />}
            </div>
          </td>
        </tr>

        {/*
        *
        * Queue Item Outputs
        *
        */}
        {showGrid ? (
          <tr className={"dark:odd:bg-neutral-900 odd:bg-neutral-100 gallery" + (selected ? " selected" : "")}
              data-selection-id={selectable ? dbId : undefined}>
            <td colSpan={4} className="px-3 py-1">
              <div className="flex flex-wrap gap-2 items">
                {mediaOutputs?.files?.length
                  ? mediaOutputs.files.map((file, fileIndex) => (
                      <MediaItem
                        key={`${file.filename}-${file.subfolder}`}
                        file={file}
                        autoplay={false}
                        onClick={() => onMediaItemClick({ dbID: dbId, fileIndex })}
                        title="Open gallery"
                      />
                    ))
                  : null}
              </div>
            </td>
          </tr>
        ) : null}
      </>
    );
  },
  (prev, next) => {
    // Custom compare: skip re\-render if the item identity changes but the content  hasn’t.
    const prevId = prev.item?.[3]?.db_id;
    const nextId = next.item?.[3]?.db_id;
    if (prevId !== nextId) return false;

    return (
      prev.loader === next.loader &&
      prev.index === next.index &&
      prev.mode === next.mode &&
      prev.route === next.route &&
      prev.thumbMode === next.thumbMode &&
      prev.galleryOptions === next.galleryOptions &&
      prev.filters === next.filters &&
      prev.workflowFilterMode === next.workflowFilterMode &&
      prev.selecting === next.selecting &&
      prev.selected === next.selected &&
      prev.info?.page === next.info?.page &&
      prev.info?.page_size === next.info?.page_size &&
      prev.item?.[3]?.extra_pnginfo?.workflow?.workflow_name === next.item?.[3]?.extra_pnginfo?.workflow?.workflow_name
    );
  }
);
