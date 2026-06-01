"""Backfill Mongo tasks into the pgvector task_embeddings table."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import math
import re
from typing import Optional, Protocol, cast

from langchain_core.embeddings import Embeddings

from app.config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 100
MAX_BATCH_SIZE = 1000
MAX_EMBEDDING_TEXT_CHARS = 8000

_VECTOR_TYPE_RE = re.compile(r"^vector\((?P<dimensions>[1-9][0-9]*)\)$")


class TaskVectorBackfillError(RuntimeError):
    """Raised when the task embedding backfill cannot safely run."""


class MongoTaskCursor(Protocol):
    def sort(self, key_or_list: str, direction: int) -> "MongoTaskCursor": ...

    def batch_size(self, batch_size: int) -> "MongoTaskCursor": ...

    def __iter__(self) -> Iterator[Mapping[str, object]]: ...


class MongoTaskCollection(Protocol):
    def find(
        self,
        filter: Mapping[str, object],
        projection: Mapping[str, int],
    ) -> MongoTaskCursor: ...


class PgCursor(Protocol):
    @property
    def rowcount(self) -> int: ...

    def execute(
        self,
        query: str,
        params: Sequence[object] = (),
    ) -> object: ...

    def fetchone(self) -> Sequence[object] | None: ...

    def fetchall(self) -> Sequence[Sequence[object]]: ...


class PgConnection(Protocol):
    def cursor(self) -> AbstractContextManager[PgCursor]: ...

    def commit(self) -> object: ...


@dataclass(frozen=True)
class TaskEmbeddingBackfillOptions:
    """Operator-controlled knobs for the pgvector backfill."""

    project_id: Optional[str] = None
    batch_size: int = DEFAULT_BATCH_SIZE
    limit: Optional[int] = None
    dry_run: bool = True
    force: bool = False
    allow_stub_embeddings: bool = False
    prune_deleted: bool = False


@dataclass(frozen=True)
class TaskEmbeddingSource:
    project_id: str
    task_id: str
    label: str
    embedding_text: str
    updated_at: Optional[datetime]


@dataclass(frozen=True)
class TaskEmbeddingBackfillSummary:
    dry_run: bool
    force: bool
    provider: str
    dimensions: int
    scanned: int
    valid: int
    skipped_invalid: int
    skipped_existing: int
    stale_deleted: int
    embedded: int
    written: int
    pruned_deleted: int
    batches: int
    last_task_id: Optional[str]

    def to_dict(self) -> dict[str, object]:
        return {
            "dry_run": self.dry_run,
            "force": self.force,
            "provider": self.provider,
            "dimensions": self.dimensions,
            "scanned": self.scanned,
            "valid": self.valid,
            "skippedInvalid": self.skipped_invalid,
            "skippedExisting": self.skipped_existing,
            "staleDeleted": self.stale_deleted,
            "embedded": self.embedded,
            "written": self.written,
            "prunedDeleted": self.pruned_deleted,
            "batches": self.batches,
            "lastTaskId": self.last_task_id,
        }


@dataclass
class _MutableSummary:
    scanned: int = 0
    valid: int = 0
    skipped_invalid: int = 0
    skipped_existing: int = 0
    stale_deleted: int = 0
    embedded: int = 0
    written: int = 0
    pruned_deleted: int = 0
    batches: int = 0
    last_task_id: Optional[str] = None

    def freeze(
        self,
        *,
        options: TaskEmbeddingBackfillOptions,
        provider: str,
        dimensions: int,
    ) -> TaskEmbeddingBackfillSummary:
        return TaskEmbeddingBackfillSummary(
            dry_run=options.dry_run,
            force=options.force,
            provider=provider,
            dimensions=dimensions,
            scanned=self.scanned,
            valid=self.valid,
            skipped_invalid=self.skipped_invalid,
            skipped_existing=self.skipped_existing,
            stale_deleted=self.stale_deleted,
            embedded=self.embedded,
            written=self.written,
            pruned_deleted=self.pruned_deleted,
            batches=self.batches,
            last_task_id=self.last_task_id,
        )


def validate_backfill_options(
    options: TaskEmbeddingBackfillOptions,
) -> TaskEmbeddingBackfillOptions:
    if options.batch_size < 1 or options.batch_size > MAX_BATCH_SIZE:
        raise TaskVectorBackfillError(
            f"batch_size must be between 1 and {MAX_BATCH_SIZE}"
        )
    if options.limit is not None and options.limit < 1:
        raise TaskVectorBackfillError("limit must be a positive integer")
    if options.prune_deleted and options.limit is not None:
        raise TaskVectorBackfillError("prune_deleted cannot be combined with limit")
    project_id = options.project_id.strip() if options.project_id else None
    return TaskEmbeddingBackfillOptions(
        project_id=project_id or None,
        batch_size=options.batch_size,
        limit=options.limit,
        dry_run=options.dry_run,
        force=options.force,
        allow_stub_embeddings=options.allow_stub_embeddings,
        prune_deleted=options.prune_deleted,
    )


def task_embedding_text(task: Mapping[str, object]) -> str:
    """Return bounded semantic text for one Mongo task document."""

    parts: list[str] = []
    for key, prefix in (
        ("taskName", "Task"),
        ("type", "Type"),
        ("epic", "Epic"),
        ("note", "Notes"),
    ):
        value = task.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(f"{prefix}: {value.strip()}")
    story_points = task.get("storyPoints")
    if isinstance(story_points, (int, float)) and not isinstance(story_points, bool):
        if math.isfinite(float(story_points)):
            parts.append(f"Story points: {story_points}")
    text = "\n".join(parts)
    return text[:MAX_EMBEDDING_TEXT_CHARS]


def task_embedding_source(
    task: Mapping[str, object],
) -> Optional[TaskEmbeddingSource]:
    task_key = _task_key(task)
    label_raw = task.get("taskName")
    if task_key is None:
        return None
    project_id, task_id = task_key
    if not isinstance(label_raw, str) or not label_raw.strip():
        return None
    embedding_text = task_embedding_text(task)
    if not embedding_text.strip():
        return None
    updated_at_raw = task.get("updatedAt")
    updated_at = (
        _normalise_datetime(updated_at_raw)
        if isinstance(updated_at_raw, datetime)
        else None
    )
    return TaskEmbeddingSource(
        project_id=project_id,
        task_id=task_id,
        label=label_raw.strip(),
        embedding_text=embedding_text,
        updated_at=updated_at,
    )


def _task_key(task: Mapping[str, object]) -> Optional[tuple[str, str]]:
    task_id_raw = task.get("_id")
    project_id_raw = task.get("projectId")
    if task_id_raw is None or project_id_raw is None:
        return None
    project_id = str(project_id_raw).strip()
    task_id = str(task_id_raw).strip()
    if not project_id or not task_id:
        return None
    return project_id, task_id


def _normalise_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _dimensions(cfg: Settings) -> int:
    return cfg.agent_vector_dimensions or cfg.embeddings_dimensions


def _validate_dimensions(
    *,
    cfg: Settings,
    provider: str,
    table_dimensions: int,
) -> int:
    dimensions = _dimensions(cfg)
    if table_dimensions != dimensions:
        raise TaskVectorBackfillError(
            "task_embeddings.embedding dimension does not match configuration: "
            f"table={table_dimensions} configured={dimensions}"
        )
    if (
        provider != "stub"
        and cfg.agent_vector_dimensions
        and cfg.agent_vector_dimensions != cfg.embeddings_dimensions
    ):
        raise TaskVectorBackfillError(
            "AGENT_VECTOR_DIMENSIONS must match EMBEDDINGS_DIMENSIONS for "
            "real embedding backfills: "
            f"agent_vector={cfg.agent_vector_dimensions} "
            f"embeddings={cfg.embeddings_dimensions}"
        )
    return dimensions


def _resolve_postgres_uri(cfg: Settings) -> str:
    try:
        from app.agents.checkpointing import resolve_agent_postgres_uri

        return resolve_agent_postgres_uri(cfg, backend_env="AGENT_VECTOR_SEARCH")
    except Exception as exc:
        raise TaskVectorBackfillError(
            "AGENT_VECTOR_SEARCH backfill requires AGENT_POSTGRES_URI or POSTGRES_URI"
        ) from exc


def _connect_postgres(uri: str) -> AbstractContextManager[PgConnection]:
    try:
        import psycopg
    except ImportError as exc:
        raise TaskVectorBackfillError(
            'psycopg is not installed; install `pip install ".[postgres-agents]"`'
        ) from exc
    try:
        return cast(AbstractContextManager[PgConnection], psycopg.connect(uri))
    except Exception as exc:
        raise TaskVectorBackfillError(
            "Postgres connection failed for task embedding backfill"
        ) from exc


def _mongo_tasks_collection() -> MongoTaskCollection:
    from app import database

    return cast(MongoTaskCollection, database.collection(database.TASKS))


def _resolve_embeddings_provider(
    *,
    cfg: Settings,
    options: TaskEmbeddingBackfillOptions,
) -> tuple[str, Optional[Embeddings]]:
    from app.agents.embeddings import (
        is_stub_embeddings,
        make_embeddings,
        resolve_embeddings_spec,
    )

    spec = resolve_embeddings_spec(settings=cfg)
    if options.dry_run:
        return spec.provider, None

    model = make_embeddings(settings=cfg)
    if is_stub_embeddings(model) and not options.allow_stub_embeddings:
        raise TaskVectorBackfillError(
            "Refusing to backfill task_embeddings with stub embeddings; set "
            "EMBEDDINGS_PROVIDER=openai or pass --allow-stub-embeddings for "
            "non-production testing"
        )
    return spec.provider, model


def _vector_literal(vector: Sequence[float], expected_dimensions: int) -> str:
    if len(vector) != expected_dimensions:
        raise TaskVectorBackfillError(
            f"embedding provider returned {len(vector)} dimensions; "
            f"expected {expected_dimensions}"
        )
    values: list[str] = []
    for raw in vector:
        value = float(raw)
        if not math.isfinite(value):
            raise TaskVectorBackfillError("embedding provider returned a non-finite value")
        values.append(str(value))
    return "[" + ",".join(values) + "]"


def _fetch_task_embeddings_dimension(conn: PgConnection) -> int:
    sql = (
        "SELECT format_type(a.atttypid, a.atttypmod) "
        "FROM pg_attribute a "
        "WHERE a.attrelid = to_regclass('task_embeddings') "
        "AND a.attname = 'embedding' "
        "AND NOT a.attisdropped "
        "LIMIT 1"
    )
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if row is None or not row:
        raise TaskVectorBackfillError(
            "task_embeddings.embedding was not found; run "
            "docs/operations/pgvector-task-embeddings.sql first"
        )
    vector_type = str(row[0])
    match = _VECTOR_TYPE_RE.match(vector_type)
    if match is None:
        raise TaskVectorBackfillError(
            "task_embeddings.embedding is not a fixed-dimension pgvector column"
        )
    return int(match.group("dimensions"))


def _existing_task_updated_at(
    conn: PgConnection,
    sources: Sequence[TaskEmbeddingSource],
) -> dict[tuple[str, str], Optional[datetime]]:
    if not sources:
        return {}
    task_ids = [source.task_id for source in sources]
    project_ids = list({source.project_id for source in sources})
    with conn.cursor() as cur:
        cur.execute(
            "SELECT project_id, task_id, updated_at FROM task_embeddings "
            "WHERE project_id = ANY(%s) AND task_id = ANY(%s)",
            (project_ids, task_ids),
        )
        rows = cur.fetchall()
    existing: dict[tuple[str, str], Optional[datetime]] = {}
    for row in rows:
        if len(row) < 3:
            continue
        project_id = str(row[0])
        task_id = str(row[1])
        updated_at = row[2]
        existing[(project_id, task_id)] = (
            _normalise_datetime(updated_at)
            if isinstance(updated_at, datetime)
            else None
        )
    return existing


def _needs_backfill(
    source: TaskEmbeddingSource,
    existing: Mapping[tuple[str, str], Optional[datetime]],
    *,
    force: bool,
) -> bool:
    if force:
        return True
    key = (source.project_id, source.task_id)
    if key not in existing:
        return True
    existing_updated_at = existing[key]
    if source.updated_at is None or existing_updated_at is None:
        return False
    return existing_updated_at < source.updated_at


def _write_embeddings(
    conn: PgConnection,
    sources: Sequence[TaskEmbeddingSource],
    vectors: Sequence[Sequence[float]],
    *,
    dimensions: int,
    force: bool,
) -> int:
    if len(sources) != len(vectors):
        raise TaskVectorBackfillError("embedding provider returned the wrong row count")
    sql_base = (
        "INSERT INTO task_embeddings "
        "(project_id, task_id, label, embedding, updated_at) "
        "VALUES (%s, %s, %s, %s::vector, %s) "
        "ON CONFLICT (project_id, task_id) DO UPDATE SET "
        "label = EXCLUDED.label, "
        "embedding = EXCLUDED.embedding, "
        "updated_at = EXCLUDED.updated_at"
    )
    sql = (
        sql_base
        if force
        else sql_base + " WHERE task_embeddings.updated_at <= EXCLUDED.updated_at"
    )
    written = 0
    with conn.cursor() as cur:
        for source, vector in zip(sources, vectors, strict=True):
            updated_at = source.updated_at or datetime.now(timezone.utc)
            cur.execute(
                sql,
                (
                    source.project_id,
                    source.task_id,
                    source.label,
                    _vector_literal(vector, dimensions),
                    updated_at,
                ),
            )
            written += max(cur.rowcount, 0)
    conn.commit()
    return written


def _embedding_keys(
    conn: PgConnection,
    *,
    project_id: Optional[str],
) -> set[tuple[str, str]]:
    if project_id is None:
        sql = "SELECT project_id, task_id FROM task_embeddings"
        params: tuple[object, ...] = ()
    else:
        sql = "SELECT project_id, task_id FROM task_embeddings WHERE project_id = %s"
        params = (project_id,)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return {
        (str(row[0]), str(row[1]))
        for row in rows
        if len(row) >= 2 and row[0] is not None and row[1] is not None
    }


def _delete_embeddings(
    conn: PgConnection,
    keys: Sequence[tuple[str, str]],
) -> int:
    if not keys:
        return 0
    project_ids = [project_id for project_id, _task_id in keys]
    task_ids = [task_id for _project_id, task_id in keys]
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM task_embeddings "
            "WHERE (project_id, task_id) IN ("
            "SELECT * FROM UNNEST(%s::text[], %s::text[])"
            ")",
            (project_ids, task_ids),
        )
        pruned = max(cur.rowcount, 0)
    conn.commit()
    return pruned


def _task_query(project_id: Optional[str]) -> dict[str, object]:
    if project_id is None:
        return {}
    return {"projectId": project_id}


def _task_projection() -> dict[str, int]:
    return {
        "_id": 1,
        "projectId": 1,
        "taskName": 1,
        "type": 1,
        "epic": 1,
        "note": 1,
        "storyPoints": 1,
        "updatedAt": 1,
    }


def _iter_batches(
    rows: Iterable[Mapping[str, object]],
    *,
    batch_size: int,
    limit: Optional[int],
    summary: _MutableSummary,
    seen_task_keys: set[tuple[str, str]],
) -> Iterator[list[TaskEmbeddingSource]]:
    batch: list[TaskEmbeddingSource] = []
    for row in rows:
        if limit is not None and summary.scanned >= limit:
            break
        summary.scanned += 1
        task_key = _task_key(row)
        if task_key is not None:
            seen_task_keys.add(task_key)
        source = task_embedding_source(row)
        if source is None:
            summary.skipped_invalid += 1
            continue
        summary.valid += 1
        summary.last_task_id = source.task_id
        batch.append(source)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def backfill_task_embeddings(
    *,
    settings: Optional[Settings] = None,
    options: TaskEmbeddingBackfillOptions = TaskEmbeddingBackfillOptions(),
    collection: Optional[MongoTaskCollection] = None,
) -> TaskEmbeddingBackfillSummary:
    """Backfill Mongo tasks into pgvector with dry-run and resume support."""

    cfg = settings if settings is not None else default_settings
    resolved_options = validate_backfill_options(options)
    dimensions = _dimensions(cfg)
    provider, embeddings_model = _resolve_embeddings_provider(
        cfg=cfg,
        options=resolved_options,
    )
    postgres_uri = _resolve_postgres_uri(cfg)
    tasks = collection if collection is not None else _mongo_tasks_collection()

    summary = _MutableSummary()
    seen_task_keys: set[tuple[str, str]] = set()
    with _connect_postgres(postgres_uri) as conn:
        table_dimensions = _fetch_task_embeddings_dimension(conn)
        dimensions = _validate_dimensions(
            cfg=cfg,
            provider=provider,
            table_dimensions=table_dimensions,
        )
        cursor = tasks.find(
            _task_query(resolved_options.project_id),
            _task_projection(),
        ).sort("_id", 1)
        cursor = cursor.batch_size(resolved_options.batch_size)
        for batch in _iter_batches(
            cursor,
            batch_size=resolved_options.batch_size,
            limit=resolved_options.limit,
            summary=summary,
            seen_task_keys=seen_task_keys,
        ):
            summary.batches += 1
            existing = _existing_task_updated_at(conn, batch)
            pending = [
                source
                for source in batch
                if _needs_backfill(
                    source,
                    existing,
                    force=resolved_options.force,
                )
            ]
            summary.skipped_existing += len(batch) - len(pending)
            if resolved_options.dry_run or not pending:
                continue
            if embeddings_model is None:
                raise TaskVectorBackfillError("embeddings provider was not initialised")
            vectors = embeddings_model.embed_documents(
                [source.embedding_text for source in pending]
            )
            summary.embedded += len(pending)
            summary.written += _write_embeddings(
                conn,
                pending,
                vectors,
                dimensions=dimensions,
                force=resolved_options.force,
            )
        if resolved_options.prune_deleted:
            stale_keys = sorted(
                _embedding_keys(conn, project_id=resolved_options.project_id)
                - seen_task_keys
            )
            summary.stale_deleted = len(stale_keys)
            if stale_keys and not resolved_options.dry_run:
                summary.pruned_deleted = _delete_embeddings(conn, stale_keys)

    frozen = summary.freeze(
        options=resolved_options,
        provider=provider,
        dimensions=dimensions,
    )
    logger.info(
        "Task embeddings backfill finished dry_run=%s scanned=%d valid=%d "
        "skipped_existing=%d skipped_invalid=%d written=%d pruned_deleted=%d",
        frozen.dry_run,
        frozen.scanned,
        frozen.valid,
        frozen.skipped_existing,
        frozen.skipped_invalid,
        frozen.written,
        frozen.pruned_deleted,
    )
    return frozen
