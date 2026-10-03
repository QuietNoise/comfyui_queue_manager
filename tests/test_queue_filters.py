"""Exact-name selection is shared by listings, pagination, exports and bulk actions."""

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
def filtered_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)

    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_filter_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        monkeypatch.setattr(qm_db, "get_conn", lambda: conn)
        qm_db.init_schema()
        queue = module.QM_Queue.__new__(module.QM_Queue)
        queue.native_queue = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={})
        queue.native_queue.not_empty = threading.Condition(queue.native_queue.mutex)
        module.PromptServer.instance = SimpleNamespace(
            send_sync=Mock(),
            queue_updated=Mock(),
            prompt_queue=queue.native_queue,
            number=100,
        )
        yield queue


def add_job(prompt_id, name, workflow_id, status=0):
    prompt = [1, prompt_id, {}, {"extra_pnginfo": {"workflow": {"id": workflow_id, "workflow_name": name}}}, []]
    qm_db.write_query(
        "INSERT INTO queue (prompt_id, number, name, workflow_id, prompt, status) VALUES (?, ?, ?, ?, ?, ?)",
        (prompt_id, 1, name, workflow_id, json.dumps(prompt), status),
    )
    return prompt


def name_filter(name):
    # workflowId is UI context for switching back, not an additional constraint.
    return {"workflow_name": {"type": "workflow_name", "value": name, "valueLabel": name, "workflowId": "original"}}


@pytest.mark.parametrize("route,status", [("queue", 0), ("archive", 3), ("completed", 2)])
def test_exact_name_matches_across_workflows_and_pages(filtered_queue, route, status):
    name = "Dog_%'猫"
    add_job("match", name, "original", status)
    add_job("other-workflow", name, "different", status)
    add_job("renamed", "different name", "original", status)
    add_job("case", name.lower(), "original", status)
    add_job("space", name + " ", "original", status)
    add_job("wildcard", "Dog_anything'猫", "original", status)
    add_job("other-tab", name, "original", 3 if status == 0 else 0)

    queue = filtered_queue
    filters = name_filter(name)
    _, first, info = queue.get_current_queue(page_size=1, route=route, filters=filters, return_meta=True)
    _, second, second_info = queue.get_current_queue(page=1, page_size=1, route=route, filters=filters, return_meta=True)
    assert info == {"total": 2, "page": 0, "page_size": 1, "last_page": 1}
    assert second_info["page"] == 1
    assert {first[0][1], second[0][1]} == {"match", "other-workflow"}
    assert {item[1] for item in queue.get_full_queue(route, filters)} == {"match", "other-workflow"}

    by_workflow = {"workflow": {"type": "workflow", "value": "original", "valueLabel": name}}
    _, items = queue.get_current_queue(page_size=100, route=route, filters=by_workflow)
    assert {item[1] for item in items} == {"match", "renamed", "case", "space", "wildcard"}


@pytest.mark.parametrize(
    "route,status,operation",
    [
        ("queue", 0, "archive"),
        ("archive", 3, "play"),
        ("queue", 0, "delete"),
        ("archive", 3, "delete"),
        ("completed", 2, "delete"),
    ],
)
def test_bulk_actions_use_the_exact_name_filter(filtered_queue, route, status, operation):
    add_job("match", "dog", "original", status)
    add_job("other-workflow", "dog", "different", status)
    add_job("renamed", "dog renamed", "original", status)
    add_job("other-tab", "dog", "original", 3 if status == 0 else 0)
    filters = name_filter("dog")
    queue = filtered_queue

    if operation == "archive":
        assert queue.archive_queue(filters) == 2
    elif operation == "play":
        assert queue.play_archive(filters=filters) == 2
    else:
        assert queue.delete_from_queue(route, filters) == 2

    rows = {row["prompt_id"]: row["status"] for row in qm_db.read_query("SELECT prompt_id, status FROM queue")}
    assert rows["renamed"] == status
    assert rows["other-tab"] == (3 if status == 0 else 0)
    if operation == "delete":
        assert "match" not in rows and "other-workflow" not in rows
    else:
        assert rows["match"] == rows["other-workflow"] == (3 if operation == "archive" else 0)


def test_rename_removes_a_job_from_name_filter_but_keeps_it_in_workflow_filter(filtered_queue):
    add_job("job", "dog", "original")
    db_id = qm_db.read_single("SELECT id FROM queue WHERE prompt_id = 'job'")[0]
    filtered_queue.rename_item(db_id, "new name")
    _, items = filtered_queue.get_current_queue(page_size=100, filters=name_filter("dog"))
    assert items == []
    _, items = filtered_queue.get_current_queue(page_size=100, filters={"workflow": {"value": "original"}})
    assert [item[1] for item in items] == ["job"]
    assert items[0][3]["extra_pnginfo"]["workflow"]["workflow_name"] == "new name"


def test_running_rows_respect_both_modes_and_remain_visible_when_unfiltered(filtered_queue):
    jobs = [
        add_job("match", "dog", "original", 1),
        add_job("renamed", "new name", "original", 1),
        add_job("other-workflow", "dog", "different", 1),
        [1, "external-job", {}, {}, []],
    ]
    filtered_queue.native_queue.currently_running = dict(enumerate(jobs))
    running, _ = filtered_queue.get_current_queue(page_size=100, filters=name_filter("dog"))
    assert {item[1] for item in running} == {"match", "other-workflow"}
    running, _ = filtered_queue.get_current_queue(page_size=100, filters={"workflow": {"value": "original"}})
    assert {item[1] for item in running} == {"match", "renamed"}
    running, _ = filtered_queue.get_current_queue(page_size=100)
    assert running == jobs
