"""Eval-harness runner — invoke agents over fixtures and aggregate scores.

The runner is intentionally small: it ties together fixture loading,
agent invocation, and judging.  All three pieces are pluggable so the CI
smoke test can substitute a stub agent and a stub judge without touching
production code.

Agent invocation strategy
-------------------------

Most callers will let the runner construct an in-process
:class:`AgentRuntime` and dispatch by agent slug — that mirrors the
production path most closely.  Tests that want to avoid the full runtime
(e.g. because they're asserting the *runner's* aggregation logic) pass
an ``agent_fn`` callable:

    def my_stub_agent(fixture: EvalFixture) -> dict[str, Any]:
        return {"draft": {"taskName": "..."}}

    report = await run_eval("task_drafting", agent_fn=my_stub_agent, ...)

When neither path runs the agent (``dry_run=True``) the runner just
plans the work and reports the fixture count.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable, Optional, Sequence

from app.eval.fixtures import (
    AGENT_NAMES,
    EvalFixture,
    agent_runtime_name,
    load_fixtures,
)
from app.eval.judge import (
    DEFAULT_PASS_THRESHOLD,
    Judge,
    JudgeResult,
    StubJudge,
)
from app.eval.rubrics import RubricCriterion, get_rubric

logger = logging.getLogger(__name__)


AgentFn = Callable[[EvalFixture], Any]
AsyncAgentFn = Callable[[EvalFixture], Awaitable[Any]]


# ---------------------------------------------------------------------------
# Report dataclasses (JSON-serializable)
# ---------------------------------------------------------------------------


@dataclass
class FixtureResult:
    """One fixture's outcome."""

    fixture_id: str
    agent: str
    passed: bool
    overall: float
    criteria: dict[str, float]
    reasoning: str
    output: Any
    duration_ms: float
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvalReport:
    """Aggregated eval result for one or more agents."""

    agents: list[str]
    judge: str
    threshold: float
    total: int
    passed: int
    failed: int
    mean_overall: float
    mean_criteria: dict[str, float]
    duration_ms: float
    results: list[FixtureResult] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.passed / self.total

    def to_dict(self) -> dict[str, Any]:
        return {
            "agents": list(self.agents),
            "judge": self.judge,
            "threshold": self.threshold,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "pass_rate": self.pass_rate,
            "mean_overall": self.mean_overall,
            "mean_criteria": dict(self.mean_criteria),
            "duration_ms": self.duration_ms,
            "results": [r.to_dict() for r in self.results],
        }


# ---------------------------------------------------------------------------
# Default agent caller (uses AgentRuntime)
# ---------------------------------------------------------------------------


async def _default_agent_caller(fixture: EvalFixture) -> Any:
    """Invoke the registered agent for ``fixture.agent`` via AgentRuntime.

    Builds an isolated, in-memory runtime per call so eval invocations do
    not collide with the app's production runtime.  Uses the deterministic
    stub model unless ``AGENT_CHAT_MODEL_PROVIDER`` is set to a real
    provider in the environment.
    """

    # Local import: keep ``app.eval`` importable even when the agent
    # runtime has heavy deps.
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.store.memory import InMemoryStore

    from app.agents.catalog import register_all
    from app.agents.registry import AgentRegistry
    from app.agents.runtime import AgentRuntime

    registry = AgentRegistry()
    register_all(registry)
    runtime = AgentRuntime(
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        registry=registry,
    )
    runtime_agent = agent_runtime_name(fixture.agent)
    final_state, events = await runtime.arun_with_events(runtime_agent, fixture.input)
    return {"final_state": final_state, "events": events}


# ---------------------------------------------------------------------------
# Runner core
# ---------------------------------------------------------------------------


def _expand_agent(agent: str) -> list[str]:
    if agent == "all":
        return list(AGENT_NAMES)
    if agent not in AGENT_NAMES:
        raise ValueError(
            f"Unknown agent {agent!r}; expected 'all' or one of {AGENT_NAMES}."
        )
    return [agent]


def _aggregate_criteria(results: Sequence[FixtureResult]) -> dict[str, float]:
    """Per-criterion mean across the result set."""
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for r in results:
        for name, score in r.criteria.items():
            sums[name] = sums.get(name, 0.0) + float(score)
            counts[name] = counts.get(name, 0) + 1
    return {
        name: (sums[name] / counts[name]) if counts[name] else 0.0 for name in sums
    }


