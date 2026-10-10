"""Queue moves persist atomically and update the job ComfyUI will execute next."""

import asyncio
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


@pytest.fixture
def reorder_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)
    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_reorder_test", path)
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
        queue.native_queue = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={}, task_counter=1)
        queue.native_queue.not_empty = threading.Condition(queue.native_queue.mutex)
        queue.pause_lock = threading.Condition(queue.native_queue.mutex)
        queue.original_get = Mock(side_effect=lambda timeout: (heapq.heappop(queue.native_queue.queue), 1))
        queue.original_put = Mock(side_effect=lambda item: heapq.heappush(queue.native_queue.queue, item))
        module.PromptServer.instance = SimpleNamespace(send_sync=Mock(), queue_updated=Mock(), number=100, prompt_queue=queue.native_queue)
        yield queue, module.PromptServer.instance


def job(number, status=0, name="job", legacy=False):
    prompt_id = f"job-{qm_db.read_single('SELECT COUNT(*) FROM queue')[0]}"
    prompt = [
        number,
        prompt_id,
        {"node": {"inputs": {"text": "keep input"}}},
        {"client_id": "original", "extra_pnginfo": {"workflow": {"id": "workflow", "workflow_name": name}}},
        ["node"],
    ]
    if not legacy:
        prompt.append({"api_key_comfy_org": "test-secret"})
    qm_db.write_query(
        "INSERT INTO queue (prompt_id, number, name, workflow_id, prompt, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (prompt_id, number, name, "workflow", json.dumps(prompt), status, "2000-01-01 00:00:00"),
    )
    return qm_db.read_single("SELECT id FROM queue WHERE prompt_id = ?", (prompt_id,))[0], prompt


def order():
    return [row[0] for row in qm_db.read_query("SELECT id FROM queue WHERE status = 0 ORDER BY number, id")]


def snapshot():
    return [tuple(row) for row in qm_db.read_query("SELECT * FROM queue ORDER BY id")]


def test_single_moves_up_and_down_persist_and_preserve_metadata(reorder_queue):
    queue, server = reorder_queue
    jobs = [job(i) for i in range(5)]
    ids = [item[0] for item in jobs]
    queue.native_queue.queue = [tuple(copy.deepcopy(jobs[0][1]))]
    original = {row["id"]: dict(row) for row in qm_db.read_query("SELECT * FROM queue")}
    queue.reorder_items([ids[4]], ids[0], "before")
    assert order() == [ids[4], *ids[:4]]
    assert queue.native_queue.queue[0][1] == jobs[4][1][1]
    assert queue.native_queue.queue[0][0] == 0
    queue.reorder_items([ids[4]], ids[2], "after")
    assert order() == [*ids[:3], ids[4], ids[3]]
    for row in qm_db.read_query("SELECT * FROM queue"):
        assert {k: v for k, v in dict(row).items() if k != "number"} == {k: v for k, v in original[row["id"]].items() if k != "number"}
    assert server.send_sync.call_count == 2
    _, pending = queue.get_current_queue(page_size=100)
    assert [item[3]["db_id"] for item in pending] == order()


def test_noncontiguous_group_keeps_queue_order_not_selection_order(reorder_queue):
    queue, _ = reorder_queue
    ids = [job(i)[0] for i in range(7)]
    result = queue.reorder_items([ids[4], ids[1], ids[4]], ids[6], "after")
    assert result == {"ids": [ids[1], ids[4]], "changed": True}
    assert order() == [ids[0], ids[2], ids[3], ids[5], ids[6], ids[1], ids[4]]
    queue.reorder_items([ids[4], ids[1]], ids[0], "before")
    assert order() == [ids[1], ids[4], ids[0], ids[2], ids[3], ids[5], ids[6]]


