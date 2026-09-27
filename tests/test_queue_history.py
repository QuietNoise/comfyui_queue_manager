"""Forward native completion arguments, including cleanup after cancellation."""

import importlib.util
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def queue_module(monkeypatch):
    # Import the extension without starting ComfyUI or loading its GPU dependencies.
    for name, attributes in {
        "execution": {"PromptQueue": type("PromptQueue", (), {})},
        "server": {"PromptServer": type("PromptServer", (), {})},
        "folder_paths": {},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)

    path = Path(__file__).parents[1] / "src/comfyui_queue_manager/qm_queue.py"
    spec = importlib.util.spec_from_file_location("src.comfyui_queue_manager._queue_history_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Database persistence is separate from the native completion contract.
    monkeypatch.setattr(module, "write_query", Mock())
    return module


@pytest.mark.parametrize("record_exists", [False, True], ids=["cancelled-and-deleted", "retained"])
@pytest.mark.parametrize("with_cleanup", [True, False], ids=["sensitive-prompt", "legacy-prompt"])
def test_task_done_forwards_native_completion(queue_module, monkeypatch, record_exists, with_cleanup):
    prompt_id = "cancelled-prompt"
    public_prompt = (1, prompt_id, {"node": {}}, {"client_id": "client"}, ["node"])
    prompt = public_prompt + ({"api_key_comfy_org": "test-secret"},) if with_cleanup else public_prompt
    native = SimpleNamespace(mutex=threading.RLock(), currently_running={7: prompt})
    monkeypatch.setattr(queue_module, "read_single", Mock(return_value=(1,) if record_exists else None))

    queue = queue_module.QM_Queue.__new__(queue_module.QM_Queue)
    queue.native_queue = native
    queue.original_task_done = Mock()
    cleanup = Mock(name="comfyui_history_cleanup") if with_cleanup else None
    status = ("error", False, [("execution_interrupted", {"prompt_id": prompt_id})])
    result = {"outputs": {}}

    queue.task_done(7, result, status, process_item=cleanup)

    if with_cleanup:
        queue.original_task_done.assert_called_once_with(7, result, status, cleanup)
    else:
        queue.original_task_done.assert_called_once_with(7, result, status)
