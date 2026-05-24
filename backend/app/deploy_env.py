"""Shared hosted-platform environment markers used across startup guards."""

from __future__ import annotations

import os
from typing import Mapping

HOSTED_PLATFORM_ENV_MARKERS: tuple[str, ...] = (
    "VERCEL",
    "VERCEL_URL",
    "RENDER_EXTERNAL_HOSTNAME",
    "RENDER",
    "KUBERNETES_SERVICE_HOST",
    "FLY_APP_NAME",
    "RAILWAY_PROJECT_ID",
)


# Map of marker env-var -> short canonical platform name. Multiple
# Vercel/Render markers collapse to one platform string because the
# operator-facing remediation copy is the same regardless of *which*
# marker the platform happened to inject.
_MARKER_PLATFORM: dict[str, str] = {
    "VERCEL": "vercel",
    "VERCEL_URL": "vercel",
    "RENDER_EXTERNAL_HOSTNAME": "render",
    "RENDER": "render",
    "KUBERNETES_SERVICE_HOST": "kubernetes",
    "FLY_APP_NAME": "fly",
    "RAILWAY_PROJECT_ID": "railway",
}


def has_hosted_platform_env(
    environ: Mapping[str, str] | None = None,
) -> bool:
    """Return ``True`` when a hosted / production-shaped env marker is present."""

    source = os.environ if environ is None else environ
    return any(source.get(name) for name in HOSTED_PLATFORM_ENV_MARKERS)


def detected_hosted_platform(
    environ: Mapping[str, str] | None = None,
) -> str | None:
    """Return the short platform name (``"vercel"``, ``"render"`` ...) or ``None``.

    Iteration follows :data:`HOSTED_PLATFORM_ENV_MARKERS` order so the
    return value is stable when multiple markers happen to be set in
    the same process (e.g. a Render image being run under Kubernetes
    for a test). The single returned string is purely cosmetic --
    error messages name *one* platform so the operator gets a
    pointer to the correct settings UI; callers that need the full set
    can iterate the markers themselves.
    """

    source = os.environ if environ is None else environ
    for marker in HOSTED_PLATFORM_ENV_MARKERS:
        if source.get(marker):
            return _MARKER_PLATFORM.get(marker)
    return None