def test_filtered_page_anchor_preserves_unseen_jobs_relative_order(reorder_queue):
    queue, _ = reorder_queue
    ids = [job(i, name="visible" if i % 2 else "hidden")[0] for i in range(10)]
    filters = {"workflow_name": {"type": "workflow_name", "value": "visible"}}
    _, page = queue.get_current_queue(page=1, page_size=2, filters=filters)
    assert [item[3]["db_id"] for item in page] == [ids[5], ids[7]]
    queue.reorder_items([ids[7]], ids[5], "before")
    assert order() == [*ids[:5], ids[7], ids[5], ids[6], ids[8], ids[9]]


@pytest.mark.parametrize("status,native_running", [(1, True), (2, False), (3, False), (0, True)])
def test_ineligible_jobs_are_fixed_and_stale_drop_target_rejected(reorder_queue, status, native_running):
    queue, server = reorder_queue
    first, _ = job(0)
    fixed, prompt = job(1, status=status)
    last, _ = job(2)
    if native_running:
        queue.native_queue.currently_running[9] = tuple(prompt)
    fixed_before = dict(qm_db.read_single("SELECT * FROM queue WHERE id = ?", (fixed,)))
    result = queue.reorder_items([last, fixed, 999], first, "before")
    assert result["ids"] == [last]
    assert dict(qm_db.read_single("SELECT * FROM queue WHERE id = ?", (fixed,))) == fixed_before
    before = snapshot()
    with pytest.raises(RuntimeError, match="drop target"):
        queue.reorder_items([first], fixed, "before")
    assert snapshot() == before
    assert server.send_sync.call_count == 1


def test_all_dragged_jobs_disappeared_is_not_a_move_all(reorder_queue):
    queue, server = reorder_queue
    target, _ = job(0)
    with pytest.raises(RuntimeError, match="no longer pending"):
        queue.reorder_items([999], target, "after")
    assert order() == [target]
    server.send_sync.assert_not_called()


@pytest.mark.parametrize(
    "ids,target,position",
    [
        ([], 2, "before"),
        ([True], 2, "before"),
        ([0], 2, "before"),
        ([1], True, "before"),
        ([1], 1, "before"),
        ([1], 2, "front"),
        (None, 2, "before"),
        ([1] * 201, 2, "before"),
    ],
)
def test_invalid_scope_cannot_change_queue(reorder_queue, ids, target, position):
    queue, server = reorder_queue
    job(0)
    before = snapshot()
    with pytest.raises(ValueError):
        queue.reorder_items(ids, target, position)
    assert snapshot() == before
    server.send_sync.assert_not_called()


