"""API prompts without canvas metadata participate in the managed queue lifecycle."""

import copy
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
from src.comfyui_queue_manager.queue_metadata import queue_metadata


@pytest.fixture
def api_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)
    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._api_jobs_test", path)
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
        queue.restored = True
        native = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={}, task_counter=1)
        native.not_empty = threading.Condition(native.mutex)
        queue.native_queue = native
        queue.pause_lock = threading.Condition(native.mutex)
        queue.original_put = Mock(side_effect=lambda item: heapq.heappush(native.queue, item))
        queue.original_get = Mock(side_effect=lambda timeout: (heapq.heappop(native.queue), native.task_counter))
        queue.original_task_done = Mock()
        module.PromptServer.instance = SimpleNamespace(send_sync=Mock(), queue_updated=Mock(), prompt_queue=native, number=100)
        yield queue


def api_job(number=1, extra=None, legacy=False):
    prompt = {
        "1": {"class_type": "ExampleInput", "inputs": {"value": "original"}},
        "9": {"class_type": "ExampleOutput", "inputs": {"source": ["1", 0]}},
    }
    item = (number, f"{number:08d}-api-prompt", prompt, copy.deepcopy(extra or {}), ["9"])
    return item if legacy else (*item, {"api_key_comfy_org": "test-only-key"})


def saved(prompt_id):
    return qm_db.read_single("SELECT * FROM queue WHERE prompt_id = ?", (prompt_id,))


@pytest.mark.parametrize("paused", [False, True])
@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"client_id": "api-client"},
        {"extra_pnginfo": {}},
        {"extra_pnginfo": None},
        {"extra_pnginfo": {"note": "preserve this"}},
        {"extra_pnginfo": {"workflow": None}},
        {"extra_pnginfo": {"workflow": {"id": "supplied-workflow"}}},
        {"extra_pnginfo": {"workflow": {"workflow_name": "Supplied name"}}},
    ],
)
def test_api_jobs_are_persisted_without_fabricating_workflows(api_queue, extra, paused):
    api_queue.paused = paused
    item = api_job(extra=extra)
    original = copy.deepcopy(item)
    api_queue.queue_put(item)
    row = saved(item[1])
    assert row["status"] == 0
    stored = json.loads(row["prompt"])
    assert stored[2] == item[2]
    assert stored[4] == item[4]
    assert stored[5] == item[5]
    assert {key: value for key, value in stored[3].items() if key != "queue_manager"} == extra
    assert item == original
    assert row["name"] == queue_metadata(stored)["name"]
    assert row["workflow_id"] == queue_metadata(stored)["workflow_id"]
    assert api_queue.get_tasks_remaining() == 1
    _, pending = api_queue.get_current_queue(page_size=100)
    assert pending[0][3]["db_id"] == row["id"]
    assert bool(api_queue.native_queue.queue) is not paused


def test_api_jobs_keep_client_routing_sensitive_fields_and_legacy_execution(api_queue):
    for number, legacy in [(1, False), (2, True)]:
        item = api_job(number, {"client_id": "api-client", "extension_data": {"keep": True}}, legacy=legacy)
        api_queue.queue_put(item)
        queued, _ = api_queue.queue_get()
        assert queued[1:3] == item[1:3]
        assert queued[3]["client_id"] == "api-client"
        assert queued[3]["extension_data"] == {"keep": True}
        assert queued[4] == item[4]
        assert queued[5] == ({} if legacy else item[5])
        assert saved(item[1])["status"] == 1


def test_api_workflow_identity_is_per_submission_and_survives_rename(api_queue):
    jobs = [api_job(1), api_job(2)]
    for item in jobs:
        api_queue.queue_put(item)
    first, second = [saved(item[1]) for item in jobs]
    assert first["workflow_id"] != second["workflow_id"]
    api_queue.rename_items([first["id"], second["id"]], "new:name", "queue")
    filters = {"workflow": {"value": first["workflow_id"]}}
    _, pending = api_queue.get_current_queue(page_size=100, filters=filters)
    assert [item[1] for item in pending] == [jobs[0][1]]
    _, same_name = api_queue.get_current_queue(page_size=100, filters={"workflow_name": {"value": "new_name"}})
    assert len(same_name) == 2
    for item in same_name:
        assert item[2] == jobs[0][2]
        assert "extra_pnginfo" not in item[3]
        assert queue_metadata(item)["name"] == "new_name"
    assert queue_metadata(api_queue.native_queue.queue[0])["name"] == "new_name"


