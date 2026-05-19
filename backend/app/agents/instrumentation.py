"""OTel + Prometheus instrumentation glue for :class:`AgentRuntime`.

Lives next to :mod:`app.agents.runtime` rather than inside it because
the bookkeeping for the span / metric pair is small but repetitive --
factoring it out keeps ``ainvoke`` / ``astream`` focused on the
LangGraph translation work and lets the test suite exercise the
instrumentation surface without spinning up a real graph.

Both helpers stay cheap when observability is disabled: ``get_tracer``
returns the OpenTelemetry no-op proxy (whose spans short-circuit
``set_attribute`` / ``record_exception``) and the metric singletons
imported from :mod:`app.observability.metrics` are inert
``_NoOpMetric`` shims until the lifespan flips them.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from app.agents.llm import result_token_usage_from_graph_result
from app.observability.metrics import record_invocation
from app.observability.otel import (
    gen_ai_span_attrs,
    get_tracer,
    record_token_usage,
)


def _result_tokens(result: Any) -> tuple[int, int]:
    """Best-effort ``(tokens_in, tokens_out)`` from a graph result."""

    return result_token_usage_from_graph_result(result)


def _outcome_for(exc: BaseException) -> str:
    """Bucket an exception into one of the metric outcome labels.

    Unhandled errors map to ``error`` (including
    :class:`~app.agents.errors.AgentRecursionError`); the router records
    recursion failures separately. Generator close / task cancel are
    rebadged as ``success`` because the SSE router uses ``aclose()`` to
    short-circuit a stream when the client disconnects -- the run
    completed cleanly from the runtime's perspective and counting it as
    a failure would distort the success-rate SLO.
    """

    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
        return "success"
    return "error"


class _AgentRunSpan:
    """Async context manager that owns the span + metric for one run.

    Splitting this out from inline ``with``/``try`` blocks in the
    runtime avoids duplicating the duration-timing + outcome-bucketing
    logic between ``ainvoke`` and ``astream``. The caller calls
    :meth:`set_result` on a successful run so we can extract token
    counts before the span closes.

    # Sync context manager is intentional — the underlying OTel
    # start_as_current_span is sync; awaiting inside the run loop is
    # unnecessary.
    """

    def __init__(
        self,
        *,
        operation: str,
        agent_name: str,
        model_id: Optional[str],
        project_id: Optional[str],
        autonomy: Optional[str],
    ) -> None:
        self._operation = operation
        self._agent_name = agent_name
        self._model_id = model_id
        self._project_id = project_id
        self._autonomy = autonomy
        self._tokens_in = 0
        self._tokens_out = 0
        self._start: float = 0.0
        self._span_cm: Any = None
        self._span: Any = None
        self._tracer = get_tracer()
        # Defer span attribute computation to __enter__ so that when OTel is
        # no-op (the span is non-recording) we skip the attribute dict build
        # entirely.  _attrs is populated in __enter__.
        self._attrs: Any = None

    def __enter__(self) -> "_AgentRunSpan":
        self._start = time.monotonic()
        span_name = f"agent.{self._agent_name}.{self._operation}"
        # Start with a name-only span first so we can interrogate is_recording();
        # if the span is live we then build and set attrs.
        self._span_cm = self._tracer.start_as_current_span(span_name)
        self._span = self._span_cm.__enter__()
        if getattr(self._span, "is_recording", lambda: True)():
            self._attrs = gen_ai_span_attrs(
                operation=self._operation,
                agent_name=self._agent_name,
                model_id=self._model_id,
                project_id=self._project_id,
                autonomy=self._autonomy,
            )
            for key, val in self._attrs.items():
                self._span.set_attribute(key, val)
        return self

    def set_result(self, result: Any) -> None:
        """Pull token counts off ``result`` for the success annotations."""

        self._tokens_in, self._tokens_out = _result_tokens(result)

    def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
        """Set token counts directly.

        Used by the streaming path, which aggregates totals across all
        messages in the final graph state rather than handing back a single
        result dict like ``ainvoke`` does.
        """

        self._tokens_in = tokens_in
        self._tokens_out = tokens_out

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[Any],
    ) -> None:
        duration = time.monotonic() - self._start
        if exc_val is None:
            outcome = "success"
            record_token_usage(
                self._span,
                self._tokens_in,
                self._tokens_out,
                model_id=self._model_id,
            )
        else:
            outcome = _outcome_for(exc_val)
            # ``record_exception`` is a no-op on a non-recording span,
            # so this is free when OTel is disabled.
            self._span.record_exception(exc_val)
        record_invocation(
            self._agent_name,
            outcome,
            tokens_in=self._tokens_in,
            tokens_out=self._tokens_out,
            duration_s=duration,
        )
        self._span_cm.__exit__(exc_type, exc_val, exc_tb)


def start_run_span(
    *,
    operation: str,
    agent_name: str,
    model_id: Optional[str] = None,
    project_id: Optional[str] = None,
    autonomy: Optional[str] = None,
) -> _AgentRunSpan:
    """Construct a per-run span / metric pair to ``with``-enter."""

    return _AgentRunSpan(
        operation=operation,
        agent_name=agent_name,
        model_id=model_id,
        project_id=project_id,
        autonomy=autonomy,
    )


__all__ = ["start_run_span"]
