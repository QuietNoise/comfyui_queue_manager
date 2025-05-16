# Add custom API routes, using router
from aiohttp import web
from typing import Optional

from execution import PromptQueue
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
    # pending items
    queue = PromptServer.instance.prompt_queue.get_current_queue(0, 100)

    # Return the queue object as JSON
    return web.json_response({"running": queue[0], "pending": queue[1]})


# If there are any items in the queue with status 1 (running), restore them to status 0 (pending) with highest priority
# TODO: Add a setting to enable/disable this feature
def restore_queue():
    # Get running items from the database
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT prompt_id, number, name, workflow_id, prompt
        FROM queue
        WHERE status = 1
        ORDER BY number
    """)
    rows = cursor.fetchall()
    if len(rows) > 0:
        logging.info("Restoring unfinished jobs: %d item(s)", len(rows))
        # Get current highest priority (lowest number for pending task) in the database
        cursor.execute("""
            SELECT number
            FROM queue
            WHERE status = 0
            ORDER BY number
            LIMIT 1
        """)
        lowest = cursor.fetchone()

        if lowest:
            min_number = lowest[0] - 1
        else:
            min_number = 0

        # Set the priority of the running items to the current highest priority
        for row in rows:
            cursor.execute(
                """
                UPDATE queue
                SET status = 0, number = ?
                WHERE prompt_id = ?
            """,
                (
                    min_number,
                    row[0],
                ),
            )
            min_number -= 1
        conn.commit()

        # Start queue processing
        # TODO: Add a setting to enable/disable auto-start
        PromptServer.instance.prompt_queue.get(1000)


# WIP - import queue from uploaded json file
def import_queue(request):
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
    restore_queue()


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
                ORDER BY number
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
        logging.info("[Queue Manager] Executing workflow: %s at %s", queue_item[0][1], queue_item[0][0])
        return queue_item  # (item, task_counter)
    else:
        # No item in the queue
        return None


PromptServer.instance.prompt_queue.get = types.MethodType(hijack_queue_get, PromptServer.instance.prompt_queue)


# Hijack PromptQueue.put() to get the queue newly added pending item
# Add the item to the database
oldqueue_put = PromptServer.instance.prompt_queue.put


def hijack_queue_put(self, item):
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

    # logging.info("[Queue Manager] Workflow queued: %s at %s", item[1], item[0])

    # Is there's no pending item in the native heap then we add item with highest priority (could be this one)
    if len(self.queue) == 0:
        # get item from database which has highest priority and higher than this
        cursor.execute(
            """
            SELECT number, prompt
            FROM queue
            WHERE status = 0 AND number <= ?
            ORDER BY number
            LIMIT 1
        """,
            (item[0],),
        )
        item = cursor.fetchone()
        if item is not None:
            # Convert the item to a tuple
            item = tuple(json.loads(item[1]))
            oldqueue_put(item)

    # NOTE: We keep only up to one item in native "pending" queue (to avoid bottleneck for large queues).


PromptServer.instance.prompt_queue.put = types.MethodType(hijack_queue_put, PromptServer.instance.prompt_queue)


# Hijack PromptQueue.get_current_queue() to get first page of the current queue
# NOTE: This hijack will make native queue API endpoint to return only one pending item so at least it shows the
# running item and that items are pending. We do this to avoid bottleneck in the native queue when it goes massive
# and to avoid duplicate bandwidth for requesting queue by execution store and queue manager.
oldqueue_get_current_queue = PromptServer.instance.prompt_queue.get_current_queue


def hijack_queue_get_current_queue(self, page=0, page_size=1):
    # logging.info('get_current_queue: %d, %d', page, page_size)
    # Get the first page of the current queue
    conn = get_conn()
    cursor = conn.cursor()

    with self.mutex:
        # Get the first page of the current queue from the database (pending only)
        cursor.execute(
            """
            SELECT prompt
            FROM queue
            WHERE status = 0
            ORDER BY number
            LIMIT ?, ?
        """,
            (page * page_size, page_size),
        )
        rows = cursor.fetchall()

        # Split running and pending jobs ito tuple of running and pending tuples
        running = []
        for x in self.currently_running.values():
            running += [x]

        # array of prompts
        pending = [json.loads(row[0]) for row in rows]

    return running, pending


PromptServer.instance.prompt_queue.get_current_queue = types.MethodType(hijack_queue_get_current_queue, PromptServer.instance.prompt_queue)


# Hijack PromptQueue.get_tasks_remaining() to get true number of tasks remaining
oldqueue_get_tasks_remaining = PromptServer.instance.prompt_queue.get_tasks_remaining


def hijack_queue_get_tasks_remaining(self):
    # Get the number of tasks remaining in the database
    conn = get_conn()
    cursor = conn.cursor()

    with self.mutex:
        # Get the number of tasks remaining in the database (pending only)
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM queue
            WHERE status = 0
        """
        )
        rows = cursor.fetchone()
        pending_count = rows[0]

    # Get the number of tasks remaining in the native queue
    native_count = len(self.currently_running)

    return pending_count + native_count


PromptServer.instance.prompt_queue.get_tasks_remaining = types.MethodType(
    hijack_queue_get_tasks_remaining, PromptServer.instance.prompt_queue
)


# Hijack PromptQueue.task_done() to mark the task as finished in the database
oldqueue_task_done = PromptServer.instance.prompt_queue.task_done


def hijack_queue_task_done(self, item_id, history_result, status: Optional["PromptQueue.ExecutionStatus"]):
    # Mark the task as finished in the database
    conn = get_conn()
    cursor = conn.cursor()

    with self.mutex:
        # Get the running item from the native queue dictionary
        item = self.currently_running.get(item_id, None)
        if item is not None:
            # Mark the item as finished in the database
            cursor.execute(
                """
                UPDATE queue
                SET status = 2
                WHERE prompt_id = ?
            """,
                (item[1],),
            )
            conn.commit()
            # logging.info("[Queue Manager] Workflow finished: %s at %s", item[1], item[0])

            # Call the original task_done method
            oldqueue_task_done(item_id, history_result, status)


PromptServer.instance.prompt_queue.task_done = types.MethodType(hijack_queue_task_done, PromptServer.instance.prompt_queue)


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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id  VARCHAR(255) NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            number     INTEGER,
            name       TEXT,
            workflow_id   VARCHAR(255),
            prompt    TEXT,
            status     INTEGER DEFAULT 0 -- 0: pending, 1: running, 2: finished, -1: error
        );

        CREATE TABLE IF NOT EXISTS options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT
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