def test_api_callers_can_supply_name_and_shared_identity(api_queue):
    for number in (1, 2):
        api_queue.queue_put(api_job(number, {"queue_manager": {"name": "my:name", "workflow_id": "my-api-workflow"}}))
    _, jobs = api_queue.get_current_queue(page_size=100, filters={"workflow": {"value": "my-api-workflow"}})
    assert len(jobs) == 2
    assert all(queue_metadata(item)["name"] == "my_name" for item in jobs)


def test_api_and_gui_jobs_reorder_together_in_actual_execution_order(api_queue):
    gui = api_job(2, {"extra_pnginfo": {"workflow": {"id": "gui", "workflow_name": "GUI", "nodes": []}}})
    jobs = [api_job(1), gui, api_job(3)]
    for item in jobs:
        api_queue.queue_put(item)
    ids = [saved(item[1])["id"] for item in jobs]
    api_queue.reorder_items([ids[2]], ids[0], "before")
    assert [api_queue.queue_get()[0][1] for _ in jobs] == [jobs[2][1], jobs[0][1], jobs[1][1]]


def test_archiving_prefetched_api_job_prevents_execution_and_allows_replay(api_queue):
    first, second = api_job(1), api_job(2)
    api_queue.queue_put(first)
    api_queue.queue_put(second)
    first_id = saved(first[1])["id"]
    assert api_queue.archive_items([first_id]) == 1
    assert api_queue.queue_get()[0][1] == second[1]
    assert api_queue.play_items([first_id], front=True, client_id="viewer") == 1
    replay, _ = api_queue.queue_get()
    assert replay[1] == first[1]
    assert replay[2] == first[2]
    assert replay[3]["client_id"] == "viewer"
    assert replay[5] == first[5]


def test_selected_api_jobs_archive_reorder_export_import_and_run_at_front(api_queue):
    jobs = [api_job(i) for i in (1, 2, 3)]
    for item in jobs:
        api_queue.queue_put(item)
    ids = [saved(item[1])["id"] for item in jobs]
    assert api_queue.selection_action("archive", "queue", ids[1:]) == 2
    api_queue.reorder_items([ids[2]], ids[1], "before", route="archive")
    exported = api_queue.selection_action("export", "archive", [ids[1]])
    assert len(exported[0]) == 5
    assert "test-only-key" not in json.dumps(exported)
    assert api_queue.selection_action("delete", "archive", [ids[1]]) == 1
    assert api_queue.import_queue(exported, status=3, api_key_comfy_org="replacement-key") == (1, 1)
    imported = saved(jobs[1][1])
    assert imported["workflow_id"] == f"api:{jobs[1][1]}"
    assert json.loads(imported["prompt"])[5] == {"api_key_comfy_org": "replacement-key"}
    assert api_queue.play_archive(front=True) == 2
    assert [api_queue.queue_get()[0][1] for _ in jobs] == [jobs[2][1], jobs[1][1], jobs[0][1]]


def test_completed_api_job_records_outputs_and_forwards_native_cleanup(api_queue):
    item = api_job()
    api_queue.queue_put(item)
    queued, item_id = api_queue.queue_get()
    api_queue.native_queue.currently_running[item_id] = queued
    history = {"outputs": {"9": {"images": [{"filename": "api.png", "subfolder": "", "type": "output"}]}}}
    status = ("success", True, [("execution_start", {"timestamp": 1000}), ("execution_success", {"timestamp": 2500})])
    cleanup = Mock()
    api_queue.task_done(item_id, history, status, process_item=cleanup)
    api_queue.original_task_done.assert_called_once_with(item_id, history, status, cleanup)
    _, completed = api_queue.get_current_queue(page_size=100, route="completed")
    assert completed[0][3]["total_files"] == 1
    assert completed[0][3]["execution_time"] == 1.5
    assert completed[0][3]["outputs"] == history["outputs"]
    assert queue_metadata(completed[0])["name"].startswith("API job ")


def test_interrupted_api_job_restores_from_persisted_prompt(api_queue):
    item = api_job()
    api_queue.queue_put(item)
    api_queue.queue_get()
    api_queue.restored = False
    api_queue.restore_queue(True)
    restored, _ = api_queue.queue_get()
    assert restored[1:3] == item[1:3]
    assert restored[5] == item[5]
    assert queue_metadata(restored)["workflow_id"] == f"api:{item[1]}"
