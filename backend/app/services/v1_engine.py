"""Deterministic Python port of the FE v1 ``utils/ai/engine.ts``.

The v1 ``/api/ai/<route>`` surface in pulse posts JSON, expects
JSON back, and never streams. This module ships small, dependency-free
implementations of the routes the FE drives today (draft, breakdown,
estimate, readiness, brief, search) so a deployment with
``REACT_APP_AI_BASE_URL`` set can use the BE without touching the v2.1
LangGraph agent endpoints. The v2.1 surface remains the recommended
path; this shim exists for the shipped FE that hasn't migrated yet.

Every output shape matches the FE's TypeScript declarations
(``src/interfaces/ai.d.ts``) so client-side validators
(``src/utils/ai/validate.ts``) pass without changes.
"""

from __future__ import annotations

from collections import Counter
import re
from typing import Any, Iterable, Optional

from app.domain.story_points import FIBONACCI_STORY_POINTS
_BUG_HINTS = (
    "bug",
    "fix",
    "broken",
    "crash",
    "error",
    "regression",
    "flaky",
    "leak",
    "issue",
    "incident",
    "outage",
    "failing",
)

_EPIC_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Bug Fix", _BUG_HINTS),
    (
        "Performance",
        ("slow", "perf", "latency", "throughput", "memory", "cache"),
    ),
    ("Auth", ("login", "auth", "token", "session", "password", "signup")),
    (
        "UI Polish",
        ("styling", "spacing", "color", "ui", "design", "layout", "modal"),
    ),
    ("Refactor", ("refactor", "cleanup", "rewrite", "migrate", "deprecate")),
    ("Documentation", ("docs", "documentation", "readme", "guide", "tutorial")),
    ("Testing", ("test", "tests", "coverage", "spec", "qa", "e2e")),
)


_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokens(text: str) -> list[str]:
    return [m.group(0).lower() for m in _TOKEN_RE.finditer(text or "")]


def _token_set(text: str) -> set[str]:
    return set(_tokens(text))


def _jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    a_set = set(a)
    b_set = set(b)
    union = a_set | b_set
    if not union:
        return 0.0
    return len(a_set & b_set) / len(union)


def _clamp_fibonacci(value: int) -> int:
    """Snap ``value`` to the nearest Fibonacci point (PRD §5.2)."""

    closest = FIBONACCI_STORY_POINTS[0]
    best = abs(value - closest)
    for point in FIBONACCI_STORY_POINTS[1:]:
        delta = abs(value - point)
        if delta < best:
            closest = point
            best = delta
    return closest


def _epic_for(prompt: str) -> str:
    tokens = _token_set(prompt)
    for epic, hints in _EPIC_HINTS:
        if tokens & set(hints):
            return epic
    return "General"


def _type_for(prompt: str) -> str:
    tokens = _token_set(prompt)
    if tokens & set(_BUG_HINTS):
        return "bug"
    if tokens & {"spike", "investigate", "research"}:
        return "spike"
    return "feature"


