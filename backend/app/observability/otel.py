"""OpenTelemetry tracing setup with GenAI semantic-convention helpers.

The module exposes four entry points the rest of the application uses:

1. :func:`configure_otel` -- one-shot lifespan setup that wires up a
   ``TracerProvider``, a ``BatchSpanProcessor``, and either an OTLP/HTTP
   exporter (when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set) or the console
   exporter (sane local-dev default that does not require a collector).
2. :func:`instrument_fastapi_app` -- attaches the FastAPI instrumentor so
   every HTTP request gets a server span. Decoupled from
   :func:`configure_otel` because the FastAPI app object is constructed
   *after* the lifespan starts and the instrumentor needs the live app.
3. :func:`get_tracer` -- the runtime / routers call this to emit spans
   without branching on whether OTel is enabled. Without a configured
   provider OpenTelemetry returns a ``ProxyTracer`` whose spans are
   non-recording, so callers can use ``start_as_current_span(...)``
   unconditionally and pay near-zero cost.
4. :func:`gen_ai_span_attrs` / :func:`record_token_usage` -- thin helpers
   that build / write the OTel GenAI semantic-convention attribute names
   so spans emitted from anywhere in the codebase line up with vendor
   dashboards (Datadog, Honeycomb, Tempo, Jaeger, Grafana Cloud) without
   per-vendor field mapping.

Lazy imports mirror the pattern in :mod:`app.agents.llm` and
:mod:`app.middleware.redis_backends`: the ``opentelemetry-*`` packages
are an opt-in dependency (the ``[observability]`` extra in
``pyproject.toml``), so a deployment that never sets
``OTEL_TRACING=true`` does not need them installed and importing
``app.main`` stays cheap.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Optional

from app.config import Settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# OTel GenAI semantic-convention attribute keys.
#
# Pinned as module constants so call sites read like the spec rather
# than hand-spelled strings; the SDK's
# ``opentelemetry.semconv.attributes.gen_ai_attributes`` module is
# pre-1.0 and the constant names are still moving, so we keep our own
# stable surface here and revisit when the upstream module stabilises.
# Source: https://opentelemetry.io/docs/specs/semconv/gen-ai/.
# ---------------------------------------------------------------------------

GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_AGENT_NAME = "gen_ai.agent.name"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

# App-level attributes -- not part of the GenAI spec but useful for
# slicing by tenant in dashboards. Prefixed with ``app.`` so they stay
# obviously distinct from the standardised ``gen_ai.*`` namespace.
APP_PROJECT_ID = "app.project_id"
APP_AUTONOMY = "app.autonomy"


# Process-wide flag mirroring ``Settings.otel_tracing``. Read by
# :func:`instrument_fastapi_app` so it can stay a no-op when the
# operator did not opt in (the FastAPI instrumentor would otherwise
# eagerly attach middleware regardless of the provider).
_otel_configured: bool = False


def _require_otel_packages() -> None:
    """Import the OTel SDK or raise a clear operator-facing error.

    Mirrors :func:`app.agents.llm._require_integration`'s remediation
    style: a missing optional dependency surfaces with the exact
    ``pip install`` command instead of an opaque ``ImportError`` deep
    inside :mod:`opentelemetry.sdk.trace`.
    """

    try:
        importlib.import_module("opentelemetry.sdk.trace")
        importlib.import_module(
            "opentelemetry.exporter.otlp.proto.http.trace_exporter"
        )
        importlib.import_module("opentelemetry.instrumentation.fastapi")
    except ImportError as exc:
        raise RuntimeError(
            "opentelemetry packages are not installed but OTEL_TRACING "
            "resolved to 'true'. Run "
            '`pip install ".[observability]"` (or `".[ai]"`) or set '
            "OTEL_TRACING=false."
        ) from exc


def configure_otel(*, settings: Settings) -> None:
    """Install a ``TracerProvider`` once, on first lifespan start.

    Idempotent: a second call (e.g. from a re-entered lifespan in a
    test harness) is a cheap return because the global flag is already
    set. When ``OTEL_TRACING=false`` (the default) this function is a
    pure no-op so an install without the ``[observability]`` extra
    pays nothing.

    The exporter selection is intentionally minimal:

    * ``OTEL_EXPORTER_OTLP_ENDPOINT`` set -- ship via OTLP/HTTP to the
      operator's collector. We use the HTTP transport (not gRPC) because
      its dependency footprint is smaller and most managed backends
      (Datadog, Honeycomb, Grafana Cloud) accept it natively.
    * Endpoint empty -- fall back to ``ConsoleSpanExporter``. Useful for
      local dev: the trace JSON streams to stderr so a developer can eyeball
      span attributes without spinning up a collector.
    """

    global _otel_configured
    if not settings.otel_tracing:
        return
    if _otel_configured:
        return

    _require_otel_packages()

    from opentelemetry import trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        BatchSpanProcessor,
        ConsoleSpanExporter,
    )

    # ``service.version`` is read off the installed package metadata so
    # a dashboard can correlate spikes with deploys without a hand-edit
    # here on every release.
    try:
        from importlib.metadata import version as _pkg_version

        service_version = _pkg_version("pulse-backend")
    except Exception:  # noqa: BLE001 - package metadata lookup is best-effort
        service_version = "0.0.0"

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.version": service_version,
        }
    )
    provider = TracerProvider(resource=resource)

    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        exporter: Any = OTLPSpanExporter(
            endpoint=settings.otel_exporter_otlp_endpoint
        )
    else:
        exporter = ConsoleSpanExporter()

    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _otel_configured = True
    logger.info(
        "OpenTelemetry tracing configured (service=%s, exporter=%s).",
        settings.otel_service_name,
        "otlp-http" if settings.otel_exporter_otlp_endpoint else "console",
    )


def instrument_fastapi_app(app: Any) -> None:
    """Attach the FastAPI instrumentor to ``app``.

    No-op when :func:`configure_otel` has not run -- without a real
    ``TracerProvider`` the instrumentor would emit spans into the
    no-op global, doing work for nothing. Lazy-imported so the
    ``opentelemetry-instrumentation-fastapi`` package only needs to
    be installed when ``OTEL_TRACING=true``.
    """

    if not _otel_configured:
        return
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)


def get_tracer() -> Any:
    """Return a tracer that is always safe to use.

    When :func:`configure_otel` has installed a real provider this
    returns the configured tracer; without one OpenTelemetry's global
    proxy returns a ``ProxyTracer`` whose spans are non-recording, so
    every ``start_as_current_span`` call short-circuits with no export
    cost. Callers never need to branch on ``settings.otel_tracing``.
    """

    from opentelemetry import trace

    return trace.get_tracer_provider().get_tracer(__name__)


def gen_ai_span_attrs(
    *,
    operation: str,
    agent_name: str,
    model_id: Optional[str] = None,
    project_id: Optional[str] = None,
    autonomy: Optional[str] = None,
) -> dict[str, Any]:
    """Build a GenAI-spec attribute dict for a span.

    Skips ``None`` values so we don't emit empty attributes (some
    backends sort their attribute key list alphabetically and a stray
    empty string clutters the UI). The attribute keys are the strings
    pinned at the top of the module so a constant rename does not
    silently drift the dashboard contract.
    """

    attrs: dict[str, Any] = {
        GEN_AI_OPERATION_NAME: operation,
        GEN_AI_AGENT_NAME: agent_name,
    }
    if model_id is not None:
        attrs[GEN_AI_REQUEST_MODEL] = model_id
    if project_id is not None:
        attrs[APP_PROJECT_ID] = project_id
    if autonomy is not None:
        attrs[APP_AUTONOMY] = autonomy
    return attrs


def record_token_usage(
    span: Any,
    tokens_in: int,
    tokens_out: int,
    model_id: Optional[str] = None,
) -> None:
    """Annotate ``span`` with provider-reported token usage.

    No-op when ``span`` is not recording (the proxy tracer's spans
    return ``False`` from ``is_recording()`` and we skip the work
    rather than walk through ``set_attribute`` calls that go to
    ``/dev/null``). Zero token counts are skipped too: the Phase A
    deterministic stub reports ``(0, 0)`` and an empty
    ``gen_ai.usage.*`` attribute is more misleading than absent.
    """

    if not getattr(span, "is_recording", lambda: False)():
        return
    if tokens_in:
        span.set_attribute(GEN_AI_USAGE_INPUT_TOKENS, int(tokens_in))
    if tokens_out:
        span.set_attribute(GEN_AI_USAGE_OUTPUT_TOKENS, int(tokens_out))
    if model_id:
        span.set_attribute(GEN_AI_RESPONSE_MODEL, model_id)


def reset_for_tests() -> None:
    """Drop the configured-flag and the OTel global tracer provider.

    Companion to :func:`app.observability.metrics.reset_for_tests`;
    only intended for the test harness. The OpenTelemetry SDK's
    ``trace.set_tracer_provider`` is single-shot per process (a second
    call logs a warning and is ignored), so to keep tests hermetic we
    shut down any previously-installed provider, reach into
    ``_TRACER_PROVIDER_SET_ONCE._done`` and the cached
    ``_TRACER_PROVIDER`` slot to roll the SDK back to its
    initial-import state. Production code never calls this.
    """

    global _otel_configured
    _otel_configured = False
    from opentelemetry import trace
    from opentelemetry.trace import _TRACER_PROVIDER_SET_ONCE

    # Drain in-flight batch processors so their exporter threads do
    # not race against the next test (a stale console exporter would
    # write to stderr after pytest closed it; an OTLP exporter would
    # spend the test's wall-clock budget in DNS retries).
    current = trace._TRACER_PROVIDER
    shutdown = getattr(current, "shutdown", None)
    if callable(shutdown):
        try:
            shutdown()
        except Exception:  # pragma: no cover - best-effort cleanup
            pass
    _TRACER_PROVIDER_SET_ONCE._done = False
    trace._TRACER_PROVIDER = None


__all__ = [
    "APP_AUTONOMY",
    "APP_PROJECT_ID",
    "GEN_AI_AGENT_NAME",
    "GEN_AI_OPERATION_NAME",
    "GEN_AI_REQUEST_MODEL",
    "GEN_AI_RESPONSE_MODEL",
    "GEN_AI_USAGE_INPUT_TOKENS",
    "GEN_AI_USAGE_OUTPUT_TOKENS",
    "configure_otel",
    "gen_ai_span_attrs",
    "get_tracer",
    "instrument_fastapi_app",
    "record_token_usage",
    "reset_for_tests",
]
