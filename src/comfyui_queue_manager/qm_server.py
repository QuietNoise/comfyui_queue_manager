# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging, json


class QM_Server:
    def __init__(self, queue_manager, __version__):
        self.queue_manager = queue_manager
        self.queue = queue_manager.queue
        self.__version__ = __version__

        # Get queue items
        @PromptServer.instance.routes.get("/queue_manager/queue")
        async def get_queue(request):
            # pending items
            queue = self.queue.get_current_queue(0, 100)

            # Return the queue object as JSON
            return web.json_response({"running": queue[0], "pending": queue[1]})

        # Get archived items
        @PromptServer.instance.routes.get("/queue_manager/archive")
        async def get_archive(request):
            # Get the archived items
            archive = self.queue.get_archived_items()

            # Return the archive object as JSON
            return web.json_response({"running": [], "pending": archive})

        # Archive POSTed items
        @PromptServer.instance.routes.post("/queue_manager/archive")
        async def post_archive(request):
            # Get the archived items
            json_data = await request.json()
            if "archive" in json_data:
                archived = self.queue.archive_items(json_data["archive"])
                return web.json_response({"archived": archived})
            else:
                return web.json_response({"error": "No items to archive"}, status=400)

        # Toggle Play/Pause of the queue
        @PromptServer.instance.routes.get("/queue_manager/toggle")
        async def toggle_queue(request):
            # Toggle the status of the queue
            self.queue.toggle_playback()
            return web.json_response({"paused": self.queue.paused})

        # Return the status of the queue's playback
        @PromptServer.instance.routes.get("/queue_manager/playback")
        async def check_queue_playback(request):
            PromptServer.instance.send_sync(
                "queue-manager-toggle-queue",
                {
                    "paused": self.queue.paused,
                },
            )
            return web.json_response({"paused": self.queue.paused})

        @PromptServer.instance.routes.get("/queue_manager/archive-queue")
        async def archive_queue(request):
            # Archive the queue
            total = self.queue.archive_queue()
            return web.json_response({"archived": total})

        # Play item from archive
        @PromptServer.instance.routes.post("/queue_manager/play")
        async def play_item(request):
            # Get the item to play
            json_data = await request.json()
            if "items" in json_data:
                total = self.queue.play_items(json_data["items"], json_data.get("front", False) == True, json_data.get("clientId", None))
                return web.json_response({"moved": total})
            else:
                return web.json_response({"error": "No item to play"}, status=400)

        # Endpoint to expose __version__ information
        @PromptServer.instance.routes.get("/queue_manager/version")
        async def get_version(request):
            # Return the version as JSON
            return web.json_response({"version": self.__version__})

        # Import the queue
        @PromptServer.instance.routes.post("/queue_manager/import")
        async def import_queue(request):
            reader = await request.multipart()

            field = await reader.next()
            if field is None or field.name != "queue_json":
                return web.Response(text="No file uploaded", status=400)

            content = await field.read()

            client_id = None

            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "client_id":
                    client_id = await field.read()

            try:
                json_data = json.loads(content)
            except json.JSONDecodeError as e:
                return web.Response(text=f"Invalid JSON: {e}", status=400)

            if client_id is not None:
                client_id = client_id.decode("ascii")

            logging.info("[Queue Manager] Importing queue.")
            imported, total = self.queue_manager.import_queue(json_data, client_id)
            logging.info("[Queue Manager] Imported %d of %d total submitted entries.", imported, total)

            return web.json_response({"imported": imported, "submitted": total})

        # Hook us into the server's middleware so we can listen to some native api requests
        @web.middleware
        async def post_queue(request, handler):
            """
            Handle the request to clear or delete items from the queue.
            """
            if request.method == "POST":
                match request.path:
                    case "/api/queue":
                        json_data = await request.json()
                        if "clear" in json_data:
                            if json_data["clear"]:
                                self.queue.wipe_queue()
                        if "delete" in json_data:
                            self.queue.delete_items(json_data["delete"])
                    case "/api/interrupt":
                        # delete the currently running item
                        total = self.queue.delete_running()
                        logging.info(f"[Queue Manager] Deleted {total} items from the queue")

            return await handler(request)

        PromptServer.instance.app.middlewares.insert(
            0,
            post_queue,
        )
