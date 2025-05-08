# Add custom API routes, using router
from aiohttp import web
from server import PromptServer


__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.nodes import NODE_CLASS_MAPPINGS
from .src.comfyui_queue_manager.nodes import NODE_DISPLAY_NAME_MAPPINGS


@PromptServer.instance.routes.get("/hello")
async def get_hello(request):
    return web.json_response("hello")


WEB_DIRECTORY = "./web"
