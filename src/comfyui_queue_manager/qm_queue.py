import threading
from typing import Optional

from execution import PromptQueue
from server import PromptServer
import logging
import json
import heapq

from .qm_db import get_conn, read_query, read_single, write_query, write_many


class QM_Queue:
    def __init__(self, queue_manager):
        self.queue_manager = queue_manager
        self.restored = False

        self.paused = queue_manager.options.get("queue_paused", False)
        logging.info("[Queue Manager] Queue status: %s", "not paused" if not self.paused else "paused")

        client_id, timestamp = queue_manager.options.get("takeover_client", False, True)
        if client_id:
            self.takeover_client = {"client_id": client_id, "timestamp": timestamp}
        else:
            self.takeover_client = None

        if self.paused:
            self.restore_queue(True)

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
    def get_current_queue(self, page=0, page_size=0, route="queue", filters=None):
        # logging.info('get_current_queue: %d, %d', page, page_size)
        # Get the first page of the current queue

        with self.native_queue.mutex:
            # Split running and pending jobs into tuple of running and pending tuples
            running = []
            pending = []
            total_rows = 0
            last_page = 0
            status = 0

            match route:
                case "queue":
                    for x in self.native_queue.currently_running.values():
                        running += [x]
                case "archive":
                    status = 3  # archived items

            where_clauses = ["status = ?"]
            params = [status]

            where_string, params = self.get_filters(filters, where_clauses, params)

            if page_size > 0:
                total_rows = read_single(f"""SELECT COUNT(*) FROM queue WHERE {where_string}""", params)[0]

            if total_rows > 0:
                last_page = (total_rows - 1) // (0 if page_size == 0 else page_size)

                # If requesting page that doesn't exist then return next adjacent one
                if page > last_page:
                    page = last_page
                if page < 0:
                    page = 0

                params += (page * page_size, page_size)

                rows = read_query(
                    f"""
                    SELECT id, prompt, number
                    FROM queue
                    WHERE {where_string}
                    ORDER BY number
                    LIMIT ?, ?
                """,
                    params,
                )

                # array of prompts
                for row in rows:
                    item = json.loads(row[1])
                    # Add db_id to the item
                    item[3]["db_id"] = row[0]

                    if route == "queue":
                        item[0] = row[2]  # set the number to the one from the database

                    pending.append(tuple(item))

            return (
                running,
                pending,
                {
                    "total": total_rows,
                    "page": page,
                    "page_size": page_size,
                    "last_page": last_page,
                },
            )

    def get_full_queue(self, archive=False, filters=None):
        with self.native_queue.mutex:
            where_string, params = self.get_filters(filters, ["status = 0 OR status = 1" if not archive else "status = 3"])

            rows = read_query(
                f"""
                SELECT id, prompt
                FROM queue
                WHERE {where_string}
                ORDER BY created_at DESC
            """,
                params,
            )

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

            return read_single("""
                SELECT COUNT(*)
                FROM queue
                WHERE status = 0 OR status = 1
            """)[0]  # total

    def task_done(self, item_id, history_result, status: Optional["PromptQueue.ExecutionStatus"]):
        with self.native_queue.mutex:
            # Mark the task as finished in the database

            # Get the running item from the native queue dictionary
            item = self.native_queue.currently_running.get(item_id, None)
            if item is not None:
                # Mark the item as finished in the database
                write_query(
                    """
                    UPDATE queue
                    SET status = 2
                    WHERE prompt_id = ?
                """,
                    (item[1],),
                )
                # logging.info("[Queue Manager] Workflow finished: %s at %s", item[1], item[0])

                # Call the original task_done method
                self.original_task_done(item_id, history_result, status)

    # NOTE: We keep only up to one item in native "pending" queue (to avoid bottleneck for large queues).
    def queue_put(self, item):  # comfy server calls this method
        with self.native_queue.mutex:
            # Add the item to the database
            write_query(
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

            # logging.info("[Queue Manager] Workflow queued: %s at %s", item[1], item[0])

            # Is there's no pending item in the native heap nd we are not paused then add item with highest priority (could be this one)
            if len(self.native_queue.queue) == 0 and not self.paused:
                # get item from database which has highest priority and higher than this
                item = read_single(
                    """
                    SELECT number, prompt
                    FROM queue
                    WHERE status = 0 AND number <= ?
                    ORDER BY number
                    LIMIT 1
                """,
                    (item[0],),
                )

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

            # if no pending item in the native queue then we get the one from the database
            if len(self.native_queue.queue) == 0:
                # if we are on the first iteration and there's no item running then check if there is anything that need to be restored
                if self.native_queue.task_counter == 0 and len(self.native_queue.currently_running) == 0:
                    self.restore_queue(True)

                # Get the item with highest priority from the queue in database
                item_db = read_single("""
                    SELECT number, prompt, updated_at
                    FROM queue
                    WHERE status = 0
                    ORDER BY number
                    LIMIT 1
                """)

                if item_db is not None:
                    item = json.loads(item_db[1])

                    # SIML: TODO: Perhaps use different column to check timestamp? i.e. queued_at since item might be updated for other reasons?
                    # If we have takeover client then we need to set the client_id in the prompt
                    if self.takeover_client and self.takeover_client["timestamp"] > item_db[2]:
                        item[3]["client_id"] = self.takeover_client["client_id"]

                    # Native format is a tuple
                    item = tuple(item)

                    heapq.heappush(self.native_queue.queue, item)

            queue_item = self.original_get(
                timeout
            )  # Wait for an item to be available in the queue (either one from the database (above) or wait for put())

            if queue_item is not None:
                # Mark the item as running in the database
                write_query(
                    """
                    UPDATE queue
                    SET status = 1
                    WHERE prompt_id = ?
                """,
                    (queue_item[0][1],),
                )
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

            # Save option in the database
            self.queue_manager.options.set("queue_paused", self.paused)

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
        with self.native_queue.mutex:
            logging.info("[Queue Manager] Deleting items from queue: %s", items)
            # Delete the item from the database

            deleted = 0
            for item in items:
                deleted += write_query(
                    """
                    DELETE FROM queue
                    WHERE prompt_id = ?
                """,
                    (item,),
                    False,
                )

            get_conn().commit()

            if deleted > 0:
                PromptServer.instance.queue_updated()
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"deleted": deleted})

    def wipe_queue(self):
        with self.native_queue.mutex:
            # Wipe the queue from the database
            write_query("""
                DELETE FROM queue
                WHERE status = 0
            """)

    # Set status of pending and running items to 3 (archived)
    def archive_queue(self, filters=None):
        with self.native_queue.mutex:
            where_string, params = self.get_filters(filters, ["status = 0"])

            # Archive the queue from the database
            total = write_query(
                f"""
                UPDATE queue
                SET status = 3
                WHERE {where_string}
            """,
                params,
            )

            # remove the items from the native queue and heapify queue
            self.native_queue.queue = []
            heapq.heapify(self.native_queue.queue)

            # If affected any rows notify the frontend that the queue and archive have been archived
            if total > 0:
                logging.info("[Queue Manager] Queue Archived: %d item(s)", total)
                PromptServer.instance.queue_updated()
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": total})
            else:
                logging.info("[Queue Manager] No items to archive")

            return total

    def archive_items(self, items):
        """
        Archive items from the database
        """
        with self.native_queue.mutex:
            # Archive the item from the database

            archived = 0
            for item in items:
                archived += write_query(
                    """
                    UPDATE queue
                    SET status = 3
                    WHERE id = ?
                """,
                    (item,),
                    False,
                )

            get_conn().commit()

            if archived > 0:
                logging.info("[Queue Manager] Queue Item Archived: %d item(s)", archived)
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": archived})

            return archived

    def delete_running(self):
        with self.native_queue.mutex:
            # Interrupt the queue
            return write_query("""
                DELETE FROM queue
                WHERE status = 1
            """)

    def play_items(self, items, front, client_id=None):
        """
        Play items from the archive
        """
        with self.native_queue.mutex:
            # Play the item from the database

            moved = 0
            for db_id in items:
                PromptServer.instance.number += 1

                logging.info(
                    "[Queue Manager] Playing item: %s, priority: %d, front: %s",
                    db_id,
                    PromptServer.instance.number * (-1 if front else 1),
                    front,
                )

                # Get the item and update the client id in prompt json
                row = read_single(
                    """
                    SELECT prompt
                    FROM queue
                    WHERE id = ?
                """,
                    (db_id,),
                )
                if row is None:
                    continue

                prompt = json.loads(row[0])
                prompt[3]["client_id"] = client_id

                moved += write_query(
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
                    False,
                )

            get_conn().commit()

            if moved > 0:
                # if moved to the front then remove the pending item from the native queue so next iteration will get the one
                # with highest priority in the database
                if front:
                    self.native_queue.queue = []

                # Notify native queue lock so if it's waiting it can move on and go for next iteration
                PromptServer.instance.prompt_queue.not_empty.notify()

                logging.info("[Queue Manager] %d item(s) scheduled for generation.", moved)
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": moved})
                PromptServer.instance.queue_updated()

            return moved

    # Change status to 0 for all items with status 3, update the client_id and set correct priority for each item
    def play_archive(self, client_id=None, filters=None):
        with self.native_queue.mutex:
            # Play the item from the database
            where_string, params = self.get_filters(filters, ["status = 3"])

            # Get the archived items from the database
            rows = read_query(
                f"""
                SELECT id, prompt
                FROM queue
                WHERE {where_string}
                ORDER BY created_at DESC
            """,
                params,
            )

            # Convert the items to a list of tuples
            parameters = []
            for row in rows:
                PromptServer.instance.number += 1

                item = json.loads(row[1])
                item[3]["client_id"] = client_id
                item[0] = PromptServer.instance.number
                parameters.append(
                    (
                        PromptServer.instance.number,
                        json.dumps(item),
                        row[0],
                    )
                )

            # Update the items in the database
            moved = write_many(
                """
                UPDATE queue
                SET status = 0, number = ?, prompt = ?
                WHERE id = ?
            """,
                parameters,
            )

            if moved > 0:
                # Notify native queue lock so if it's waiting it can move on and go for next iteration
                PromptServer.instance.prompt_queue.not_empty.notify()

                logging.info("[Queue Manager] %d item(s) scheduled for generation.", moved)
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_moved": moved})
                PromptServer.instance.queue_updated()
            return moved

    def delete_from_queue(self, route="queue", filters=None):
        with self.native_queue.mutex:
            where_string, params = self.get_filters(filters, ["status = 3" if route == "archive" else "status = 0"])
            # Delete the archive from the database
            deleted = write_query(
                f"""
                DELETE FROM queue
                WHERE {where_string}
            """,
                params,
            )

            if route == "archive":
                PromptServer.instance.send_sync("queue-manager-archive-updated", {"deleted": deleted})
            else:
                PromptServer.instance.queue_updated()

            return deleted

    # Import queue from uploaded json file
    def import_queue(self, items, client_id=None, status=0):
        theServer = PromptServer.instance
        theQueue = theServer.prompt_queue
        with theQueue.mutex:
            # Add items to the queue in database

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

            total = write_many(
                """
                    INSERT OR IGNORE INTO queue (prompt_id, number, name, workflow_id, prompt, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                query_params,
            )

            if total > 0:
                theQueue.not_empty.notify()
                if status == 0:
                    theServer.queue_updated()
                if status == 3:
                    PromptServer.instance.send_sync("queue-manager-archive-updated", {"total_imported": total})

            return total, len(items)

    # If there are any items in the queue with status 1 (running), restore them to status 0 (pending) with highest priority
    # TODO: Add a setting to enable/disable this feature
    def restore_queue(self, called_by_queue_get=False):
        with PromptServer.instance.prompt_queue.mutex:
            if self.restored:
                return

            # Get running items from the database
            rows = read_query("""
                SELECT prompt_id, number, name, workflow_id, prompt
                FROM queue
                WHERE status = 1
                ORDER BY number
            """)
            if len(rows) > 0:
                logging.info("[Queue Manager] Restoring unfinished jobs: %d item(s)", len(rows))
                # Get current highest priority (lowest number for pending task) in the database
                lowest = read_single("""
                    SELECT number
                    FROM queue
                    WHERE status = 0
                    ORDER BY number
                    LIMIT 1
                """)

                if lowest:
                    min_number = lowest[0] - 1
                else:
                    min_number = 0

                # Set the priority of the running items to the current highest priority
                for row in rows:
                    write_query(
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

            # Get task counter (highest task number) from the database
            rows = read_single("""
                SELECT number
                FROM queue
                WHERE status = 1 OR status = 0 -- pending or running
                ORDER BY number DESC
                LIMIT 1
            """)
            if rows:
                task_counter = rows[0] + 1
            else:
                task_counter = 1

            # Set the task counter in the queue
            PromptServer.instance.prompt_queue.task_counter = task_counter
            # Set the number in server
            PromptServer.instance.number = task_counter

            logging.info("[Queue Manager] Task counter set to %d", task_counter)

            # Start queue processing
            # TODO: Add a setting to enable/disable auto-start
            if not called_by_queue_get:  # prevent circular call
                PromptServer.instance.prompt_queue.get(1000)

            self.restored = True  # we restore the queue only once per server start

    def get_filters(self, filters=None, where_clauses=None, params=None):
        if filters is not None:
            if where_clauses is None:
                where_clauses = []
            if params is None:
                params = []

            # If there are any filters, add them to the where clauses
            for key, the_filter in filters.items():
                if key == "workflow":
                    where_clauses.append("workflow_id = ?")
                    params.append(the_filter["value"])
                # elif key == "checkpoint":
                #     where_clauses.append("name LIKE ?")
                #     params.append(f"%{value}%")

        return " AND ".join(where_clauses), () if params is None else tuple(params)  # convert to tuple if not None
