# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging, json
from datetime import datetime

from .helpers import sanitize_filename


class QM_Server:
    def __init__(self, queue_manager, __version__):
        self.queue_manager = queue_manager
        self.queue = queue_manager.queue
        self.__version__ = __version__

        # Get queue items
        @PromptServer.instance.routes.get("/queue_manager/queue")
        async def get_queue(request):
            # Get page number from query string
            page = int(request.query.get("page", 0))

            filters = self.get_filters(request)

            route = request.query.get("route", "queue")
            if route not in ["queue", "archive"]:
                return web.json_response({"error": "Invalid route"}, status=400)

            # pending items
            # TODO: Get page size from extension settings
            running, pending, info = self.queue.get_current_queue(page, 100, route=route, filters=filters)

            # Return the archive object as JSON
            return web.json_response({"running": running, "pending": pending, "info": info})

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

        # Play entire archive
        @PromptServer.instance.routes.post("/queue_manager/play-archive")
        async def play_archive(request):
            logging.info("[Queue Manager] Play archive")
            json_data = await request.json()
            client_id = None
            filters = None
            if "client_id" in json_data:
                client_id = json_data["client_id"]
            if "filters" in json_data:
                filters = json_data["filters"]

            moved = self.queue.play_archive(client_id, filters)
            return web.json_response({"archived": moved})

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
            filters = self.get_filters(request)
            total = self.queue.archive_queue(filters)
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
            is_archive = False

            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "client_id":
                    client_id = await field.read()
                if field.name == "archive":
                    is_archive = True

            try:
                json_data = json.loads(content)
            except json.JSONDecodeError as e:
                return web.Response(text=f"Invalid JSON: {e}", status=400)

            if client_id is not None:
                client_id = client_id.decode("ascii")

            logging.info("[Queue Manager] Importing %s", "to archive." if is_archive else "to queue.")
            imported, total = self.queue.import_queue(json_data, client_id, 3 if is_archive else 0)
            logging.info(
                "[Queue Manager] Imported %d of %d total submitted entries %s",
                imported,
                total,
                "to archive." if is_archive else "to queue.",
            )

            return web.json_response({"imported": imported, "submitted": total})

        # Export the queue
        @PromptServer.instance.routes.get("/queue_manager/export")
        async def export_queue(request):
            # Is there 'archive' in query string?
            archive = request.query.get("archive", "false").lower() == "true"
            filters = self.get_filters(request)

            # Export the queue
            json_data = self.queue.get_full_queue(archive, filters)

            # Get filter values from the request so we can include them in the export filename
            filter_values = []
            if filters is not None:
                for key, the_filter in filters.items():
                    if isinstance(the_filter, dict):
                        filter_values.append(the_filter["valueLabel"])
            if len(filter_values) > 0:
                filter_values = "(" + (",".join(filter_values)) + ")"
                # sanitize filter values for filename
                filter_values = sanitize_filename(filter_values)
            else:
                filter_values = ""

            # Trigger browser download
            response = web.json_response(json_data)
            # file name: comfyui-queue-export-[current-date-and-time].json
            response.headers["Content-Disposition"] = 'attachment; filename="comfyui-{}-export-{}.json"'.format(
                ("archive" if archive else "queue") + filter_values, datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            )
            response.headers["Content-Type"] = "application/json"
            return response

        # Delete archive
        @PromptServer.instance.routes.delete("/queue_manager/archive")
        async def delete_archive(request):
            # Delete the archive
            filters = self.get_filters(request)
            total = self.queue.delete_archive(filters)

            logging.info("[Queue Manager] Deleted %d items from the archive", total)

            return web.json_response({"deleted": total})

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

    def get_filters(self, request):
        filters_json = request.query.get("filters", None)
        filters = None
        if filters_json is not None:
            #     decode url-encoded json string
            try:
                filters = json.loads(filters_json)
            except json.JSONDecodeError:
                return web.json_response({"error": "Invalid filter format"}, status=400)

        return filters
