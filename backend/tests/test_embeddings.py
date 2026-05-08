"""Tests for :mod:`app.agents.embeddings`."""

from __future__ import annotations

import math
import sys
from dataclasses import replace

import pytest
from langchain_core.embeddings import Embeddings

from app.agents import embeddings as embeddings_module
from app.agents.embeddings import (
    DEFAULT_OPENAI_MODEL,
    PROVIDER_OPENAI,
    PROVIDER_STUB,
    STUB_EMBEDDING_DIM,
    EmbeddingsSpec,
    _StubEmbeddings,
    assert_embeddings_provider_available,
    is_stub_embeddings,
    make_embeddings,
    make_stub_embeddings,
    resolve_embeddings_spec,
)
from app.config import settings as default_settings


def _settings(**overrides: object) -> object:
    """Return a frozen :class:`Settings` clone with overrides applied."""

    return replace(default_settings, **overrides)


# ---------------------------------------------------------------------------
# resolve_embeddings_spec
# ---------------------------------------------------------------------------


def test_resolve_spec_auto_picks_stub_when_no_key() -> None:
    spec = resolve_embeddings_spec(settings=_settings(openai_api_key=""))
    assert spec.provider == PROVIDER_STUB
    assert spec.is_stub is True
    assert spec.model == ""
    assert spec.api_key == ""


def test_resolve_spec_auto_picks_openai_when_key_set() -> None:
    spec = resolve_embeddings_spec(settings=_settings(openai_api_key="sk-test"))
    assert spec.provider == PROVIDER_OPENAI
    assert spec.is_stub is False
    assert spec.model == DEFAULT_OPENAI_MODEL
    assert spec.api_key == "sk-test"


def test_resolve_spec_explicit_stub_overrides_auto() -> None:
    spec = resolve_embeddings_spec(
        settings=_settings(
            embeddings_provider="stub",
            openai_api_key="sk-still-here",
        )
    )
    assert spec.provider == PROVIDER_STUB


def test_resolve_spec_explicit_openai_uses_provider_default_model() -> None:
    spec = resolve_embeddings_spec(
        settings=_settings(embeddings_provider="openai", openai_api_key="sk-x")
    )
    assert spec.provider == PROVIDER_OPENAI
    assert spec.model == DEFAULT_OPENAI_MODEL


def test_resolve_spec_uses_explicit_model_id() -> None:
    spec = resolve_embeddings_spec(
        settings=_settings(
            embeddings_provider="openai",
            embeddings_model_id="text-embedding-3-large",
            openai_api_key="sk-x",
        )
    )
    assert spec.model == "text-embedding-3-large"


def test_resolve_spec_rejects_unknown_provider() -> None:
    with pytest.raises(RuntimeError, match="Unsupported"):
        resolve_embeddings_spec(settings=_settings(embeddings_provider="not-a-thing"))


