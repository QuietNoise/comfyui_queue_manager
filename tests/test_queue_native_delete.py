"""Native deletions (POST /queue {"delete": [...]}, /api/jobs/{id}/cancel) also remove database jobs."""

import heapq
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import threading
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

from src.comfyui_queue_manager import qm_db


@pytest.fixture
def delete_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)
    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_native_delete_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        monkeypatch.setattr(qm_db, "get_conn", lambda: conn)
        monkeypatch.setattr(module, "get_conn", lambda: conn)
        qm_db.init_schema()
        queue = module.QM_Queue.__new__(module.QM_Queue)
        queue.paused = False
        queue.takeover_client = None
        native = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={}, task_counter=1)
        native.not_empty = threading.Condition(native.mutex)

        def native_delete(function):  # same logic as ComfyUI's PromptQueue.delete_queue_item
            with native.mutex:
                for x in range(len(native.queue)):
                    if function(native.queue[x]):
                        native.queue.pop(x)
                        heapq.heapify(native.queue)
                        return True
            return False

        queue.native_queue = native
        queue.pause_lock = threading.Condition(native.mutex)
        queue.original_get = Mock(side_effect=lambda timeout: (heapq.heappop(native.queue), 1))
        queue.original_put = Mock(side_effect=lambda item: heapq.heappush(native.queue, item))
        queue.original_delete_queue_item = native_delete
        module.PromptServer.instance = SimpleNamespace(send_sync=Mock(), queue_updated=Mock(), number=100, prompt_queue=native)
        yield queue, module.PromptServer.instance


def add_job(number, prompt_id, status=0):
    prompt = [
        number,
        prompt_id,
        {"node": {}},
        {"client_id": "c", "extra_pnginfo": {"workflow": {"id": "w", "workflow_name": "n"}}},
        ["node"],
        {},
    ]
    qm_db.write_query(
        "INSERT INTO queue (prompt_id, number, name, workflow_id, prompt, status) VALUES (?, ?, ?, ?, ?, ?)",
        (prompt_id, number, "n", "w", json.dumps(prompt), status),
    )
    return tuple(prompt)


def pending():
    return [row[0] for row in qm_db.read_query("SELECT prompt_id FROM queue WHERE status = 0 ORDER BY number, id")]


def test_native_delete_removes_database_only_job(delete_queue):
    queue, server = delete_queue
    for n, pid in enumerate(["a", "b", "c"]):
        add_job(n, pid)

    assert queue.queue_delete_item(lambda a: a[1] == "b") is True
    assert pending() == ["a", "c"]
    server.send_sync.assert_called_with("queue-manager-queue-updated", {"deleted": 1})


def test_native_delete_removes_prefetched_job_from_heap_and_database(delete_queue):
    queue, _ = delete_queue
    item = add_job(0, "a")
    add_job(1, "b")
    heapq.heappush(queue.native_queue.queue, item)  # job prefetched into the native heap

    assert queue.queue_delete_item(lambda a: a[1] == "a") is True
    assert queue.native_queue.queue == []
    assert pending() == ["b"]
    # the deleted job is not picked up again by the worker
    assert queue.queue_get(timeout=0)[0][1] == "b"


def test_native_delete_keeps_running_and_archived_jobs(delete_queue):
    queue, _ = delete_queue
    add_job(0, "running", status=1)
    add_job(1, "archived", status=3)

    assert queue.queue_delete_item(lambda a: a[1] in ("running", "archived")) is False
    assert {r[0] for r in qm_db.read_query("SELECT prompt_id FROM queue")} == {"running", "archived"}


def test_native_delete_predicate_can_read_stored_prompt(delete_queue):
    queue, _ = delete_queue
    add_job(0, "a")
    add_job(1, "b")

    assert queue.queue_delete_item(lambda a: a[3]["client_id"] == "c" and a[1] == "a") is True
    assert pending() == ["b"]


def test_unknown_id_deletes_nothing(delete_queue):
    queue, server = delete_queue
    add_job(0, "a")

    assert queue.queue_delete_item(lambda a: a[1] == "zzz") is False
    assert pending() == ["a"]
    server.send_sync.assert_not_called()
