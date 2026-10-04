import { useEffect, useRef, useState } from "react";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { apiCall } from "../internals/functions";
import {useSelectionStore} from "../stores/selectionStore";
import {consumeRenameGesture} from "../internals/renameGesture.mjs";

export function QueueItemName({ name, dbId, canRename, selecting = false, route, onFilter, onRenamed, filterTitle = "Filter view by the workflow" }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorHeight, setEditorHeight] = useState(0);
  const contentRef = useRef(null);
  const formRef = useRef(null);
  const inputRef = useRef(null);
  const savingRef = useRef(false);
  const saveRef = useRef(null);
  const group = useSelectionStore((state) => state.rename);
  const groupSource = selecting && group?.sourceId === dbId;
  const groupAffected = selecting && group?.ids.includes(dbId);
  const isEditing = canRename && (groupSource || (!selecting && editing));
  const value = groupSource ? group.draftName : draftName;
  const busy = groupSource ? group.saving : saving;
  const message = groupSource ? group.error : error;

  useEffect(() => {
    if (!isEditing) return;
    // Even non-focusable row backgrounds must blur and commit the active input.
    const blurOutside = (event) => {
      if (formRef.current?.contains(event.target)) return;
      // This click only finishes editing; it must not also change the selection,
      // start a drag, run an action, or open a newly enabled rename pencil.
      if (groupSource) consumeRenameGesture(event, document);
      const commit = saveRef.current;
      inputRef.current?.blur();
      commit?.();
    };
    document.addEventListener("pointerdown", blurOutside, true);
    return () => document.removeEventListener("pointerdown", blurOutside, true);
  }, [isEditing, groupSource]);

  const cancel = () => {
    if (savingRef.current || busy) return;
    if (groupSource) useSelectionStore.getState().finishRename(group.sessionId);
    setEditing(false);
    setError("");
  };

  const save = async (event) => {
    event?.preventDefault();
    if (savingRef.current || busy) return;
    const batch = groupSource ? useSelectionStore.getState().rename : null;
    if (groupSource && batch?.sessionId !== group.sessionId) return;
    const newName = batch ? batch.draftName : draftName;
    // Explicit Save/Enter can apply the source name to differently named jobs.
    if (batch ? newName === batch.initialName && event?.type !== "submit" : newName === name) {
      cancel();
      return;
    }
    if (!newName.trim()) {
      if (batch) useSelectionStore.getState().updateRename(batch.sessionId, {error: "Name cannot be empty"});
      else setError("Name cannot be empty");
      return;
    }

    savingRef.current = true;
    if (batch) useSelectionStore.getState().updateRename(batch.sessionId, {saving: true, error: ""});
    else {setSaving(true); setError("");}
    try {
      await apiCall("queue_manager/rename", batch
        ? {ids: batch.ids, name: newName, route: batch.route}
        : {id: dbId, name: newName});
      if (batch) useSelectionStore.getState().finishRename(batch.sessionId);
      setEditing(false);
      onRenamed();
    } catch (error) {
      const message = error.message || "Could not rename. Try again.";
      if (batch) useSelectionStore.getState().updateRename(batch.sessionId, {saving: false, error: message});
      else setError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  saveRef.current = save;

  return (
    <div className={"workflow-name" + (groupAffected ? " group-renaming" : "")}>
      {isEditing ? (
        <form ref={formRef} data-selection-ignore
          className="workflow-name-content"
          style={{ minHeight: editorHeight }}
          onSubmit={save}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) save();
          }}
          aria-busy={busy}
        >
          <input ref={inputRef}
            className="workflow-name-input"
            aria-label={groupSource ? `Name for ${group.ids.length} selected workflows` : "Workflow name"}
            aria-invalid={!!message}
            title={groupSource ? `Renaming ${group.ids.length} selected workflows together` : undefined}
            value={value}
            disabled={busy}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => {
              if (groupSource) useSelectionStore.getState().updateRename(group.sessionId, {draftName: event.target.value, error: ""});
              else {setDraftName(event.target.value); setError("");}
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                if (event.key === "Enter") event.preventDefault();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
          <button type="submit" className="plain workflow-name-action" title="Save name (Enter)" aria-label="Save name" disabled={busy}>
            <CheckOutlinedIcon fontSize="small" />
          </button>
          <button type="button" className="plain workflow-name-action" onClick={cancel} title="Cancel (Escape)" aria-label="Cancel rename" disabled={busy}>
            <CloseOutlinedIcon fontSize="small" />
          </button>
        </form>
      ) : (
        <div className="workflow-name-content" ref={contentRef}>
          {selecting ? <span className={groupAffected ? "workflow-name-preview" : "workflow-name-label"}
            title={groupAffected ? `Will be renamed with ${group.ids.length} selected workflows` : undefined}>
            {groupAffected ? group.draftName : name}
          </span> : <button type="button" className="plain workflow-name-label" onClick={onFilter} title={filterTitle}>
            {name}
          </button>}
          {canRename && (
            <button type="button" data-selection-ignore
              className="plain workflow-name-action"
              title={group ? "Finish the current rename first" : selecting ? "Rename selected workflows (adds this job if unselected)" : "Rename workflow"}
              aria-label="Rename workflow"
              disabled={!!group}
              onClick={() => {
                if (useSelectionStore.getState().rename) return;
                setEditorHeight(contentRef.current?.getBoundingClientRect().height ?? 0);
                setError("");
                if (selecting) useSelectionStore.getState().beginRename(dbId, name, route);
                else {setDraftName(name); setEditing(true);}
              }}
            >
              <EditOutlinedIcon fontSize="small" />
            </button>
          )}
        </div>
      )}
      {message && isEditing && <div className="workflow-name-error" role="alert">{message}</div>}
    </div>
  );
}
