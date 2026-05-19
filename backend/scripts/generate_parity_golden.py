#!/usr/bin/env python3
"""Generate ``parity_golden.json`` from the BE deterministic baselines.

This script reads the parity fixtures committed at
``src/utils/ai/__tests__/fixtures/parity.json`` and runs each one through
the BE's deterministic helpers (``_draft_from_prompt`` / ``draft_task`` /
``semantic_search``). The result is written to
``src/utils/ai/__tests__/fixtures/parity_golden.json`` and consumed by the
TypeScript parity test (``src/utils/ai/__tests__/parity.test.ts``).

The TS test compares the FE engine output to this golden file on every
run; if the BE heuristics drift, the TS test fails and someone must
regenerate the golden (and decide whether the FE needs to follow).

Run from the repo root::

    python3 backend/scripts/generate_parity_golden.py

or via uv if the backend env is isolated::

    cd backend && uv run python ../backend/scripts/generate_parity_golden.py

The script is intentionally simple — no CLI flags, no env knobs. Pinning
the BE heuristic snapshot in a committed JSON file is the entire point.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# Allow running from the repo root by adding backend/ to sys.path so the
# ``app`` package resolves the same way it does in production.
ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.agents.catalog.search import semantic_search  # noqa: E402
from app.agents.catalog.task_drafting import (  # noqa: E402
    _epic_for,
    _type_for,
    draft_task,
)

FIXTURE_PATH = (
    ROOT / "src" / "utils" / "ai" / "__tests__" / "fixtures" / "parity.json"
)
GOLDEN_PATH = (
    ROOT / "src" / "utils" / "ai" / "__tests__" / "fixtures" / "parity_golden.json"
)


# Normalize the FE/BE type vocabularies to a single canonical bucket so the
# TS test can compare without re-implementing the mapping in JS.
#
#   FE detect_type returns "Task" | "Bug"
#   BE _type_for returns "feature" | "bug" | "spike"
#
# We bucket both into {"bug", "feature_or_task", "spike"}: this preserves the
# "the prompt looked like a bug" signal — which is what parity actually cares
# about — while letting the FE keep its richer feature/task distinction and
# the BE keep its spike branch.
_TYPE_CANONICAL = {
    "Bug": "bug",
    "Task": "feature_or_task",
    "bug": "bug",
    "feature": "feature_or_task",
    "task": "feature_or_task",
    "spike": "spike",
}


# Epic vocabularies use the same source list of hints but slightly
# different default values: FE = "New Feature", BE = "General". We unify the
# default to a sentinel so the comparison stays meaningful.
_EPIC_DEFAULTS = {"New Feature", "General"}


def _canonical_type(raw: str) -> str:
    return _TYPE_CANONICAL.get(raw, raw)


def _canonical_epic(raw: str) -> str:
    if raw in _EPIC_DEFAULTS:
        return "DEFAULT"
    return raw


def _be_draft(fixture_input: dict[str, Any]) -> dict[str, Any]:
    """Compute the BE deterministic draft and return canonical fields."""
    prompt = fixture_input.get("prompt") or ""
    # ``_type_for`` and ``_epic_for`` are the BE's source-of-truth helpers
    # for the two signals we compare.  Calling them directly (rather than
    # extracting from ``draft_task``'s output) keeps the comparison
    # focused on the heuristic, not the wire shape.
    raw_type = _type_for(prompt)
    raw_epic = _epic_for(prompt)
    # Also compute the full ``draft_task`` so consumers can see other
    # fields if they want to extend the test.
    full = draft_task({"prompt": prompt})
    return {
        "type": _canonical_type(raw_type),
        "type_raw_be": raw_type,
        "epic": _canonical_epic(raw_epic),
        "epic_raw_be": raw_epic,
        "storyPoints": full.get("storyPoints"),
    }


def _be_search(fixture_input: dict[str, Any]) -> dict[str, Any]:
    kind = fixture_input.get("kind") or "tasks"
    query = fixture_input.get("query") or ""
    context = fixture_input.get("context") or {}
    result = semantic_search(kind, query, context)
    ids = list(result.get("ids") or [])
    return {
        "ids_set": sorted(ids),
        "ids_order": ids,
        "has_results": len(ids) > 0,
    }


def _generate() -> dict[str, Any]:
    fixtures = json.loads(FIXTURE_PATH.read_text())["fixtures"]
    golden: dict[str, Any] = {}
    for fx in fixtures:
        fid = fx["id"]
        kind = fx["kind"]
        if kind == "draft":
            golden[fid] = _be_draft(fx["input"])
        elif kind == "search":
            golden[fid] = _be_search(fx["input"])
        else:
            raise ValueError(f"Unsupported fixture kind {kind!r} (id={fid})")
    return golden


def main() -> int:
    golden = _generate()
    GOLDEN_PATH.write_text(json.dumps(golden, indent=4, sort_keys=True) + "\n")
    print(f"Wrote {len(golden)} entries to {GOLDEN_PATH}")
    # Run prettier in-place if available, so the committed JSON file
    # matches the repo's standard formatting. Without this the JS
    # tooling complains about ``parity_golden.json`` on every CI run.
    prettier = shutil.which("prettier") or shutil.which("npx")
    if prettier:
        args = (
            [prettier, "--write", str(GOLDEN_PATH)]
            if prettier.endswith("prettier")
            else [prettier, "prettier", "--write", str(GOLDEN_PATH)]
        )
        try:
            subprocess.run(args, check=False, cwd=str(ROOT))
        except FileNotFoundError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
