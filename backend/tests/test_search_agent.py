"""Tests for the ``search-agent`` polish helper and stub graph.

Polish-helper tests live in this module rather than in
``tests/test_ai_v1_router.py`` because they exercise the helper in
isolation -- the router-level tests in ``test_ai_v1_router.py`` focus on
the wire shape and the budget true-up. Same split the other catalog
agents use (e.g. ``polish_draft`` is exercised both directly and through
``/api/ai/task-draft``).
"""

from __future__ import annotations

from langchain_core.messages import AIMessage

from app.agents.catalog.search import SearchAgent, SearchRanking, polish_search
from app.agents.llm import make_stub_chat_model
from tests.conftest import structured_model


_DETERMINISTIC = {
    "ids": ["t-1", "t-2"],
    "rationale": "Deterministic Jaccard ranking.",
}
_CANDIDATES = [
    {"id": "t-1", "text": "Fix login bug on Safari"},
    {"id": "t-2", "text": "Refactor auth module"},
    {"id": "t-3", "text": "Add password reset"},
]


def test_polish_search_returns_deterministic_on_stub() -> None:
    result, tokens_in, tokens_out = polish_search(
        make_stub_chat_model(), _DETERMINISTIC, "auth", _CANDIDATES
    )
    assert result == _DETERMINISTIC
    assert (tokens_in, tokens_out) == (0, 0)


def test_polish_search_returns_deterministic_when_no_candidates() -> None:
    """Empty candidate set -> nothing to rank, skip the LLM round-trip."""

    parsed = SearchRanking(ids=["t-x"], rationale="hallucinated")
    result, tokens_in, tokens_out = polish_search(
        structured_model(parsed=parsed), _DETERMINISTIC, "q", []
    )
    assert result == _DETERMINISTIC
    assert (tokens_in, tokens_out) == (0, 0)


def test_polish_search_reranks_when_model_succeeds() -> None:
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 4, "output_tokens": 2, "total_tokens": 6},
    )
    parsed = SearchRanking(
        ids=["t-3", "t-1"],
        rationale="t-3 closest to 'auth'; t-1 mentions login",
    )
    model = structured_model(parsed=parsed, raw_message=raw)
    result, tokens_in, tokens_out = polish_search(
        model, _DETERMINISTIC, "auth", _CANDIDATES
    )
    assert result["ids"] == ["t-3", "t-1"]
    assert result["rationale"].startswith("t-3 closest")
    assert (tokens_in, tokens_out) == (4, 2)


def test_polish_search_drops_hallucinated_ids() -> None:
    """Ids not in the candidate set must never reach the FE."""

    parsed = SearchRanking(ids=["bogus-1", "bogus-2"], rationale="rationale text")
    raw = AIMessage(
        content="x",
        usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    )
    result, tokens_in, tokens_out = polish_search(
        structured_model(parsed=parsed, raw_message=raw),
        _DETERMINISTIC,
        "q",
        _CANDIDATES,
    )
    # Empty intersection -> deterministic preserved (token usage still tracked).
    assert result == _DETERMINISTIC
    assert (tokens_in, tokens_out) == (1, 1)


def test_polish_search_keeps_deterministic_rationale_when_polished_blank() -> None:
    parsed = SearchRanking(ids=["t-1"], rationale="   \n  ")
    result, *_ = polish_search(
        structured_model(parsed=parsed),
        _DETERMINISTIC,
        "q",
        _CANDIDATES,
    )
    # Polished ids accepted; rationale falls back to deterministic.
    assert result["ids"] == ["t-1"]
    assert result["rationale"] == _DETERMINISTIC["rationale"]


def test_polish_search_falls_back_on_provider_exception() -> None:
    model = structured_model(raise_on_call=RuntimeError("provider down"))
    result, tokens_in, tokens_out = polish_search(
        model, _DETERMINISTIC, "q", _CANDIDATES
    )
    assert result == _DETERMINISTIC
    assert (tokens_in, tokens_out) == (0, 0)


