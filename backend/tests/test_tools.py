"""Tests for :mod:`app.tools.be_tools`, :mod:`app.tools.redaction`, and
:mod:`app.tools.fe_tool_schemas`.
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta, timezone

import pytest

from app.tools import be_tools
from app.tools.fe_tool_schemas import (
    FE_TOOL_SCHEMAS,
    fe_tool_definitions,
    interrupt_payload,
)
from app.tools.redaction import PATTERNS, RedactionSpan, redact, redact_dict


def test_emit_custom_reraises_unexpected_runtime_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents import stream as stream_module

    def bad_writer() -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(stream_module, "get_stream_writer", bad_writer)
    with pytest.raises(RuntimeError, match="boom"):
        stream_module.emit_custom({"x": 1})


# ---------------------------------------------------------------------------
# redaction
# ---------------------------------------------------------------------------


def test_redact_email() -> None:
    out, spans = redact("Reach me at alice@example.com please.")
    assert "[EMAIL]" in out
    assert "alice@example.com" not in out
    assert any(s.pattern == "[EMAIL]" for s in spans)


def test_redact_secret() -> None:
    out, _ = redact("Auth: Bearer abcdefghijklmno end")
    assert "[SECRET]" in out
    assert "abcdefghijklmno" not in out


def test_redact_ssn_and_card() -> None:
    out, _ = redact("SSN 123-45-6789 card 4111111111111111 done")
    assert "[SSN]" in out
    assert "[CARD]" in out
    assert "123-45-6789" not in out
    assert "4111111111111111" not in out


def test_redact_returns_sorted_spans() -> None:
    text = "foo alice@x.io bar 123-45-6789"
    _, spans = redact(text)
    starts = [s.start for s in spans]
    assert starts == sorted(starts)


def test_redact_spans_reference_original_text_offsets() -> None:
    """Spans must index into the input string, not the rewritten one."""

    text = "email alice@example.com card 4111111111111111 done"
    out, spans = redact(text)
    # Each span's [start:end] slice of the *original* text must equal the
    # actual sensitive substring, regardless of the cascading rewrites.
    for span in spans:
        if span.pattern == "[EMAIL]":
            assert text[span.start : span.end] == "alice@example.com"
        if span.pattern == "[CARD]":
            assert text[span.start : span.end] == "4111111111111111"
    assert "[EMAIL]" in out
    assert "[CARD]" in out


def test_redact_skips_overlapping_match_already_claimed() -> None:
    """Once a pattern claims a range, a later, broader pattern skips it."""

    # Build a synthetic pattern list that *does* overlap so the
    # _is_claimed branch is exercised: a 'TOK' pattern of 5+ chars and a
    # broader 'BROAD' pattern of 3+ chars sharing the same input.
    import re as _re

    custom = [
        (_re.compile(r"\bABCDE\b"), "[TOK]"),
        (_re.compile(r"\bABC\w*"), "[BROAD]"),
    ]
    monkey_text = "head ABCDE tail"
    # Use the real redact() pipeline by patching PATTERNS for the call.
    from app.tools import redaction as _redaction

    original_patterns = _redaction.PATTERNS
    try:
        _redaction.PATTERNS = custom  # type: ignore[assignment]
        out, spans = _redaction.redact(monkey_text)
    finally:
        _redaction.PATTERNS = original_patterns  # type: ignore[assignment]
    assert [s.pattern for s in spans] == ["[TOK]"]
    assert "[TOK]" in out
    assert "[BROAD]" not in out


def test_redact_no_matches_passthrough() -> None:
    out, spans = redact("nothing sensitive here")
    assert out == "nothing sensitive here"
    assert spans == []


def test_redact_dict_strings_dicts_lists_tuples_passthrough() -> None:
    payload = {
        "user": "alice@example.com",
        "tags": ["plain", "alice@example.com"],
        "tuple": ("plain", "alice@example.com"),
        "depth": {"inner": "alice@example.com"},
        "number": 42,
        "none": None,
    }
    out = redact_dict(payload)
    assert out["user"] == "[EMAIL]"
    assert out["tags"][1] == "[EMAIL]"
    assert isinstance(out["tuple"], tuple)
    assert out["tuple"][1] == "[EMAIL]"
    assert out["depth"]["inner"] == "[EMAIL]"
    assert out["number"] == 42
    assert out["none"] is None


def test_redaction_span_dataclass_is_frozen() -> None:
    span = RedactionSpan("[EMAIL]", 0, 5)
    with pytest.raises(Exception):
        span.start = 99  # type: ignore[misc]
    assert PATTERNS  # patterns list is non-empty


# ---------------------------------------------------------------------------
# fe_tool_schemas
# ---------------------------------------------------------------------------


_EXPECTED_TOOLS = {
    "fe.listProjects",
    "fe.listMembers",
    "fe.getProject",
    "fe.listBoard",
    "fe.listTasks",
    "fe.getTask",
    "fe.boardSnapshot",
    "fe.similarTasks",
}


def test_all_fe_tool_names_present() -> None:
    assert _EXPECTED_TOOLS <= set(FE_TOOL_SCHEMAS)


def test_each_schema_has_required_keys() -> None:
    for schema in FE_TOOL_SCHEMAS.values():
        assert "description" in schema
        assert "args_schema" in schema
        assert "result_schema" in schema


def test_fe_tool_definitions_returns_list_of_named_dicts() -> None:
    defs = fe_tool_definitions()
    names = {item["name"] for item in defs}
    assert names == set(FE_TOOL_SCHEMAS)
    for item in defs:
        assert "description" in item
        assert "args_schema" in item


def test_interrupt_payload_known_tool() -> None:
    payload = interrupt_payload("fe.boardSnapshot", {"project_id": "p1"})
    assert payload == {"tool": "fe.boardSnapshot", "args": {"project_id": "p1"}}
    # Mutating original args afterwards must not mutate stored payload.
    args = {"project_id": "p1"}
    payload2 = interrupt_payload("fe.listProjects", args)
    args["project_id"] = "p2"
    assert payload2["args"] == {"project_id": "p1"}


def test_interrupt_payload_unknown_tool_raises() -> None:
    with pytest.raises(KeyError):
        interrupt_payload("fe.unknown", {})


# ---------------------------------------------------------------------------
# be_tools.summarize
# ---------------------------------------------------------------------------


def test_summarize_collapses_whitespace_short_input() -> None:
    assert be_tools.summarize("hello\n\n  world") == "hello world"


def test_summarize_truncates_with_head_and_tail() -> None:
    text = "a" * 200 + "X" + "b" * 200
    out = be_tools.summarize(text, max_chars=50)
    assert len(out) == 50
    assert out.startswith("a")
    assert out.endswith("b")
    assert "..." in out


def test_summarize_short_max_chars() -> None:
    assert be_tools.summarize("abcdef", max_chars=2) == "ab"


def test_summarize_max_chars_three_returns_only_ellipsis_or_short_head() -> None:
    out = be_tools.summarize("abcdefghi", max_chars=3)
    assert out == "abc"


def test_summarize_max_chars_four_returns_head_then_ellipsis() -> None:
    out = be_tools.summarize("abcdefghi", max_chars=4)
    assert out == "a..."


def test_summarize_invalid_max_chars() -> None:
    with pytest.raises(ValueError, match="max_chars"):
        be_tools.summarize("hi", max_chars=0)


# ---------------------------------------------------------------------------
# embed / cosine helpers
# ---------------------------------------------------------------------------


def test_embed_deterministic_and_l2_normalised() -> None:
    a = be_tools.embed(["hello"])[0]
    b = be_tools.embed(["hello"])[0]
    assert a == b
    norm = math.sqrt(sum(x * x for x in a))
    assert math.isclose(norm, 1.0, rel_tol=1e-6)


def test_embed_zero_norm_handled() -> None:
    # Patch the internal hash function to force a zero vector and exercise the
    # "norm == 0" branch in _l2_normalize.
    out = be_tools._l2_normalize([0.0, 0.0, 0.0])
    assert out == [0.0, 0.0, 0.0]


def test_embed_dim_validation() -> None:
    with pytest.raises(ValueError, match="dim"):
        be_tools.embed(["a"], dim=0)


# ---------------------------------------------------------------------------
# embed via the Tier 8 provider singleton
# ---------------------------------------------------------------------------


class _RecordingEmbeddings:
    """Test double standing in for a real :class:`Embeddings` provider."""

    def __init__(self, vectors: list[list[float]] | None = None) -> None:
        self.vectors = vectors
        self.calls: list[list[str]] = []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        if self.vectors is None:
            # Echo the deterministic stub so the dim invariant holds.
            return be_tools._stub_embed(texts, dim=16)
        return self.vectors


class _ExplodingEmbeddings:
    """Provider whose ``embed_documents`` always raises (fallback path)."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("upstream API is down")


