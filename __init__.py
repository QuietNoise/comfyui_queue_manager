# SIML: Enable option to toggle logging

__all__ = [
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.queue_manager import QueueManager


# When the server is fully started, restore the queue from the shadow copy
# async def on_ready(app):
#     # TODO: Add a setting to enable/disable this feature
#     restore_queue()
# PromptServer.instance.app.on_startup.append(on_ready)

queueManager = QueueManager(__version__)

WEB_DIRECTORY = "./web"
