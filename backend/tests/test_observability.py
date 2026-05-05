"""Tests for the Tier 9 observability surface.

Covers :mod:`app.observability.otel` and :mod:`app.observability.metrics`
end-to-end -- ``configure_*`` no-ops, lazy-import error reporting,
exporter selection, the GenAI attribute helper, the inert no-op metric
shim, the Prometheus counter increments, the ``/metrics`` ASGI app, and
the FastAPI instrumentor wiring.

Mirrors the per-test fixture + autouse cleanup pattern in
:mod:`tests.test_redis_backends` so a flipped-on case never leaks state
into the next test (the OpenTelemetry global tracer provider and the
Prometheus process-wide registry are both single-shot resources that
have to be reset between cases).
"""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI

from app.config import settings as app_settings
from app.observability import metrics as metrics_module
from app.observability import otel as otel_module
from app.observability.metrics import (
    IDEMPOTENCY_OUTCOMES,
    INVOCATION_OUTCOMES,
    RUN_DURATION_BUCKETS,
    TOKEN_DIRECTIONS,
    configure_metrics,
    make_metrics_app,
    record_idempotency,
    record_invocation,
)
from app.observability.otel import (
    APP_AUTONOMY,
    APP_PROJECT_ID,
    GEN_AI_AGENT_NAME,
    GEN_AI_OPERATION_NAME,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_MODEL,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    configure_otel,
    gen_ai_span_attrs,
    get_tracer,
    instrument_fastapi_app,
    record_token_usage,
)


# ---------------------------------------------------------------------------
# Autouse cleanup: roll the OTel + Prometheus globals back between cases.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_observability_singletons() -> Iterable[None]:
    """Restore the OTel / Prometheus globals between tests.

    Both surfaces hold process-wide state (the OTel global tracer
    provider, the Prometheus ``REGISTRY``) so an enabled-in-one-test
    configuration would otherwise survive into the next case and
    pollute its assertions.
    """

    yield
    metrics_module.reset_for_tests()
    otel_module.reset_for_tests()


# ---------------------------------------------------------------------------
# configure_otel
# ---------------------------------------------------------------------------


def test_configure_otel_is_noop_when_tracing_disabled() -> None:
    cfg = replace(app_settings, otel_tracing=False)
    # Nothing raised; the global flag stays False.
    configure_otel(settings=cfg)
    assert otel_module._otel_configured is False


def test_configure_otel_raises_runtime_error_when_packages_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mirrors :func:`assert_provider_available`'s remediation copy."""

    cfg = replace(app_settings, otel_tracing=True)

    def _missing(name: str) -> object:
        raise ImportError(f"no module named {name!r}")

    monkeypatch.setattr(otel_module.importlib, "import_module", _missing)
    with pytest.raises(RuntimeError, match="opentelemetry"):
        configure_otel(settings=cfg)


def test_configure_otel_uses_otlp_exporter_when_endpoint_set() -> None:
    cfg = replace(
        app_settings,
        otel_tracing=True,
        otel_exporter_otlp_endpoint="https://otlp.example.com/v1/traces",
    )
    configure_otel(settings=cfg)
    assert otel_module._otel_configured is True
    # The configured tracer comes from a real ``TracerProvider``, not
    # the no-op proxy.
    from opentelemetry.sdk.trace import TracerProvider

    from opentelemetry import trace

    assert isinstance(trace.get_tracer_provider(), TracerProvider)


def test_configure_otel_falls_back_to_console_when_endpoint_empty() -> None:
    cfg = replace(
        app_settings,
        otel_tracing=True,
        otel_exporter_otlp_endpoint="",
    )
    configure_otel(settings=cfg)
    assert otel_module._otel_configured is True


def test_configure_otel_is_idempotent_on_second_call() -> None:
    cfg = replace(app_settings, otel_tracing=True)
    configure_otel(settings=cfg)
    # A second call should be a cheap return: the configured flag
    # stays True and no exception is raised.
    configure_otel(settings=cfg)
    assert otel_module._otel_configured is True


