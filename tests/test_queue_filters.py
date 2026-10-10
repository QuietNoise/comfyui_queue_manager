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
        monkeypatch.setattr(module, "get_conn", lambda: conn)
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
        [1, "unmanaged-job", {}, {}, []],
    ]
    filtered_queue.native_queue.currently_running = dict(enumerate(jobs))
    running, _ = filtered_queue.get_current_queue(page_size=100, filters=name_filter("dog"))
    assert {item[1] for item in running} == {"match", "other-workflow"}
    running, _ = filtered_queue.get_current_queue(page_size=100, filters={"workflow": {"value": "original"}})
    assert {item[1] for item in running} == {"match", "renamed"}
    running, _ = filtered_queue.get_current_queue(page_size=100)
    assert running == jobs


@pytest.mark.parametrize(
    "route,status,action",
    [
        ("queue", 0, "archive"),
        ("queue", 0, "delete"),
        ("queue", 0, "export"),
        ("archive", 3, "play"),
        ("archive", 3, "delete"),
        ("archive", 3, "export"),
        ("completed", 2, "delete"),
        ("completed", 2, "export"),
    ],
)
def test_selection_actions_only_affect_selected_jobs_in_the_current_tab(filtered_queue, route, status, action):
    selected_prompt = add_job("selected", "same name", "same workflow", status)
    untouched = add_job("untouched", "same name", "same workflow", status)
    add_job("other-tab", "same name", "same workflow", 3 if status == 0 else 0)
    add_job("started-running", "same name", "same workflow", 1)
    ids = {row["prompt_id"]: row["id"] for row in qm_db.read_query("SELECT id, prompt_id FROM queue")}
    # Exports must also remove the optional sensitive-data field.
    selected_prompt.append({"api_key_comfy_org": "example-secret"})
    qm_db.write_query("UPDATE queue SET prompt = ? WHERE id = ?", (json.dumps(selected_prompt), ids["selected"]))
    filtered_queue.native_queue.queue = [tuple(selected_prompt), tuple(untouched)] if status == 0 else []

    result = filtered_queue.selection_action(
        action, route, [ids["selected"], ids["selected"], ids["other-tab"], ids["started-running"], 9999]
    )
    rows = {row["prompt_id"]: row["status"] for row in qm_db.read_query("SELECT prompt_id, status FROM queue")}
    assert rows["untouched"] == status
    assert rows["other-tab"] == (3 if status == 0 else 0)
    assert rows["started-running"] == 1
    if action == "export":
        assert result == [selected_prompt[:5]]
        assert rows["selected"] == status
    else:
        assert result == 1
        if action == "delete":
            assert "selected" not in rows
        else:
            assert rows["selected"] == (3 if action == "archive" else 0)
        if status == 0:
            assert [item[1] for item in filtered_queue.native_queue.queue] == ["untouched"]


@pytest.mark.parametrize("ids", [None, [], "1", [True], [0], ["1) OR 1=1"], list(range(1, 202))])
def test_invalid_selection_never_expands_to_all_jobs(filtered_queue, ids):
    add_job("keep", "name", "workflow")
    with pytest.raises(ValueError):
        filtered_queue.selection_action("delete", "queue", ids)
    assert len(qm_db.read_query("SELECT id FROM queue")) == 1
    assert filtered_queue.get_full_queue("queue", {"items": ids}) == []


def test_stale_selection_and_wrong_actions_cannot_touch_other_tabs(filtered_queue):
    add_job("running", "name", "workflow", 1)
    db_id = qm_db.read_single("SELECT id FROM queue")[0]
    assert filtered_queue.selection_action("delete", "queue", [db_id]) == 0
    assert filtered_queue.selection_action("export", "queue", [db_id]) == []
    for action, route in [("archive", "completed"), ("play", "queue"), ("delete", "unknown")]:
        with pytest.raises(ValueError):
            filtered_queue.selection_action(action, route, [db_id])
    assert len(qm_db.read_query("SELECT id FROM queue")) == 1


def test_run_selected_at_front_keeps_order_and_unmanaged_native_jobs(filtered_queue):
    pending = add_job("prefetched", "pending", "workflow")
    add_job("first", "first", "workflow", 3)
    add_job("second", "second", "workflow", 3)
    qm_db.write_query("UPDATE queue SET number = 2 WHERE prompt_id = 'second'")
    ids = [row[0] for row in qm_db.read_query("SELECT id FROM queue WHERE status = 3 ORDER BY number")]
    unmanaged = [5, "unmanaged", {}, {"extra_pnginfo": {"other": "metadata"}}, []]
    filtered_queue.native_queue.queue = [tuple(pending), tuple(unmanaged)]
    assert filtered_queue.selection_action("play", "archive", ids, client_id="client", front=True) == 2
    assert filtered_queue.native_queue.queue == [tuple(unmanaged)]
    rows = qm_db.read_query("SELECT prompt_id, prompt FROM queue WHERE status = 0 ORDER BY number")
    assert [row[0] for row in rows] == ["first", "second", "prefetched"]
    assert all(json.loads(row[1])[3]["client_id"] == "client" for row in rows[:2])
