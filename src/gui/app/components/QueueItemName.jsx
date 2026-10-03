import { useRef, useState } from "react";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { apiCall } from "../internals/functions";

export function QueueItemName({ name, dbId, canRename, onFilter, onRenamed, filterTitle = "Filter view by the workflow" }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorHeight, setEditorHeight] = useState(0);
  const contentRef = useRef(null);
  const savingRef = useRef(false);

  const cancel = () => {
    if (savingRef.current) return;
    setEditing(false);
    setError("");
  };

  const save = async (event) => {
    event?.preventDefault();
    if (savingRef.current) return;
    if (draftName === name) {
      cancel();
      return;
    }
    if (!draftName.trim()) {
      setError("Name cannot be empty");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await apiCall("queue_manager/rename", { id: dbId, name: draftName });
      setEditing(false);
      onRenamed();
    } catch (error) {
      setError(error.message || "Could not rename this job. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="workflow-name">
      {editing && canRename ? (
        <form
          className="workflow-name-content"
          style={{ minHeight: editorHeight }}
          onSubmit={save}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              save();
            }
          }}
          aria-busy={saving}
        >
          <input
            className="workflow-name-input"
            aria-label="Workflow name"
            aria-invalid={!!error}
            value={draftName}
            disabled={saving}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => {
              setDraftName(event.target.value);
              setError("");
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
          <button type="submit" className="plain workflow-name-action" title="Save name (Enter)" aria-label="Save name" disabled={saving}>
            <CheckOutlinedIcon fontSize="small" />
          </button>
          <button type="button" className="plain workflow-name-action" onClick={cancel} title="Cancel (Escape)" aria-label="Cancel rename" disabled={saving}>
            <CloseOutlinedIcon fontSize="small" />
          </button>
        </form>
      ) : (
        <div className="workflow-name-content" ref={contentRef}>
          <button type="button" className="plain workflow-name-label" onClick={onFilter} title={filterTitle}>
            {name}
          </button>
          {canRename && (
            <button
              type="button"
              className="plain workflow-name-action"
              title="Rename workflow"
              aria-label="Rename workflow"
              onClick={() => {
                setEditorHeight(contentRef.current?.getBoundingClientRect().height ?? 0);
                setDraftName(name);
                setError("");
                setEditing(true);
              }}
            >
              <EditOutlinedIcon fontSize="small" />
            </button>
          )}
        </div>
      )}
      {error && <div className="workflow-name-error" role="alert">{error}</div>}
    </div>
  );
}
