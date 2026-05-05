"""Tests for the ``search-agent`` v2.1 LangGraph (interrupt → embed → rank → polish).

Focuses exclusively on the new real graph -- the ``polish_search`` helper
tests are in ``tests/test_search_agent.py``.  Together they bring
``app/agents/catalog/search.py`` to 100% coverage.

Pattern copied from ``tests/test_agents_catalog.py``: an :class:`InMemorySaver`
checkpointer and :class:`InMemoryStore` are constructed per-test, the graph is
driven through the interrupt via :class:`langgraph.types.Command`, and
assertions target the final state dict.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import patch

from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.search import SearchAgent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _persistence() -> tuple[InMemorySaver, InMemoryStore]:
    return InMemorySaver(), InMemoryStore()


def _drive(
    graph: Any,
    inputs: dict[str, Any],
    resumes: list[Any],
    thread_id: str,
) -> dict[str, Any]:
    """Run the graph through a single interrupt and return the final state."""

    cfg = {"configurable": {"thread_id": thread_id}}

    async def run() -> dict[str, Any]:
        result = await graph.ainvoke(inputs, config=cfg)
        for resume in resumes:
            result = await graph.ainvoke(Command(resume=resume), config=cfg)
        return result

    return asyncio.run(run())


_CANDIDATES = [
    {"id": "t-1", "text": "Fix login bug on Safari"},
    {"id": "t-2", "text": "Refactor auth module"},
    {"id": "t-3", "text": "Add password reset flow"},
]


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def test_search_agent_metadata_status_is_active() -> None:
    """Status must be ``"active"`` so the FE picker shows the agent."""

    agent = SearchAgent()
    assert agent.metadata.status == "active"
    assert agent.metadata.recursion_limit == 8
    assert "fe.searchCandidates" in agent.metadata.tools
    assert "be.embed" in agent.metadata.tools
    assert "be.embedding_neighbors" in agent.metadata.tools
    assert agent.metadata.allowed_autonomy == ("suggest",)


# ---------------------------------------------------------------------------
# Graph builds and initial interrupt
# ---------------------------------------------------------------------------


def test_graph_builds_without_error() -> None:
    """Compiling the graph with a checkpointer must not raise."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    assert graph is not None


def test_graph_interrupts_with_correct_tool_name_and_args() -> None:
    """First invoke must raise an interrupt for ``fe.searchCandidates``."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    cfg = {"configurable": {"thread_id": "interrupt-test-1"}}

    async def run() -> dict[str, Any]:
        return await graph.ainvoke(
            {
                "messages": [],
                "query": "auth bug",
                "project_id": "p1",
                "kind": "tasks",
            },
            config=cfg,
        )

    result = asyncio.run(run())
    interrupts = result.get("__interrupt__", [])
    assert interrupts, "Expected an interrupt but none was raised"
    interrupt_value = interrupts[0].value
    assert interrupt_value["tool"] == "fe.searchCandidates"
    args = interrupt_value["args"]
    assert args["project_id"] == "p1"
    assert args["query"] == "auth bug"
    assert args["kind"] == "tasks"
    assert args["limit"] == 30


def test_graph_defaults_kind_to_tasks_when_missing() -> None:
    """A missing ``kind`` field defaults to ``"tasks"`` in the interrupt args."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    cfg = {"configurable": {"thread_id": "interrupt-test-2"}}

    async def run() -> dict[str, Any]:
        return await graph.ainvoke(
            {"messages": [], "query": "search term"},
            config=cfg,
        )

    result = asyncio.run(run())
    interrupts = result.get("__interrupt__", [])
    assert interrupts[0].value["args"]["kind"] == "tasks"


# ---------------------------------------------------------------------------
# Resume with FE candidates → embed → rank → polish → emit
# ---------------------------------------------------------------------------


def test_resume_with_fe_envelope_dict_produces_ranked_result() -> None:
    """Resuming with ``{"candidates": [...]}`` must unwrap and rank correctly.

    The FE sends the candidates wrapped in a ``{"candidates": [...]}``
    envelope; ``fetch_candidates`` must unwrap it before storing.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth bug", "project_id": "p1", "kind": "tasks"},
        [{"candidates": _CANDIDATES}],
        thread_id="resume-dict-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    assert isinstance(ranking["ids"], list)
    assert len(ranking["ids"]) > 0
    # All returned ids must originate from the candidate set.
    candidate_ids = {c["id"] for c in _CANDIDATES}
    assert all(id_ in candidate_ids for id_ in ranking["ids"])
    # Rationale must mention candidate count.
    assert "3" in ranking["rationale"]


def test_resume_with_raw_list_produces_ranked_result() -> None:
    """Resuming with a bare list (no envelope) also produces a ranking."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth", "project_id": "p1", "kind": "tasks"},
        [_CANDIDATES],
        thread_id="resume-list-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    assert isinstance(ranking["ids"], list)
    assert len(ranking["ids"]) > 0


