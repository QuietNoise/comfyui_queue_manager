import threading
from typing import Optional

from execution import PromptQueue
from server import PromptServer
import logging
import json
import heapq

from .qm_db import get_conn, read_query, read_single, write_query, write_many

VALID_TAGS = {"none", "new", "main", "priority", "background", "archive", "completed"}
DEFAULT_TAG = "none"


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
    def get_current_queue(self, page=0, page_size=0, route="queue", filters=None, return_meta=False):
        # logging.info('get_current_queue: %d, %d', page, page_size)
        # Get the first page of the current queue

        with self.native_queue.mutex:
            # Split running and pending jobs into tuple of running and pending tuples
            running = []
            pending = []
            total_rows = 0
            last_page = 0
            order_string = "ORDER BY number"

            match route:
                case "queue":
                    running.extend(self.native_queue.currently_running.values())
                case "archive" | "completed":
                    order_string = "ORDER BY updated_at"

            where_clauses = [self.get_route_query(route)]

            where_string, params = self.get_filters(filters, where_clauses)

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
                    SELECT id, prompt, number, tag, status
                    FROM queue
                    WHERE {where_string}
                    {order_string}
                    LIMIT ?, ?
                """,
                    params,
                )

                # array of prompts
                for row in rows:
                    item = json.loads(row[1])
                    # Add db_id to the item
                    item[3]["db_id"] = row[0]
                    # Add tag to the item
                    item[3]["tag"] = row[3] if row[3] else "none"
                    # Add status to the item
                    item[3]["status"] = row[4]

                    if route == "queue":
                        item[0] = row[2]  # set the number to the one from the database

                    pending.append(tuple(item))

            # If called without parameters, return all three values

            if return_meta:
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
            else:
                return running, pending

    def get_full_queue(self, route="queue", filters=None):
        with self.native_queue.mutex:
            where_string, params = self.get_filters(filters, [self.get_route_query(route, True)])

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

    def task_done(self, item_id, history_result, status: Optional["PromptQueue.ExecutionStatus"], process_item=None):
        with self.native_queue.mutex:
            # Mark the task as finished in the database

            # Get the running item from the native queue dictionary
            item = self.native_queue.currently_running.get(item_id, None)
            if item is not None:
                # Mark the item as finished in the database
                write_query(
                    """
                    UPDATE queue
                    SET status = 2, tag = 'completed'
                    WHERE prompt_id = ?
                """,
                    (item[1],),
                )
                # logging.info("[Queue Manager] Workflow finished: %s at %s", item[1], item[0])

                # Call the original task_done method
                if (process_item is None) or (not process_item):  # accommodate original method signature
                    self.original_task_done(item_id, history_result, status)
                    return

                self.original_task_done(item_id, history_result, status, process_item)

    # Put item for execution
    # NOTE: We keep only up to one item in native "pending" queue (to avoid bottleneck for large queues).
    def queue_put(self, item):  # comfy server calls this method
        # logging.info(json.dumps(item))

        with self.native_queue.mutex:
            # if item[3]["extra_pnginfo"] is not set then we pass it to original put
            # It suggests request does not come from ComfyUI but from external source (like API or some app's plugin) - as such they won't benefit from queue manager features
            if "extra_pnginfo" not in item[3] or "workflow" not in item[3]["extra_pnginfo"]:
                # item = tuple(item)
                self.original_put(tuple(item))
                return

            # Get default status and tag from settings
            default_status = self.queue_manager.options.get("default_status", 4)
            default_tag = self.queue_manager.options.get("default_tag", "main")

            # Add the item to the database with default status and tag from settings
            write_query(
                """
                INSERT OR REPLACE INTO queue (prompt_id, number, name, workflow_id, prompt, status, tag)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    item[1],
                    item[0],
                    item[3]["extra_pnginfo"]["workflow"]["workflow_name"],
                    item[3]["extra_pnginfo"]["workflow"]["id"],
                    json.dumps(item),
                    default_status,
                    default_tag,
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

                    # Backwards compatibility: if item[5] does not exist, create it with empty dict
                    if len(item) < 6:
                        item = item + ({},)

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

                    # Backwards compatibility: if item[5] does not exist, create it with empty dict
                    if len(item) < 6:
                        item = item + ({},)

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
                # logging.info(
                #     "[Queue Manager] Executing workflow: \033[33m%s\033[0m at %s",
                #     queue_item[0][3]["extra_pnginfo"]["workflow"]["workflow_name"],
                #     queue_item[0][0],
                # )
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
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"deleted": deleted})

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

            # Archive the queue from the database (preserve existing tag)
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
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": total})
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
                    SET status = 3, tag = 'archive'
                    WHERE id = ?
                """,
                    (item,),
                    False,
                )

            get_conn().commit()

            if archived > 0:
                logging.info("[Queue Manager] Queue Item Archived: %d item(s)", archived)
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": archived})

            return archived

    def delete_running(self, prompt_id=None):
        with self.native_queue.mutex:
            # Interrupt the queue
            return write_query(
                """
                DELETE FROM queue
                WHERE status = 1 AND (? IS NULL OR prompt_id = ?)
            """,
                (prompt_id, prompt_id),
            )

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

                # Backwards compatibility: if prompt[5] does not exist, create it with empty dict
                if len(prompt) < 6:
                    prompt.append({})

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
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": moved})
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
                ORDER BY updated_at
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
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": moved})
                PromptServer.instance.queue_updated()
            return moved

    def move_to_category(self, item_ids, category_status):
        """
        Move items to Priority/Main/Background (status 5/6/7)
        Also updates the tag to match the category.
        Works from any source status (New, Waiting, Archive, etc.)
        """
        with self.native_queue.mutex:
            if category_status not in [5, 6, 7]:
                logging.error("[Queue Manager] Invalid category status: %s", category_status)
                return 0

            # Map status to tag
            status_to_tag = {
                5: "priority",
                6: "main",
                7: "background",
            }
            new_tag = status_to_tag[category_status]

            moved = 0
            for db_id in item_ids:
                moved += write_query(
                    """
                    UPDATE queue
                    SET status = ?, tag = ?
                    WHERE id = ?
                """,
                    (category_status, new_tag, db_id),
                    False,
                )

            get_conn().commit()

            if moved > 0:
                logging.info("[Queue Manager] %d item(s) moved to category %d (tag: %s)", moved, category_status, new_tag)
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": moved})

            return moved

    def update_tag(self, item_ids, tag):
        """
        Update tag for the specified items.
        tag: single string from VALID_TAGS set
        """
        with self.native_queue.mutex:
            # Validate tag
            if tag not in VALID_TAGS:
                logging.error("[Queue Manager] Invalid tag: %s", tag)
                return 0

            updated = 0
            for db_id in item_ids:
                updated += write_query(
                    """
                    UPDATE queue
                    SET tag = ?
                    WHERE id = ?
                """,
                    (tag, db_id),
                    False,
                )

            get_conn().commit()

            if updated > 0:
                logging.info("[Queue Manager] %d item(s) tag updated to %s", updated, tag)
                PromptServer.instance.queue_updated()

            return updated

    def reorder_items(self, item_ids: list):
        """
        Reorder pending queue items by redistributing their current 'number' values.
        item_ids: list of db_ids in the desired execution order (first = highest priority).
        Only items on the current page are reordered; items on other pages are unaffected.
        """
        with self.native_queue.mutex:
            # 1. Read current numbers for all items being reordered
            placeholders = ",".join("?" for _ in item_ids)
            rows = read_query(
                f"SELECT id, number FROM queue WHERE id IN ({placeholders})",
                tuple(item_ids),
            )
            if not rows:
                return 0

            # Build id->number map
            num_map = {row[0]: row[1] for row in rows}

            # 2. Sort existing numbers ascending
            sorted_numbers = sorted(num_map.values())

            # 3. Assign numbers in new order (first item gets smallest number = highest priority)
            for i, db_id in enumerate(item_ids):
                if db_id in num_map:
                    write_query(
                        "UPDATE queue SET number = ? WHERE id = ?",
                        (sorted_numbers[i], db_id),
                        commit=False,
                    )

            get_conn().commit()

            # 4. Clear native queue so next queue_get() picks up the new order
            self.native_queue.queue = []
            heapq.heapify(self.native_queue.queue)

            # 5. Notify the queue processing loop
            PromptServer.instance.prompt_queue.not_empty.notify()
            PromptServer.instance.send_sync(
                "queue-manager-queue-updated",
                {"reordered": len(item_ids)},
            )
            PromptServer.instance.queue_updated()

            return len(item_ids)

    def _build_queue_step1_archive_pending(self):
        """
        Step 1: Archive all current pending items (status 0 -> 3).
        Tags are preserved as-is.
        Returns the number of archived items.
        """
        archived = write_query(
            """
            UPDATE queue
            SET status = 3
            WHERE status = 0
        """
        )
        logging.info("[Queue Manager] Build Queue Step 1: Archived %d pending items", archived)
        return archived

    def _build_queue_step2_process_tiers(self, client_id=None):
        """
        Step 2: Process items in priority tiers.
        For each tier (priority -> main -> background):
          a. Move items from the category (status 5/6/7) to pending (status 0),
             keeping their tag (priority/main/background).
          b. Move items from archive (status 3) with matching tag to pending (status 0),
             keeping their tag (priority/main/background).

        After this step, only items with non-priority tags (archive, none, new, completed)
        remain in the archive (status 3).
        Returns the total number of moved items.
        """
        tiers = [
            (5, "priority"),
            (6, "main"),
            (7, "background"),
        ]

        total_moved = 0
        for category_status, tag_name in tiers:
            # Sub-step a: Move items from the category to pending
            rows = read_query(
                """
                SELECT id, prompt
                FROM queue
                WHERE status = ?
                ORDER BY updated_at
            """,
                (category_status,),
            )

            parameters = []
            for row in rows:
                PromptServer.instance.number += 1

                item = json.loads(row[1])
                if client_id is not None:
                    item[3]["client_id"] = client_id
                item[0] = PromptServer.instance.number

                # Backwards compatibility: if item[5] does not exist, create it with empty dict
                if len(item) < 6:
                    item.append({})

                parameters.append(
                    (
                        0,  # status = pending
                        tag_name,  # keep the tag
                        PromptServer.instance.number,
                        json.dumps(item),
                        row[0],
                    )
                )

            if parameters:
                moved = write_many(
                    """
                    UPDATE queue
                    SET status = ?, tag = ?, number = ?, prompt = ?
                    WHERE id = ?
                """,
                    parameters,
                )
                total_moved += moved
                logging.info("[Queue Manager] Build Queue: Moved %d items from %s category", moved, tag_name)

            # Sub-step b: Move items from archive with matching tag to pending
            rows = read_query(
                """
                SELECT id, prompt
                FROM queue
                WHERE status = 3 AND tag = ?
                ORDER BY updated_at
            """,
                (tag_name,),
            )

            parameters = []
            for row in rows:
                PromptServer.instance.number += 1

                item = json.loads(row[1])
                if client_id is not None:
                    item[3]["client_id"] = client_id
                item[0] = PromptServer.instance.number

                # Backwards compatibility: if item[5] does not exist, create it with empty dict
                if len(item) < 6:
                    item.append({})

                parameters.append(
                    (
                        0,  # status = pending
                        tag_name,  # keep the tag
                        PromptServer.instance.number,
                        json.dumps(item),
                        row[0],
                    )
                )

            if parameters:
                moved = write_many(
                    """
                    UPDATE queue
                    SET status = ?, tag = ?, number = ?, prompt = ?
                    WHERE id = ?
                """,
                    parameters,
                )
                total_moved += moved
                logging.info(
                    "[Queue Manager] Build Queue: Restored %d archived items with tag '%s'", moved, tag_name
                )

        return total_moved

    def build_queue(self, client_id=None):
        """
        Build the working queue from categorized items:
        1. Archive all current pending items (status 0 -> 3), preserving their tags
        2. Process items in priority tiers:
           a. Move items from Priority category (status 5) to pending (status 0), keep tag 'priority'
           b. Move archived items with tag 'priority' (status 3) to pending (status 0), keep tag 'priority'
           c. Move items from Main category (status 6) to pending (status 0), keep tag 'main'
           d. Move archived items with tag 'main' (status 3) to pending (status 0), keep tag 'main'
           e. Move items from Background category (status 7) to pending (status 0), keep tag 'background'
           f. Move archived items with tag 'background' (status 3) to pending (status 0), keep tag 'background'

        After build, only items with non-priority tags (archive, none, new, completed)
        remain in the archive (status 3).
        """
        with self.native_queue.mutex:
            # Step 1: Archive all current pending items
            archived = self._build_queue_step1_archive_pending()

            # Step 2: Process items in priority tiers (category + archive with matching tag)
            moved = self._build_queue_step2_process_tiers(client_id)

            total_moved = moved

            # Clear native queue and notify
            self.native_queue.queue = []
            heapq.heapify(self.native_queue.queue)

            if total_moved > 0:
                # Notify native queue lock so if it's waiting it can move on
                PromptServer.instance.prompt_queue.not_empty.notify()

                logging.info("[Queue Manager] Build Queue: %d total item(s) scheduled for generation.", total_moved)
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_moved": total_moved, "archived": archived})
                PromptServer.instance.queue_updated()

            return {"archived": archived, "moved": total_moved}

    def delete_from_queue(self, route="queue", filters=None):
        with self.native_queue.mutex:
            where_string, params = self.get_filters(filters, [self.get_route_query(route)])
            # Delete the archive from the database
            deleted = write_query(
                f"""
                DELETE FROM queue
                WHERE {where_string}
            """,
                params,
            )

            if route == "queue":
                PromptServer.instance.queue_updated()
            else:
                PromptServer.instance.send_sync("queue-manager-queue-updated", {"deleted": deleted})

            return deleted

    # Import queue from uploaded json file
    def import_queue(self, items, client_id=None, status=0, api_key_comfy_org=None):
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

                if api_key_comfy_org is not None:
                    if len(item) < 6:
                        item.append({})
                    item[5] = {"api_key_comfy_org": api_key_comfy_org} if api_key_comfy_org is not None else {}

                PromptServer.instance.number += 1
                query_params.append(
                    (
                        item[1],
                        PromptServer.instance.number,
                        item[3]["extra_pnginfo"]["workflow"]["workflow_name"],
                        item[3]["extra_pnginfo"]["workflow"]["id"],
                        json.dumps(item),
                        status,
                        DEFAULT_TAG,
                    )
                )

            total = write_many(
                """
                    INSERT OR IGNORE INTO queue (prompt_id, number, name, workflow_id, prompt, status, tag)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                query_params,
            )

            if total > 0:
                theQueue.not_empty.notify()
                if status == 0:
                    theServer.queue_updated()
                if status == 3:
                    PromptServer.instance.send_sync("queue-manager-queue-updated", {"total_imported": total})

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
                elif key == "status":
                    # status filter: value is a list of status numbers (e.g., [5, 6, 7])
                    placeholders = ", ".join(["?" for _ in the_filter["value"]])
                    where_clauses.append(f"status IN ({placeholders})")
                    params.extend(the_filter["value"])
                elif key == "tag":
                    # tag filter: value is a list of tag strings (e.g., ["priority", "main", "background"])
                    placeholders = ", ".join(["?" for _ in the_filter["value"]])
                    where_clauses.append(f"tag IN ({placeholders})")
                    params.extend(the_filter["value"])
                # elif key == "checkpoint":
                #     where_clauses.append("name LIKE ?")
                #     params.append(f"%{value}%")

        return " AND ".join(where_clauses), () if params is None else tuple(params)  # convert to tuple if not None

    def get_route_query(self, route="queue", include_running=False):
        # Get the query for the given route
        match route:
            case "queue":
                return "status = 0" + (" OR status = 1" if include_running else "")  # pending
            case "archive":
                return "status = 3"
            case "completed":
                return "status = 2"  # completed
            case "new":
                return "status = 4"  # new
            case "waiting":
                return "status IN (5, 6, 7)"  # waiting (priority, main, background)

        return ""
