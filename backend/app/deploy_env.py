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


def has_hosted_platform_env(
    environ: Mapping[str, str] | None = None,
) -> bool:
    """Return ``True`` when a hosted / production-shaped env marker is present."""

    source = os.environ if environ is None else environ
    return any(source.get(name) for name in HOSTED_PLATFORM_ENV_MARKERS)