def test_configure_otel_handles_missing_package_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``importlib.metadata.version`` failure must not break boot.

    The fallback is the literal ``"0.0.0"`` placeholder so the
    span resource attribute is still present.
    """

    from importlib import metadata as _metadata

    def _boom(_name: str) -> str:
        raise _metadata.PackageNotFoundError("missing")

    monkeypatch.setattr(_metadata, "version", _boom)
    cfg = replace(app_settings, otel_tracing=True)
    configure_otel(settings=cfg)
    assert otel_module._otel_configured is True


# ---------------------------------------------------------------------------
# get_tracer + no-op span path
# ---------------------------------------------------------------------------


def test_get_tracer_returns_proxy_when_unconfigured() -> None:
    tracer = get_tracer()
    span = tracer.start_span("smoke")
    # Proxy tracer's spans are non-recording; every ``set_attribute``
    # is a cheap no-op.
    assert span.is_recording() is False
    span.end()


def test_get_tracer_returns_real_tracer_when_configured() -> None:
    cfg = replace(app_settings, otel_tracing=True)
    configure_otel(settings=cfg)
    tracer = get_tracer()
    with tracer.start_as_current_span("smoke") as span:
        assert span.is_recording() is True


# ---------------------------------------------------------------------------
# gen_ai_span_attrs
# ---------------------------------------------------------------------------


def test_gen_ai_span_attrs_minimal_only_required_keys() -> None:
    attrs = gen_ai_span_attrs(operation="invoke_agent", agent_name="echo")
    assert attrs == {
        GEN_AI_OPERATION_NAME: "invoke_agent",
        GEN_AI_AGENT_NAME: "echo",
    }


def test_gen_ai_span_attrs_skips_none_values() -> None:
    attrs = gen_ai_span_attrs(
        operation="stream_agent",
        agent_name="echo",
        model_id=None,
        project_id=None,
        autonomy=None,
    )
    assert GEN_AI_REQUEST_MODEL not in attrs
    assert APP_PROJECT_ID not in attrs
    assert APP_AUTONOMY not in attrs


def test_gen_ai_span_attrs_includes_all_optional_keys() -> None:
    attrs = gen_ai_span_attrs(
        operation="invoke_agent",
        agent_name="board-brief",
        model_id="claude-sonnet-4-6",
        project_id="proj-1",
        autonomy="plan",
    )
    assert attrs[GEN_AI_REQUEST_MODEL] == "claude-sonnet-4-6"
    assert attrs[APP_PROJECT_ID] == "proj-1"
    assert attrs[APP_AUTONOMY] == "plan"


# ---------------------------------------------------------------------------
# record_token_usage
# ---------------------------------------------------------------------------


def test_record_token_usage_skips_non_recording_spans() -> None:
    span = MagicMock()
    span.is_recording.return_value = False
    record_token_usage(span, 10, 20, model_id="claude-sonnet-4-6")
    span.set_attribute.assert_not_called()


def test_record_token_usage_writes_attributes_on_recording_span() -> None:
    span = MagicMock()
    span.is_recording.return_value = True
    record_token_usage(span, 12, 34, model_id="claude-sonnet-4-6")
    calls = {call.args[0]: call.args[1] for call in span.set_attribute.mock_calls}
    assert calls[GEN_AI_USAGE_INPUT_TOKENS] == 12
    assert calls[GEN_AI_USAGE_OUTPUT_TOKENS] == 34
    assert calls[GEN_AI_RESPONSE_MODEL] == "claude-sonnet-4-6"


def test_record_token_usage_skips_zero_counts() -> None:
    span = MagicMock()
    span.is_recording.return_value = True
    record_token_usage(span, 0, 0)
    # Zero counts and no model_id -> nothing written.
    span.set_attribute.assert_not_called()


def test_record_token_usage_handles_span_without_is_recording() -> None:
    """A bare object without ``is_recording`` must not raise.

    Defensive duck-type check: the helper falls through to a no-op
    rather than raising on a stub passed by a test fake.
    """

    class _Bare:
        pass

    record_token_usage(_Bare(), 10, 20)


# ---------------------------------------------------------------------------
# instrument_fastapi_app
# ---------------------------------------------------------------------------


def test_instrument_fastapi_app_is_noop_when_otel_disabled() -> None:
    fake_app = FastAPI()
    # No exception -- the helper short-circuits because the global
    # configured flag is False.
    instrument_fastapi_app(fake_app)


def test_instrument_fastapi_app_attaches_when_otel_enabled() -> None:
    cfg = replace(app_settings, otel_tracing=True)
    configure_otel(settings=cfg)
    application = FastAPI()
    instrument_fastapi_app(application)
    # The instrumentor stamps a private attribute on the app instance
    # to mark itself as already wired; that's how it stays idempotent
    # on accidental double-attach. Reading it is the cleanest
    # behavioural smoke test we can do without poking ASGI internals.
    assert (
        getattr(application, "_is_instrumented_by_opentelemetry", False) is True
    )


# ---------------------------------------------------------------------------
# configure_metrics
# ---------------------------------------------------------------------------


def test_configure_metrics_is_noop_when_disabled() -> None:
    cfg = replace(app_settings, prometheus_metrics=False)
    configure_metrics(settings=cfg)
    # Singletons stay as the inert no-op shim.
    assert metrics_module._metrics_enabled is False
    # The shim's surface is callable without raising.
    metrics_module.agent_invocations_total.labels(
        agent="x", outcome="success"
    ).inc()
    metrics_module.agent_run_duration_seconds.labels(
        agent="x", outcome="success"
    ).observe(0.5)


def test_configure_metrics_raises_when_packages_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cfg = replace(app_settings, prometheus_metrics=True)

    def _missing(name: str) -> object:
        raise ImportError(f"no module named {name!r}")

    monkeypatch.setattr(metrics_module.importlib, "import_module", _missing)
    with pytest.raises(RuntimeError, match="prometheus_client"):
        configure_metrics(settings=cfg)


def test_configure_metrics_initialises_real_counters() -> None:
    from prometheus_client import Counter, Histogram

    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    assert isinstance(metrics_module.agent_invocations_total, Counter)
    assert isinstance(metrics_module.agent_tokens_total, Counter)
    assert isinstance(metrics_module.agent_run_duration_seconds, Histogram)
    assert isinstance(metrics_module.idempotency_cache_total, Counter)


def test_configure_metrics_is_idempotent_on_second_call() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    first = metrics_module.agent_invocations_total
    configure_metrics(settings=cfg)
    # Second call short-circuits without rebuilding (would otherwise
    # raise ``ValueError`` from prometheus_client on duplicate
    # registration).
    assert metrics_module.agent_invocations_total is first


# ---------------------------------------------------------------------------
# record_invocation / record_idempotency
# ---------------------------------------------------------------------------


def _counter_value(counter: object, **labels: str) -> float:
    """Fetch the current value of a labelled prometheus_client.Counter."""

    return counter.labels(**labels)._value.get()


def _histogram_count(histogram: object, **labels: str) -> int:
    """Fetch the count of observations on a labelled Histogram."""

    return int(histogram.labels(**labels)._sum.get() > 0) + int(
        sum(b.get() for b in histogram.labels(**labels)._buckets)
    )


def test_record_invocation_increments_invocation_and_token_counters() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    record_invocation(
        "echo", "success", tokens_in=12, tokens_out=34, duration_s=0.42
    )
    assert (
        _counter_value(
            metrics_module.agent_invocations_total,
            agent="echo",
            outcome="success",
        )
        == 1.0
    )
    assert (
        _counter_value(
            metrics_module.agent_tokens_total, agent="echo", direction="input"
        )
        == 12.0
    )
    assert (
        _counter_value(
            metrics_module.agent_tokens_total,
            agent="echo",
            direction="output",
        )
        == 34.0
    )
    # The duration histogram receives one observation.
    bucket_observed = sum(
        bucket.get()
        for bucket in metrics_module.agent_run_duration_seconds.labels(
            agent="echo", outcome="success"
        )._buckets
    )
    assert bucket_observed >= 1


def test_record_invocation_skips_token_counters_when_zero() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    record_invocation("echo", "error")
    # Invocations counter recorded the error.
    assert (
        _counter_value(
            metrics_module.agent_invocations_total,
            agent="echo",
            outcome="error",
        )
        == 1.0
    )
    # No tokens reported -> the per-direction counters stay at zero.
    assert (
        _counter_value(
            metrics_module.agent_tokens_total, agent="echo", direction="input"
        )
        == 0.0
    )


def test_record_invocation_is_safe_when_metrics_disabled() -> None:
    cfg = replace(app_settings, prometheus_metrics=False)
    configure_metrics(settings=cfg)
    # Nothing raised; the inert shim absorbs every call.
    record_invocation("echo", "success", tokens_in=1, tokens_out=2, duration_s=0.1)


def test_record_idempotency_increments_cache_counter() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    record_idempotency("/api/v1/agents/x/invoke", "hit")
    record_idempotency("/api/v1/agents/x/invoke", "hit")
    assert (
        _counter_value(
            metrics_module.idempotency_cache_total,
            route="/api/v1/agents/x/invoke",
            outcome="hit",
        )
        == 2.0
    )


def test_record_idempotency_is_safe_when_metrics_disabled() -> None:
    cfg = replace(app_settings, prometheus_metrics=False)
    configure_metrics(settings=cfg)
    record_idempotency("/x", "hit")  # no-op, no raise


# ---------------------------------------------------------------------------
# make_metrics_app
# ---------------------------------------------------------------------------


def test_make_metrics_app_returns_none_when_disabled() -> None:
    cfg = replace(app_settings, prometheus_metrics=False)
    configure_metrics(settings=cfg)
    assert make_metrics_app() is None


def test_make_metrics_app_returns_asgi_app_when_enabled() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    app = make_metrics_app()
    assert app is not None
    # Smoke-test the ASGI surface by mounting under FastAPI and
    # scraping ``/metrics`` -- a real Prometheus-text response
    # (``text/plain; version=0.0.4``) is the contract.
    application = FastAPI()
    application.mount("/metrics", app)
    from fastapi.testclient import TestClient

    with TestClient(application) as client:
        response = client.get("/metrics")
        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]


# ---------------------------------------------------------------------------
# Reset helper -- guards against test pollution from previous cases.
# ---------------------------------------------------------------------------


def test_reset_for_tests_drops_singletons_back_to_noop() -> None:
    cfg = replace(app_settings, prometheus_metrics=True)
    configure_metrics(settings=cfg)
    metrics_module.reset_for_tests()
    assert metrics_module._metrics_enabled is False
    # Subsequent calls still no-op safely.
    record_invocation("x", "success")


def test_reset_for_tests_otel_drops_configured_flag() -> None:
    cfg = replace(app_settings, otel_tracing=True)
    configure_otel(settings=cfg)
    otel_module.reset_for_tests()
    assert otel_module._otel_configured is False


# ---------------------------------------------------------------------------
# Documented enums stay stable.
# ---------------------------------------------------------------------------


def test_invocation_outcomes_cover_the_six_documented_values() -> None:
    assert set(INVOCATION_OUTCOMES) == {
        "success",
        "error",
        "timeout",
        "rate_limited",
        "budget_exhausted",
        "replay",
    }


def test_token_directions_are_input_and_output() -> None:
    assert TOKEN_DIRECTIONS == ("input", "output")


def test_idempotency_outcomes_match_router_branches() -> None:
    assert set(IDEMPOTENCY_OUTCOMES) == {"hit", "miss", "mismatch", "in_flight"}


def test_run_duration_buckets_cover_agent_latency_band() -> None:
    """Histogram buckets should bracket the configured timeout cap."""

    assert RUN_DURATION_BUCKETS[0] == 0.1
    assert RUN_DURATION_BUCKETS[-1] >= 60.0


# ---------------------------------------------------------------------------
# Runtime instrumentation surface
# ---------------------------------------------------------------------------


def test_outcome_for_buckets_known_exception_types() -> None:
    """Runtime-side exception → metric outcome mapping."""

    import asyncio

    from app.agents.errors import AgentRecursionError
    from app.agents.instrumentation import _outcome_for

    assert _outcome_for(asyncio.TimeoutError()) == "timeout"
    assert _outcome_for(asyncio.CancelledError()) == "success"
    assert _outcome_for(GeneratorExit()) == "success"
    assert _outcome_for(AgentRecursionError("x", 5)) == "error"
    assert _outcome_for(RuntimeError("boom")) == "error"


def test_runtime_helpers_skip_non_mapping_inputs() -> None:
    """``_project_id`` / ``_autonomy`` defend against odd input shapes."""

    from app.agents.runtime import _autonomy, _project_id

    assert _project_id(None) is None  # type: ignore[arg-type]
    assert _project_id("not a mapping") is None  # type: ignore[arg-type]
    assert _autonomy(None) is None  # type: ignore[arg-type]
    assert _autonomy("not a mapping") is None  # type: ignore[arg-type]
    assert _project_id({"project_id": ""}) is None
    assert _project_id({"project_id": "p-1"}) == "p-1"
    assert _autonomy({"autonomy_level": "plan"}) == "plan"


def test_lifespan_mounts_metrics_when_prometheus_enabled(
    store: object,
) -> None:
    """Tier 9: lifespan path mounts ``/metrics`` when the operator opts in.

    Flips ``settings.prometheus_metrics`` on for the duration of the
    test, brings up a fresh TestClient (which walks the FastAPI
    lifespan), and scrapes ``/metrics`` to confirm the mount took
    effect. ``store`` fixture is the standard test scaffolding that
    swaps the repository into a fake. ``Settings`` is a frozen
    dataclass so we mutate via ``object.__setattr__`` (the project
    convention -- mirrors :mod:`tests.test_security`).
    """

    from fastapi.testclient import TestClient

    from app import main
    from app.config import settings as live_settings

    object.__setattr__(live_settings, "prometheus_metrics", True)
    try:
        with TestClient(main.app) as client:
            response = client.get("/metrics")
            assert response.status_code == 200
            assert "text/plain" in response.headers["content-type"]
    finally:
        object.__setattr__(live_settings, "prometheus_metrics", False)
        # Drop the singletons so the mount on ``main.app`` does not
        # bleed into the next test (the mounted ASGI app survives the
        # TestClient teardown because ``app.mount`` writes onto the
        # FastAPI router).
        metrics_module.reset_for_tests()