def test_final_message_contains_ranking_json() -> None:
    """The ``emit`` node must append an :class:`AIMessage` with the ranking JSON."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth bug", "project_id": "p1", "kind": "tasks"},
        [_CANDIDATES],
        thread_id="msg-check-1",
    )
    messages = final.get("messages", [])
    assert messages, "Expected at least one message in the final state"
    last_msg = messages[-1]
    assert isinstance(last_msg, AIMessage)
    payload = json.loads(last_msg.content)
    assert "ids" in payload
    assert "rationale" in payload


# ---------------------------------------------------------------------------
# Empty candidates path
# ---------------------------------------------------------------------------


def test_empty_candidates_returns_empty_ids_with_rationale() -> None:
    """Empty candidate list must produce ``{ids: [], rationale: ...}``.

    When the FE has no candidates (e.g. the project is empty), the graph
    must still complete cleanly and surface a non-empty rationale string
    so the FE layout does not break.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "anything", "project_id": "p1"},
        [[]],
        thread_id="empty-candidates-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    assert ranking["ids"] == []
    assert ranking["rationale"]  # non-empty string


def test_empty_candidates_does_not_call_embed() -> None:
    """The embed call is skipped when there are no candidates to score."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    from app.tools import be_tools

    with patch.object(be_tools, "embed", wraps=be_tools.embed) as mock_embed:
        _drive(
            graph,
            {"messages": [], "query": "anything", "project_id": "p1"},
            [[]],
            thread_id="empty-no-embed-1",
        )
        mock_embed.assert_not_called()


# ---------------------------------------------------------------------------
# Deterministic ranking (stub model, no LLM polish)
# ---------------------------------------------------------------------------


def test_stub_model_returns_deterministic_ranking() -> None:
    """With the stub chat model the ranking comes from embeddings alone.

    The stub model returns a JSON blob that is not a valid ``SearchRanking``
    so ``polish_search`` falls back to the deterministic result -- the ids
    from the embedding ranker pass through unchanged.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth bug", "project_id": "p1"},
        [_CANDIDATES],
        thread_id="stub-model-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    # The stub model cannot produce a valid SearchRanking, so the
    # deterministic embedding ranking survives through polish.
    candidate_ids = {c["id"] for c in _CANDIDATES}
    assert all(id_ in candidate_ids for id_ in ranking["ids"])


# ---------------------------------------------------------------------------
# Token usage emission on polish
# ---------------------------------------------------------------------------


def test_token_usage_emitted_on_polish() -> None:
    """The ``polish`` node emits a ``{"kind": "usage", ...}`` custom event.

    ``emit_custom`` is a no-op when there is no active stream writer (the
    ``/invoke`` path). This test verifies that the node *attempts* to emit
    by patching the stream helper at its local name inside
    ``app.agents.stream`` so the patch takes effect inside the node
    closure.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    emitted: list[Any] = []

    def fake_writer(payload: Any) -> None:
        emitted.append(payload)

    from app.agents import stream as stream_module

    with patch.object(stream_module, "get_stream_writer", return_value=fake_writer):
        _drive(
            graph,
            {"messages": [], "query": "auth bug", "project_id": "p1"},
            [_CANDIDATES],
            thread_id="usage-emit-1",
        )

    usage_events = [
        e for e in emitted if isinstance(e, dict) and e.get("kind") == "usage"
    ]
    assert usage_events, "Expected at least one usage emission from the polish node"
    usage = usage_events[0]
    assert "tokensIn" in usage
    assert "tokensOut" in usage


def test_suggestion_event_emitted_on_emit_node() -> None:
    """The ``emit`` node must emit a ``{"kind": "suggestion", ...}`` custom event.

    Same patching strategy as ``test_token_usage_emitted_on_polish``: we
    patch ``get_stream_writer`` at its local name in ``app.agents.stream``
    so the patch is visible inside the node's ``emit_custom`` call.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    emitted: list[Any] = []

    def fake_writer(payload: Any) -> None:
        emitted.append(payload)

    from app.agents import stream as stream_module

    with patch.object(stream_module, "get_stream_writer", return_value=fake_writer):
        _drive(
            graph,
            {"messages": [], "query": "auth bug", "project_id": "p1"},
            [_CANDIDATES],
            thread_id="suggestion-emit-1",
        )

    suggestion_events = [
        e for e in emitted if isinstance(e, dict) and e.get("kind") == "suggestion"
    ]
    assert suggestion_events, "Expected a suggestion event from the emit node"
    evt = suggestion_events[0]
    assert evt.get("surface") == "search"
    assert "payload" in evt
    payload = evt["payload"]
    assert "ids" in payload
    assert "rationale" in payload


# ---------------------------------------------------------------------------
# Candidates envelope unwrap variant
# ---------------------------------------------------------------------------


