"""Queue display metadata without inventing a GUI workflow for API prompts."""

from .nodes import resolve_workflow_name


def _mapping(value):
    return value if isinstance(value, dict) else {}


def workflow_data(item):
    return _mapping(_mapping(item[3].get("extra_pnginfo")).get("workflow"))


def queue_metadata(item):
    workflow = workflow_data(item)
    metadata = _mapping(item[3].get("queue_manager"))
    name = metadata.get("name", workflow.get("workflow_name"))
    if not isinstance(name, str):
        name = f"API job {str(item[1])[:8]}"
    workflow_id = metadata.get("workflow_id", workflow.get("id"))
    if not isinstance(workflow_id, str) or not workflow_id:
        # Each API submission has its own identity unless the caller supplies one.
        workflow_id = f"api:{item[1]}"
    return {"name": name, "workflow_id": workflow_id}


def prepare_queue_item(item):
    """Copy only extra data needing queue metadata; preserve executable/sensitive fields."""
    workflow = workflow_data(item)
    if (
        isinstance(workflow.get("workflow_name"), str)
        and isinstance(workflow.get("id"), str)
        and workflow["id"]
        and "queue_manager" not in item[3]
    ):
        return item
    metadata = queue_metadata(item)
    metadata["name"] = resolve_workflow_name(metadata["name"])
    extra = {**item[3], "queue_manager": {**_mapping(item[3].get("queue_manager")), **metadata}}
    return (item[0], item[1], item[2], extra, *item[4:])


def rename_queue_item(item, name):
    """Update the saved name while leaving API prompts and absent PNG metadata alone."""
    workflow = workflow_data(item)
    if workflow:
        workflow["workflow_name"] = name
    if "queue_manager" in item[3] or not workflow:
        item[3]["queue_manager"] = {**_mapping(item[3].get("queue_manager")), **queue_metadata(item), "name": name}
