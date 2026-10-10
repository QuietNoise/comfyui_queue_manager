// Presentation data only: never add a fabricated workflow to execution/PNG metadata.
export function queueWorkflow(item) {
  const saved = item?.[3]?.extra_pnginfo?.workflow;
  const workflow = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const metadata = item?.[3]?.queue_manager;
  return {
    ...workflow,
    id: metadata?.workflow_id ?? workflow.id ?? `api:${item?.[1]}`,
    workflow_name: metadata?.name ?? workflow.workflow_name ?? `API job ${String(item?.[1] ?? "").slice(0, 8)}`,
    // The parent uses ComfyUI's API loader when the original canvas is absent.
    ...(!Array.isArray(workflow.nodes) ? {api_prompt: item?.[2]} : {}),
  };
}

export function queueNodeIDs(item) {
  const workflow = queueWorkflow(item);
  const ids = workflow.api_prompt
    ? Object.keys(workflow.api_prompt)
    : (workflow.nodes ?? []).map(node => node.id).filter(id => id != null);
  return Object.fromEntries(ids.map(id => [id, id]));
}
