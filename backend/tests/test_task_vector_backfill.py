"""Tests for the pgvector task embedding backfill service."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from contextlib import AbstractContextManager
from datetime import datetime, timezone

import pytest

from app.agents import task_vector_backfill
from app.agents.task_vector_backfill import (
    TaskEmbeddingBackfillOptions,
    TaskVectorBackfillError,
    backfill_task_embeddings,
    task_embedding_source,
    validate_backfill_options,
)
from app.config import Settings


class _MongoCursor:
    def __init__(self, rows: list[Mapping[str, object]]) -> None:
        self._rows = rows
        self.sort_args: tuple[str, int] | None = None
        self.batch_size_value: int | None = None

    def sort(self, key_or_list: str, direction: int) -> "_MongoCursor":
        self.sort_args = (key_or_list, direction)
        return self

    def batch_size(self, batch_size: int) -> "_MongoCursor":
        self.batch_size_value = batch_size
        return self

    def __iter__(self) -> Iterator[Mapping[str, object]]:
        return iter(self._rows)


class _MongoCollection:
    def __init__(self, rows: list[Mapping[str, object]]) -> None:
        self._rows = rows
        self.find_filter: Mapping[str, object] | None = None
        self.find_projection: Mapping[str, int] | None = None
        self.cursor = _MongoCursor(rows)

    def find(
        self,
        filter: Mapping[str, object],
        projection: Mapping[str, int],
    ) -> _MongoCursor:
        self.find_filter = filter
        self.find_projection = projection
        return self.cursor


class _PgCursor:
    def __init__(self, conn: "_PgConnection") -> None:
        self._conn = conn
        self._rows: list[tuple[object, ...]] = []
        self._rowcount = -1

    def __enter__(self) -> "_PgCursor":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(
        self,
        query: str,
        params: Sequence[object] = (),
    ) -> object:
        self._conn.queries.append((query, params))
        self._rowcount = -1
        if query.startswith("SELECT format_type"):
            self._rows = [(f"vector({self._conn.dimensions})",)]
        elif query.startswith("SELECT project_id, task_id, updated_at"):
            project_ids = set(params[0]) if params else set()
            task_ids = set(params[1]) if len(params) > 1 else set()
            self._rows = [
                (project_id, task_id, updated_at)
                for (project_id, task_id), updated_at in self._conn.existing.items()
                if project_id in project_ids and task_id in task_ids
            ]
        elif query.startswith("SELECT project_id, task_id FROM task_embeddings"):
            project_id_filter = params[0] if params else None
            self._rows = [
                (project_id, task_id)
                for project_id, task_id in self._conn.existing
                if project_id_filter is None or project_id == project_id_filter
            ]
        elif query.startswith("DELETE FROM task_embeddings"):
            project_ids = params[0] if params else []
            task_ids = params[1] if len(params) > 1 else []
            deleted = 0
            for key in zip(project_ids, task_ids, strict=True):
                if key in self._conn.existing:
                    del self._conn.existing[key]
                    self._conn.deletes.append(key)
                    deleted += 1
            self._rowcount = deleted
            self._rows = []
        elif query.startswith("INSERT INTO task_embeddings"):
            self._conn.inserts.append(params)
            self._rowcount = (
                self._conn.insert_rowcounts.pop(0)
                if self._conn.insert_rowcounts
                else 1
            )
            self._rows = []
        else:
            self._rows = []
        return None

    @property
    def rowcount(self) -> int:
        return self._rowcount

    def fetchone(self) -> tuple[object, ...] | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple[object, ...]]:
        return self._rows


class _PgConnection:
    def __init__(
        self,
        *,
        dimensions: int = 2,
        existing: Mapping[tuple[str, str], datetime | None] | None = None,
        insert_rowcounts: list[int] | None = None,
    ) -> None:
        self.dimensions = dimensions
        self.existing = dict(existing or {})
        self.insert_rowcounts = list(insert_rowcounts or [])
        self.queries: list[tuple[str, Sequence[object]]] = []
        self.inserts: list[Sequence[object]] = []
        self.deletes: list[tuple[str, str]] = []
        self.commits = 0

    def cursor(self) -> _PgCursor:
        return _PgCursor(self)

    def commit(self) -> object:
        self.commits += 1
        return None


class _PgContext(AbstractContextManager[_PgConnection]):
    def __init__(self, conn: _PgConnection) -> None:
        self.conn = conn

    def __enter__(self) -> _PgConnection:
        return self.conn

    def __exit__(self, *_exc: object) -> None:
        return None


class _Embeddings:
    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.texts.extend(texts)
        return [[1.0, 0.0] for _ in texts]


def _settings(dimensions: int = 2) -> Settings:
    return Settings(
        agent_postgres_uri="postgresql://example.invalid/db",
        agent_vector_dimensions=dimensions,
        embeddings_dimensions=dimensions,
    )


def _openai_settings(
    *,
    vector_dimensions: int,
    embeddings_dimensions: int,
) -> Settings:
    return Settings(
        agent_postgres_uri="postgresql://example.invalid/db",
        agent_vector_dimensions=vector_dimensions,
        embeddings_dimensions=embeddings_dimensions,
        embeddings_provider="openai",
        openai_api_key="sk-test",
    )


def test_validate_backfill_options_rejects_bad_batch_size() -> None:
    with pytest.raises(TaskVectorBackfillError, match="batch_size"):
        validate_backfill_options(TaskEmbeddingBackfillOptions(batch_size=0))


def test_task_embedding_source_rejects_missing_required_fields() -> None:
    assert task_embedding_source({"_id": "t1", "projectId": "p1"}) is None
    assert task_embedding_source({"_id": "t1", "taskName": "x"}) is None


def test_resolve_embeddings_provider_refuses_stub_for_execute() -> None:
    with pytest.raises(TaskVectorBackfillError, match="stub embeddings"):
        task_vector_backfill._resolve_embeddings_provider(
            cfg=Settings(embeddings_provider="stub"),
            options=TaskEmbeddingBackfillOptions(dry_run=False),
        )


def test_backfill_dry_run_reports_missing_existing_and_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 5, 1, tzinfo=timezone.utc)
    collection = _MongoCollection(
        [
            {"_id": "t1", "projectId": "p1", "taskName": "Build auth"},
            {
                "_id": "t2",
                "projectId": "p1",
                "taskName": "Fix login",
                "updatedAt": now,
            },
            {"_id": "bad", "projectId": "p1", "taskName": ""},
        ]
    )
    pg = _PgConnection(existing={("p1", "t2"): now})
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(
            project_id=" p1 ",
            batch_size=2,
            dry_run=True,
        ),
        collection=collection,
    )

    assert collection.find_filter == {"projectId": "p1"}
    assert summary.to_dict() == {
        "dry_run": True,
        "force": False,
        "provider": "stub",
        "dimensions": 2,
        "scanned": 3,
        "valid": 2,
        "skippedInvalid": 1,
        "skippedExisting": 1,
        "staleDeleted": 0,
        "embedded": 0,
        "written": 0,
        "prunedDeleted": 0,
        "batches": 1,
        "lastTaskId": "t2",
    }
    assert pg.inserts == []


def test_backfill_execute_embeds_and_upserts_pending_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = datetime(2026, 5, 1, tzinfo=timezone.utc)
    new = datetime(2026, 5, 2, tzinfo=timezone.utc)
    collection = _MongoCollection(
        [
            {
                "_id": "t1",
                "projectId": "p1",
                "taskName": "Build auth",
                "type": "feature",
                "updatedAt": new,
            },
            {
                "_id": "t2",
                "projectId": "p1",
                "taskName": "Fresh cache",
                "updatedAt": old,
            },
        ]
    )
    pg = _PgConnection(existing={("p1", "t2"): new})
    embeddings = _Embeddings()
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_resolve_embeddings_provider",
        lambda **_kwargs: ("openai", embeddings),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(dry_run=False),
        collection=collection,
    )

    assert summary.embedded == 1
    assert summary.written == 1
    assert summary.skipped_existing == 1
    assert pg.commits == 1
    assert len(pg.inserts) == 1
    params = pg.inserts[0]
    assert params[:4] == ("p1", "t1", "Build auth", "[1.0,0.0]")
    assert embeddings.texts == ["Task: Build auth\nType: feature"]


def test_backfill_counts_actual_upserts_after_concurrent_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 5, 1, tzinfo=timezone.utc)
    collection = _MongoCollection(
        [{"_id": "t1", "projectId": "p1", "taskName": "Build auth", "updatedAt": now}]
    )
    pg = _PgConnection(insert_rowcounts=[0])
    embeddings = _Embeddings()
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_resolve_embeddings_provider",
        lambda **_kwargs: ("openai", embeddings),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(dry_run=False),
        collection=collection,
    )

    assert summary.embedded == 1
    assert summary.written == 0


def test_backfill_force_rewrites_existing_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = datetime(2026, 5, 1, tzinfo=timezone.utc)
    new = datetime(2026, 5, 2, tzinfo=timezone.utc)
    collection = _MongoCollection(
        [{"_id": "t1", "projectId": "p1", "taskName": "Build auth", "updatedAt": old}]
    )
    pg = _PgConnection(existing={("p1", "t1"): new})
    embeddings = _Embeddings()
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_resolve_embeddings_provider",
        lambda **_kwargs: ("openai", embeddings),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(dry_run=False, force=True),
        collection=collection,
    )

    assert summary.skipped_existing == 0
    assert summary.written == 1
    insert_query = next(query for query, _params in pg.queries if query.startswith("INSERT"))
    assert "WHERE task_embeddings.updated_at" not in insert_query


def test_backfill_refuses_dimension_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _MongoCollection(
        [{"_id": "t1", "projectId": "p1", "taskName": "Build auth"}]
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(_PgConnection(dimensions=3)),
    )

    with pytest.raises(TaskVectorBackfillError, match="dimension"):
        backfill_task_embeddings(
            settings=_settings(dimensions=2),
            options=TaskEmbeddingBackfillOptions(dry_run=True),
            collection=collection,
        )


def test_backfill_refuses_real_provider_dimension_drift_on_dry_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _MongoCollection(
        [{"_id": "t1", "projectId": "p1", "taskName": "Build auth"}]
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(_PgConnection(dimensions=512)),
    )

    with pytest.raises(TaskVectorBackfillError, match="EMBEDDINGS_DIMENSIONS"):
        backfill_task_embeddings(
            settings=_openai_settings(
                vector_dimensions=512,
                embeddings_dimensions=16,
            ),
            options=TaskEmbeddingBackfillOptions(dry_run=True),
            collection=collection,
        )


def test_backfill_prune_deleted_reports_stale_rows_on_dry_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _MongoCollection(
        [
            {"_id": "live", "projectId": "p1", "taskName": "Build auth"},
            {"_id": "invalid", "projectId": "p1", "taskName": ""},
        ]
    )
    pg = _PgConnection(
        existing={
            ("p1", "live"): None,
            ("p1", "invalid"): None,
            ("p1", "deleted"): None,
            ("p2", "other"): None,
        }
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(
            project_id="p1",
            dry_run=True,
            prune_deleted=True,
        ),
        collection=collection,
    )

    assert summary.stale_deleted == 1
    assert summary.skipped_invalid == 1
    assert summary.pruned_deleted == 0
    assert pg.deletes == []


def test_backfill_prune_deleted_removes_missing_rows_on_execute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _MongoCollection(
        [{"_id": "live", "projectId": "p1", "taskName": "Build auth"}]
    )
    pg = _PgConnection(
        existing={
            ("p1", "live"): None,
            ("p1", "deleted"): None,
        }
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_connect_postgres",
        lambda _uri: _PgContext(pg),
    )
    monkeypatch.setattr(
        task_vector_backfill,
        "_resolve_embeddings_provider",
        lambda **_kwargs: ("openai", _Embeddings()),
    )

    summary = backfill_task_embeddings(
        settings=_settings(),
        options=TaskEmbeddingBackfillOptions(
            dry_run=False,
            prune_deleted=True,
        ),
        collection=collection,
    )

    assert summary.stale_deleted == 1
    assert summary.pruned_deleted == 1
    assert pg.deletes == [("p1", "deleted")]


def test_validate_backfill_options_rejects_prune_with_limit() -> None:
    with pytest.raises(TaskVectorBackfillError, match="prune_deleted"):
        validate_backfill_options(
            TaskEmbeddingBackfillOptions(limit=1, prune_deleted=True)
        )
