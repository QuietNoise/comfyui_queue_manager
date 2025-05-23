# Add custom API routes, using router

from server import PromptServer
import logging
import json

# import traceback

from .qm_queue import QM_Queue
from .qm_server import QM_Server
from .qm_db import init_schema, get_conn


class QueueManager:
    def __init__(self, __version__):
        init_schema()

        self.queue = QM_Queue(self)
        self.server = QM_Server(self, __version__)
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
    def import_queue(self, items, client_id=None, status=0):
        theServer = PromptServer.instance
        theQueue = theServer.prompt_queue
        with theQueue.mutex:
            # Add items to the queue in database
            conn = get_conn()
            cursor = conn.cursor()

            before = conn.total_changes
            query_params = []

            for item in items:
                # TODO: Check if the item is a list, has the correct length, and contains valid data format
                # SIML: Check if all prompts in the queue are valid

                if client_id is not None:
                    item[3]["client_id"] = client_id

                PromptServer.instance.number += 1
                query_params.append(
                    (
                        item[1],
                        PromptServer.instance.number,
                        item[3]["extra_pnginfo"]["workflow"]["workflow_name"],
                        item[3]["extra_pnginfo"]["workflow"]["id"],
                        json.dumps(item),
                        status,
                    )
                )

            cursor.executemany(
                """
                    INSERT OR IGNORE INTO queue (prompt_id, number, name, workflow_id, prompt, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                query_params,
            )
            conn.commit()
            total = conn.total_changes - before

            if total > 0:
                theQueue.not_empty.notify()
                theServer.queue_updated()

            return total, len(items)