async def _maybe_await(value: Any) -> Any:
    """Await ``value`` if it's awaitable, otherwise return as-is."""
    if asyncio.iscoroutine(value):
        return await value
    return value


async def _run_one(
    fixture: EvalFixture,
    rubric: Sequence[RubricCriterion],
    judge: Judge,
    agent_fn: Callable[[EvalFixture], Any],
    threshold: float,
) -> FixtureResult:
    start = time.perf_counter()
    output: Any = None
    error: Optional[str] = None
    try:
        output = await _maybe_await(agent_fn(fixture))
    except Exception as exc:  # noqa: BLE001 — surface in report
        logger.exception("Agent invocation failed for fixture %r", fixture.id)
        error = f"{type(exc).__name__}: {exc}"
    if error is not None:
        return FixtureResult(
            fixture_id=fixture.id,
            agent=fixture.agent,
            passed=False,
            overall=0.0,
            criteria={c.name: 0.0 for c in rubric},
            reasoning=f"Agent invocation error: {error}",
            output=None,
            duration_ms=(time.perf_counter() - start) * 1000.0,
            error=error,
        )
    try:
        judgement: JudgeResult = judge(fixture, output, rubric, threshold=threshold)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Judge failed for fixture %r", fixture.id)
        return FixtureResult(
            fixture_id=fixture.id,
            agent=fixture.agent,
            passed=False,
            overall=0.0,
            criteria={c.name: 0.0 for c in rubric},
            reasoning=f"Judge error: {type(exc).__name__}: {exc}",
            output=output,
            duration_ms=(time.perf_counter() - start) * 1000.0,
            error=f"{type(exc).__name__}: {exc}",
        )
    return FixtureResult(
        fixture_id=fixture.id,
        agent=fixture.agent,
        passed=judgement.passed,
        overall=judgement.overall,
        criteria=dict(judgement.criteria),
        reasoning=judgement.reasoning,
        output=output,
        duration_ms=(time.perf_counter() - start) * 1000.0,
    )


async def run_eval(
    agent: str,
    *,
    fixtures: Optional[list[EvalFixture]] = None,
    judge: Optional[Judge] = None,
    agent_fn: Optional[Callable[[EvalFixture], Any]] = None,
    max_fixtures: Optional[int] = None,
    dry_run: bool = False,
    threshold: float = DEFAULT_PASS_THRESHOLD,
) -> EvalReport:
    """Run the eval for ``agent`` (or ``"all"``).

    Parameters mirror the CLI surface so the function can be driven from
    a notebook or another script without going through argparse.
    """

    agent_list = _expand_agent(agent)
    if fixtures is None:
        loaded: list[EvalFixture] = []
        for agent_slug in agent_list:
            loaded.extend(load_fixtures(agent_slug))
        fixtures = loaded
    else:
        # Filter to requested agents when the caller passes its own list.
        fixtures = [f for f in fixtures if f.agent in agent_list]
    if max_fixtures is not None:
        fixtures = fixtures[:max_fixtures]

    judge = judge if judge is not None else StubJudge()
    agent_fn = agent_fn if agent_fn is not None else _default_agent_caller

    start = time.perf_counter()

    if dry_run:
        # Plan only; no agent invocation, no judge.
        results: list[FixtureResult] = []
        for f in fixtures:
            results.append(
                FixtureResult(
                    fixture_id=f.id,
                    agent=f.agent,
                    passed=True,
                    overall=0.0,
                    criteria={},
                    reasoning="dry_run",
                    output=None,
                    duration_ms=0.0,
                )
            )
        return EvalReport(
            agents=agent_list,
            judge=getattr(judge, "name", type(judge).__name__),
            threshold=threshold,
            total=len(results),
            passed=len(results),
            failed=0,
            mean_overall=0.0,
            mean_criteria={},
            duration_ms=(time.perf_counter() - start) * 1000.0,
            results=results,
        )

    results = []
    for f in fixtures:
        rubric = get_rubric(f.agent, overrides=f.rubric_overrides)
        result = await _run_one(f, rubric, judge, agent_fn, threshold)
        results.append(result)

    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    mean_overall = (
        sum(r.overall for r in results) / len(results) if results else 0.0
    )
    return EvalReport(
        agents=agent_list,
        judge=getattr(judge, "name", type(judge).__name__),
        threshold=threshold,
        total=len(results),
        passed=passed,
        failed=failed,
        mean_overall=mean_overall,
        mean_criteria=_aggregate_criteria(results),
        duration_ms=(time.perf_counter() - start) * 1000.0,
        results=results,
    )