def test_resolve_spec_uses_default_settings_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Omitting ``settings`` falls back to the process-wide defaults."""

    monkeypatch.setattr(
        embeddings_module,
        "default_settings",
        _settings(embeddings_provider="stub"),
    )
    spec = resolve_embeddings_spec()
    assert spec.provider == PROVIDER_STUB


# ---------------------------------------------------------------------------
# _StubEmbeddings
# ---------------------------------------------------------------------------


def test_stub_embeddings_query_and_documents_match_each_other() -> None:
    stub = _StubEmbeddings()
    single = stub.embed_query("hello")
    batch = stub.embed_documents(["hello"])
    assert single == batch[0]


def test_stub_embeddings_documents_are_deterministic_and_correct_shape() -> None:
    stub = _StubEmbeddings()
    a = stub.embed_documents(["alpha", "beta"])
    b = stub.embed_documents(["alpha", "beta"])
    assert a == b
    assert len(a) == 2
    for vec in a:
        assert len(vec) == STUB_EMBEDDING_DIM
        norm = math.sqrt(sum(x * x for x in vec))
        assert math.isclose(norm, 1.0, rel_tol=1e-6)


def test_stub_embeddings_query_returns_unit_vector() -> None:
    vec = _StubEmbeddings().embed_query("query text")
    assert len(vec) == STUB_EMBEDDING_DIM
    norm = math.sqrt(sum(x * x for x in vec))
    assert math.isclose(norm, 1.0, rel_tol=1e-6)


# ---------------------------------------------------------------------------
# make_stub_embeddings / make_embeddings / is_stub_embeddings
# ---------------------------------------------------------------------------


def test_make_stub_embeddings_returns_stub_instance() -> None:
    model = make_stub_embeddings()
    assert isinstance(model, _StubEmbeddings)
    assert is_stub_embeddings(model) is True


def test_make_embeddings_returns_stub_when_no_key() -> None:
    model = make_embeddings(settings=_settings(openai_api_key=""))
    assert isinstance(model, _StubEmbeddings)
    assert is_stub_embeddings(model) is True


def test_make_embeddings_returns_openai_instance_when_key_set() -> None:
    model = make_embeddings(
        settings=_settings(
            embeddings_provider="openai",
            openai_api_key="sk-test",
        )
    )
    assert is_stub_embeddings(model) is False
    assert isinstance(model, Embeddings)
    assert model.__class__.__name__ == "OpenAIEmbeddings"
    # Default embeddings_dimensions is 16 (STUB_EMBEDDING_DIM) unless overridden.
    assert getattr(model, "dimensions", None) == STUB_EMBEDDING_DIM


def test_make_embeddings_openai_respects_embeddings_dimensions_setting() -> None:
    """EMBEDDINGS_DIMENSIONS=512 is forwarded to OpenAIEmbeddings."""

    model = make_embeddings(
        settings=_settings(
            embeddings_provider="openai",
            openai_api_key="sk-test",
            embeddings_dimensions=512,
        )
    )
    assert model.__class__.__name__ == "OpenAIEmbeddings"
    assert getattr(model, "dimensions", None) == 512


def test_stub_embeddings_always_returns_16_dim_regardless_of_setting() -> None:
    """Stub path ignores EMBEDDINGS_DIMENSIONS and always emits 16-dim vectors."""

    stub = make_stub_embeddings()
    vecs = stub.embed_documents(["test"])
    assert len(vecs[0]) == STUB_EMBEDDING_DIM


def test_make_embeddings_resolves_default_when_spec_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``spec`` is None it falls back to the resolved global settings."""

    monkeypatch.setattr(
        embeddings_module,
        "default_settings",
        _settings(embeddings_provider="stub"),
    )
    model = make_embeddings()
    assert is_stub_embeddings(model)


def test_make_embeddings_accepts_explicit_spec() -> None:
    spec = EmbeddingsSpec(provider=PROVIDER_STUB, model="", api_key="")
    model = make_embeddings(spec)
    assert is_stub_embeddings(model)


def test_is_stub_embeddings_false_for_arbitrary_object() -> None:
    assert is_stub_embeddings(object()) is False
    assert is_stub_embeddings(None) is False


# ---------------------------------------------------------------------------
# assert_embeddings_provider_available
# ---------------------------------------------------------------------------


def test_assert_embeddings_provider_available_no_op_for_stub() -> None:
    assert_embeddings_provider_available(
        EmbeddingsSpec(provider=PROVIDER_STUB, model="", api_key="")
    )


def test_assert_embeddings_provider_available_passes_when_openai_importable() -> None:
    """The dev install pulls langchain-openai in; the check should pass."""

    assert_embeddings_provider_available(
        EmbeddingsSpec(
            provider=PROVIDER_OPENAI,
            model="text-embedding-3-small",
            api_key="sk-x",
        )
    )


def test_assert_embeddings_provider_available_uses_settings_when_spec_missing() -> None:
    assert_embeddings_provider_available(
        settings=_settings(embeddings_provider="stub", openai_api_key="")
    )


def test_assert_embeddings_provider_available_raises_for_missing_openai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mirror of :func:`tests.test_coverage_filling`'s missing-extra check."""

    monkeypatch.setitem(sys.modules, "langchain_openai", None)
    spec = EmbeddingsSpec(
        provider=PROVIDER_OPENAI, model="text-embedding-3-small", api_key="sk-x"
    )
    with pytest.raises(RuntimeError, match="langchain-openai is not installed"):
        assert_embeddings_provider_available(spec)


def test_assert_embeddings_provider_available_warns_on_dim_mismatch(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """OpenAI provider configured with a dim != stub width logs a warning."""

    spec = EmbeddingsSpec(
        provider=PROVIDER_OPENAI, model="text-embedding-3-small", api_key="sk-x"
    )
    with caplog.at_level("WARNING", logger=embeddings_module.__name__):
        assert_embeddings_provider_available(
            spec,
            settings=_settings(embeddings_dimensions=STUB_EMBEDDING_DIM + 16),
        )
    assert any("Embedding width changed" in rec.message for rec in caplog.records)
