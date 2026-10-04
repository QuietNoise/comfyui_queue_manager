"""Renaming persists a single job and keeps ComfyUI's pending copy in sync."""

import copy
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
def rename_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)

    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_rename_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        monkeypatch.setattr(qm_db, "get_conn", lambda: conn)
        monkeypatch.setattr(module, "get_conn", lambda: conn)
        qm_db.init_schema()
        queue = module.QM_Queue.__new__(module.QM_Queue)
        queue.native_queue = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={})
        module.PromptServer.instance = SimpleNamespace(send_sync=Mock())
        yield queue, module.PromptServer.instance


def add_job(prompt_id="job", status=0, sensitive=True):
    prompt = [
        12,
        prompt_id,
        {"name-node": {"class_type": "Workflow Name", "inputs": {"text": "original text"}}},
        {"client_id": "client", "extra_pnginfo": {"workflow": {"id": "workflow-id", "workflow_name": "old name", "nodes": []}}},
        ["name-node"],
    ]
    if sensitive:
        prompt.append({"api_key_comfy_org": "test-key"})
    qm_db.write_query(
        "INSERT INTO queue (prompt_id, number, name, workflow_id, prompt, status) VALUES (?, ?, ?, ?, ?, ?)",
        (prompt_id, 12, "old name", "workflow-id", json.dumps(prompt), status),
    )
    db_id = qm_db.read_single("SELECT id FROM queue WHERE prompt_id = ?", (prompt_id,))[0]
    return db_id, prompt


@pytest.mark.parametrize("status", [0, 3], ids=["pending", "archived"])
@pytest.mark.parametrize("sensitive", [True, False], ids=["current-prompt", "legacy-prompt"])
def test_rename_persists_only_selected_job(rename_queue, status, sensitive):
    queue, server = rename_queue
    db_id, prompt = add_job(status=status, sensitive=sensitive)
    sibling_id, sibling = add_job("sibling", status=status)
    qm_db.write_query("UPDATE queue SET updated_at = '2000-01-01 00:00:00' WHERE id = ?", (db_id,))

    assert queue.rename_item(db_id, "my:name  ") == "my_name__"

    expected = copy.deepcopy(prompt)
    expected[3]["extra_pnginfo"]["workflow"]["workflow_name"] = "my_name__"
    row = qm_db.read_single("SELECT * FROM queue WHERE id = ?", (db_id,))
    assert row["name"] == "my_name__"
    assert row["status"] == status
    assert row["updated_at"] == "2000-01-01 00:00:00"
    assert row["number"] == prompt[0]
    assert row["workflow_id"] == "workflow-id"
    assert json.loads(row["prompt"]) == expected
    assert json.loads(qm_db.read_single("SELECT prompt FROM queue WHERE id = ?", (sibling_id,))[0]) == sibling

    # Listings and exports reconstruct the renamed metadata from storage.
    route = "queue" if status == 0 else "archive"
    _, items = queue.get_current_queue(page_size=20, route=route)
    renamed = next(item for item in items if item[3]["db_id"] == db_id)
    assert renamed[3]["extra_pnginfo"]["workflow"]["workflow_name"] == "my_name__"
    exported = next(item for item in queue.get_full_queue(route) if item[1] == prompt[1])
    assert exported == expected
    server.send_sync.assert_called_once_with("queue-manager-queue-updated", {"renamed": db_id})


def test_rename_updates_already_pending_native_copy(rename_queue):
    queue, _ = rename_queue
    db_id, prompt = add_job()
    _, sibling = add_job("sibling")
    native_item = tuple(copy.deepcopy(prompt))
    queue.native_queue.queue = [native_item, tuple(copy.deepcopy(sibling))]
    original_inputs = copy.deepcopy(native_item[2])
    sensitive_data = native_item[5]

    queue.rename_item(db_id, "new name")

    assert queue.native_queue.queue[0] is native_item
    assert native_item[3]["extra_pnginfo"]["workflow"]["workflow_name"] == "new name"
    assert native_item[2] == original_inputs
    assert native_item[5] is sensitive_data
    assert list(queue.native_queue.queue[1]) == sibling


@pytest.mark.parametrize("status,native_running", [(1, True), (2, False), (0, True)])
def test_rename_rejects_started_or_completed_jobs(rename_queue, status, native_running):
    queue, server = rename_queue
    db_id, prompt = add_job(status=status)
    if native_running:
        queue.native_queue.currently_running[7] = tuple(prompt)

    with pytest.raises(RuntimeError, match="Only pending or archived"):
        queue.rename_item(db_id, "new name")

    row = qm_db.read_single("SELECT name, prompt FROM queue WHERE id = ?", (db_id,))
    assert row["name"] == "old name"
    assert json.loads(row["prompt"]) == prompt
    server.send_sync.assert_not_called()


