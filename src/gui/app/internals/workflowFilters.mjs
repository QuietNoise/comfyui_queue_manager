const WORKFLOW_FILTER_MODE_KEY = "queue-manager.workflow-filter-mode";

export function readWorkflowFilterMode(storage) {
  try {
    const mode = (storage ?? globalThis.localStorage)?.getItem(WORKFLOW_FILTER_MODE_KEY);
    return mode === "workflow_name" ? mode : "workflow";
  } catch {
    return "workflow";
  }
}

export function saveWorkflowFilterMode(mode, storage) {
  if (!["workflow", "workflow_name"].includes(mode)) return;
  try {
    (storage ?? globalThis.localStorage)?.setItem(WORKFLOW_FILTER_MODE_KEY, mode);
  } catch {
    // Keep filtering usable when browser storage is unavailable.
  }
}

export function getWorkflowFilter(filters) {
  if (filters?.workflow_name) {
    const filter = filters.workflow_name;
    return {mode: "workflow_name", id: filter.workflowId, name: filter.value};
  }
  if (filters?.workflow) {
    const filter = filters.workflow;
    return {mode: "workflow", id: filter.value, name: filter.valueLabel ?? ""};
  }
  return null;
}

export function withWorkflowFilter(filters, selection, mode = getWorkflowFilter(filters)?.mode ?? "workflow") {
  if (!selection || !["workflow", "workflow_name"].includes(mode)) return filters;
  if (mode === "workflow" && !selection.id) return filters;
  if (typeof selection.name !== "string") return filters;

  const next = {...filters};
  delete next.workflow;
  delete next.workflow_name;
  next[mode] = {
    type: mode,
    value: mode === "workflow" ? selection.id : selection.name,
    valueLabel: selection.name,
    // Retain the clicked workflow so switching back does not need another row.
    ...(mode === "workflow_name" ? {workflowId: selection.id} : {}),
  };
  return next;
}
