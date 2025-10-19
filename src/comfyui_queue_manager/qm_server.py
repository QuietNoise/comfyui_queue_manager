# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging, json
from datetime import datetime, timezone

from .helpers import sanitize_filename
from .inc.exceptions import BadRouteException


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

            route = self.get_the_route(request)

            # pending items
            # TODO: Get page size from extension settings
            running, pending, info = self.queue.get_current_queue(page, 100, route=route, filters=filters, return_meta=True)

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
            route = self.get_the_route(request)

            filters = self.get_filters(request)

            # Export the queue
            json_data = self.queue.get_full_queue(route, filters)

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
                route + filter_values, datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            )
            response.headers["Content-Type"] = "application/json"
            return response

        # Delete archive
        @PromptServer.instance.routes.delete("/queue_manager/queue")
        async def delete_from_queue(request):
            route = self.get_the_route(request)
            filters = self.get_filters(request)
            total = self.queue.delete_from_queue(route, filters)

            logging.info("[Queue Manager] Deleted %d items from the archive", total)

            return web.json_response({"deleted": total})

        # Take over client focus
        @PromptServer.instance.routes.get("/queue_manager/takeover")
        async def takeover_focus(request):
            client_id = request.query.get("client_id", None)

            # is client_id valid: 32 chars hex
            if client_id is None:
                return web.json_response({"error": "Client ID not provided"}, status=400)
            if len(client_id) != 32:
                return web.json_response({"error": "Invalid client ID"}, status=400)
            if not all(c in "0123456789abcdef" for c in client_id):
                return web.json_response({"error": "Invalid client ID"}, status=400)

            takeover_client = {"client_id": client_id, "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")}

            self.queue_manager.queue.takeover_client = takeover_client
            self.queue_manager.options.set("takeover_client", client_id)

            logging.info(f"[Queue Manager] Client takeover requested by {client_id}")

            return web.json_response(takeover_client)

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
                        json_data = await request.json()
                        total = 0

                        if ("prompt_id" in json_data) and (json_data["prompt_id"] is not None):
                            # delete specific item
                            total = self.queue.delete_running(json_data["prompt_id"])
                            # logging.info(f"[Queue Manager] Interrupting item {json_data["prompt_id"]}")
                        else:
                            # delete the currently running item
                            total = self.queue.delete_running()
                        logging.info(f"[Queue Manager] Deleted {total} items from the queue")

            return await handler(request)

        PromptServer.instance.app.middlewares.insert(
            0,
            post_queue,
        )

        # Handle internal errors
        @web.middleware
        async def error_middleware(request, handler):
            try:
                return await handler(request)
            except BadRouteException as ae:
                logging.error("[Queue Manager] " + ae.message)
                return web.json_response(
                    {"error": ae.message},
                    status=422,
                )

        PromptServer.instance.app.middlewares.insert(
            0,
            error_middleware,
        )

    def get_the_route(self, request):
        """
        Check if the route is valid.
        """
        route = request.query.get("route", "queue")
        if route not in ["queue", "archive", "completed"]:
            raise BadRouteException("Invalid route: " + route)

        return route

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
