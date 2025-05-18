# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging

# import traceback

# import json
# import uuid


class QM_Server:
    def __init__(self, __version__):
        # Save shadow copy of the queue and return it to the client
        @PromptServer.instance.routes.get("/queue_manager/queue")
        async def get_queue(request):
            # pending items
            queue = PromptServer.instance.prompt_queue.get_current_queue(0, 100)

            # Return the queue object as JSON
            return web.json_response({"running": queue[0], "pending": queue[1]})

        # Toggle Play/Pause of the queue
        @PromptServer.instance.routes.post("/queue_manager/toggle")
        async def toggle_queue(request):
            # Get the current status of the queue
            queue = PromptServer.instance.prompt_queue

            # Toggle the status of the queue
            if queue.is_paused:
                queue.resume()
                logging.info("[Queue Manager] Queue resumed.")
                return web.json_response({"status": "success", "message": "Queue resumed."})
            else:
                queue.pause()
                logging.info("[Queue Manager] Queue paused.")
                return web.json_response({"status": "success", "message": "Queue paused."})

        # Endpoint to expose __version__ information
        @PromptServer.instance.routes.get("/queue_manager/version")
        async def get_version(request):
            # Return the version as JSON
            return web.json_response({"version": __version__})
