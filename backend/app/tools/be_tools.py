"""BE-side tools (PRD v2.1 §5.5).

These are deterministic, dependency-free Python helpers that the agent
graphs call directly. Phase A intentionally avoided real LLM and
embedding providers so the test suite stays hermetic and the 100%
coverage gate is achievable without network access; the SHA-256
``embed`` / ``embedding_neighbors`` pair below is the deterministic
fallback that powers stub-mode neighbour scoring.

Tier 8 keeps the public ``embed`` / ``embedding_neighbors`` names but
branches internally on :func:`app.agents.embeddings.is_stub_embeddings`:
when an OpenAI key resolves we call the real :class:`Embeddings`
provider, and any provider exception falls back to the deterministic
SHA-256 helpers (mirroring the ``polish_*`` defensive pattern in the
catalog modules). This is design A from the Tier 8 brief -- it keeps
the diff smallest and the call sites unchanged. The resolved provider
is cached in a module-level singleton so a busy ``task-estimation``
run does not re-import or re-instantiate it on every node.

Each function is a pure callable so it can be unit-tested in isolation.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# summarise
# ---------------------------------------------------------------------------


_WHITESPACE = re.compile(r"\s+")


def summarize(text: str, max_chars: int = 280) -> str:
    """Collapse whitespace and trim to ``max_chars`` using head + tail.

    The helper keeps the first half and last half of the trimmed text with a
    ``"..."`` separator so the summary still reflects both ends of the
    input -- useful for board-brief headlines that want to preserve the
    closing call-to-action.
    """

    if max_chars < 1:
        raise ValueError("max_chars must be >= 1")

    cleaned = _WHITESPACE.sub(" ", text).strip()
    if len(cleaned) <= max_chars:
        return cleaned

    if max_chars <= 3:
        return cleaned[:max_chars]

    keep = max_chars - 3
    head = keep // 2 + (keep % 2)
    tail = keep - head
    if tail == 0:
        return cleaned[:head] + "..."
    return cleaned[:head] + "..." + cleaned[-tail:]


# ---------------------------------------------------------------------------
# embedding helpers
# ---------------------------------------------------------------------------


def _hash_floats(text: str, dim: int) -> list[float]:
    """Deterministically expand ``text`` to ``dim`` floats in ``[-1, 1]``."""

    bytes_needed = dim * 2  # 2 bytes per float for resolution
    digest = b""
    counter = 0
    while len(digest) < bytes_needed:
        digest += hashlib.sha256(f"{counter}:{text}".encode("utf-8")).digest()
        counter += 1
    out: list[float] = []
    for i in range(dim):
        slice_ = digest[i * 2 : i * 2 + 2]
        unsigned = int.from_bytes(slice_, "big")
        # Map to [-1, 1].
        out.append((unsigned / 65535.0) * 2.0 - 1.0)
    return out


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return list(vec)
    return [v / norm for v in vec]


def _stub_embed(texts: list[str], dim: int = 16) -> list[list[float]]:
    """Deterministic SHA-256 fallback used when no real provider resolves.

    Kept as the underlying implementation of :class:`_StubEmbeddings`
    in :mod:`app.agents.embeddings` so the byte-for-byte vector layout
    matches what every Phase A test was written against. ``dim`` is
    validated by the public :func:`embed` wrapper before this helper
    runs; both call sites pass a known-positive width.
    """

    return [_l2_normalize(_hash_floats(t, dim)) for t in texts]


# Process-wide cache for the resolved embeddings provider. Resolving
# the spec on every ``embed`` call would re-import langchain_openai
# (cheap but not free) and re-read settings (which the rest of the
# server treats as fixed-at-boot). Cache invalidation is a test-only
# concern -- :func:`reset_embeddings_singleton` exists for that.
_embeddings_singleton: Any = None


def _resolve_embeddings() -> Any:
    """Return the cached :class:`Embeddings`, building it on first use."""

    global _embeddings_singleton
    if _embeddings_singleton is None:
        # Local import: the agents package imports this module for the
        # stub implementation, so the top-level import would cycle.
        from app.agents.embeddings import make_embeddings

        _embeddings_singleton = make_embeddings()
    return _embeddings_singleton


def reset_embeddings_singleton() -> None:
    """Clear the cached embeddings provider (test helper)."""

    global _embeddings_singleton
    _embeddings_singleton = None


async def embed_async(texts: list[str], dim: int = 16) -> list[list[float]]:
    """Like :func:`embed` but safe to ``await`` from async LangGraph nodes.

    Deterministic stub embeddings stay on the event loop; real providers
    run the blocking ``embed_documents`` call in a worker thread so a
    slow OpenAI round-trip does not stall other HTTP requests on the
    same worker.
    """

    if dim < 1:
        raise ValueError("dim must be >= 1")
    from app.agents.embeddings import is_stub_embeddings

    model = _resolve_embeddings()
    if is_stub_embeddings(model):
        return _stub_embed(texts, dim=dim)
    if not texts:
        return []
    try:

        def call() -> list[list[float]]:
            return list(model.embed_documents(list(texts)))

        vectors = await asyncio.to_thread(call)
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("embeddings provider call failed; using stub fallback.")
        return _stub_embed(texts, dim=dim)
    return [_l2_normalize(list(vec)) for vec in vectors]


def embed(texts: list[str], dim: int = 16) -> list[list[float]]:
    """Return a ``dim``-dimensional embedding per input string.

    Routes through the configured provider (currently only OpenAI) when
    one resolves and falls back to the deterministic SHA-256 stub when
    the resolved model is the stub or the provider call raises. The
    fallback mirrors the ``polish_*`` defensive pattern in the catalog
    -- a flaky embeddings backend must never take down the
    ``task-estimation`` agent.

    The ``dim`` parameter is honoured on the stub path for backwards
    compatibility with callers that override the width; the OpenAI
    branch always returns ``STUB_EMBEDDING_DIM`` floats per the
    ``dimensions=`` request parameter pinned in
    :func:`app.agents.embeddings.make_embeddings`.
    """

    if dim < 1:
        raise ValueError("dim must be >= 1")
    # Local import to avoid the agents -> tools -> agents cycle.
    from app.agents.embeddings import is_stub_embeddings

    model = _resolve_embeddings()
    if is_stub_embeddings(model):
        return _stub_embed(texts, dim=dim)
    if not texts:
        return []
    try:
        vectors = model.embed_documents(list(texts))
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("embeddings provider call failed; using stub fallback.")
        return _stub_embed(texts, dim=dim)
    # Provider responses are L2-normalised by OpenAI for the
    # ``text-embedding-3-*`` family, but a future provider might not
    # be -- normalise defensively so ``embedding_neighbors``'s
    # dot-product-equals-cosine invariant holds either way.
    return [_l2_normalize(list(vec)) for vec in vectors]


def _dot_normalised(a: list[float], b: list[float]) -> float:
    """Dot product of two vectors that the caller has already L2-normalised.

    Equivalent to cosine similarity *only* when both inputs are unit
    vectors. ``embedding_neighbors`` guarantees this via :func:`embed`.
    """

    if len(a) != len(b):
        raise ValueError("vectors must share dimensionality")
    return sum(x * y for x, y in zip(a, b))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Proper cosine similarity for arbitrary (non-normalised) vectors."""

    if len(a) != len(b):
        raise ValueError("vectors must share dimensionality")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def embedding_neighbors(
    query_embedding: list[float],
    corpus: list[tuple[str, list[float]]],
    k: int = 5,
) -> list[tuple[str, float]]:
    """Return the top-``k`` ``(id, score)`` pairs by cosine similarity, descending.

    Both ``query_embedding`` and every vector in ``corpus`` are required
    to be L2-normalised (which :func:`embed` guarantees). When that
    invariant holds the dot product equals cosine similarity, so we use
    the cheaper :func:`_dot_normalised` instead of the full division.
    Callers with non-normalised vectors should use
    :func:`cosine_similarity` directly.
    """

    if k < 1:
        raise ValueError("k must be >= 1")
    scored = [
        (item_id, _dot_normalised(query_embedding, vec)) for item_id, vec in corpus
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:k]


