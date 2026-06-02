#!/usr/bin/env python3
"""Backfill Mongo tasks into the pgvector task_embeddings table."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

SCRIPT = Path(__file__).resolve()
BACKEND_CANDIDATES = (SCRIPT.parent.parent, SCRIPT.parent.parent.parent / "backend")
BACKEND = next(
    (candidate for candidate in BACKEND_CANDIDATES if (candidate / "app").is_dir()),
    BACKEND_CANDIDATES[0],
)
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.agents.task_vector_backfill import (  # noqa: E402
    DEFAULT_BATCH_SIZE,
    TaskEmbeddingBackfillOptions,
    TaskVectorBackfillError,
    backfill_task_embeddings,
)
from app.config import Settings  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill existing Mongo tasks into Postgres task_embeddings. "
            "Defaults to dry-run; pass --execute to write rows."
        )
    )
    parser.add_argument("--project-id", help="Limit backfill to one projectId.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Mongo/embedding batch size, 1-1000. Default: {DEFAULT_BATCH_SIZE}.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Scan at most N Mongo task documents.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write missing or stale embeddings. Without this flag, only diagnose.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-embed valid tasks even when task_embeddings already has them.",
    )
    parser.add_argument(
        "--prune-deleted",
        action="store_true",
        help=(
            "Delete task_embeddings rows whose Mongo tasks are no longer present. "
            "Dry-run reports staleDeleted without deleting."
        ),
    )
    parser.add_argument(
        "--allow-stub-embeddings",
        action="store_true",
        help="Permit deterministic stub embeddings for non-production testing.",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parser().parse_args(argv)
    options = TaskEmbeddingBackfillOptions(
        project_id=args.project_id,
        batch_size=args.batch_size,
        limit=args.limit,
        dry_run=not args.execute,
        force=args.force,
        allow_stub_embeddings=args.allow_stub_embeddings,
        prune_deleted=args.prune_deleted,
    )
    try:
        summary = backfill_task_embeddings(settings=Settings(), options=options)
    except TaskVectorBackfillError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "task_embedding_backfill_failed",
                        "message": str(exc),
                    },
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps({"ok": True, "summary": summary.to_dict()}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
