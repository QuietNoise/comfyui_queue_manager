"""Pause requests defer native cleanup until execution finishes without delaying idle cleanup."""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, call

import pytest


@pytest.fixture
def pause_queue(monkeypatch):
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)

    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_pause_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "read_single", Mock(return_value=None))
    monkeypatch.setattr(module, "write_query", Mock())

    flags = {}
    native = SimpleNamespace(mutex=threading.RLock(), queue=[], currently_running={}, task_counter=1)
    native.not_empty = threading.Condition(native.mutex)
    native.get_flags = Mock(side_effect=lambda reset=True: flags.copy())
    native.set_flag = Mock(side_effect=lambda key, value: flags.__setitem__(key, value))
    queue = module.QM_Queue.__new__(module.QM_Queue)
    queue.paused = False
    queue.native_queue = native
    queue.pause_lock = threading.Condition(native.mutex)
    queue.original_get = Mock(return_value=None)
    queue.queue_manager = SimpleNamespace(queue=queue, gallery=Mock(), options=Mock())
    module.PromptServer.instance = SimpleNamespace(send_sync=Mock(), queue_updated=Mock(), prompt_queue=native)
    return queue, module


@pytest.mark.parametrize("enabled", [None, False, True], ids=["default", "disabled", "enabled"])
def test_pause_requests_cleanup_only_when_enabled_and_preserves_running_job(pause_queue, enabled):
    queue, module = pause_queue
    running = object()
    queue.native_queue.currently_running = {7: running}
    queue.native_queue.queue = [object()]
    queue.toggle_playback(**({} if enabled is None else {"clean_caches": enabled}))
    assert queue.paused
    assert queue.native_queue.queue == []
    assert queue.native_queue.currently_running == {7: running}
    assert queue.native_queue.set_flag.call_args_list == ([call("unload_models", True), call("free_memory", True)] if enabled else [])
    queue.queue_manager.options.set.assert_called_once_with("queue_paused", True)
    module.write_query.assert_not_called()


@pytest.mark.parametrize("enabled", [False, True])
def test_resuming_never_requests_cleanup(pause_queue, enabled):
    queue, _ = pause_queue
    queue.paused = True
    queue.toggle_playback(clean_caches=enabled)
    assert not queue.paused
    queue.native_queue.set_flag.assert_not_called()


def test_paused_worker_returns_for_cleanup_without_consuming_flags_or_starting_jobs(pause_queue):
    queue, module = pause_queue
    queue.toggle_playback(clean_caches=True)
    queue.pause_lock.wait = Mock(side_effect=AssertionError("Cleanup must not wait for the pause timeout"))
    assert queue.queue_get(timeout=1000) is None
    queue.native_queue.get_flags.assert_called_once_with(reset=False)
    assert queue.native_queue.get_flags(reset=False) == {"unload_models": True, "free_memory": True}
    queue.original_get.assert_not_called()
    module.read_single.assert_not_called()


def test_pause_wakes_idle_worker_to_handle_cleanup(pause_queue):
    queue, _ = pause_queue
    waiting = threading.Event()
    returned = threading.Event()

    def wait_for_work(timeout):
        with queue.native_queue.not_empty:
            waiting.set()
            queue.native_queue.not_empty.wait(timeout=timeout)
        return None

    queue.original_get.side_effect = wait_for_work

    def worker():
        if queue.queue_get(timeout=1000) is None:
            returned.set()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    try:
        assert waiting.wait(2), "Worker did not enter its idle wait"
        queue.toggle_playback(clean_caches=True)
        assert returned.wait(2), "Pause did not wake the idle worker for cleanup"
        assert queue.paused
        assert queue.native_queue.get_flags(reset=False) == {"unload_models": True, "free_memory": True}
    finally:
        with queue.native_queue.not_empty:
            queue.native_queue.not_empty.notify_all()
        thread.join(2)


def test_paused_worker_still_waits_when_no_cleanup_is_pending(pause_queue):
    queue, _ = pause_queue
    queue.paused = True
    queue.pause_lock.wait = Mock(return_value=False)
    assert queue.queue_get(timeout=10) is None
    queue.pause_lock.wait.assert_called_once_with(timeout=10)
    queue.original_get.assert_not_called()


@pytest.mark.parametrize(
    "saved,query,expected",
    [
        (None, {}, False),
        (True, {}, True),
        (False, {"clean_caches": "true"}, True),
        (True, {"clean_caches": "false"}, False),
        (True, {"clean_caches": "invalid"}, None),
    ],
)
def test_pause_endpoint_uses_live_setting_then_saved_default_and_validates_input(pause_queue, monkeypatch, saved, query, expected):
    queue, module = pause_queue
    server = module.PromptServer.instance
    # Exercise the actual registered handler without requiring ComfyUI's HTTP runtime.
    handlers = {}
    register = lambda path: lambda handler: handlers.setdefault(path, handler)
    server.routes = SimpleNamespace(get=register, post=register, delete=register)
    server.app = SimpleNamespace(middlewares=[])
    aiohttp = ModuleType("aiohttp")
    aiohttp.web = SimpleNamespace(
        middleware=lambda handler: handler,
        json_response=lambda data, status=200: SimpleNamespace(status=status, text=json.dumps(data)),
    )
    monkeypatch.setitem(sys.modules, "aiohttp", aiohttp)
    settings = {} if saved is None else {"QueueManager.Basic.CleanCachesOnPause": saved}
    get_settings = Mock(return_value=settings)
    server.user_manager = SimpleNamespace(settings=SimpleNamespace(get_settings=get_settings))
    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_server.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._pause_server_test", path)
    server_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server_module)
    server_module.QM_Server(queue.queue_manager, "test")
    toggle = handlers["/queue_manager/toggle"]
    request = SimpleNamespace(query=query)
    response = asyncio.run(toggle(request))
    if expected is None:
        assert response.status == 400
        assert not queue.paused
        queue.native_queue.set_flag.assert_not_called()
    else:
        assert response.status == 200
        assert json.loads(response.text) == {"paused": True}
        assert bool(queue.native_queue.set_flag.call_count) == expected
        if query:
            get_settings.assert_not_called()
        else:
            get_settings.assert_called_once_with(request)
