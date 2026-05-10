"""Unit tests for optional pgvector neighbour merge."""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from app.agents import task_vector_pg
from app.agents.errors import AgentConfigurationError
from app.config import Settings


def test_merge_similar_prefers_fe_order_and_skips_dup_ids() -> None:
    similar = [
        {"id": "a", "text": "A"},
        {"id": "b", "text": "B"},
    ]
    hits = [{"id": "b", "text": "B2", "score": 0.9}, {"id": "c", "text": "C"}]
    merged = task_vector_pg.merge_similar_with_vector_hits(similar, hits)
    assert [m["id"] for m in merged[:3]] == ["a", "b", "c"]
    assert merged[1]["text"] == "B"


def test_merge_similar_caps_max_total() -> None:
    fe = [{"id": str(i), "text": "x"} for i in range(30)]
    hits = [{"id": str(i + 100), "text": "y"} for i in range(30)]
    merged = task_vector_pg.merge_similar_with_vector_hits(
        fe, hits, max_total=10
    )
    assert len(merged) == 10


def test_fetch_vector_empty_project_returns_early() -> None:
    cfg = Settings(agent_vector_search_enabled=True, agent_vector_dimensions=1)
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="",
            query_embedding=[1.0],
            settings=cfg,
        )
        == []
    )


def test_fetch_vector_empty_query_returns_early() -> None:
    cfg = Settings(agent_vector_search_enabled=True, agent_vector_dimensions=1)
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="p",
            query_embedding=[],
            settings=cfg,
        )
        == []
    )


def test_merge_similar_skips_non_dict_and_blank_id() -> None:
    merged = task_vector_pg.merge_similar_with_vector_hits(
        ["bad", {"id": "", "text": "x"}, {"id": "z", "text": "Z"}],
        [],
    )
    assert [m["id"] for m in merged] == ["z"]


def test_fetch_vector_psycopg_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = Settings(
        agent_vector_search_enabled=True,
        agent_vector_dimensions=1,
        agent_postgres_uri="postgresql://u:p@localhost/db",
    )

    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "psycopg":
            raise ImportError("blocked")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="p",
            query_embedding=[1.0],
            settings=cfg,
        )
        == []
    )


def test_fetch_vector_disabled_returns_empty() -> None:
    cfg = Settings(agent_vector_search_enabled=False)
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="p",
            query_embedding=[0.1, 0.2],
            settings=cfg,
        )
        == []
    )


def test_fetch_vector_dim_mismatch_returns_empty() -> None:
    cfg = Settings(agent_vector_search_enabled=True, agent_vector_dimensions=4)
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="p",
            query_embedding=[0.1, 0.2],
            settings=cfg,
        )
        == []
    )


def test_fetch_vector_psycopg_query_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = Settings(
        agent_vector_search_enabled=True,
        agent_vector_dimensions=2,
        agent_postgres_uri="postgresql://u:p@localhost/db",
    )

    class _FakeCur:
        def __enter__(self) -> "_FakeCur":
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

        def fetchall(self) -> list[tuple[object, ...]]:
            return [("t1", "Hello", 0.91)]

    class _FakeConn:
        def __enter__(self) -> "_FakeConn":
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def cursor(self) -> _FakeCur:
            return _FakeCur()

    fake_psycopg = MagicMock()
    fake_psycopg.connect = MagicMock(side_effect=lambda _uri: _FakeConn())

    monkeypatch.setitem(sys.modules, "psycopg", fake_psycopg)

    out = task_vector_pg.fetch_vector_neighbours_for_project(
        project_id="proj",
        query_embedding=[1.0, 0.0],
        settings=cfg,
    )
    assert out == [{"id": "t1", "text": "Hello", "score": 0.91}]


def test_fetch_vector_swallows_psycopg_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = Settings(
        agent_vector_search_enabled=True,
        agent_vector_dimensions=1,
        agent_postgres_uri="postgresql://u:p@localhost/db",
    )
    fake_psycopg = MagicMock()
    fake_psycopg.connect = MagicMock(side_effect=RuntimeError("db down"))
    monkeypatch.setitem(sys.modules, "psycopg", fake_psycopg)
    with patch.object(task_vector_pg.logger, "warning"):
        assert (
            task_vector_pg.fetch_vector_neighbours_for_project(
                project_id="p",
                query_embedding=[1.0],
                settings=cfg,
            )
            == []
        )


def test_fetch_vector_no_postgres_config_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cfg = Settings(
        agent_vector_search_enabled=True,
        agent_vector_dimensions=1,
    )

    def deny(*_a: object, **_k: object) -> str:
        raise AgentConfigurationError("missing", details={})

    monkeypatch.setattr(
        "app.agents.checkpointing.resolve_agent_postgres_uri",
        deny,
    )
    assert (
        task_vector_pg.fetch_vector_neighbours_for_project(
            project_id="p",
            query_embedding=[1.0],
            settings=cfg,
        )
        == []
    )