def test_atomic_rollback_preserves_native_prefetch_and_database(reorder_queue):
    queue, server = reorder_queue
    jobs = [job(i) for i in range(3)]
    queue.native_queue.queue = [tuple(jobs[0][1])]
    before = snapshot()
    native = copy.deepcopy(queue.native_queue.queue)
    qm_db.get_conn().execute(
        f"CREATE TRIGGER reject_reorder BEFORE UPDATE OF number ON queue WHEN NEW.id = {jobs[0][0]} BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    )
    with pytest.raises(sqlite3.IntegrityError, match="test failure"):
        queue.reorder_items([jobs[2][0]], jobs[0][0], "before")
    assert snapshot() == before
    assert queue.native_queue.queue == native
    server.send_sync.assert_not_called()


def test_native_execution_follows_new_order_and_keeps_unmanaged_jobs(reorder_queue):
    queue, _ = reorder_queue
    first, first_prompt = job(-5)
    second, second_prompt = job(4)
    third, third_prompt = job(9, legacy=True)
    unmanaged = (-20, "unmanaged", {}, {}, [], {"private": "unmanaged-secret"})
    queue.native_queue.queue = [unmanaged, tuple(first_prompt)]
    queue.reorder_items([third], first, "before")
    assert unmanaged in queue.native_queue.queue
    assert queue.original_get(None)[0] == unmanaged
    head = queue.queue_get()[0]
    assert head[1] == third_prompt[1]
    assert head[0] == -5
    assert head[5] == {}
    assert queue.queue_get()[0][1] == first_prompt[1]
    assert queue.queue_get()[0][1] == second_prompt[1]


def test_paused_reorder_restores_persisted_priority_and_client_takeover(reorder_queue):
    queue, _ = reorder_queue
    first, _ = job(5)
    last, prompt = job(8)
    queue.paused = True
    queue.reorder_items([last], first, "before")
    assert queue.native_queue.queue == []
    queue.takeover_client = {"timestamp": "2026-01-01", "client_id": "new-client"}
    queue.paused = False
    item = queue.queue_get()[0]
    assert item[1] == prompt[1]
    assert item[0] == 5
    assert item[3]["client_id"] == "new-client"
    assert item[5] == prompt[5]


def test_submission_prefetch_uses_persisted_priority(reorder_queue):
    queue, _ = reorder_queue
    first, _ = job(1)
    last, prompt = job(2)
    queue.paused = True
    queue.reorder_items([last], first, "before")
    queue.paused = False
    incoming = copy.deepcopy(prompt)
    incoming[0], incoming[1] = 100, "incoming"
    queue.queue_put(incoming)
    assert queue.native_queue.queue[0][1] == prompt[1]
    assert queue.native_queue.queue[0][0] == 1


def test_tied_priorities_are_normalized_and_new_submissions_remain_at_end(reorder_queue):
    queue, server = reorder_queue
    server.number = 0
    ids = [job(0)[0] for _ in range(4)]
    queue.reorder_items([ids[3]], ids[0], "before")
    assert order() == [ids[3], *ids[:3]]
    assert len({row[0] for row in qm_db.read_query("SELECT number FROM queue")}) == 4
    assert server.number >= 3
    tail, _ = job(server.number + 1)
    assert order()[-1] == tail


def test_noop_does_not_touch_heap_timestamps_or_send_updates(reorder_queue):
    queue, server = reorder_queue
    ids = [job(i)[0] for i in range(3)]
    before = snapshot()
    result = queue.reorder_items([ids[1]], ids[0], "after")
    assert result["changed"] is False
    assert snapshot() == before
    server.send_sync.assert_not_called()


def test_unchanged_native_head_retains_runtime_metadata_and_sensitive_values(reorder_queue):
    queue, _ = reorder_queue
    first, prompt = job(0)
    second, _ = job(1)
    third, _ = job(2)
    prompt[3]["runtime_marker"] = "keep this"
    native = tuple(prompt)
    queue.native_queue.queue = [native]
    queue.reorder_items([third], second, "before")
    assert queue.native_queue.queue[0][3] is native[3]
    assert queue.native_queue.queue[0][5] is native[5]
    assert queue.native_queue.queue[0][1] == prompt[1]
    assert order() == [first, third, second]


def archive_ids(queue, **kwargs):
    _, items = queue.get_current_queue(route="archive", page_size=100, **kwargs)
    return [item[3]["db_id"] for item in items]


def test_archive_uses_chronology_until_reordered_then_persists_its_own_order(reorder_queue):
    queue, server = reorder_queue
    pending, prompt = job(-4)
    archived = [job(number, status=3)[0] for number in [50, 10, 20]]
    qm_db.write_query("UPDATE queue SET updated_at = '1999-01-01' WHERE id = ?", (archived[0],))
    assert archive_ids(queue) == archived
    native = [tuple(prompt)]
    queue.native_queue.queue = native
    before = {row["id"]: dict(row) for row in qm_db.read_query("SELECT * FROM queue")}
    assert queue.reorder_items([archived[2]], archived[0], "before", "archive")["changed"]
    expected = [archived[2], archived[0], archived[1]]
    assert archive_ids(queue) == expected
    qm_db.init_schema()  # Startup must retain existing saved positions.
    assert archive_ids(queue) == expected
    assert queue.native_queue.queue is native
    assert order() == [pending]
    assert server.number == 100
    server.queue_updated.assert_not_called()
    for row in qm_db.read_query("SELECT * FROM queue"):
        assert {k: v for k, v in dict(row).items() if k != "archive_order"} == {
            k: v for k, v in before[row["id"]].items() if k != "archive_order"
        }
    queue.rename_item(archived[0], "renamed")
    assert archive_ids(queue) == expected
    queue.reorder_items([archived[2], archived[0]], archived[1], "after", "archive")
    assert archive_ids(queue) == [archived[1], archived[2], archived[0]]


def test_archive_filtered_group_move_preserves_hidden_items(reorder_queue):
    queue, _ = reorder_queue
    archived = [job(i, status=3, name="visible" if i % 2 else "hidden")[0] for i in range(8)]
    filters = {"workflow_name": {"type": "workflow_name", "value": "visible"}}
    assert archive_ids(queue, filters=filters) == [archived[i] for i in [1, 3, 5, 7]]
    queue.reorder_items([archived[7], archived[3]], archived[1], "before", "archive")
    assert archive_ids(queue) == [archived[0], archived[3], archived[7], archived[1], archived[2], archived[4], archived[5], archived[6]]
    _, page, info = queue.get_current_queue(route="archive", filters=filters, page=1, page_size=2, return_meta=True)
    assert [item[3]["db_id"] for item in page] == [archived[1], archived[5]]
    assert info["total"] == 4


@pytest.mark.parametrize("status,native_running", [(0, False), (1, True), (2, False), (3, True)])
def test_archive_reorder_cannot_move_jobs_from_other_tabs_or_running_jobs(reorder_queue, status, native_running):
    queue, _ = reorder_queue
    first, _ = job(1, status=3)
    fixed, prompt = job(2, status=status)
    last, _ = job(3, status=3)
    if native_running:
        queue.native_queue.currently_running[3] = tuple(prompt)
    before = dict(qm_db.read_single("SELECT * FROM queue WHERE id = ?", (fixed,)))
    assert queue.reorder_items([last, fixed, 999], first, "before", "archive")["ids"] == [last]
    assert dict(qm_db.read_single("SELECT * FROM queue WHERE id = ?", (fixed,))) == before
    with pytest.raises(RuntimeError, match="no longer archived"):
        queue.reorder_items([first], fixed, "before", "archive")


@pytest.mark.parametrize("route", ["completed", "unknown", None, []])
def test_reorder_rejects_unsupported_tabs(reorder_queue, route):
    queue, _ = reorder_queue
    first, _ = job(0)
    second, _ = job(1)
    before = snapshot()
    with pytest.raises(ValueError, match="only available"):
        queue.reorder_items([second], first, "before", route)
    assert snapshot() == before


def test_archive_reorder_rollback_preserves_all_positions_and_timestamps(reorder_queue):
    queue, server = reorder_queue
    archived = [job(i, status=3)[0] for i in range(3)]
    before = snapshot()
    qm_db.get_conn().execute(
        f"CREATE TRIGGER reject_archive_order BEFORE UPDATE OF archive_order ON queue WHEN NEW.id = {archived[0]} BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    )
    with pytest.raises(sqlite3.IntegrityError, match="test failure"):
        queue.reorder_items([archived[2]], archived[0], "before", "archive")
    assert snapshot() == before
    server.send_sync.assert_not_called()


def test_newly_archived_and_rearchived_jobs_join_the_end(reorder_queue):
    queue, _ = reorder_queue
    archived = [job(i, status=3)[0] for i in range(3)]
    queue.reorder_items([archived[2]], archived[0], "before", "archive")
    newcomer, _ = job(-10, status=3)
    assert archive_ids(queue) == [archived[2], archived[0], archived[1], newcomer]
    queue.play_items([archived[2]], front=False)
    assert qm_db.read_single("SELECT archive_order FROM queue WHERE id = ?", (archived[2],))[0] is None
    queue.archive_items([archived[2]])
    assert archive_ids(queue) == [archived[0], archived[1], newcomer, archived[2]]


@pytest.mark.parametrize("front", [False, True])
@pytest.mark.parametrize("selected", [False, True])
def test_run_all_and_selected_follow_archive_order_at_front_or_back(reorder_queue, front, selected):
    queue, _ = reorder_queue
    pending, pending_prompt = job(0)
    queue.native_queue.queue = [tuple(pending_prompt)]
    archived = [job(i, status=3)[0] for i in range(1, 5)]
    queue.reorder_items([archived[3]], archived[0], "before", "archive")
    newcomer, _ = job(-10, status=3)
    if selected:
        chosen = [archived[3], archived[1], newcomer]
        assert queue.selection_action("play", "archive", list(reversed(chosen)), front=front) == len(chosen)
    else:
        chosen = [archived[3], archived[0], archived[1], archived[2], newcomer]
        assert queue.play_archive(front=front) == len(chosen)
    expected = [*chosen, pending] if front else [pending, *chosen]
    assert order() == expected
    actual = []
    for _ in expected:
        item = queue.queue_get()[0]
        actual.append(qm_db.read_single("SELECT id FROM queue WHERE prompt_id = ?", (item[1],))[0])
    assert actual == expected
    assert all(row[0] is None for row in qm_db.read_query("SELECT archive_order FROM queue WHERE status != 3"))


def test_archive_schema_upgrade_preserves_existing_rows(monkeypatch):
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        monkeypatch.setattr(qm_db, "get_conn", lambda: conn)
        conn.executescript("""
            CREATE TABLE queue (id INTEGER PRIMARY KEY, prompt_id TEXT UNIQUE, created_at TEXT,
                updated_at TEXT, number INTEGER, name TEXT, workflow_id TEXT, prompt TEXT, status INTEGER DEFAULT 0);
            INSERT INTO queue VALUES (1, 'old-job', '1998-01-01', '1999-01-01', 12, 'keep name', 'workflow', '[]', 3);
        """)
        before = dict(conn.execute("SELECT * FROM queue").fetchone())
        qm_db.init_schema()
        qm_db.init_schema()
        after = dict(conn.execute("SELECT * FROM queue").fetchone())
        assert after.pop("archive_order") is None
        assert after == before


@pytest.mark.parametrize("route,status", [("queue", 0), ("archive", 3)])
@pytest.mark.parametrize("destination", ["start", "end"])
def test_boundary_moves_use_full_tab_not_visible_filtered_page(reorder_queue, route, status, destination):
    queue, _ = reorder_queue
    ids = [job(i, status=status, name="visible" if i % 2 else "hidden")[0] for i in range(10)]
    filters = {"workflow_name": {"type": "workflow_name", "value": "visible"}}
    _, page = queue.get_current_queue(route=route, filters=filters, page=1, page_size=2)
    assert [item[3]["db_id"] for item in page] == [ids[5], ids[7]]
    selected = [ids[5], ids[7]]
    # A job submitted after the page fetch also counts towards the current boundary.
    newer, _ = job(20, status=status)
    remaining = [item for item in ids if item not in selected] + [newer]
    result = queue.reorder_items(list(reversed(selected)), route=route, destination=destination)
    assert result == {"ids": selected, "changed": True}
    expected = selected + remaining if destination == "start" else remaining + selected
    assert (archive_ids(queue) if route == "archive" else order()) == expected
    if route == "queue":
        first = queue.queue_get()[0]
        assert qm_db.read_single("SELECT id FROM queue WHERE prompt_id = ?", (first[1],))[0] == expected[0]


@pytest.mark.parametrize("route,status", [("queue", 0), ("archive", 3)])
def test_boundary_moves_respect_existing_manual_order_and_skip_ineligible_jobs(reorder_queue, route, status):
    queue, _ = reorder_queue
    ids = [job(i, status=status)[0] for i in range(5)]
    foreign, _ = job(10, status=3 if status == 0 else 0)
    running, prompt = job(11, status=status)
    queue.native_queue.currently_running[8] = tuple(prompt)
    fixed_before = [dict(row) for row in qm_db.read_query("SELECT * FROM queue WHERE id IN (?, ?)", (foreign, running))]
    queue.reorder_items([ids[4]], ids[0], "before", route)
    result = queue.reorder_items([ids[1], ids[4], foreign, running, 999], route=route, destination="end")
    assert result["ids"] == [ids[4], ids[1]]
    actual = archive_ids(queue) if route == "archive" else order()
    assert [item for item in actual if item != running] == [ids[0], ids[2], ids[3], ids[4], ids[1]]
    assert [dict(row) for row in qm_db.read_query("SELECT * FROM queue WHERE id IN (?, ?)", (foreign, running))] == fixed_before


@pytest.mark.parametrize("route,status", [("queue", 0), ("archive", 3)])
@pytest.mark.parametrize("destination", ["start", "end"])
def test_boundary_noop_for_entire_tab_does_not_write(reorder_queue, route, status, destination):
    queue, server = reorder_queue
    ids = [job(i, status=status)[0] for i in range(3)]
    before = snapshot()
    assert queue.reorder_items(list(reversed(ids)), route=route, destination=destination) == {"ids": ids, "changed": False}
    assert snapshot() == before
    server.send_sync.assert_not_called()


@pytest.mark.parametrize(
    "move_args",
    [
        {"ids": [], "destination": "start"},
        {"ids": [True], "destination": "end"},
        {"ids": [1], "destination": "page_top"},
        {"ids": [1], "destination": []},
        {"ids": [1], "destination": "start", "target_id": 2},
        {"ids": [1], "destination": "end", "position": "after"},
    ],
)
def test_invalid_boundary_request_cannot_broaden_selection(reorder_queue, move_args):
    queue, server = reorder_queue
    job(0)
    job(1)
    before = snapshot()
    with pytest.raises(ValueError):
        queue.reorder_items(**move_args)
    assert snapshot() == before
    server.send_sync.assert_not_called()


def test_vanished_boundary_selection_is_not_a_move_all(reorder_queue):
    queue, server = reorder_queue
    job(0)
    before = snapshot()
    with pytest.raises(RuntimeError, match="no longer pending"):
        queue.reorder_items([999], destination="start")
    assert snapshot() == before
    server.send_sync.assert_not_called()


@pytest.mark.parametrize("front", [False, True])
@pytest.mark.parametrize("existing", ["empty", "chronological", "reordered"])
@pytest.mark.parametrize("action", ["items", "selected", "all"])
def test_archive_actions_preserve_group_order_and_existing_archive(reorder_queue, front, existing, action):
    queue, _ = reorder_queue
    archived = [] if existing == "empty" else [job(i, status=3)[0] for i in range(3)]
    if existing == "reordered":
        queue.reorder_items([archived[2]], archived[0], "before", "archive")
        archived = [archived[2], archived[0], archived[1], job(-20, status=3)[0]]
    jobs = [job(i, name="move") for i in [7, 2, 5]]
    moving = [jobs[i][0] for i in [1, 2, 0]]
    untouched, untouched_prompt = job(3, name="keep")
    running, running_prompt = job(0, status=1, name="move")
    completed, _ = job(1, status=2, name="move")
    queue.native_queue.currently_running[1] = tuple(running_prompt)
    unmanaged = (100, "unmanaged-native", {}, {}, [])
    queue.native_queue.queue = [tuple(jobs[0][1]), tuple(untouched_prompt), unmanaged]
    before = {row["id"]: dict(row) for row in qm_db.read_query("SELECT * FROM queue")}
    requested = [jobs[0][0], jobs[2][0], jobs[1][0], jobs[0][0], running, completed, *archived, 9999]
    if action == "items":
        result = queue.archive_items(requested, front=front)
    elif action == "selected":
        result = queue.selection_action("archive", "queue", requested, front=front)
    else:
        filters = {"workflow_name": {"type": "workflow_name", "value": "move"}}
        result = queue.archive_queue(filters, front=front)
    assert result == 3
    expected = moving + archived if front else archived + moving
    assert archive_ids(queue) == expected
    assert {item[1] for item in queue.native_queue.queue} == {untouched_prompt[1], unmanaged[1]}
    assert queue.native_queue.currently_running[1] == tuple(running_prompt)
    for row in qm_db.read_query("SELECT * FROM queue"):
        if row["id"] not in moving:
            assert dict(row) == before[row["id"]]
        else:
            assert row["status"] == 3
            assert {k: v for k, v in dict(row).items() if k not in {"status", "updated_at", "archive_order"}} == {
                k: v for k, v in before[row["id"]].items() if k not in {"status", "updated_at", "archive_order"}
            }
    qm_db.init_schema()
    assert archive_ids(queue) == expected
    assert order() == [untouched]


def test_repeated_front_archives_and_rearchiving_use_current_positions(reorder_queue):
    queue, _ = reorder_queue
    old, _ = job(20, status=3)
    first, _ = job(4)
    second, _ = job(5)
    queue.archive_items([first], front=True)
    queue.archive_items([second], front=True)
    assert archive_ids(queue) == [second, first, old]
    queue.play_items([first], front=False)
    queue.archive_items([first], front=True)
    assert archive_ids(queue) == [first, second, old]
    queue.play_items([first], front=False)
    queue.archive_items([first])
    assert archive_ids(queue) == [second, old, first]


def test_front_archive_rollback_preserves_status_positions_and_native_queue(reorder_queue):
    queue, server = reorder_queue
    job(0, status=3)
    jobs = [job(i) for i in [1, 2]]
    native = [tuple(jobs[0][1])]
    queue.native_queue.queue = native
    before = snapshot()
    qm_db.get_conn().execute(
        f"CREATE TRIGGER reject_front_archive BEFORE UPDATE OF archive_order ON queue WHEN NEW.id = {jobs[1][0]} AND NEW.archive_order IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    )
    with pytest.raises(sqlite3.IntegrityError, match="test failure"):
        queue.archive_queue(front=True)
    assert snapshot() == before
    assert queue.native_queue.queue is native
    server.send_sync.assert_not_called()
    server.queue_updated.assert_not_called()


@pytest.mark.parametrize("items", [None, [], "1", [True], [0], [9999]])
def test_invalid_or_stale_archive_ids_cannot_archive_all(reorder_queue, items):
    queue, server = reorder_queue
    job(0)
    before = snapshot()
    assert queue.archive_items(items, front=True) == 0
    assert snapshot() == before
    server.send_sync.assert_not_called()


@pytest.mark.parametrize("action", ["items", "selected", "all"])
@pytest.mark.parametrize("front", [None, False, True])
def test_archive_http_handlers_apply_front_and_default_order(reorder_queue, monkeypatch, action, front):
    queue, server = reorder_queue
    handlers = {}
    register = lambda path: lambda handler: handlers.setdefault(path, handler)
    server.routes = SimpleNamespace(get=register, post=register, delete=register)
    server.app = SimpleNamespace(middlewares=[])
    server.user_manager = SimpleNamespace()
    aiohttp = ModuleType("aiohttp")
    aiohttp.web = SimpleNamespace(
        middleware=lambda handler: handler,
        json_response=lambda data, status=200: SimpleNamespace(status=status, text=json.dumps(data)),
    )
    monkeypatch.setitem(sys.modules, "aiohttp", aiohttp)
    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_server.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._archive_server_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.QM_Server(SimpleNamespace(queue=queue, gallery=None), "test")
    archived, _ = job(0, status=3)
    pending, _ = job(1, name="move")
    untouched, _ = job(2, name="keep")
    body = {"archive": [pending]} if action == "items" else {"action": "archive", "route": "queue", "ids": [pending]}
    query = {"filters": json.dumps({"workflow_name": {"value": "move"}})}
    if front is not None:
        body["front"] = front
        query["front"] = str(front).lower()

    async def request_json():
        return body

    request = SimpleNamespace(query=query, json=request_json)
    endpoint = {"items": "archive", "selected": "selection", "all": "archive-queue"}[action]
    response = asyncio.run(handlers[f"/queue_manager/{endpoint}"](request))
    assert response.status == 200
    assert archive_ids(queue) == ([pending, archived] if front else [archived, pending])
    assert order() == [untouched]
