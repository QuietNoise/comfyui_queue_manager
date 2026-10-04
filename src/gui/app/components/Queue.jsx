// `src/gui/app/components/Queue.jsx`

"use client";

import React, { memo, useMemo, useRef } from "react";
import { LoaderSpinner } from "../components/LoaderSpinner";
import { QueueItemRow } from "../components/QueueItemRow";
import { useAppStore } from "../stores/appStore";
import { useOptionsStore } from "../stores/optionsStore";
import {useSelectionStore} from "../stores/selectionStore";
import {useQueueSelection} from "./useQueueSelection";
import {useQueueReorder} from "./useQueueReorder";

const QueueItems = memo(function QueueItems({ running, pending, info, reorderPreview, reorderBusy }) {
  // Read global state ONCE here (parent of many rows)
  const route = useAppStore((state) => state.route);
  const filters = useAppStore((state) => state.filters);
  const workflowFilterMode = useAppStore((state) => state.workflowFilterMode);
  const selecting = useSelectionStore((state) => state.active);
  const selected = useSelectionStore((state) => state.selected);

  const thumbMode = useOptionsStore((state) => state.thumb_mode);
  const galleryOptions = useOptionsStore((state) => state.Gallery);

  // Optional: keep object identity stable if upstream recreates it
  const stableGalleryOptions = useMemo(() => galleryOptions, [galleryOptions]);

  return (
    <>
      {running.map((item) => (
        <QueueItemRow
          key={item?.[3]?.db_id ?? item?.[1]}
          item={item}
          className="running"
          loader={true}
          mode={item?.[3]?.extra_pnginfo ? "running" : "external"}
          info={info}
          route={route}
          thumbMode={thumbMode}
          galleryOptions={stableGalleryOptions}
          filters={filters}
          workflowFilterMode={workflowFilterMode}
          selecting={selecting}
          selected={false}
          reorderBusy={reorderBusy}
        />
      ))}

      {pending.map((item, index) => (
        <QueueItemRow
          key={item?.[3]?.db_id ?? `${item?.[1]}-${index}`}
          item={item}
          className="pending"
          index={index}
          info={info}
          route={route}
          thumbMode={thumbMode}
          galleryOptions={stableGalleryOptions}
          filters={filters}
          workflowFilterMode={workflowFilterMode}
          selecting={selecting}
          selected={selected.has(item?.[3]?.db_id)}
          reorderBusy={reorderBusy}
          dragging={reorderPreview?.ids.includes(item?.[3]?.db_id) ?? false}
          reorderAnchor={reorderPreview?.anchorId === item?.[3]?.db_id ? reorderPreview.anchorSide : undefined}
        />
      ))}
    </>
  );
});

// take items from parent component
export const Queue = memo(function Queue({ data, isLoading, error, progress }) {
  const route = useAppStore((state) => state.route);
  const thumbMode = useOptionsStore((state) => state.thumb_mode);
  const options = useOptionsStore((state) => state.Completed);
  const galleryOptions = useOptionsStore((state) => state.Gallery);
  const selecting = useSelectionStore((state) => state.active);
  const selected = useSelectionStore((state) => state.selected);
  const containerRef = useRef(null);
  const ids = useMemo(() => (data?.pending ?? []).map((item) => item?.[3]?.db_id).filter(Number.isInteger), [data]);
  const canReorder = route === "queue" || route === "archive";
  const reorder = useQueueReorder(containerRef, canReorder && !isLoading, data, route);
  const {rectangle, onClickCapture} = useQueueSelection(containerRef, !isLoading && !reorder.busy, ids);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  const coverMode = String(options.CoverThumbMode ?? "Cropped")
    .toLowerCase()
    .replace(/\s+/g, "_");
  const gridMode = String(options.GridThumbMode ?? "Square Fit")
    .toLowerCase()
    .replace(/\s+/g, "_");

  const running = data?.running ?? [];
  const pending = data?.pending ?? [];

  return (
    <div
      className={
        "overflow-x-auto table-wrapper" + (selecting ? " selecting" : "") +
        (isLoading || reorder.busy ? " loading" : "") +
        " cover-" +
        coverMode +
        " grid-" +
        gridMode +
        " mode-"
      }
      style={{ "--job-progress": progress + "%" }}
    >
      <div className={"table-container"} ref={containerRef} onClickCapture={onClickCapture}>
        <>
          <table className="min-w-full border border-0">
            <thead className="dark:bg-neutral-800 bg-neutral-200 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                {route === "completed" &&
                  thumbMode === "cover" &&
                  (galleryOptions.ShowImages || galleryOptions.ShowVideos) && (
                    <th className="px-3 py-2 cover">Thumbnail</th>
                  )}
                <th className="px-3 py-2 text-left workflow-column">
                  Workflow
                </th>
                {route === "completed" &&
                  <th></th>
                }
                <th className="px-3 py-2 text-left">
                  {selecting ? <label className="selection-heading" data-selection-ignore>
                    Actions
                    <input type="checkbox" className="row-selection" aria-label="Select all visible jobs"
                      checked={allSelected} disabled={!ids.length || isLoading || reorder.busy}
                      ref={(input) => {if (input) input.indeterminate = selected.size > 0 && !allSelected;}}
                      onChange={() => useSelectionStore.getState().selectAll(ids)} />
                  </label> : "Actions"}
                </th>
                {canReorder && <th className="reorder-column" aria-label="Reorder jobs" title="Drag handles to reorder jobs in this tab" />}
              </tr>
            </thead>

            <tbody>
              {canReorder && reorder.error && <tr><td colSpan={100} className="selection-error" role="alert">{reorder.error}</td></tr>}
              {error && (
                <tr>
                  <td colSpan={100} className="text-red-500 text-center info-cell">
                    Loading failed: {error}
                  </td>
                </tr>
              )}

              {!isLoading && (!data || (!running.length && !pending.length)) && (
                <tr>
                  <td colSpan={100} className="italic text-center info-cell">
                    No items.
                  </td>
                </tr>
              )}

              {isLoading && !data && (
                <tr>
                  <td className="px-3 py-1 serial">
                    <LoaderSpinner />
                  </td>
                  <td colSpan={100} className="italic text-center info-cell">
                    Loading...
                  </td>
                </tr>
              )}

              {data && <QueueItems running={running} pending={pending} info={data.info} reorderPreview={reorder.preview} reorderBusy={reorder.busy || isLoading} />}
            </tbody>
          </table>
          {reorder.preview && <>
            {reorder.preview.line != null && <div className="reorder-line" style={{top: reorder.preview.line}} />}
            <div className="reorder-label" role="status" style={{top: reorder.preview.top}}>
              Move {reorder.preview.ids.length} {reorder.preview.ids.length === 1 ? "job" : "jobs"}
              {reorder.preview.position && ` ${reorder.preview.position} highlighted row`}
            </div>
          </>}
          {selecting && rectangle && <div className="selection-rectangle" style={{
            left: rectangle.left, top: rectangle.top, width: rectangle.right - rectangle.left,
            height: rectangle.bottom - rectangle.top,
          }} />}
        </>
      </div>
    </div>
  );
});
