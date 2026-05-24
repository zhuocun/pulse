"""Tests for :mod:`app.deploy_env`.

Covers ``detected_hosted_platform`` for every supported marker, the
no-marker fallback, and the multi-marker tie-break (first marker in
:data:`HOSTED_PLATFORM_ENV_MARKERS` wins so the platform label is
stable across boots that happen to carry overlapping env shapes).
"""

from __future__ import annotations

import pytest

from app.deploy_env import (
    HOSTED_PLATFORM_ENV_MARKERS,
    detected_hosted_platform,
    has_hosted_platform_env,
)


def _clear_all_markers(monkeypatch: pytest.MonkeyPatch) -> None:
    for marker in HOSTED_PLATFORM_ENV_MARKERS:
        monkeypatch.delenv(marker, raising=False)


@pytest.mark.parametrize(
    ("marker", "expected"),
    [
        ("VERCEL", "vercel"),
        ("VERCEL_URL", "vercel"),
        ("RENDER", "render"),
        ("RENDER_EXTERNAL_HOSTNAME", "render"),
        ("FLY_APP_NAME", "fly"),
        ("RAILWAY_PROJECT_ID", "railway"),
        ("KUBERNETES_SERVICE_HOST", "kubernetes"),
    ],
)
def test_detect_returns_expected_platform_per_marker(
    monkeypatch: pytest.MonkeyPatch, marker: str, expected: str
) -> None:
    _clear_all_markers(monkeypatch)
    monkeypatch.setenv(marker, "1")
    assert detected_hosted_platform() == expected


def test_detect_returns_none_when_no_markers_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local-dev path -- no platform markers, no claimed platform."""

    _clear_all_markers(monkeypatch)
    assert detected_hosted_platform() is None


def test_detect_first_marker_wins_on_tie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Multiple markers -> the first one in declared order wins.

    A stable tie-break is important: error copy mentions the platform
    by name, so a re-ordering between boots would confuse operators
    chasing an issue across redeploys.
    """

    _clear_all_markers(monkeypatch)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("RENDER", "1")
    monkeypatch.setenv("FLY_APP_NAME", "demo")

    assert detected_hosted_platform() == "vercel"


def test_detect_ignores_empty_string_markers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty string is the canonical "unset" form (Vercel templates use ``FOO=``)."""

    _clear_all_markers(monkeypatch)
    monkeypatch.setenv("VERCEL", "")
    monkeypatch.setenv("RENDER", "1")

    assert detected_hosted_platform() == "render"


def test_has_hosted_platform_env_pairs_with_detect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``has_hosted_platform_env`` is the boolean form of ``detected_hosted_platform``."""

    _clear_all_markers(monkeypatch)
    assert has_hosted_platform_env() is False
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "proj-x")
    assert has_hosted_platform_env() is True
    assert detected_hosted_platform() == "railway"


def test_detect_with_explicit_environ_mapping() -> None:
    """The optional ``environ`` arg makes the helper testable without monkeypatch."""

    assert detected_hosted_platform({"FLY_APP_NAME": "x"}) == "fly"
    assert detected_hosted_platform({}) is None
