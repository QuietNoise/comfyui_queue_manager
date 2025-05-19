# Add custom API routes, using router
from aiohttp import web
from server import PromptServer


class QM_Server:
    def __init__(self, queue_manager, __version__):
        self.queue_manager = queue_manager
        self.__version__ = __version__

        # Save shadow copy of the queue and return it to the client
        @PromptServer.instance.routes.get("/queue_manager/queue")
        async def get_queue(request):
            # pending items
            queue = PromptServer.instance.prompt_queue.get_current_queue(0, 100)

            # Return the queue object as JSON
            return web.json_response({"running": queue[0], "pending": queue[1]})

        # Toggle Play/Pause of the queue
        @PromptServer.instance.routes.get("/queue_manager/toggle")
        async def toggle_queue(request):
            # Toggle the status of the queue
            self.queue_manager.queue.toggle_playback()
            return web.json_response({"paused": self.queue_manager.queue.paused})

        # Return the status of the queue's playback
        @PromptServer.instance.routes.get("/queue_manager/playback")
        async def check_queue_playback(request):
            PromptServer.instance.send_sync(
                "queue-manager-toggle-queue",
                {
                    "paused": self.queue_manager.queue.paused,
                },
            )
            return web.json_response({"paused": self.queue_manager.queue.paused})

        # Endpoint to expose __version__ information
        @PromptServer.instance.routes.get("/queue_manager/version")
        async def get_version(request):
            # Return the version as JSON
            return web.json_response({"version": self.__version__})

        # Hook us into the server's middleware so we can handle POST "/api/queue" requests
        @web.middleware
        async def post_queue(request, handler):
            """
            Handle the request to clear or delete items from the queue.
            """
            if request.method == "POST" and request.path == "/api/queue":
                json_data = await request.json()
                if "clear" in json_data:
                    if json_data["clear"]:
                        self.queue_manager.queue.wipe_queue()
                if "delete" in json_data:
                    self.queue_manager.queue.delete_items(json_data["delete"])

            return await handler(request)

        PromptServer.instance.app.middlewares.insert(
            0,
            post_queue,
        )
