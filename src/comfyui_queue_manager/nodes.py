from __future__ import annotations

from inspect import cleandoc
from typing import Any, Dict
import re


def sanitize_workflow_name(name: str) -> str:
    """Make a filename component without discarding any of the supplied text.

    Keep in sync with web/js/workflow-name.js.
    """
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    name = re.sub(r"[ .]+$", lambda match: "_" * len(match[0]), name)
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)", name, re.IGNORECASE):
        name = f"_{name}"
    return name


def resolve_workflow_name(text: str = "", workflow_name: str = "") -> str:
    # Include the BOM in whitespace checks, matching JavaScript string trimming.
    if re.search(r"[^\s\ufeff]", text):
        return sanitize_workflow_name(text)
    return workflow_name or ""


class WorkflowName:
    """
    Emits the workflow name, overridden by a typed or connected text value.
    Empty text falls back to the workflow filename, then an empty string.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {},
            # Optional text also keeps old API prompts (with no inputs) valid.
            "optional": {
                "text": ("STRING", {"default": "", "multiline": False, "dynamicPrompts": False}),
            },
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING",)  # socket type
    RETURN_NAMES = ("workflow_name",)  # socket label
    FUNCTION = "run"  # method to call
    CATEGORY = "Queue Manager"  # node menu group
    DESCRIPTION = cleandoc(__doc__)  # node tooltip

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Workflow metadata can change without any visible input changing.
        # ComfyUI's cache checks do not always receive EXTRA_PNGINFO.
        return float("nan")

    def run(self, text="", extra_pnginfo=None):
        workflow_name = (extra_pnginfo or {}).get("workflow", {}).get("workflow_name", "")
        return (resolve_workflow_name(text, workflow_name),)


NODE_CLASS_MAPPINGS = {
    "Workflow Name": WorkflowName,
}
NODE_DISPLAY_NAME_MAPPINGS = {}
