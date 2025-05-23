import threading
from typing import Optional
from execution import PromptQueue
from server import PromptServer
import logging
import json
import heapq

from .qm_db import get_conn


class QM_Queue:
    def __init__(self, queue_manager):
        self.paused = False  # TODO: restore state from DB
        self.queue_manager = queue_manager

        # ===================================================================
        # ================ Hijack Native Queue ==============================
        # ===================================================================
        #
        # While we hijack most crucial methods of the native queue, we retain
        # most of the original mechanisms, events and processes to avoid
        # as many compatibility issues as possible.
        #
        # ===================================================================
        # ===================================================================
        self.native_queue = PromptServer.instance.prompt_queue
        self.pause_lock = threading.Condition(self.native_queue.mutex)

        # Hijack PromptQueue.get() to get the item marked for execution and mark the item as running in the database
        self.original_get = self.native_queue.get
        self.native_queue.get = self.queue_get

        # Hijack PromptQueue.put() to get the queue newly added pending item; add the item to the database
        self.original_put = self.native_queue.put
        self.native_queue.put = self.queue_put

        # Hijack PromptQueue.get_current_queue() to get first page of the current queue
        self.original_get_current_queue = self.native_queue.get_current_queue
        self.native_queue.get_current_queue = self.get_current_queue

        # Hijack PromptQueue.get_tasks_remaining() to get true number of tasks remaining
        self.original_get_tasks_remaining = self.native_queue.get_tasks_remaining
        self.native_queue.get_tasks_remaining = self.get_tasks_remaining

        # Hijack PromptQueue.task_done() to mark the task as finished in the database
        self.original_task_done = self.native_queue.task_done
        self.native_queue.task_done = self.task_done

    # NOTE: This hijack will make native queue API endpoint to not return pending items.
    # We do this to avoid bottleneck in the native queue when it goes massive
    # and to avoid duplicate bandwidth for requesting queue by execution store and queue manager.
    def get_current_queue(self, page=0, page_size=0):
        # logging.info('get_current_queue: %d, %d', page, page_size)
        # Get the first page of the current queue

        with self.native_queue.mutex:
            # Split running and pending jobs into tuple of running and pending tuples
            running = []
            for x in self.native_queue.currently_running.values():
                running += [x]

            if page_size > 0:
                conn = get_conn()
                cursor = conn.cursor()
                # Get the first page of the current queue from the database (pending only)
                cursor.execute(
                    """
                    SELECT id, prompt, number
                    FROM queue
                    WHERE status = 0
                    ORDER BY number
                    LIMIT ?, ?
                """,
                    (page * page_size, page_size),
                )
                rows = cursor.fetchall()
                # array of prompts
                pending = []
                for row in rows:
                    item = json.loads(row[1])
                    # Add db_id to the item
                    item[3]["db_id"] = row[0]
                    item[0] = row[2]  # set the number to the one from the database

                    # Convert the item to a tuple
                    item = tuple(item)
                    # Add the item to the pending list
                    pending.append(item)
            elif page_size == 0:
                pending = []

            return running, pending

    def get_full_queue(self, archive=False):
        conn = get_conn()
        cursor = conn.cursor()

        if archive:
            # Get the archived items from the database
            cursor.execute(
                """
                SELECT id, prompt
                FROM queue
                WHERE status = 3
                ORDER BY created_at DESC
            """
            )
        else:
            # Get the pending / running items from the database
            cursor.execute(
                """
                SELECT id, prompt
                FROM queue
                WHERE status = 0 OR status = 1
                ORDER BY created_at DESC
            """
            )

        rows = cursor.fetchall()

        # array of prompts
        prompts = []
        for row in rows:
            item = json.loads(row[1])
            # Convert the item to a tuple
            # item = tuple(item)
            # Add the item to the pending list
            prompts.append(item)
        return prompts

    def get_tasks_remaining(self):
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

    def task_done(self, item_id, history_result, status: Optional["PromptQueue.ExecutionStatus"]):
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
    def queue_put(self, item):  # comfy server calls this method
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

            # Is there's no pending item in the native heap nd we are not paused then add item with highest priority (could be this one)
            if len(self.native_queue.queue) == 0 and not self.paused:
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
            else:  # just notify frontend that we have a new item
                PromptServer.instance.queue_updated()

    def queue_get(self, timeout=None):
        with self.pause_lock:
            while self.paused:
                self.pause_lock.wait(timeout=timeout)
                if timeout is not None and self.paused:  # if timed out and we are still paused
                    return None  # give up

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

    # ===========================================================
    # ================== NON-HIJACK METHODS =====================
    # ===========================================================

    def toggle_playback(self):
        with self.pause_lock:
            # Toggle the playback of the queue
            self.paused = not self.paused
            logging.info("[Queue Manager] Queue " + ("paused." if self.paused else "play."))
            PromptServer.instance.send_sync(
                "queue-manager-toggle-queue",
                {
                    "paused": self.paused,
                },
            )

            # unlock the pause lock if we are playing
            if not self.paused:
                self.pause_lock.notify()
            else:
                # remove the pending item from the native queue if we are paused
                self.native_queue.queue = []
                PromptServer.instance.queue_updated()
                # native queue might also be locked waiting for an item to be available
                # we need to notify it to wake up so it can move on, and so we can reach the pause lock
                # and avoid executing a new item while we are paused
                self.native_queue.not_empty.notify()

    def delete_items(self, items):
        """
        Delete items from the database
        """

        logging.info("[Queue Manager] Deleting items from queue: %s", items)
        with self.native_queue.mutex:
            # Delete the item from the database
            conn = get_conn()
            cursor = conn.cursor()

            deleted = 0
            for item in items:
                cursor.execute(
                    """
                    DELETE FROM queue
                    WHERE prompt_id = ?
                """,
                    (item,),
                )
                deleted += cursor.rowcount

            conn.commit()

            if deleted > 0:
                PromptServer.instance.queue_updated()

    def wipe_queue(self):
        with self.native_queue.mutex:
            # Wipe the queue from the database
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM queue
                WHERE status = 0
            """
            )
            conn.commit()

    # Set status of pending and running items to 3 (archived)
    def archive_queue(self):
        with self.native_queue.mutex:
            # Archive the queue from the database
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE queue
                SET status = 3
                WHERE status = 0
            """
            )
            conn.commit()
            total = cursor.rowcount

            # If affected any rows notify the frontend that the queue and archive have been archived
            if total > 0:
                logging.info("[Queue Manager] Queue Archived: %d item(s)", total)
                PromptServer.instance.queue_updated()
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": total})
            else:
                logging.info("[Queue Manager] No items to archive")

            return total

    def get_archived_items(self):
        with self.native_queue.mutex:
            # Get the archived items from the database
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, prompt
                FROM queue
                WHERE status = 3
                ORDER BY created_at DESC
            """
            )
            rows = cursor.fetchall()

            # Convert the items to a list of tuples
            archive = []
            for row in rows:
                item = tuple(json.loads(row[1]))
                item[3]["db_id"] = row[0]
                archive.append(item)

            return archive

    def archive_items(self, items):
        """
        Archive items from the database
        """
        with self.native_queue.mutex:
            # Archive the item from the database
            conn = get_conn()
            cursor = conn.cursor()

            archived = 0
            for item in items:
                cursor.execute(
                    """
                    UPDATE queue
                    SET status = 3
                    WHERE id = ?
                """,
                    (item,),
                )
                archived += cursor.rowcount

            conn.commit()

            if archived > 0:
                logging.info("[Queue Manager] Queue Item Archived: %d item(s)", archived)
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": archived})

            return archived

    def delete_running(self):
        with self.native_queue.mutex:
            # Interrupt the queue
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM queue
                WHERE status = 1
            """
            )
            conn.commit()

            return cursor.rowcount

    def play_items(self, items, front, client_id=None):
        """
        Play items from the archive
        """
        with self.native_queue.mutex:
            # Play the item from the database
            conn = get_conn()
            cursor = conn.cursor()

            PromptServer.instance.number += 1

            moved = 0
            for db_id in items:
                logging.info(
                    "[Queue Manager] Playing item: %s, priority: %d, front: %s",
                    db_id,
                    PromptServer.instance.number * (-1 if front else 1),
                    front,
                )

                # Get the item and update the client id in prompt json
                cursor.execute(
                    """
                    SELECT prompt
                    FROM queue
                    WHERE id = ?
                """,
                    (db_id,),
                )
                row = cursor.fetchone()
                if row is None:
                    continue

                prompt = json.loads(row[0])
                prompt[3]["client_id"] = client_id

                cursor.execute(
                    """
                    UPDATE queue
                    SET status = 0, number = ?, prompt = ?
                    WHERE id = ?
                """,
                    # Ensure correct priority
                    (
                        PromptServer.instance.number * (-1 if front else 1),
                        json.dumps(prompt),
                        db_id,
                    ),
                )
                moved += cursor.rowcount

            conn.commit()

            if moved > 0:
                # if moved to the front then remove the pending item from the native queue so next iteration will get the one
                # with highest priority in the database
                if front:
                    self.native_queue.queue = []

                # Notify native queue lock so if it's waiting it can move on and go for next iteration
                PromptServer.instance.prompt_queue.not_empty.notify()

                logging.info("[Queue Manager] %d item(s) scheduled for generation.", moved)
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": moved})

            return moved

    def delete_archive(self):
        with self.native_queue.mutex:
            # Delete the archive from the database
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM queue
                WHERE status = 3
            """
            )
            conn.commit()

            PromptServer.instance.send_sync("queue-manager-archive-updated", {"deleted": cursor.rowcount})

            return cursor.rowcount

    # Import queue from uploaded json file
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
                if status == 0:
                    theServer.queue_updated()
                if status == 3:
                    PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_imported": total})

            return total, len(items)
