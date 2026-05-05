"""Prometheus counters / histograms for the agent surface.

Exposes a small, opinionated set of metrics designed to back the SLO
dashboards an operator would want against the AI features:

- ``agent_invocations_total{agent, outcome}`` -- per-agent counts
  bucketed by outcome (``success``, ``error``, ``timeout``,
  ``rate_limited``, ``budget_exhausted``, ``replay``). The ``replay``
  outcome is what makes the Tier 7 ``Idempotent-Replay: true``
  cache-hit ratio observable -- without it operators can't tell a
  cached run from a fresh one in metrics.
- ``agent_tokens_total{agent, direction}`` -- input / output token
  counters so cost dashboards can sum per-agent token spend over time.
- ``agent_run_duration_seconds{agent, outcome}`` -- histogram with
  buckets sized for typical agent latency (sub-second polish helpers
  through 2-minute long-running streams).
- ``idempotency_cache_total{route, outcome}`` -- cache hit / miss /
  mismatch / in-flight counters so operators can SLO on cache-hit
  ratio.

Like :mod:`app.observability.otel`, every metric is opt-in:
``PROMETHEUS_METRICS=false`` (the default) keeps the helpers as no-ops
backed by an inert shim object that mimics the
``Counter.labels(...).inc()`` / ``Histogram.labels(...).observe()``
surface so handler code never has to branch on whether metrics are
enabled. Lazy-imports the ``prometheus_client`` package so the slim
install does not pay the dependency cost.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Optional

from app.config import Settings

logger = logging.getLogger(__name__)


# Outcome / direction enums kept as module-level tuples so dashboards
# and tests can introspect the canonical set without re-parsing
# docstrings. Treat as the contract: a new outcome must be added here
# (and to the Tier 9 docs) before a handler emits it, otherwise the
# rate-limit alert that sums ``rate_limited + timeout`` silently
# under-counts.
INVOCATION_OUTCOMES: tuple[str, ...] = (
    "success",
    "error",
    "timeout",
    "rate_limited",
    "budget_exhausted",
    "replay",
)
TOKEN_DIRECTIONS: tuple[str, str] = ("input", "output")
IDEMPOTENCY_OUTCOMES: tuple[str, ...] = (
    "hit",
    "miss",
    "mismatch",
    "in_flight",
)

# Histogram buckets chosen for agent latency: sub-second polish helpers,
# multi-second LangGraph runs with FE-tool round-trips, and the upper
# tail covering interrupt-using agents that stall on slow FE responses.
# Mirrors the default Prometheus latency layout but stretched for the
# 2-minute timeout cap configured in ``AGENT_REQUEST_TIMEOUT_SECONDS``.
RUN_DURATION_BUCKETS: tuple[float, ...] = (
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
)


class _NoOpMetric:
    """Stand-in for a ``Counter`` / ``Histogram`` when metrics are off.

    Implements the subset of the ``prometheus_client`` surface the
    handlers reach for: ``labels(...)`` returns ``self`` so the chained
    ``.inc()`` / ``.observe(...)`` call does nothing. Keeping the shim
    behind the same module attribute as the real metric means router
    code can call ``agent_invocations_total.labels(...).inc()``
    unconditionally and pay near-zero cost when disabled.
    """

    def labels(self, *_args: Any, **_kwargs: Any) -> "_NoOpMetric":
        return self

    def inc(self, _amount: float = 1.0) -> None:
        return None

    def observe(self, _value: float) -> None:
        return None


_NOOP = _NoOpMetric()


# Module-level metric singletons. Initialised to the no-op shim so any
# import-time reference is safe even before :func:`configure_metrics`
# runs; the lifespan swaps them out for the real ``Counter`` /
# ``Histogram`` when the operator opts in.
agent_invocations_total: Any = _NOOP
agent_tokens_total: Any = _NOOP
agent_run_duration_seconds: Any = _NOOP
idempotency_cache_total: Any = _NOOP

_metrics_enabled: bool = False


def _require_prometheus_packages() -> None:
    """Import ``prometheus_client`` or raise a clear error.

    Mirrors :func:`app.observability.otel._require_otel_packages`'s
    remediation copy so a misconfigured deploy surfaces with the
    exact ``pip install`` command instead of a generic ``ImportError``.
    """

    try:
        importlib.import_module("prometheus_client")
    except ImportError as exc:
        raise RuntimeError(
            "prometheus_client is not installed but PROMETHEUS_METRICS "
            "resolved to 'true'. Run "
            '`pip install ".[observability]"` (or `".[ai]"`) or set '
            "PROMETHEUS_METRICS=false."
        ) from exc


def configure_metrics(*, settings: Settings) -> None:
    """Build the real metric singletons when ``PROMETHEUS_METRICS=true``.

    Idempotent: a second call with metrics already enabled is a cheap
    return because the global flag is already set. When disabled, the
    module-level singletons stay as the inert ``_NoOpMetric`` shim so
    handler code is unconditional.
    """

    global agent_invocations_total
    global agent_tokens_total
    global agent_run_duration_seconds
    global idempotency_cache_total
    global _metrics_enabled

    if not settings.prometheus_metrics:
        return
    if _metrics_enabled:
        return

    _require_prometheus_packages()

    from prometheus_client import Counter, Histogram

    agent_invocations_total = Counter(
        "agent_invocations_total",
        "Per-agent invocation count, bucketed by outcome.",
        labelnames=("agent", "outcome"),
    )
    agent_tokens_total = Counter(
        "agent_tokens_total",
        "Per-agent provider-reported token usage.",
        labelnames=("agent", "direction"),
    )
    agent_run_duration_seconds = Histogram(
        "agent_run_duration_seconds",
        "Per-agent end-to-end run duration in seconds.",
        labelnames=("agent", "outcome"),
        buckets=RUN_DURATION_BUCKETS,
    )
    idempotency_cache_total = Counter(
        "idempotency_cache_total",
        "Idempotency-Key cache outcomes per route.",
        labelnames=("route", "outcome"),
    )
    _metrics_enabled = True
    logger.info("Prometheus metrics configured.")


def record_invocation(
    agent: str,
    outcome: str,
    *,
    tokens_in: int = 0,
    tokens_out: int = 0,
    duration_s: Optional[float] = None,
) -> None:
    """Increment the per-agent counters for one invocation.

    Always safe to call: when metrics are disabled the singletons are
    no-op shims and this collapses to a couple of attribute lookups.
    Token counts of zero (the deterministic stub never reports usage)
    are skipped so the per-agent token-rate panel doesn't render an
    artificial floor.
    """

    agent_invocations_total.labels(agent=agent, outcome=outcome).inc()
    if tokens_in:
        agent_tokens_total.labels(agent=agent, direction="input").inc(
            float(tokens_in)
        )
    if tokens_out:
        agent_tokens_total.labels(agent=agent, direction="output").inc(
            float(tokens_out)
        )
    if duration_s is not None:
        agent_run_duration_seconds.labels(
            agent=agent, outcome=outcome
        ).observe(float(duration_s))


def record_idempotency(route: str, outcome: str) -> None:
    """Increment the idempotency cache counter for ``route``.

    See :data:`IDEMPOTENCY_OUTCOMES` for the canonical set of values.
    """

    idempotency_cache_total.labels(route=route, outcome=outcome).inc()


def make_metrics_app() -> Optional[Any]:
    """Return a ``prometheus_client.make_asgi_app()`` mountable at ``/metrics``.

    Returns ``None`` when metrics are disabled so the lifespan can
    skip the mount entirely (an unmounted ``/metrics`` 404 is the
    documented signal that the operator has not opted in; mounting an
    empty endpoint would emit a misleading "200 with zero metrics").
    """

    if not _metrics_enabled:
        return None
    from prometheus_client import make_asgi_app

    return make_asgi_app()


def reset_for_tests() -> None:
    """Drop the metric singletons back to the no-op shim and unregister.

    Tests that flip ``configure_metrics`` on need a clean slate between
    cases; the underlying ``prometheus_client.REGISTRY`` is process-wide
    and will raise ``ValueError`` on a duplicate ``Counter`` registration
    if we don't unregister the previous instance. Production code must
    never call this -- it intentionally clears the running tally.
    """

    global agent_invocations_total
    global agent_tokens_total
    global agent_run_duration_seconds
    global idempotency_cache_total
    global _metrics_enabled

    if _metrics_enabled:
        from prometheus_client import REGISTRY

        for metric in (
            agent_invocations_total,
            agent_tokens_total,
            agent_run_duration_seconds,
            idempotency_cache_total,
        ):
            try:
                REGISTRY.unregister(metric)
            except (KeyError, ValueError):  # pragma: no cover - already gone
                pass

    agent_invocations_total = _NOOP
    agent_tokens_total = _NOOP
    agent_run_duration_seconds = _NOOP
    idempotency_cache_total = _NOOP
    _metrics_enabled = False


__all__ = [
    "IDEMPOTENCY_OUTCOMES",
    "INVOCATION_OUTCOMES",
    "RUN_DURATION_BUCKETS",
    "TOKEN_DIRECTIONS",
    "agent_invocations_total",
    "agent_run_duration_seconds",
    "agent_tokens_total",
    "configure_metrics",
    "idempotency_cache_total",
    "make_metrics_app",
    "record_idempotency",
    "record_invocation",
    "reset_for_tests",
]