def test_embed_async_dim_validation() -> None:
    with pytest.raises(ValueError, match="dim"):
        asyncio.run(be_tools.embed_async(["a"], dim=0))


def test_embed_async_stub_path_matches_embed() -> None:
    be_tools.reset_embeddings_singleton()
    sync_out = be_tools.embed(["hello"])
    async_out = asyncio.run(be_tools.embed_async(["hello"]))
    assert sync_out == async_out


def test_embed_async_runs_provider_on_worker_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _RecordingEmbeddings()
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: fake)
    out = asyncio.run(be_tools.embed_async(["one", "two"]))
    assert fake.calls == [["one", "two"]]
    assert len(out) == 2


def test_embed_async_short_circuits_empty_when_provider_resolves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _RecordingEmbeddings()
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: fake)
    assert asyncio.run(be_tools.embed_async([])) == []
    assert fake.calls == []


def test_embed_async_falls_back_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: _ExplodingEmbeddings())
    out = asyncio.run(be_tools.embed_async(["alpha"]))
    assert out == be_tools._stub_embed(["alpha"], dim=16)


def test_embed_routes_through_provider_when_resolved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _RecordingEmbeddings()
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: fake)
    out = be_tools.embed(["one", "two"])
    assert fake.calls == [["one", "two"]]
    # Two L2-normalised vectors of stub width.
    assert len(out) == 2
    for vec in out:
        assert math.isclose(math.sqrt(sum(x * x for x in vec)), 1.0, rel_tol=1e-6)


