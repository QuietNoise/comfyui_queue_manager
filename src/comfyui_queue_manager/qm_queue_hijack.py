from typing import Optional
from execution import PromptQueue
from server import PromptServer
import logging
import json
import heapq

from .qm_db import get_conn

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


class QM_Queue_Hijack:
    def __init__(self, queue_manager):
        self.queue_manager = queue_manager
        self.native_queue = PromptServer.instance.prompt_queue

        # Hijack PromptQueue.get() to get the item marked for execution and mark the item as running in the database
        self.original_get = self.native_queue.get
        self.native_queue.get = self.queue_get

        # Hijack PromptQueue.put() to get the queue newly added pending item; add the item to the database
        self.original_put = self.native_queue.put
        self.native_queue.put = self.queue_put

        # Hijack PromptQueue.get_current_queue() to get first page of the current queue
        self.original_get_current_queue = self.native_queue.get_current_queue
        self.native_queue.get_current_queue = self.queue_get_current_queue

        # Hijack PromptQueue.get_tasks_remaining() to get true number of tasks remaining
        self.original_get_tasks_remaining = self.native_queue.get_tasks_remaining
        self.native_queue.get_tasks_remaining = self.queue_get_tasks_remaining

        # Hijack PromptQueue.task_done() to mark the task as finished in the database
        self.original_task_done = self.native_queue.task_done
        self.native_queue.task_done = self.queue_task_done

    # NOTE: This hijack will make native queue API endpoint to return only one pending item so at least it shows the
    # running item and that items are pending. We do this to avoid bottleneck in the native queue when it goes massive
    # and to avoid duplicate bandwidth for requesting queue by execution store and queue manager.
    def queue_get_current_queue(self, page=0, page_size=1):
        # logging.info('get_current_queue: %d, %d', page, page_size)
        # Get the first page of the current queue

        with self.native_queue.mutex:
            conn = get_conn()
            cursor = conn.cursor()
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
            for x in self.native_queue.currently_running.values():
                running += [x]

            # array of prompts
            pending = [json.loads(row[0]) for row in rows]

            return running, pending

    def queue_get_tasks_remaining(self):
        with self.native_queue.mutex:
            # Get the number of tasks remaining in the database
            conn = get_conn()
            cursor = conn.cursor()
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
            native_count = len(self.native_queue.currently_running)

            return pending_count + native_count

    def queue_task_done(self, item_id, history_result, status: Optional["PromptQueue.ExecutionStatus"]):
        with self.native_queue.mutex:
            # Mark the task as finished in the database
            conn = get_conn()
            cursor = conn.cursor()

            # Get the running item from the native queue dictionary
            item = self.native_queue.currently_running.get(item_id, None)
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
                self.original_task_done(item_id, history_result, status)

    # NOTE: We keep only up to one item in native "pending" queue (to avoid bottleneck for large queues).
    def queue_put(self, item):
        with self.native_queue.mutex:
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
            if len(self.native_queue.queue) == 0:
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
                    self.original_put(item)

    def queue_get(self, timeout=None):
        with self.native_queue.mutex:
            conn = get_conn()
            cursor = conn.cursor()

            # if no pending item in the native queue then we get the one from the database
            if len(self.native_queue.queue) == 0:
                # if we are on the first iteration and there's no item running then check if there is anything that need to be restored
                if self.native_queue.task_counter == 0 and len(self.native_queue.currently_running) == 0:
                    self.queue_manager.restore_queue(True)

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
                    heapq.heappush(self.native_queue.queue, item)

            queue_item = self.original_get(
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