def test_rename_rejects_deleted_jobs(rename_queue):
    queue, server = rename_queue
    with pytest.raises(LookupError, match="no longer exists"):
        queue.rename_item(99, "new name")
    server.send_sync.assert_not_called()


@pytest.mark.parametrize("db_id,name", [(None, "name"), (True, "name"), (-1, "name"), (1, None), (1, 123), (1, " \ufeff ")])
def test_rename_rejects_invalid_input(rename_queue, db_id, name):
    queue, server = rename_queue
    with pytest.raises(ValueError):
        queue.rename_item(db_id, name)
    server.send_sync.assert_not_called()


@pytest.mark.parametrize("route,status", [("queue", 0), ("archive", 3)])
def test_batch_rename_updates_only_eligible_selected_jobs(rename_queue, route, status):
    queue, server = rename_queue
    first, prompt = add_job("first", status=status)
    second, second_prompt = add_job("second", status=status)
    other, _ = add_job("unselected", status=status)
    moved, _ = add_job("moved", status=3 if status == 0 else 0)
    completed, _ = add_job("completed", status=2)
    running, running_prompt = add_job("running", status=status)
    queue.native_queue.currently_running[7] = tuple(running_prompt)
    native = tuple(copy.deepcopy(prompt))
    queue.native_queue.queue = [native, tuple(copy.deepcopy(second_prompt))]
    for db_id in (first, second):
        qm_db.write_query("UPDATE queue SET updated_at = '2000-01-01' WHERE id = ?", (db_id,))

    result = queue.rename_items([second, first, first, moved, completed, running, 999], "my:name  ", route)

    assert set(result["ids"]) == {first, second}
    assert result["name"] == "my_name__"
    for db_id in (first, second):
        row = qm_db.read_single("SELECT * FROM queue WHERE id = ?", (db_id,))
        assert row["name"] == "my_name__"
        assert row["updated_at"] == "2000-01-01"
        assert row["status"] == status
        assert json.loads(row["prompt"])[3]["extra_pnginfo"]["workflow"]["workflow_name"] == "my_name__"
    for db_id in (other, moved, completed, running):
        assert qm_db.read_single("SELECT name FROM queue WHERE id = ?", (db_id,))[0] == "old name"
    assert native[3]["extra_pnginfo"]["workflow"]["workflow_name"] == "my_name__"
    assert native[2] == prompt[2]
    assert native[5] == prompt[5]
    assert native[0] == prompt[0]
    server.send_sync.assert_called_once_with("queue-manager-queue-updated", {"renamed": result["ids"]})


@pytest.mark.parametrize(
    "ids,name,route",
    [
        ([], "name", "queue"),
        (None, "name", "queue"),
        ([True], "name", "queue"),
        ([0], "name", "queue"),
        (["1"], "name", "queue"),
        (list(range(1, 202)), "name", "queue"),
        ([1], None, "queue"),
        ([1], " ", "queue"),
        ([1], "name", "completed"),
        ([1], "name", None),
    ],
)
def test_batch_rename_rejects_invalid_scope(rename_queue, ids, name, route):
    queue, server = rename_queue
    db_id, _ = add_job()
    with pytest.raises(ValueError):
        queue.rename_items(ids, name, route)
    assert qm_db.read_single("SELECT name FROM queue WHERE id = ?", (db_id,))[0] == "old name"
    server.send_sync.assert_not_called()


def test_batch_rename_with_no_remaining_jobs_does_not_broaden(rename_queue):
    queue, server = rename_queue
    db_id, _ = add_job()
    assert queue.rename_items([999], "name", "queue") == {"ids": [], "name": "name"}
    assert qm_db.read_single("SELECT name FROM queue WHERE id = ?", (db_id,))[0] == "old name"
    server.send_sync.assert_not_called()


def test_batch_rename_rolls_back_on_write_failure(rename_queue):
    queue, server = rename_queue
    first, first_prompt = add_job("first")
    second, _ = add_job("second")
    native = tuple(copy.deepcopy(first_prompt))
    queue.native_queue.queue = [native]
    qm_db.get_conn().executescript("""
        CREATE TRIGGER reject_second_name BEFORE UPDATE OF name ON queue
        WHEN NEW.prompt_id = 'second'
        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    """)
    with pytest.raises(sqlite3.IntegrityError, match="simulated failure"):
        queue.rename_items([first, second], "new name", "queue")
    assert all(row["name"] == "old name" for row in qm_db.read_query("SELECT name FROM queue"))
    assert list(native) == first_prompt
    server.send_sync.assert_not_called()
