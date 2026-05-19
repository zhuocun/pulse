"""Optional pgvector-backed task neighbours for estimation and search.

Disabled unless ``AGENT_VECTOR_SEARCH_ENABLED`` is true and psycopg is
installed. Operators run ``docs/operations/pgvector-task-embeddings.sql``
against the same Postgres cluster as LangGraph checkpoints when enabling
this path.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.config import Settings, settings as default_settings

logger = logging.getLogger(__name__)


def _dimensions(cfg: Settings) -> int:
    return cfg.agent_vector_dimensions or cfg.embeddings_dimensions


def fetch_vector_neighbours_for_project(
    *,
    project_id: str,
    query_embedding: list[float],
    limit: int = 8,
    settings: Optional[Settings] = None,
) -> list[dict[str, Any]]:
    """Return ``[{"id", "text", "score"}, ...]`` from pgvector, newest first."""

    cfg = settings if settings is not None else default_settings
    if not cfg.agent_vector_search_enabled or not project_id:
        return []
    if not query_embedding:
        return []
    try:
        from app.agents.checkpointing import resolve_agent_postgres_uri
    except Exception:  # pragma: no cover - defensive
        return []
    try:
        uri = resolve_agent_postgres_uri(cfg, backend_env="AGENT_VECTOR_SEARCH")
    except Exception:
        try:
            uri = resolve_agent_postgres_uri(cfg, backend_env="AGENT_CHECKPOINT_BACKEND")
        except Exception:
            logger.debug("Vector search skipped: no Postgres URI resolved.")
            return []
    dim = _dimensions(cfg)
    if len(query_embedding) != dim:
        logger.debug(
            "Vector search skipped: query dim %d != configured %d",
            len(query_embedding),
            dim,
        )
        return []
    try:
        import psycopg
    except ImportError:
        logger.debug("Vector search skipped: psycopg not installed.")
        return []

    vec_lit = "[" + ",".join(str(float(x)) for x in query_embedding) + "]"
    sql = (
        "SELECT task_id, label, 1 - (embedding <=> %s::vector) AS score "
        "FROM task_embeddings WHERE project_id = %s "
        "ORDER BY embedding <=> %s::vector ASC LIMIT %s"
    )
    try:
        with psycopg.connect(uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (vec_lit, project_id, vec_lit, limit))
                rows = cur.fetchall()
    except Exception:
        logger.warning("pgvector query failed; continuing without store hits.", exc_info=True)
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        tid, label, score = row[0], row[1], row[2]
        out.append(
            {
                "id": str(tid),
                "text": str(label or ""),
                "score": float(score) if score is not None else 0.0,
            }
        )
    return out


async def fetch_vector_neighbours_for_project_async(
    *,
    project_id: str,
    query_embedding: list[float],
    limit: int = 8,
    settings: Optional[Settings] = None,
) -> list[dict[str, Any]]:
    """Async wrapper around :func:`fetch_vector_neighbours_for_project`.

    Runs the synchronous ``psycopg.connect`` call inside
    :func:`asyncio.to_thread` so the event loop is not blocked while the
    database round-trip completes. The catalog's ``_shared.py`` call site
    should prefer this async variant; the sync function is kept for
    backward-compatibility and direct test use.
    """

    return await asyncio.to_thread(
        fetch_vector_neighbours_for_project,
        project_id=project_id,
        query_embedding=query_embedding,
        limit=limit,
        settings=settings,
    )


def merge_similar_with_vector_hits(
    similar: list[Any],
    vector_hits: list[dict[str, Any]],
    *,
    max_total: int = 24,
) -> list[dict[str, Any]]:
    """Merge FE ``similar`` list with store hits without duplicate ids."""

    merged: dict[str, dict[str, Any]] = {}
    for item in similar or []:
        if not isinstance(item, dict):
            continue
        tid = item.get("id")
        if not tid:
            continue
        tid_s = str(tid)
        merged[tid_s] = {
            "id": tid_s,
            "text": str(item.get("text", "") or ""),
        }
    for hit in vector_hits:
        tid = hit.get("id")
        if not tid or tid in merged:
            continue
        merged[str(tid)] = {"id": str(tid), "text": str(hit.get("text", "") or "")}
    items = list(merged.values())
    return items[:max_total]
