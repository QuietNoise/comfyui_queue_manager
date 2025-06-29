from __future__ import annotations

from inspect import cleandoc
from typing import Any, Dict
from server import PromptServer


class WorkflowName:
    """
    Emits the currently running workflow's name.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        # no sockets, no UI fields
        return {"required": {}}

    RETURN_TYPES = ("STRING",)  # socket type
    RETURN_NAMES = ("workflow_name",)  # socket label
    FUNCTION = "run"  # method to call
    CATEGORY = "Queue Manager"  # node menu group
    DESCRIPTION = cleandoc(__doc__)  # node tooltip

    def run(self):
        running = next(iter(PromptServer.instance.prompt_queue.currently_running.values()), None)

        if running is not None:
            wf_name = (
                running[3]  # prompt_options dict
                .get("extra_pnginfo", {})
                .get("workflow", {})
                .get("workflow_name", "")
            )
            if wf_name:
                # If the workflow name is set, return it
                return (wf_name,)
        # If no workflow is running or the name is not set, return an empty string
        return ("",)


NODE_CLASS_MAPPINGS = {
    "Workflow Name": WorkflowName,
}
NODE_DISPLAY_NAME_MAPPINGS = {}
