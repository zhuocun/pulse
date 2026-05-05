"""Tests for the FE-executed chat tool catalogue.

The tools in :mod:`app.agents.catalog._chat_tools` carry only schemas;
the bodies must never run server-side. These tests assert each body
raises if invoked, plus pin the BE -> FE arg-shape contract so a
schema rename here can't silently desync from the FE dispatcher.
"""

from __future__ import annotations

import pytest

from app.agents.catalog._chat_tools import CHAT_TOOLS


_INVOCATIONS: tuple[tuple[str, dict[str, object]], ...] = (
    ("listProjects", {}),
    ("listMembers", {}),
    ("getProject", {"projectId": "p-1"}),
    ("listBoard", {"projectId": "p-1"}),
    ("listTasks", {"projectId": "p-1"}),
    ("getTask", {"taskId": "t-1"}),
)


def test_chat_tools_are_complete_and_named_for_the_fe_wire() -> None:
    """All six tools are registered and the names match ``chatTools.ts``.

    The FE dispatcher in ``jira-react-app/src/utils/ai/chatTools.ts``
    routes by the wire name; a typo here breaks the round-trip without
    a clear error. The assertions below catch a rename / missing tool.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    expected_names = {name for name, _ in _INVOCATIONS}
    assert set(by_name) == expected_names


def test_chat_tool_arg_shapes_match_fe_dispatcher() -> None:
    """Each tool's top-level arg keys match what the FE dispatcher reads.

    The FE dispatcher in ``jira-react-app/src/utils/ai/chatTools.ts``
    pulls fields from ``call.arguments`` by name (e.g. ``args.filter``,
    ``args.projectId``). If the BE schema declares a flat
    ``{taskName, type, ...}`` while the FE reads ``args.filter.taskName``,
    every model-emitted filter is silently dropped at the dispatcher --
    user-visible failure mode is "the AI ignores my filter request".
    Pinning the contract here catches the regression at unit-test time.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    expected: dict[str, set[str]] = {
        "listProjects": {"filter"},
        "listMembers": set(),
        "getProject": {"projectId"},
        "listBoard": {"projectId"},
        "listTasks": {"projectId", "filter"},
        "getTask": {"taskId"},
    }
    for name, expected_keys in expected.items():
        actual_keys = set(by_name[name].args.keys())
        assert actual_keys == expected_keys, (
            f"{name}: expected top-level args {expected_keys}, "
            f"got {actual_keys}"
        )


def test_list_tasks_filter_subschema_matches_fe_known_fields() -> None:
    """The ``listTasks.filter`` sub-schema mirrors the FE dispatcher's
    pass-through fields exactly.

    ``chatTools.ts`` only forwards ``taskName``, ``type``,
    ``coordinatorId``, and ``columnId``; any other field on
    ``args.filter`` is dropped on the client. Steering the LLM toward
    these exact names keeps the round-trip actionable.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    list_tasks = by_name["listTasks"]
    filter_schema = list_tasks.args["filter"]
    # The bound schema for an Optional[Pydantic] arg is a $ref into
    # ``$defs``; resolve once so the assertion is shape-stable.
    if "$ref" in filter_schema:
        defs = list_tasks.args_schema.model_json_schema()["$defs"]
        ref_name = filter_schema["$ref"].rsplit("/", 1)[-1]
        filter_schema = defs[ref_name]
    elif "anyOf" in filter_schema:
        # Older Pydantic emits Optional[X] as anyOf[X, null]; pick X.
        non_null = next(
            entry
            for entry in filter_schema["anyOf"]
            if entry.get("type") != "null"
        )
        if "$ref" in non_null:
            defs = list_tasks.args_schema.model_json_schema()["$defs"]
            ref_name = non_null["$ref"].rsplit("/", 1)[-1]
            filter_schema = defs[ref_name]
        else:
            filter_schema = non_null
    actual_fields = set(filter_schema.get("properties", {}).keys())
    assert actual_fields == {"taskName", "type", "coordinatorId", "columnId"}


def test_chat_tools_never_execute_server_side() -> None:
    """Each declare-only tool raises if invoked by mistake.

    LangChain's ``@tool`` builds a callable; if a server-side caller
    forgot the FE-executes-tools contract and tried to run one of these
    tools directly, the body raises so the misuse surfaces in tests
    rather than silently returning placeholder data.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    for name, args in _INVOCATIONS:
        with pytest.raises(RuntimeError, match=f"{name!r}"):
            by_name[name].invoke(args)