def _safe_id(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _default_column(context: dict[str, Any]) -> Optional[str]:
    columns = context.get("columns") or []
    if not isinstance(columns, list):
        return None
    for col in columns:
        if isinstance(col, dict) and (col.get("name") or "").strip().lower() in {
            "to do",
            "todo",
            "backlog",
        }:
            return _safe_id(col.get("_id"))
    if columns and isinstance(columns[0], dict):
        return _safe_id(columns[0].get("_id"))
    return None


def _least_loaded_member(context: dict[str, Any]) -> Optional[str]:
    members = context.get("members") or []
    tasks = context.get("tasks") or []
    if not isinstance(members, list) or not members:
        return None
    counts: Counter[str] = Counter()
    for task in tasks if isinstance(tasks, list) else []:
        if isinstance(task, dict):
            coordinator = task.get("coordinatorId")
            if isinstance(coordinator, str):
                counts[coordinator] += 1
    sorted_members = sorted(
        (m for m in members if isinstance(m, dict) and isinstance(m.get("_id"), str)),
        key=lambda m: counts.get(m["_id"], 0),
    )
    if sorted_members:
        return sorted_members[0]["_id"]
    return None


def draft_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IDraftTaskSuggestion`` for the FE's task-draft route."""

    context = payload.get("context") or {}
    prompt = (payload.get("prompt") or "").strip()
    epic = _epic_for(prompt)
    type_ = _type_for(prompt)
    points = _clamp_fibonacci(max(1, len(prompt) // 60))
    column_id = _safe_id(payload.get("columnId")) or _default_column(context) or ""
    coordinator_id = (
        _safe_id(payload.get("coordinatorId")) or _least_loaded_member(context) or ""
    )
    return {
        "taskName": prompt[:80] or "New task",
        "type": type_,
        "epic": epic,
        "storyPoints": points,
        "note": prompt or "Acceptance criteria pending.",
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "confidence": 0.55,
        "rationale": "Heuristic draft from prompt keywords.",
    }


def breakdown_task(payload: dict[str, Any], count: int = 3) -> dict[str, Any]:
    """Return an ``ITaskBreakdownSuggestion`` (3 sub-drafts by default)."""

    base = draft_task(payload)
    pieces = []
    for index in range(1, max(1, min(count, 5)) + 1):
        pieces.append(
            {
                **base,
                "taskName": f"{base['taskName']} (part {index})",
                "rationale": f"Slice {index} of the parent task.",
            }
        )
    return {"items": pieces}


def estimate(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IEstimateSuggestion`` based on description length + neighbours."""

    description = (payload.get("note") or "") + (payload.get("taskName") or "")
    context = payload.get("context") or {}
    tasks = context.get("tasks") or []
    query_tokens = _token_set(description)
    similars: list[tuple[str, float, str]] = []
    for task in tasks if isinstance(tasks, list) else []:
        if not isinstance(task, dict):
            continue
        task_id = task.get("_id")
        if not isinstance(task_id, str):
            continue
        score = _jaccard(
            query_tokens,
            _token_set((task.get("taskName") or "") + " " + (task.get("note") or "")),
        )
        if score:
            reason = f"shares {int(score * 100)}% keywords"
            similars.append((task_id, score, reason))
    similars.sort(key=lambda triple: triple[1], reverse=True)
    top = similars[:3]
    avg_neighbour_points = (
        sum(_clamp_fibonacci(point) for point in (3, 5, 3)) / 3 if top else 3
    )
    points = _clamp_fibonacci(
        int(round((len(description) / 80) + avg_neighbour_points))
    )
    confidence = 0.7 if top else 0.45
    return {
        "storyPoints": points,
        "confidence": confidence,
        "rationale": "Derived from prompt length + nearest-neighbour tasks."
        if top
        else "Derived from prompt length; no similar tasks found.",
        "similar": [{"_id": tid, "reason": reason} for tid, _, reason in top],
    }


def readiness(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IReadinessReport`` describing missing draft fields."""

    issues: list[dict[str, Any]] = []
    fields = {
        "taskName": "Task name is required.",
        "note": "Acceptance criteria are missing.",
        "epic": "Epic helps grouping; pick one.",
        "type": "Choose feature / bug / spike.",
        "coordinatorId": "Assign a coordinator.",
    }
    for field, message in fields.items():
        if not payload.get(field):
            issue: dict[str, Any] = {
                "field": field,
                "severity": "error" if field == "taskName" else "warn",
                "message": message,
            }
            issues.append(issue)
    return {"issues": issues}


def board_brief(context: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IBoardBrief`` for the FE's board-brief route."""

    columns = context.get("columns") or []
    tasks = context.get("tasks") or []
    task_list = tasks if isinstance(tasks, list) else []
    members = context.get("members") or []
    counts: list[dict[str, Any]] = []
    column_index: dict[str, str] = {}
    for col in columns if isinstance(columns, list) else []:
        if not isinstance(col, dict):
            continue
        cid = col.get("_id")
        if isinstance(cid, str):
            column_index[cid] = col.get("name") or cid
    column_task_count: Counter[str] = Counter()
    for task in task_list:
        if not isinstance(task, dict):
            continue
        cid = task.get("columnId")
        if isinstance(cid, str):
            column_task_count[cid] += 1
    for cid, name in column_index.items():
        counts.append(
            {
                "columnId": cid,
                "columnName": name,
                "count": column_task_count.get(cid, 0),
            }
        )
    largest = sorted(
        [t for t in task_list if isinstance(t, dict) and isinstance(t.get("_id"), str)],
        key=lambda t: int(t.get("storyPoints") or 0),
        reverse=True,
    )[:3]
    largest_unstarted = [
        {
            "taskId": t["_id"],
            "taskName": t.get("taskName") or "",
            "storyPoints": int(t.get("storyPoints") or 0),
        }
        for t in largest
        if (
            t.get("columnId")
            and column_index.get(t.get("columnId"), "").lower().strip() != "done"
        )
    ]
    unowned = [
        {"taskId": t["_id"], "taskName": t.get("taskName") or ""}
        for t in task_list
        if isinstance(t, dict)
        and isinstance(t.get("_id"), str)
        and not t.get("coordinatorId")
    ][:5]
    member_index = {m.get("_id"): m for m in members if isinstance(m, dict)}
    member_load: dict[str, dict[str, Any]] = {}
    for task in task_list:
        if not isinstance(task, dict):
            continue
        coordinator = task.get("coordinatorId")
        if not isinstance(coordinator, str):
            continue
        entry = member_load.setdefault(
            coordinator,
            {
                "memberId": coordinator,
                "username": (member_index.get(coordinator) or {}).get(
                    "username", coordinator
                ),
                "openTasks": 0,
                "openPoints": 0,
            },
        )
        entry["openTasks"] += 1
        entry["openPoints"] += int(task.get("storyPoints") or 0)
    workload = sorted(
        member_load.values(), key=lambda m: m["openPoints"], reverse=True
    )[:5]
    headline = (
        f"{len(task_list)} tasks across {len(columns)} columns; "
        f"{len(unowned)} unowned, {len(largest_unstarted)} large unstarted."
    )
    return {
        "headline": headline[:140],
        "counts": counts,
        "largestUnstarted": largest_unstarted,
        "unowned": unowned,
        "workload": workload,
        "recommendation": "Reassign unowned bugs first; chunk large unstarted cards.",
    }


def semantic_search(
    kind: str,
    query: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Return an ``ISearchResult`` ranking matching ids by Jaccard."""

    query_tokens = _token_set(query)
    if kind == "tasks":
        items = context.get("tasks") or []
        searchables = [
            (
                t.get("_id"),
                _token_set(
                    " ".join(
                        str(t.get(field) or "")
                        for field in ("taskName", "note", "type", "epic")
                    )
                ),
            )
            for t in items
            if isinstance(t, dict) and isinstance(t.get("_id"), str)
        ]
    else:
        items = context.get("projects") or []
        searchables = [
            (
                p.get("_id"),
                _token_set(
                    " ".join(
                        str(p.get(field) or "")
                        for field in (
                            "projectName",
                            "organization",
                            "organisation",
                            "managerId",
                            "manager",
                        )
                    )
                ),
            )
            for p in items
            if isinstance(p, dict) and isinstance(p.get("_id"), str)
        ]
    scored = [(id_, _jaccard(query_tokens, tokens)) for id_, tokens in searchables]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    matched = [id_ for id_, score in scored if score > 0.0]
    return {
        "ids": matched[:10],
        "rationale": (
            f"Ranked by keyword overlap with the query (top {len(matched[:10])})."
            if matched
            else "No matches; try broader keywords."
        ),
    }
