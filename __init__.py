"""Top-level package for comfyui_queue_manager."""

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.nodes import NODE_CLASS_MAPPINGS
from .src.comfyui_queue_manager.nodes import NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"
