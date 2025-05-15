# Add custom API routes, using router
from aiohttp import web
from server import PromptServer
import logging
import json
import os
import heapq
import sqlite3, threading

# import json
# import uuid

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.nodes import NODE_CLASS_MAPPINGS
from .src.comfyui_queue_manager.nodes import NODE_DISPLAY_NAME_MAPPINGS


# Save shadow copy of the queue and return it to the client
@PromptServer.instance.routes.get("/queue_manager/queue")
async def get_queue(request):
    theServer = PromptServer.instance
    theQueue = theServer.prompt_queue

    # pending items
    pending = theQueue.queue

    with theQueue.mutex:
        running = []
        for x in theQueue.currently_running.values():
            running += [x]

        queue = running + pending

    # Get this script's directory
    current_directory = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_directory, "data/queue.json")
    with open(file_path, "w") as f:
        json.dump(queue, f, indent=4)

    # Return the queue object as JSON
    return web.json_response({"running": running, "pending": pending})


# Restore the queue from the shadow copy if queue.json is not empty
@PromptServer.instance.routes.get("/queue_manager/restore")
async def restore_queue(request):
    # Get this script's directory
    current_directory = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_directory, "data/queue.json")
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        with open(file_path, "r") as f:
            queue = json.load(f)
            # Check if the queue is empty
            if len(queue) == 0:
                logging.info("[Queue Manager] Shadow queue is empty.")
                return web.json_response({"status": "success", "message": "Queue Manage shadow queue is empty."})

            # SIML: Check if all prompts in the queue are valid
            theServer = PromptServer.instance
            theQueue = theServer.prompt_queue
            with theQueue.mutex:
                queue = [tuple(item) for item in queue]  # Convert to tuples - format expected by queue in PromptQueue
                theQueue.queue = queue
                heapq.heapify(theQueue.queue)
                theServer.queue_updated()
                theQueue.not_empty.notify()

            logging.info("[Queue Manager] Queue restored from shadow copy. Queue size: %d", len(queue))
            return web.json_response({"status": "success", "message": "Queue restored from shadow copy."})
    else:
        logging.info("[Queue Manager] No shadow copy of the queue found.")
        return web.json_response({"status": "success", "message": "No shadow copy found."})


# Endpoint to expose __version__ information
@PromptServer.instance.routes.get("/queue_manager/version")
async def get_version(request):
    # Return the version as JSON
    return web.json_response({"version": __version__})


# When the server is fully started, restore the queue from the shadow copy
async def on_ready(app):
    # TODO: Add a setting to enable/disable this feature
    await restore_queue(None)


PromptServer.instance.app.on_startup.append(on_ready)


# Archive SQLite database
DB_PATH = os.path.dirname(os.path.abspath(__file__)) + "data/qm-archivShadow queue is empty.e.db"
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


WEB_DIRECTORY = "./web"