def test_embed_short_circuits_empty_inputs_when_provider_resolves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _RecordingEmbeddings()
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: fake)
    assert be_tools.embed([]) == []
    assert fake.calls == []


def test_embed_falls_back_to_stub_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: _ExplodingEmbeddings())
    out = be_tools.embed(["alpha"])
    expected = be_tools._stub_embed(["alpha"], dim=16)
    assert out == expected


def test_embed_normalises_provider_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider returning a non-unit vector still produces an L2-normalised output."""

    raw = [[3.0, 0.0, 4.0]]
    fake = _RecordingEmbeddings(vectors=raw)
    be_tools.reset_embeddings_singleton()
    monkeypatch.setattr(be_tools, "_resolve_embeddings", lambda: fake)
    out = be_tools.embed(["x"])
    assert len(out) == 1
    norm = math.sqrt(sum(x * x for x in out[0]))
    assert math.isclose(norm, 1.0, rel_tol=1e-6)


def test_resolve_embeddings_caches_singleton() -> None:
    """The factory is invoked once per process; subsequent calls hit the cache."""

    be_tools.reset_embeddings_singleton()
    first = be_tools._resolve_embeddings()
    second = be_tools._resolve_embeddings()
    assert first is second
    be_tools.reset_embeddings_singleton()
    third = be_tools._resolve_embeddings()
    # After a manual reset a fresh stub is built.
    assert third is not first


def test_embedding_neighbors_topk_descending() -> None:
    vecs = be_tools.embed(["a", "b", "c", "d"])
    corpus = list(zip(["a", "b", "c", "d"], vecs))
    query = vecs[0]
    out = be_tools.embedding_neighbors(query, corpus, k=2)
    assert len(out) == 2
    assert out[0][0] == "a"
    assert out[0][1] >= out[1][1]


def test_embedding_neighbors_validates_k() -> None:
    with pytest.raises(ValueError, match="k"):
        be_tools.embedding_neighbors([0.1], [], k=0)


def test_dot_normalised_dim_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="dimensionality"):
        be_tools._dot_normalised([0.1, 0.2], [0.1])


def test_cosine_similarity_dim_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="dimensionality"):
        be_tools.cosine_similarity([0.1, 0.2], [0.1])


def test_cosine_similarity_returns_one_for_identical_vectors() -> None:
    assert math.isclose(be_tools.cosine_similarity([3.0, 0.0], [9.0, 0.0]), 1.0)


def test_cosine_similarity_returns_zero_when_vector_is_zero() -> None:
    assert be_tools.cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert be_tools.cosine_similarity([1.0, 1.0], [0.0, 0.0]) == 0.0


def test_cosine_similarity_orthogonal_vectors_score_zero() -> None:
    assert math.isclose(
        be_tools.cosine_similarity([1.0, 0.0], [0.0, 1.0]),
        0.0,
        abs_tol=1e-9,
    )


# ---------------------------------------------------------------------------
# detect_drift
# ---------------------------------------------------------------------------


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def test_detect_drift_no_signals() -> None:
    snapshot: dict = {
        "columns": [{"id": "c1", "name": "Todo"}],
        "tasks": [{"id": "t1", "columnId": "c1", "type": "feature"}],
    }
    out = be_tools.detect_drift(snapshot)
    assert out == {"signals": [], "severity": "info"}


def test_detect_drift_wip_overflow_and_stale() -> None:
    old = datetime.now(timezone.utc) - timedelta(days=20)
    columns = [
        {"id": "c1", "name": "In Progress"},
        {"id": "c2", "name": "Done"},
    ]
    tasks = [{"id": f"t{i}", "columnId": "c1", "type": "feature"} for i in range(7)]
    tasks.append({"id": "stale", "columnId": "c1", "updatedAt": old.isoformat()})
    out = be_tools.detect_drift({"columns": columns, "tasks": tasks})
    types = {sig["type"] for sig in out["signals"]}
    assert "wip_overflow" in types
    assert "stale_task" in types
    assert out["severity"] == "warn"


def test_detect_drift_unowned_bug_is_critical() -> None:
    columns = [{"id": "c1", "name": "Todo"}]
    tasks = [{"id": "bug", "columnId": "c1", "type": "bug"}]
    out = be_tools.detect_drift({"columns": columns, "tasks": tasks})
    assert any(s["type"] == "unowned_bug" for s in out["signals"])
    assert out["severity"] == "critical"


def test_detect_drift_unparseable_iso_is_skipped() -> None:
    columns = [{"id": "c1", "name": "Todo"}]
    tasks = [{"id": "t1", "columnId": "c1", "updatedAt": "not-a-date"}]
    out = be_tools.detect_drift({"columns": columns, "tasks": tasks})
    assert out["signals"] == []
    # _parse_iso(None) and _parse_iso("") both return None as well.
    assert be_tools._parse_iso(None) is None
    assert be_tools._parse_iso("") is None
    assert be_tools._parse_iso("nope") is None


def test_detect_drift_handles_missing_column_ids() -> None:
    out = be_tools.detect_drift(
        {
            "columns": [
                {"id": None, "name": "Mystery"},
                {"id": "c1", "name": "Todo"},
            ],
            "tasks": [
                {"id": "t1", "columnId": None},
                {"id": "t2", "columnId": "c1"},
            ],
        }
    )
    assert out["signals"] == []


def test_detect_drift_uses_alternate_column_field() -> None:
    out = be_tools.detect_drift(
        {
            "columns": [{"id": "c1", "name": "Todo"}],
            "tasks": [{"id": "t1", "column": "c1"}],
        }
    )
    assert out == {"signals": [], "severity": "info"}


# ---------------------------------------------------------------------------
# validated_citation_ref
# ---------------------------------------------------------------------------


def test_validated_citation_ref_valid_source_returns_dict() -> None:
    out = be_tools.validated_citation_ref(source="task", id="t1", quote="My task")
    assert out == {"source": "task", "id": "t1", "quote": "My task"}


@pytest.mark.parametrize("source", ["task", "column", "member", "project"])
def test_validated_citation_ref_accepts_all_four_valid_sources(source: str) -> None:
    out = be_tools.validated_citation_ref(source=source, id="x", quote="q")
    assert out["source"] == source


def test_validated_citation_ref_invalid_source_raises_value_error() -> None:
    with pytest.raises(ValueError, match="invalid citation source"):
        be_tools.validated_citation_ref(
            source="fe.boardSnapshot", id="t1", quote="bad source"
        )
