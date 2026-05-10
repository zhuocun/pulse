"""Guards against Vercel deployment-config conflicts.

Vercel rejects ``vercel.json`` at deploy time when mutually-exclusive
keys are combined, but those errors only surface in CI / on `vercel
deploy` — not in the local test suite. The build error then takes a
round trip to fix. These tests encode the invariants locally so a
conflicting edit fails ``pytest`` instead of the deploy.

References:
- https://vercel.com/docs/errors/error-list#conflicting-functions-and-builds-configuration
- https://vercel.com/docs/projects/project-configuration#legacy
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

VERCEL_JSON_PATH = Path(__file__).resolve().parent.parent / "vercel.json"


@pytest.fixture(scope="module")
def vercel_config() -> dict:
    assert VERCEL_JSON_PATH.exists(), f"vercel.json not found at {VERCEL_JSON_PATH}"
    with VERCEL_JSON_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def test_builds_and_functions_are_mutually_exclusive(vercel_config: dict) -> None:
    """Vercel rejects vercel.json that defines both legacy ``builds`` and modern ``functions``.

    The error code is ``BUILDS_AND_FUNCTIONS``; the deploy fails with
    "The `functions` property cannot be used in conjunction with the
    `builds` property." Pick one — modern ``functions`` is preferred.
    """
    has_builds = "builds" in vercel_config
    has_functions = "functions" in vercel_config
    assert not (has_builds and has_functions), (
        "vercel.json defines both `builds` and `functions`. "
        "Vercel rejects this combination at deploy time. Drop `builds` "
        "(Vercel auto-detects `api/*.py` files) and keep `functions` "
        "for per-function config like maxDuration."
    )


def test_routes_excludes_modern_routing_keys(vercel_config: dict) -> None:
    """``routes`` (legacy v1) cannot be combined with the modern routing keys.

    Vercel raises ``MIXED_ROUTING_PROPERTIES`` if ``routes`` appears
    alongside any of ``rewrites`` / ``redirects`` / ``headers`` /
    ``cleanUrls`` / ``trailingSlash``.
    """
    if "routes" not in vercel_config:
        pytest.skip("no `routes` key — modern routing keys are unconstrained")
    forbidden_with_routes = {
        "rewrites",
        "redirects",
        "headers",
        "cleanUrls",
        "trailingSlash",
    }
    conflicts = forbidden_with_routes & vercel_config.keys()
    assert not conflicts, (
        f"vercel.json combines legacy `routes` with modern routing keys "
        f"{sorted(conflicts)}. Vercel rejects this. Pick one routing model."
    )


def test_sse_function_has_max_duration(vercel_config: dict) -> None:
    """Regression guard: the AI/agents Python function must keep ``maxDuration``.

    SSE streams from multi-interrupt agent flows (board-brief,
    task-drafting) exceed Vercel's default 10s (Hobby) / 60s (Pro)
    function timeout and get silently truncated without this setting.
    See `docs/ai-remaining-work.md` item 4.
    """
    functions = vercel_config.get("functions", {})
    api_entry = functions.get("api/index.py")
    assert api_entry is not None, (
        "`functions['api/index.py']` is missing. The SSE function must "
        "have an explicit maxDuration to avoid silent truncation."
    )
    max_duration = api_entry.get("maxDuration")
    assert isinstance(max_duration, int) and max_duration >= 60, (
        f"`functions['api/index.py'].maxDuration` is {max_duration!r}; "
        "expected an int >= 60 (use 300 on Pro for the full SSE budget)."
    )
