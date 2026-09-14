"""Workflow Name behavior, including parity with the queue-time JavaScript."""

import json
import math
from pathlib import Path

import pytest

from src.comfyui_queue_manager.nodes import WorkflowName


CASES = json.loads(Path(__file__).with_name("workflow_name_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["label"])
def test_workflow_name(case):
    kwargs = {"text": case["text"], "extra_pnginfo": {"workflow": {"workflow_name": case["workflow"]}}}
    assert WorkflowName().run(**kwargs) == (case["expected"],)


def test_old_prompt_without_inputs_or_metadata():
    assert WorkflowName().run() == ("",)
    schema = WorkflowName.INPUT_TYPES()
    assert schema["required"] == {}
    assert schema["optional"]["text"][1]["default"] == ""
    assert set(schema["optional"]) == {"text"}
    assert schema["hidden"]["extra_pnginfo"] == "EXTRA_PNGINFO"
    assert WorkflowName.RETURN_TYPES == ("STRING",)


def test_metadata_changes_do_not_reuse_previous_name():
    assert math.isnan(WorkflowName.IS_CHANGED())
    node = WorkflowName()
    assert node.run(extra_pnginfo={"workflow": {"workflow_name": "first"}}) == ("first",)
    assert node.run(extra_pnginfo={"workflow": {"workflow_name": "second"}}) == ("second",)


def test_execution_uses_current_socket_value_instead_of_queued_name():
    assert WorkflowName().run(text="render:name", extra_pnginfo={"workflow": {"workflow_name": "queued_name"}}) == ("render_name",)