def test_polish_search_falls_back_on_parsing_error() -> None:
    raw = AIMessage(
        content="x",
        usage_metadata={"input_tokens": 2, "output_tokens": 0, "total_tokens": 2},
    )
    model = structured_model(
        parsing_error=ValueError("bad json"), parsed=None, raw_message=raw
    )
    result, tokens_in, tokens_out = polish_search(
        model, _DETERMINISTIC, "q", _CANDIDATES
    )
    assert result == _DETERMINISTIC
    # Tokens still recorded so a runaway provider can be billed.
    assert (tokens_in, tokens_out) == (2, 0)


def test_polish_search_falls_back_when_parsed_is_not_schema() -> None:
    """A model that returns a raw dict (not the typed Pydantic class) falls back."""

    model = structured_model(parsed={"ids": ["t-1"], "rationale": "wrong type"})
    result, *_ = polish_search(model, _DETERMINISTIC, "q", _CANDIDATES)
    assert result == _DETERMINISTIC


def test_polish_search_strips_multiline_rationale_to_first_line() -> None:
    parsed = SearchRanking(
        ids=["t-1"],
        rationale="first line\nsecond line that should be dropped",
    )
    result, *_ = polish_search(
        structured_model(parsed=parsed), _DETERMINISTIC, "q", _CANDIDATES
    )
    assert result["rationale"] == "first line"


def test_polish_search_emits_expanded_terms_when_llm_provides_them() -> None:
    """When the LLM returns ``expanded_terms``, they surface as ``expandedTerms``."""

    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
    )
    parsed = SearchRanking(
        ids=["t-1"],
        rationale="auth match",
        expanded_terms=["authentication", "login", "sso"],
    )
    result, *_ = polish_search(
        structured_model(parsed=parsed, raw_message=raw),
        _DETERMINISTIC,
        "auth",
        _CANDIDATES,
    )
    assert result.get("expandedTerms") == ["authentication", "login", "sso"]


def test_polish_search_omits_expanded_terms_when_empty() -> None:
    """No ``expandedTerms`` key if the LLM returns an empty list."""

    parsed = SearchRanking(ids=["t-1"], rationale="x", expanded_terms=[])
    result, *_ = polish_search(
        structured_model(parsed=parsed), _DETERMINISTIC, "q", _CANDIDATES
    )
    assert "expandedTerms" not in result


def test_polish_search_includes_matches_in_reranked_result() -> None:
    """Reranked result must include ``matches`` aligned with the new ``ids``."""

    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 4, "output_tokens": 2, "total_tokens": 6},
    )
    parsed = SearchRanking(ids=["t-2", "t-1"], rationale="reranked")
    deterministic_with_matches = {
        **_DETERMINISTIC,
        "matches": [
            {"id": "t-1", "strength": "strong"},
            {"id": "t-2", "strength": "moderate"},
        ],
    }
    result, *_ = polish_search(
        structured_model(parsed=parsed, raw_message=raw),
        deterministic_with_matches,
        "auth",
        _CANDIDATES,
    )
    assert result["ids"] == ["t-2", "t-1"]
    assert "matches" in result
    assert len(result["matches"]) == 2
    match_map = {m["id"]: m["strength"] for m in result["matches"]}
    assert match_map["t-2"] == "moderate"
    assert match_map["t-1"] == "strong"


def test_search_agent_passthrough_returns_no_updates() -> None:
    """The compiled graph runs cleanly so the runtime can lookup chat_model.

    Build (not compile) keeps the test independent of the cached
    BaseAgent compile state; the agent is exercised here to cover the
    inner ``passthrough`` node that BaseAgent.build returns.
    """

    agent = SearchAgent()
    graph = agent.build(checkpointer=None, store=None)
    result = graph.invoke({"messages": []})
    # Single passthrough node returns no updates; the wrapper still
    # echoes the input messages back through the ``add_messages`` reducer.
    assert isinstance(result, dict)
    assert result.get("messages") == []
