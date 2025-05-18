# Add custom API routes, using router
from aiohttp import web

from server import PromptServer
import logging
import json
import os
import heapq

# import traceback

from .qm_queue import QM_Queue
from .qm_server import QM_Server
from .qm_db import init_schema, get_conn


class QueueManager:
    def __init__(self, __version__):
        init_schema()

        self.server = QM_Server(self, __version__)
        self.queue = QM_Queue(self)
        self.queueRestored = False
        return

    # If there are any items in the queue with status 1 (running), restore them to status 0 (pending) with highest priority
    # TODO: Add a setting to enable/disable this feature
    def restore_queue(self, calledByQueue_get=False):
        with PromptServer.instance.prompt_queue.mutex:
            if self.queueRestored:
                return
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
                    conn.commit()
                    min_number -= 1

            # Get task counter (highest task number) from the database
            cursor.execute("""
                SELECT number
                FROM queue
                WHERE status = 1 OR status = 0 -- pending or running
                ORDER BY number DESC
                LIMIT 1
            """)
            rows = cursor.fetchone()
            if rows:
                task_counter = rows[0] + 1
            else:
                task_counter = 1

            # Set the task counter in the queue
            PromptServer.instance.prompt_queue.task_counter = task_counter
            # Set the number in server
            PromptServer.instance.number = task_counter

            # Start queue processing
            # TODO: Add a setting to enable/disable auto-start
            if not calledByQueue_get:  # prevent circular call
                PromptServer.instance.prompt_queue.get(1000)

            self.queueRestored = True  # we restore the queue only once per server start

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
