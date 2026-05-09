"""Golden SSE transcript snapshot tests (Task 2).

For each of the six catalog agents, drives the existing runtime with the
deterministic stub model and captures the sequence of ``(kind, surface)``
tuples emitted as SSE events.  Also snapshots the **top-level payload keys**
(not the prose content — that would be flaky once a real LLM lands).

Design
------
* Uses ``AgentRuntime.arun_with_events`` — the same path the routers use.
* Agents with FE interrupts (board-brief, triage, task-drafting,
  task-estimation, search) skip the interrupt by pre-populating the
  relevant state keys (``board_snapshot``, ``similar_tasks``, ``candidates``).
  This mirrors the v1 shim path and is valid per the short-circuit guards in
  ``app.agents.catalog._shared``.
* The chat agent needs no interrupt resolution.
* Assertions target ``(kind, surface)`` ordering and top-level payload key
  sets — not prose text — so the tests stay green once a real model lands.

The assertion "wire shape unchanged" means: if a future schema bump
removes ``recommendationDetail`` from the brief payload or renames
``storyPoints``, these tests fail loudly.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langchain_core.messages import HumanMessage

from app.agents.catalog.board_brief import BoardBriefAgent
from app.agents.catalog.chat import ChatAgent
from app.agents.catalog.search import SearchAgent
from app.agents.catalog.task_drafting import TaskDraftingAgent
from app.agents.catalog.task_estimation import TaskEstimationAgent
from app.agents.catalog.triage import TriageAgent
from app.agents.registry import AgentRegistry
from app.agents.runtime import AgentRuntime


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_runtime(agent_instance: Any) -> AgentRuntime:
    """Build an isolated AgentRuntime with InMemory persistence for one agent."""
    registry = AgentRegistry()
    registry.register(agent_instance)
    return AgentRuntime(
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        registry=registry,
    )


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

# Minimal board snapshot (id-keyed, as FE sends it).
_BOARD_SNAPSHOT = {
    "project_id": "p-transcript",
    "columns": [
        {"id": "c-todo", "name": "To Do"},
        {"id": "c-doing", "name": "In Progress"},
        {"id": "c-done", "name": "Done", "isDone": True},
    ],
    "tasks": [
        {
            "id": "t-1",
            "taskName": "Fix login bug",
            "note": "Auth breaks on Safari",
            "type": "bug",
            "epic": "Bug Fix",
            "storyPoints": 3,
            "columnId": "c-todo",
        },
        {
            "id": "t-2",
            "taskName": "Onboarding tour",
            "note": "Build guided UI",
            "type": "feature",
            "epic": "UI Polish",
            "storyPoints": 5,
            "columnId": "c-doing",
            "coordinatorId": "m-1",
        },
    ],
    "members": [{"id": "m-1", "username": "alice"}],
}

_SIMILAR_TASKS = [
    {"id": "t-1", "text": "Fix login bug on Safari"},
    {"id": "t-2", "text": "Build guided UI onboarding"},
]

_SEARCH_CANDIDATES = [
    {"id": "t-1", "text": "Fix login bug on Safari"},
    {"id": "t-2", "text": "Build guided UI onboarding"},
]


# ---------------------------------------------------------------------------
# Helper: extract (kind, surface) tuples and payload key-sets from events
# ---------------------------------------------------------------------------


def _event_shapes(events: list[Any]) -> list[tuple[str, str | None, frozenset[str]]]:
    """Return ``[(kind, surface_or_None, frozenset_of_top_level_payload_keys)]``."""
    shapes = []
    for evt in events:
        if not isinstance(evt, dict):
            continue
        kind = evt.get("kind", "")
        surface = evt.get("surface") if kind == "suggestion" else None
        payload = evt.get("payload") if kind == "suggestion" else None
        keys: frozenset[str] = (
            frozenset(payload.keys()) if isinstance(payload, dict) else frozenset()
        )
        shapes.append((kind, surface, keys))
    return shapes


# ---------------------------------------------------------------------------
# Parameterised transcript tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent_name, inputs, expected_kinds_surfaces",
    [
        # board-brief: interrupt skipped by pre-populating board_snapshot
        pytest.param(
            "board-brief-agent",
            {"project_id": "p-transcript", "board_snapshot": _BOARD_SNAPSHOT},
            [("citation", None), ("suggestion", "brief")],
            id="board-brief",
        ),
        # triage: interrupt skipped by pre-populating board_snapshot
        pytest.param(
            "triage-agent",
            {"project_id": "p-transcript", "board_snapshot": _BOARD_SNAPSHOT},
            # nudge events — one per drift signal; a board with one unowned bug
            # produces at least one nudge. We check "at least one nudge" below.
            None,  # checked manually in the test body
            id="triage",
        ),
        # task-drafting: interrupt skipped by pre-populating board_snapshot + similar_tasks
        pytest.param(
            "task-drafting-agent",
            {
                "project_id": "p-transcript",
                "prompt": "fix SSO login",
                "board_snapshot": _BOARD_SNAPSHOT,
                "similar_tasks": _SIMILAR_TASKS,
            },
            [("suggestion", "draft")],
            id="task-drafting",
        ),
        # task-estimation: interrupt skipped by pre-populating similar_tasks
        pytest.param(
            "task-estimation-agent",
            {
                "project_id": "p-transcript",
                "task_draft": {
                    "taskName": "Fix login bug",
                    "note": "Auth breaks on Safari",
                    "coordinatorId": "m-1",
                },
                "similar_tasks": _SIMILAR_TASKS,
            },
            # citation (if similar tasks exist) + estimate suggestion
            None,  # checked manually (citation is conditional on refs)
            id="task-estimation",
        ),
        # chat: no interrupt needed
        pytest.param(
            "chat-agent",
            {
                "project_id": "p-transcript",
                "messages": [HumanMessage(content="hello board")],
            },
            [],  # chat emits no suggestion/citation events
            id="chat",
        ),
        # search: interrupt skipped by pre-populating candidates
        pytest.param(
            "search-agent",
            {
                "project_id": "p-transcript",
                "query": "login bug",
                "kind": "tasks",
                "candidates": _SEARCH_CANDIDATES,
            },
            [("suggestion", "search")],
            id="search",
        ),
    ],
)
def test_sse_transcript_kinds_and_surfaces(
    agent_name: str,
    inputs: dict[str, Any],
    expected_kinds_surfaces: list[tuple[str, str | None]] | None,
) -> None:
    """Golden SSE transcript: wire shape (kind + surface) is unchanged."""
    agent_map = {
        "board-brief-agent": BoardBriefAgent,
        "triage-agent": TriageAgent,
        "task-drafting-agent": TaskDraftingAgent,
        "task-estimation-agent": TaskEstimationAgent,
        "chat-agent": ChatAgent,
        "search-agent": SearchAgent,
    }
    agent_cls = agent_map[agent_name]
    runtime = _make_runtime(agent_cls())

    _final_state, events = _run(
        runtime.arun_with_events(agent_name, inputs)
    )

    # Extract (kind, surface) pairs (ignoring payload keys for the ordering check).
    actual_ks = [(e[0], e[1]) for e in _event_shapes(events)]

    if agent_name == "triage-agent":
        # Triage emits one nudge per drift signal; the board has one unowned
        # bug so we expect at least one nudge event.
        nudge_events = [(k, s) for k, s in actual_ks if k == "suggestion" and s == "nudge"]
        assert nudge_events, (
            "triage-agent must emit at least one nudge suggestion event; "
            f"got: {actual_ks}"
        )

    elif agent_name == "task-estimation-agent":
        # estimate surface must appear (with or without a preceding citation).
        suggestion_surfaces = {s for k, s in actual_ks if k == "suggestion"}
        assert "estimate" in suggestion_surfaces, (
            "task-estimation-agent must emit a suggestion with surface='estimate'; "
            f"got: {actual_ks}"
        )
        # Also check v1 shim surfaces are emitted.
        assert "estimate_v1" in suggestion_surfaces
        assert "readiness_v1" in suggestion_surfaces

    else:
        assert actual_ks == expected_kinds_surfaces, (
            f"SSE event (kind, surface) sequence mismatch for {agent_name}.\n"
            f"Expected: {expected_kinds_surfaces}\n"
            f"Got:      {actual_ks}"
        )


@pytest.mark.parametrize(
    "agent_name, inputs, surface, expected_payload_keys",
    [
        # board-brief: payload must contain all IBoardBriefPayload top-level keys
        pytest.param(
            "board-brief-agent",
            {"project_id": "p-transcript", "board_snapshot": _BOARD_SNAPSHOT},
            "brief",
            frozenset({
                "headline",
                "counts",
                "largestUnstarted",
                "unowned",
                "workload",
                "recommendation",
                "recommendationDetail",
            }),
            id="board-brief-payload-keys",
        ),
        # task-drafting: payload must contain all ITaskDraftPayload top-level keys
        pytest.param(
            "task-drafting-agent",
            {
                "project_id": "p-transcript",
                "prompt": "fix SSO login",
                "board_snapshot": _BOARD_SNAPSHOT,
                "similar_tasks": _SIMILAR_TASKS,
            },
            "draft",
            frozenset({
                "taskName",
                "type",
                "epic",
                "storyPoints",
                "note",
                "columnId",
                "coordinatorId",
                "confidence",
                "rationale",
            }),
            id="task-drafting-payload-keys",
        ),
        # search: payload must contain ISearchPayload top-level keys
        pytest.param(
            "search-agent",
            {
                "project_id": "p-transcript",
                "query": "login bug",
                "kind": "tasks",
                "candidates": _SEARCH_CANDIDATES,
            },
            "search",
            frozenset({"ids", "rationale", "matches"}),
            id="search-payload-keys",
        ),
        # nudge: payload must contain INudgePayload top-level keys
        pytest.param(
            "triage-agent",
            {"project_id": "p-transcript", "board_snapshot": _BOARD_SNAPSHOT},
            "nudge",
            frozenset({
                "nudge_id",
                "kind",
                "project_id",
                "summary",
                "target_ids",
                "severity",
            }),
            id="nudge-payload-keys",
        ),
    ],
)
def test_sse_transcript_payload_keys(
    agent_name: str,
    inputs: dict[str, Any],
    surface: str,
    expected_payload_keys: frozenset[str],
) -> None:
    """Golden SSE transcript: top-level payload key set is unchanged.

    Asserts that the payload emitted for ``surface`` contains **at least**
    the expected top-level keys.  Extra keys are tolerated (forward-compat),
    but missing keys fail loudly so a schema refactor is immediately visible.
    """
    agent_map = {
        "board-brief-agent": BoardBriefAgent,
        "triage-agent": TriageAgent,
        "task-drafting-agent": TaskDraftingAgent,
        "task-estimation-agent": TaskEstimationAgent,
        "chat-agent": ChatAgent,
        "search-agent": SearchAgent,
    }
    agent_cls = agent_map[agent_name]
    runtime = _make_runtime(agent_cls())

    _final_state, events = _run(
        runtime.arun_with_events(agent_name, inputs)
    )

    shapes = _event_shapes(events)
    matching = [keys for (kind, srf, keys) in shapes if kind == "suggestion" and srf == surface]
    assert matching, (
        f"No suggestion event with surface={surface!r} found for {agent_name}. "
        f"Events: {[(k, s) for k, s, _ in shapes]}"
    )
    # Use the first matching event.
    actual_keys = matching[0]
    missing = expected_payload_keys - actual_keys
    assert not missing, (
        f"Payload for {agent_name}/{surface} is missing expected keys: {sorted(missing)}. "
        f"Got: {sorted(actual_keys)}"
    )


@pytest.mark.parametrize(
    "agent_name, inputs",
    [
        pytest.param(
            "board-brief-agent",
            {"project_id": "p-transcript", "board_snapshot": _BOARD_SNAPSHOT},
            id="board-brief-no-mutation",
        ),
        pytest.param(
            "task-drafting-agent",
            {
                "project_id": "p-transcript",
                "prompt": "fix SSO login",
                "board_snapshot": _BOARD_SNAPSHOT,
                "similar_tasks": _SIMILAR_TASKS,
            },
            id="task-drafting-no-mutation",
        ),
        pytest.param(
            "search-agent",
            {
                "project_id": "p-transcript",
                "query": "login bug",
                "kind": "tasks",
                "candidates": _SEARCH_CANDIDATES,
            },
            id="search-no-mutation",
        ),
    ],
)
def test_sse_transcript_payload_not_mutated(
    agent_name: str,
    inputs: dict[str, Any],
) -> None:
    """Validation must not mutate any event payload dict."""
    agent_map = {
        "board-brief-agent": BoardBriefAgent,
        "task-drafting-agent": TaskDraftingAgent,
        "search-agent": SearchAgent,
    }
    agent_cls = agent_map[agent_name]
    runtime = _make_runtime(agent_cls())

    _final_state, events = _run(
        runtime.arun_with_events(agent_name, inputs)
    )

    for evt in events:
        if isinstance(evt, dict) and evt.get("kind") == "suggestion":
            payload = evt.get("payload")
            if isinstance(payload, dict):
                # Snapshot keys before and after — keys must be identical.
                keys_before = set(payload.keys())
                # Re-run validation to confirm idempotency.
                from app.agents.events import validate_suggestion_payload
                validate_suggestion_payload(evt, agent=agent_name)
                keys_after = set(payload.keys())
                assert keys_before == keys_after, (
                    f"Validation mutated payload keys for {agent_name}: "
                    f"{keys_before} → {keys_after}"
                )
