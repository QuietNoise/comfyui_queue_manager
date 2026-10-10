# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import json
from datetime import datetime, timezone

from .helpers import sanitize_filename, requestJson
from .inc.exceptions import BadRouteException
from .qm_log import qm_log


class QM_Server:
    def __init__(self, queue_manager, __version__):
        self.queue_manager = queue_manager
        self.queue = queue_manager.queue
        self.gallery = queue_manager.gallery
        self.user_manager = PromptServer.instance.user_manager
        self.__version__ = __version__

        # Get queue items
        @PromptServer.instance.routes.get("/queue_manager/queue")
        async def get_queue(request):
            # Get page number from query string
            page = int(request.query.get("page", 0))

            filters = self.get_filters(request)

            route = self.get_the_route(request)

            # Get page size from extension settings
            settings = self.user_manager.settings.get_settings(None)
            page_size = settings.get("QueueManager.Basic.PageSize", 100)
            # The open frontend can supply a setting change before ComfyUI saves it.
            if "page_size" in request.query:
                try:
                    page_size = int(request.query["page_size"])
                except ValueError:
                    return web.json_response({"error": "Invalid page size"}, status=400)
                if not 1 <= page_size <= 200:
                    return web.json_response({"error": "Page size must be between 1 and 200"}, status=400)
            if route == "completed":
                order = request.query.get("order")
                if order is None:
                    saved_order = settings.get("QueueManager.Completed.ListOrder", "Newest first")
                    order = "desc" if saved_order == "Newest first" else "asc"
                if order not in ("asc", "desc"):
                    return web.json_response({"error": "Invalid completed jobs order"}, status=400)
            else:
                order = None

            # pending items
            running, pending, info = self.queue.get_current_queue(
                page, page_size, route=route, filters=filters, return_meta=True, order=order
            )

            # Remove sensitive data
            remove_sensitive = lambda queue: [x[:5] for x in queue]
            running = remove_sensitive(running)
            pending = remove_sensitive(pending)

            # Return the archive object as JSON
            return web.json_response({"running": running, "pending": pending, "info": info})

        @PromptServer.instance.routes.post("/queue_manager/reorder")
        async def reorder_items(request):
            data = await requestJson(request)
            if not isinstance(data, dict):
                return web.json_response({"error": "Expected a JSON object"}, status=400)
            try:
                result = self.queue.reorder_items(
                    data.get("ids"), data.get("target_id"), data.get("position"), data.get("route", "queue"), data.get("destination")
                )
            except ValueError as error:
                return web.json_response({"error": str(error)}, status=400)
            except RuntimeError as error:
                return web.json_response({"error": str(error)}, status=409)
            return web.json_response(result)

        @PromptServer.instance.routes.post("/queue_manager/rename")
        async def rename_item(request):
            json_data = await requestJson(request)
            if not isinstance(json_data, dict):
                return web.json_response({"error": "Expected a JSON object"}, status=400)
            try:
                if "ids" in json_data:
                    result = self.queue.rename_items(json_data["ids"], json_data.get("name"), json_data.get("route"))
                else:
                    name = self.queue.rename_item(json_data.get("id"), json_data.get("name"))
                    result = {"id": json_data["id"], "name": name}
            except ValueError as error:
                return web.json_response({"error": str(error)}, status=400)
            except LookupError as error:
                return web.json_response({"error": str(error)}, status=404)
            except RuntimeError as error:
                return web.json_response({"error": str(error)}, status=409)
            return web.json_response(result)

        @PromptServer.instance.routes.post("/queue_manager/selection")
        async def selection_action(request):
            data = await requestJson(request)
            if not isinstance(data, dict):
                return web.json_response({"error": "Expected a JSON object"}, status=400)
            try:
                result = self.queue.selection_action(
                    data.get("action"),
                    data.get("route"),
                    data.get("ids"),
                    data.get("client_id"),
                    data.get("front") is True,
                )
            except ValueError as error:
                return web.json_response({"error": str(error)}, status=400)
            if data["action"] == "export":
                return web.json_response(result)
            return web.json_response({"affected": result})

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
            qm_log.info("Play archive")
            json_data = await request.json()
            client_id = None
            filters = None
            if "client_id" in json_data:
                client_id = json_data["client_id"]
            if "filters" in json_data:
                filters = json_data["filters"]

            front = json_data.get("front", False) == True

            moved = self.queue.play_archive(client_id, filters, front)
            return web.json_response({"queued": moved})

        # Toggle Play/Pause of the queue
        @PromptServer.instance.routes.get("/queue_manager/toggle")
        async def toggle_queue(request):
            # Prefer the live browser value; older clients use their saved setting.
            clean_caches = request.query.get("clean_caches")
            if clean_caches is None:
                settings = self.user_manager.settings.get_settings(request)
                clean_caches = settings.get("QueueManager.Basic.CleanCachesOnPause", False) is True
            elif clean_caches in ("true", "false"):
                clean_caches = clean_caches == "true"
            else:
                return web.json_response({"error": "Invalid clean_caches value"}, status=400)
            self.queue.toggle_playback(clean_caches=clean_caches)
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
            api_key_comfy_org = None

            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "client_id":
                    client_id = await field.read()
                if field.name == "archive":
                    is_archive = True
                if field.name == "api_key_comfy_org":
                    api_key_comfy_org = await field.read()

            try:
                json_data = json.loads(content)
            except json.JSONDecodeError as e:
                return web.Response(text=f"Invalid JSON: {e}", status=400)

            if client_id is not None:
                client_id = client_id.decode("ascii")

            if api_key_comfy_org is not None:
                api_key_comfy_org = api_key_comfy_org.decode("ascii")

            qm_log.info("Importing %s", "to archive." if is_archive else "to queue.")
            imported, total = self.queue.import_queue(json_data, client_id, 3 if is_archive else 0, api_key_comfy_org)
            qm_log.info(
                "Imported %d of %d total submitted entries %s %s",
                imported,
                total,
                "to archive." if is_archive else "to queue.",
                "Duplicate entries (items that already exist in Queue, Archive or Completed) were skipped." if imported < total else "",
            )

            return web.json_response({"imported": imported, "submitted": total})

        # Export the queue
        @PromptServer.instance.routes.get("/queue_manager/export")
        async def export_queue(request):
            route = self.get_the_route(request)

            filters = self.get_filters(request)

            # Export the queue
            json_data = self.queue.get_full_queue(route, filters)

            # Remove sensitive data from items. json_data is a list of lists, check each item if it is 6 elements long and remove the 6th element
            for i in range(len(json_data)):
                if len(json_data[i]) >= 6:
                    del json_data[i][5]

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

            qm_log.info("Deleted %d items from the archive", total)

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

            qm_log.info(f"Client takeover requested by {client_id}")

            return web.json_response(takeover_client)

        @PromptServer.instance.routes.get("/queue_manager/open_location")
        async def open_location(request):
            id = request.query.get("id", None)
            filename = request.query.get("filename", None)
            subfolder = request.query.get("subfolder", None)

            # If any is None, return error
            if id is None or filename is None:
                return web.json_response({"error": "Missing parameters"}, status=400)

            result = self.queue_manager.queue.open_file_location(id, filename, subfolder)

            # Return result of the operation
            if result is None:
                return web.json_response({"error": "File not found"}, status=404)

            return web.json_response("Location opened")

        # Allowed options with their default values
        self.allowed_options = {
            "thumb_size": 150,
            "cover_size": 50,
            "thumb_mode": "cover",
            "queue_paused": False,
            "splash_screen": "0.0.0",  # last seen splash screen version
            "show_gallery_ui": True,
        }

        # Get options
        @PromptServer.instance.routes.get("/queue_manager/options")
        async def get_options(request):
            # Does option is allowed?
            option = request.query.get("key", None)
            if option is not None:
                if option not in self.allowed_options:
                    return web.json_response({"error": "Option not allowed"}, status=400)

                # Get the specific option
                value = self.queue_manager.options.get(option, None)
                if value is None:
                    return web.json_response({"error": "Option not found"}, status=404)

                return web.json_response({option: value})
            else:
                # Get all options
                options = self.queue_manager.options.get_all()

                # Return only allowed options
                options = {key: value for key, value in options.items() if key in self.allowed_options}

                # Add default values for any missing allowed options
                for key, default_value in self.allowed_options.items():
                    if key not in options:
                        options[key] = default_value

                # append extension version
                options["__version__"] = self.__version__

                return web.json_response(options)

        # Set options
        @PromptServer.instance.routes.post("/queue_manager/options")
        async def set_options(request):
            # Does option is allowed?
            json_data = await request.json()
            if "key" not in json_data or "value" not in json_data:
                return web.json_response({"error": "Missing parameters"}, status=400)

            option = json_data["key"]
            value = json_data["value"]

            if option not in self.allowed_options:
                return web.json_response({"error": "Option not allowed"}, status=400)

            # Validate / sanitize value based on option
            if option == "thumb_size":  # thumb size must be a positive integer between 50 and 500
                if not isinstance(value, int) or value < 50 or value > 500:
                    return web.json_response({"error": "Invalid thumb_size value"}, status=400)
            elif option == "thumb_mode":  # thumb mode must be one of the allowed modes
                allowed_modes = ["none", "cover", "grid"]
                if value not in allowed_modes:
                    return web.json_response({"error": "Invalid thumb_mode value"}, status=400)
            elif option == "cover_size":  # cover size must be a positive integer between 50 and 500
                if not isinstance(value, int) or value < 25 or value > 200:
                    return web.json_response({"error": "Invalid cover_size value"}, status=400)
            #     Boolean options
            elif option == "queue_paused" or option == "show_gallery_ui":
                if not isinstance(value, bool):
                    return web.json_response({"error": "Invalid " + option + " value"}, status=400)
            elif (
                option == "splash_screen"
            ):  # splash_screen we always set to current version (indication that user has seen the latest splash)
                value = self.__version__

            # Set the specific option
            self.queue_manager.options.set(option, value)
            # qm_log.info(f"Set option {option} to {value}")

            return web.json_response({"success": True})

        @PromptServer.instance.routes.get("/queue_manager/poke_status")
        async def poke_status(request):
            PromptServer.instance.queue_updated()
            return web.json_response({"success": True})

        # Hook us into the server's middleware so we can listen to some native api requests
        @web.middleware
        async def post_queue(request, handler):
            """
            Handle the request to clear or delete items from the queue.
            """
            if request.method == "POST":
                match request.path:
                    case "/api/queue":
                        json_data = await requestJson(request)
                        if "clear" in json_data:
                            if json_data["clear"]:
                                self.queue.wipe_queue()
                        if "delete" in json_data:
                            self.queue.delete_items(json_data["delete"])
                    case "/api/interrupt":
                        json_data = await requestJson(request)
                        total = 0

                        if ("prompt_id" in json_data) and (json_data["prompt_id"] is not None):
                            # delete specific item
                            total = self.queue.delete_running(json_data["prompt_id"])
                            # logging.info(f"[Queue Manager] Interrupting item {json_data["prompt_id"]}")
                        else:
                            # delete the currently running item
                            total = self.queue.delete_running()
                            qm_log.info(f"[Queue Manager] Deleted {total} items from the queue")

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
                qm_log.error(ae.message)
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