# ---------------------------------------------------------------------------
# drift detection (PRD §5A.3 step 2)
# ---------------------------------------------------------------------------


_WIP_LIMIT = 5
_STALE_DAYS = 7

# Common column-name labels that indicate a "Done" / completed bucket
# when no explicit ``isDone`` flag is set on the column. Lowercased
# match. Keep terse and locale-aware -- the previous version only
# matched English ``"done"``, which silently disabled WIP overflow
# detection on non-English boards (column names like "Terminé"
# wrongly triggered overflow signals when they shouldn't).
_DONE_COLUMN_NAMES = frozenset(
    {
        "done",
        "complete",
        "completed",
        "closed",
        "shipped",
        "released",
        "terminé",  # fr
        "terminée",  # fr
        "abgeschlossen",  # de
        "fertig",  # de
        "完了",  # ja
        "完成",  # zh
        "完成済み",  # ja
        "hecho",  # es
        "concluido",  # pt
    }
)


def _is_done_column(col: dict[str, Any]) -> bool:
    """Return True if ``col`` should be excluded from WIP overflow detection."""

    if col.get("isDone") is True:
        return True
    name = (col.get("name") or "").strip().lower()
    return bool(name) and name in _DONE_COLUMN_NAMES


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def detect_drift(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Rule-based drift detector returning ``{"signals": [...], "severity": "..."}``.

    Implements three lightweight checks:
        - WIP overflow: any non-Done column with >5 cards.
        - Stale tasks: a card with ``updatedAt`` older than 7 days.
        - Unowned bugs: ``type=="bug"`` with no coordinator.
    """

    columns = snapshot.get("columns") or []
    tasks = snapshot.get("tasks") or []
    now = datetime.now(timezone.utc)

    signals: list[dict[str, Any]] = []

    # WIP overflow per non-Done column.
    column_counts: dict[str, int] = {}
    for task in tasks:
        column_id = task.get("columnId") or task.get("column")
        if column_id is None:
            continue
        column_counts[column_id] = column_counts.get(column_id, 0) + 1

    for col in columns:
        col_id = col.get("id")
        if col_id is None or _is_done_column(col):
            continue
        # Honour an explicit per-column ``wipLimit`` when the FE
        # supplies one; otherwise fall back to the org-default. A
        # ``wipLimit`` of 0 / negative is treated as "no limit set".
        explicit = col.get("wipLimit")
        limit = (
            int(explicit)
            if isinstance(explicit, int) and explicit > 0
            else _WIP_LIMIT
        )
        count = column_counts.get(col_id, 0)
        if count > limit:
            signals.append(
                {
                    "type": "wip_overflow",
                    "column_id": col_id,
                    "column_name": col.get("name"),
                    "count": count,
                    "limit": limit,
                }
            )

    for task in tasks:
        updated = _parse_iso(task.get("updatedAt"))
        if updated is not None:
            age_days = (now - updated).total_seconds() / 86400.0
            if age_days > _STALE_DAYS:
                signals.append(
                    {
                        "type": "stale_task",
                        "task_id": task.get("id"),
                        "age_days": round(age_days, 1),
                    }
                )
        if task.get("type") == "bug" and not task.get("coordinatorId"):
            signals.append(
                {
                    "type": "unowned_bug",
                    "task_id": task.get("id"),
                }
            )

    if any(s["type"] == "unowned_bug" for s in signals):
        severity = "critical"
    elif signals:
        severity = "warn"
    else:
        severity = "info"

    return {"signals": signals, "severity": severity}


# ---------------------------------------------------------------------------
# citation helpers (PRD §FE wire contract)
# ---------------------------------------------------------------------------

_VALID_CITATION_SOURCES = frozenset({"task", "column", "member", "project"})


def validated_citation_ref(*, source: str, id: str | None, quote: str) -> dict[str, Any]:
    """Return a citation ref dict after validating ``source`` against the FE contract.

    The FE wire contract (``src/interfaces/agent.d.ts``) declares
    ``source: "task" | "column" | "member" | "project"``. Any other value
    silently corrupts citation chip state on every stream; this helper
    raises ``ValueError`` loudly so the bug surfaces in tests rather than
    in production.
    """

    if source not in _VALID_CITATION_SOURCES:
        raise ValueError(
            f"invalid citation source {source!r}; must be one of {sorted(_VALID_CITATION_SOURCES)}"
        )
    return {"source": source, "id": id, "quote": quote}