def test_candidates_stored_after_dict_unwrap() -> None:
    """After the resume, ``state['candidates']`` holds the list, not the envelope."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth", "project_id": "p1"},
        [{"candidates": _CANDIDATES}],
        thread_id="unwrap-check-1",
    )
    # The state should contain the unwrapped list.
    stored = final.get("candidates")
    assert stored == _CANDIDATES


# ---------------------------------------------------------------------------
# matches[] and expandedTerms[] fields (Gap A)
# ---------------------------------------------------------------------------

_VALID_STRENGTHS = {"strong", "moderate", "weak"}


def test_ranking_includes_matches_parallel_to_ids() -> None:
    """``ranking['matches']`` must be present, same length as ``ids``,
    and each entry must have an id and a valid strength label.
    """

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth bug", "project_id": "p1", "kind": "tasks"},
        [_CANDIDATES],
        thread_id="matches-present-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    ids = ranking.get("ids", [])
    matches = ranking.get("matches")
    assert matches is not None, "matches[] must be present in the ranking payload"
    assert len(matches) == len(ids), (
        f"matches ({len(matches)}) must be same length as ids ({len(ids)})"
    )
    for entry in matches:
        assert isinstance(entry, dict)
        assert "id" in entry
        assert "strength" in entry
        assert entry["strength"] in _VALID_STRENGTHS, (
            f"strength '{entry['strength']}' not in {_VALID_STRENGTHS}"
        )


def test_matches_ids_align_with_ranking_ids() -> None:
    """Each ``matches[i]['id']`` must equal ``ids[i]``."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth bug", "project_id": "p1"},
        [_CANDIDATES],
        thread_id="matches-align-1",
    )
    ranking = final["ranking"]
    ids = ranking["ids"]
    matches = ranking["matches"]
    for idx, (id_, match) in enumerate(zip(ids, matches)):
        assert match["id"] == id_, (
            f"matches[{idx}].id '{match['id']}' != ids[{idx}] '{id_}'"
        )


def test_empty_candidates_produces_empty_matches() -> None:
    """When the candidate list is empty, ``matches`` must also be empty."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth", "project_id": "p1"},
        [[]],
        thread_id="matches-empty-1",
    )
    ranking = final.get("ranking")
    assert ranking is not None
    assert ranking["ids"] == []
    assert ranking.get("matches") == []


def test_suggestion_payload_includes_matches() -> None:
    """The ``suggestion`` custom event's payload must carry ``matches``."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    emitted: list[Any] = []

    def fake_writer(payload: Any) -> None:
        emitted.append(payload)

    from app.agents import stream as stream_module

    with patch.object(stream_module, "get_stream_writer", return_value=fake_writer):
        _drive(
            graph,
            {"messages": [], "query": "auth bug", "project_id": "p1"},
            [_CANDIDATES],
            thread_id="suggestion-matches-1",
        )

    suggestion_events = [
        e for e in emitted if isinstance(e, dict) and e.get("kind") == "suggestion"
    ]
    assert suggestion_events
    payload = suggestion_events[0]["payload"]
    assert "matches" in payload
    assert len(payload["matches"]) == len(payload["ids"])


def test_final_message_json_includes_matches() -> None:
    """The AIMessage content must include the ``matches`` key."""

    agent = SearchAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {"messages": [], "query": "auth", "project_id": "p1"},
        [_CANDIDATES],
        thread_id="msg-matches-1",
    )
    messages = final.get("messages", [])
    last_msg = messages[-1]
    payload = json.loads(last_msg.content)
    assert "matches" in payload
    assert len(payload["matches"]) == len(payload["ids"])


def test_polish_search_rerank_preserves_matches_alignment() -> None:
    """When the LLM reranks, ``matches`` must still align 1:1 with new ``ids``."""

    from langchain_core.messages import AIMessage as _AIMessage
    from app.agents.catalog.search import SearchRanking, polish_search
    from tests.conftest import structured_model

    # Deterministic ranking has scores embedded in matches.
    deterministic = {
        "ids": ["t-1", "t-2", "t-3"],
        "rationale": "embedding order",
        "matches": [
            {"id": "t-1", "strength": "strong"},
            {"id": "t-2", "strength": "moderate"},
            {"id": "t-3", "strength": "weak"},
        ],
    }
    candidates = [
        {"id": "t-1", "text": "Fix login bug on Safari"},
        {"id": "t-2", "text": "Refactor auth module"},
        {"id": "t-3", "text": "Add password reset flow"},
    ]
    # LLM reverses the order.
    raw = _AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
    )
    parsed = SearchRanking(
        ids=["t-3", "t-2", "t-1"],
        rationale="custom rerank order",
    )
    result, _, _ = polish_search(
        structured_model(parsed=parsed, raw_message=raw),
        deterministic,
        "auth",
        candidates,
    )
    assert result["ids"] == ["t-3", "t-2", "t-1"]
    # matches must align with the new ids order.
    assert len(result["matches"]) == len(result["ids"])
    for id_, match in zip(result["ids"], result["matches"]):
        assert match["id"] == id_
    # Strengths come from original score_map (derived from old matches).
    id_to_strength = {m["id"]: m["strength"] for m in result["matches"]}
    assert id_to_strength["t-1"] == "strong"
    assert id_to_strength["t-2"] == "moderate"
    assert id_to_strength["t-3"] == "weak"
