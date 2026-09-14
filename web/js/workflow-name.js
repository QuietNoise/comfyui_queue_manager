// Keep filename sanitization and precedence in sync with nodes.py.
export function sanitizeWorkflowName(name) {
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  name = name.replace(/[ .]+$/g, suffix => '_'.repeat(suffix.length));
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) {
    name = `_${name}`;
  }
  return name;
}

export function resolveWorkflowName(text = '', workflowName = '') {
  // Include Python's additional whitespace characters for identical fallbacks.
  const nonWhitespace = /[^\s\u001c-\u001f\u0085]/u;
  if (typeof text === 'string' && nonWhitespace.test(text)) {
    return sanitizeWorkflowName(text);
  }
  return workflowName || '';
}

function liveNode(graph, id) {
  return graph?.getNodeById?.(id);
}

function readString(value, output, graph, workflowName, visited = new Set()) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length !== 2) return undefined;

  const [id, slot] = value;
  const key = `${id}:${slot}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const source = output?.[id];
  // Known pass-through nodes can be read before their first execution.
  if (slot === 0 && ['PrimitiveString', 'PrimitiveStringMultiline'].includes(source?.class_type)) {
    return readString(source.inputs?.value, output, graph, workflowName, visited);
  }
  if (slot === 0 && source?.class_type === 'Workflow Name') {
    return nodeWorkflowName(id, source, output, graph, workflowName, visited);
  }
  const current = liveNode(graph, id)?.getOutputData?.(slot);
  return typeof current === 'string' ? current : undefined;
}

function nodeWorkflowName(id, node, output, graph, workflowName, visited = new Set()) {
  const inputs = node.inputs ?? {};
  const live = liveNode(graph, id);
  const socketIndex = live?.inputs?.findIndex(input => input.name === 'text') ?? -1;
  let text = readString(inputs.text, output, graph, workflowName, visited);
  if (text === undefined && socketIndex >= 0 && live.inputs[socketIndex].link != null) {
    const current = live.getInputData?.(socketIndex);
    if (typeof current === 'string') text = current;
  }
  // Unavailable socket data is empty at queue time; execution may produce a new value.
  return resolveWorkflowName(text ?? '', workflowName);
}

export function queuedWorkflowName(data, graph, workflowName) {
  // Use the submitted prompt: muted/bypassed nodes have already been removed,
  // primitive widgets resolved, and subgraphs expanded by ComfyUI.
  const entry = Object.entries(data.output ?? {}).find(([, node]) => node.class_type === 'Workflow Name');
  return entry ? nodeWorkflowName(entry[0], entry[1], data.output, graph, workflowName) : workflowName;
}

export function installWorkflowNameInjection(app) {
  const apiQueuePrompt = app.api.queuePrompt;
  app.api.queuePrompt = async function(n, data, ...args) {
    if (data.workflow) {
      data.workflow.workflow_name = queuedWorkflowName(
        data, app.graph, app.extensionManager.workflow.activeWorkflow?.filename ?? ''
      );
    }
    return await apiQueuePrompt.call(this, n, data, ...args);
  };
}
