"""Tests for the FE-executed chat tool catalogue.

The tools in :mod:`app.agents.catalog._chat_tools` carry only schemas;
the bodies must never run server-side. These tests assert each body
raises if invoked, plus pin the BE -> FE arg-shape contract so a
schema rename here can't silently desync from the FE dispatcher.

Additional tests cover:
- The schema-to-tool loop is authoritative: every key in
  ``CHAT_TOOL_SCHEMAS`` has exactly one matching tool in ``CHAT_TOOLS``.
- The ``_make_chat_tool`` generator works correctly on a synthetic schema
  entry, independent of the real schema content.
"""

from __future__ import annotations

import pytest

from app.agents.catalog._chat_tools import CHAT_TOOLS, _make_chat_tool
from app.tools.fe_tool_schemas import CHAT_TOOL_SCHEMAS


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

    The FE dispatcher in ``src/utils/ai/chatTools.ts``
    routes by the wire name; a typo here breaks the round-trip without
    a clear error. The assertions below catch a rename / missing tool.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    expected_names = {name for name, _ in _INVOCATIONS}
    assert set(by_name) == expected_names


def test_chat_tool_arg_shapes_match_fe_dispatcher() -> None:
    """Each tool's top-level arg keys match what the FE dispatcher reads.

    The FE dispatcher in ``src/utils/ai/chatTools.ts``
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

    LangChain's ``StructuredTool`` builds a callable; if a server-side caller
    forgot the FE-executes-tools contract and tried to run one of these
    tools directly, the body raises so the misuse surfaces in tests
    rather than silently returning placeholder data.
    """

    by_name = {tool.name: tool for tool in CHAT_TOOLS}
    for name, args in _INVOCATIONS:
        with pytest.raises(RuntimeError, match=f"{name!r}"):
            by_name[name].invoke(args)


# ---------------------------------------------------------------------------
# Contract test: schema dict is the authoritative loop
# ---------------------------------------------------------------------------


def test_every_schema_key_produces_exactly_one_tool() -> None:
    """Every key in ``CHAT_TOOL_SCHEMAS`` has exactly one tool in ``CHAT_TOOLS``.

    This asserts that the generator loop is complete: if a new entry is
    added to ``CHAT_TOOL_SCHEMAS`` it will produce a stub in ``CHAT_TOOLS``
    automatically, and no stub can exist without a schema entry driving it.
    """
    schema_names = set(CHAT_TOOL_SCHEMAS.keys())
    tool_names = [t.name for t in CHAT_TOOLS]
    tool_name_set = set(tool_names)

    # Every schema key has a corresponding tool
    missing = schema_names - tool_name_set
    assert not missing, f"Schema keys without a tool stub: {missing}"

    # Every tool has a corresponding schema key
    extra = tool_name_set - schema_names
    assert not extra, f"Tool stubs without a schema entry: {extra}"

    # No duplicate tool names
    assert len(tool_names) == len(tool_name_set), (
        f"Duplicate tool names in CHAT_TOOLS: {tool_names}"
    )

    # Counts match exactly
    assert len(CHAT_TOOLS) == len(CHAT_TOOL_SCHEMAS)


# ---------------------------------------------------------------------------
# Generator unit test: _make_chat_tool on a synthetic schema
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_schema_entry() -> dict:  # type: ignore[type-arg]
    """A synthetic schema entry for testing the generator in isolation."""
    return {
        "description": "Fake tool for generator testing.",
        "args": {
            "requiredStr": {
                "type": "string",
                "description": "A required string argument.",
            },
            "optionalInt": {
                "type": "integer",
                "description": "An optional integer argument.",
                "optional": True,
            },
            "filteredObj": {
                "type": "object",
                "description": "Optional filter with known sub-fields.",
                "optional": True,
                "filter_fields": ["alpha", "beta"],
            },
        },
    }


def test_make_chat_tool_produces_correct_name(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """The generated tool carries the name passed to ``_make_chat_tool``."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    assert t.name == "fakeTool"


def test_make_chat_tool_produces_correct_description(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """The generated tool description matches ``spec["description"]``."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    assert t.description == "Fake tool for generator testing."


def test_make_chat_tool_produces_correct_arg_keys(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """The generated tool exposes the arg keys declared in the schema."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    assert set(t.args.keys()) == {"requiredStr", "optionalInt", "filteredObj"}


def test_make_chat_tool_required_arg_has_no_default(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """Args without ``optional: true`` are required (no default in the schema)."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    schema = t.args_schema.model_json_schema()
    required = schema.get("required", [])
    assert "requiredStr" in required, (
        f"Expected 'requiredStr' in required fields, got {required}"
    )


def test_make_chat_tool_optional_arg_has_default(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """Args with ``optional: true`` are optional (have a default in the schema)."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    schema = t.args_schema.model_json_schema()
    required = schema.get("required", [])
    assert "optionalInt" not in required, (
        f"Expected 'optionalInt' to be optional, but found in required: {required}"
    )


def test_make_chat_tool_filter_fields_produce_submodel(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """An object arg with ``filter_fields`` generates a typed nested model.

    The sub-model's properties must exactly match the ``filter_fields`` list
    so the LLM is steered to emit the right field names.
    """
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    filter_arg = t.args["filteredObj"]

    # Resolve $ref or anyOf to the actual sub-schema
    if "$ref" in filter_arg:
        defs = t.args_schema.model_json_schema()["$defs"]
        ref_name = filter_arg["$ref"].rsplit("/", 1)[-1]
        resolved = defs[ref_name]
    elif "anyOf" in filter_arg:
        non_null = next(e for e in filter_arg["anyOf"] if e.get("type") != "null")
        if "$ref" in non_null:
            defs = t.args_schema.model_json_schema()["$defs"]
            ref_name = non_null["$ref"].rsplit("/", 1)[-1]
            resolved = defs[ref_name]
        else:
            resolved = non_null
    else:
        resolved = filter_arg

    actual = set(resolved.get("properties", {}).keys())
    assert actual == {"alpha", "beta"}, f"Unexpected sub-model fields: {actual}"


def test_make_chat_tool_raises_on_server_side_invocation(fake_schema_entry: dict) -> None:  # type: ignore[type-arg]
    """The generated tool body raises ``RuntimeError`` if invoked server-side."""
    t = _make_chat_tool("fakeTool", fake_schema_entry)
    with pytest.raises(RuntimeError, match="'fakeTool'"):
        t.invoke({"requiredStr": "hello"})
