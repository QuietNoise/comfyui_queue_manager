# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging
import json
import os
import heapq
import sqlite3, threading

# import traceback
import types

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


# ===================================================================
# ================ Hijack Native Queue ==============================
# ===================================================================
#
# While we hijack most crucial methods of the native queue, we retain
# most of the original mechanisms, events and processes to avoid a
# as many compatibility issues as possible.
#
# ===================================================================
# ===================================================================


# Hijack PromptQueue.get() to get the item marked for execution
# and mark the item as running in the database
oldqueue_get = PromptServer.instance.prompt_queue.get


def hijack_queue_get(self, timeout=None):
    conn = get_conn()
    cursor = conn.cursor()

    with self.mutex:
        # if no pending item in the native queue then we get the one from the database
        if len(self.queue) == 0:
            # Get the item with highest priority from the queue in database
            cursor.execute("""
                SELECT number, prompt
                FROM queue
                WHERE status = 0
                ORDER BY number ASC
                LIMIT 1
            """)
            item = cursor.fetchone()
            if item is not None:
                # Convert the item to a tuple
                item = tuple(json.loads(item[1]))  # Convert the json's list to a tuple
                heapq.heappush(PromptServer.instance.prompt_queue.queue, item)

    queue_item = oldqueue_get(
        timeout
    )  # Wait for an item to be available in the queue (either one from the database (above) or wait for put())
    if queue_item is not None:
        # Mark the item as running in the database
        cursor.execute(
            """
            UPDATE queue
            SET status = 1
            WHERE prompt_id = ?
        """,
            (queue_item[0][1],),
        )
        conn.commit()
        logging.info("[Queue Manager] Workflow running: %s at %s", queue_item[0][1], queue_item[0][0])
        return queue_item  # (item, task_counter)
    else:
        # No item in the queue
        return None


PromptServer.instance.prompt_queue.get = types.MethodType(hijack_queue_get, PromptServer.instance.prompt_queue)


# Hijack PromptQueue.put() to get the queue newly added pending item
# Add the item to the database
oldqueue_put = PromptServer.instance.prompt_queue.put


def hijack_queue_put(self, item):
    print("================ PUT ================")
    # traceback.print_stack()

    # Add the item to the database
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO queue (prompt_id, number, name, workflow_id, prompt)
        VALUES (?, ?, ?, ?, ?)
    """,
        (
            item[1],
            item[0],
            item[3]["extra_pnginfo"]["workflow"]["workflow_name"],
            item[3]["extra_pnginfo"]["workflow"]["id"],
            json.dumps(item),
        ),
    )
    conn.commit()

    logging.info("[Queue Manager] Workflow queued: %s at %s", item[1], item[0])

    # Is there's no pending item in the native heap the we add this one
    if len(self.queue) == 0 and self.queue[0][0] < item[0]:
        # If no pending items we add this one so it can be pulled for execution straight away
        oldqueue_put(item)

    # NOTE: We keep only up to one item in native "pending" queue (to avoid bottleneck for large queues).

    # else:
    #     # If there is already pending item we just lost race with another thread perhaps.
    #     # Just notify the front end and unlock if needed
    #     with self.mutex:
    #         self.server.queue_updated()
    #         self.not_empty.notify()


PromptServer.instance.prompt_queue.put = types.MethodType(hijack_queue_put, PromptServer.instance.prompt_queue)


# Archive SQLite database
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "qm-queue.db")
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_schema():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS queue (
            prompt_id  VARCHAR(255) PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            number     INTEGER,
            name       TEXT,
            workflow_id   VARCHAR(255),
            prompt    TEXT,
            status     INTEGER DEFAULT 0 -- 0: pending, 1: running, 2: finished, -1: error
        );

        -- Create a trigger to update the updated_at column
        CREATE TRIGGER IF NOT EXISTS queue_set_updated_at
        AFTER UPDATE ON queue
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at         -- only if caller didn't change it
        BEGIN
          UPDATE queue
          SET    updated_at = CURRENT_TIMESTAMP
          WHERE  rowid = NEW.rowid;
        END;
    """)


init_schema()

WEB_DIRECTORY = "./web"
