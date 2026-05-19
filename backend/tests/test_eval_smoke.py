"""End-to-end smoke test for the eval harness.

The test is marked ``@pytest.mark.eval`` *and* skipped at collection
time unless ``RUN_EVAL=1`` is set in the environment — mirroring the
``RUN_INTEGRATION`` pattern used elsewhere in the codebase.  This is
the right tradeoff: the default ``pytest`` run gates on 100% coverage
of ``app`` and the eval module is explicitly out of scope (it is a
test / dev harness, not production code).

Run with::

    cd backend && RUN_EVAL=1 pytest tests/test_eval_smoke.py -m eval --no-cov

The smoke test never touches a real provider API: it injects a stub
agent function and uses :class:`StubJudge`.  It exercises the full
pipeline — fixture loading, rubric resolution, runner aggregation, CLI
invocation — so a regression in the harness wiring is caught locally.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from app.eval import (
    EvalFixture,
    RUBRICS,
    StubJudge,
    judge_output,
    load_fixtures,
    run_eval,
)
from app.eval.fixtures import AGENT_NAMES, agent_runtime_name
from app.eval.rubrics import get_rubric

pytestmark = [
    pytest.mark.eval,
    pytest.mark.skipif(
        not os.environ.get("RUN_EVAL"),
        reason="Set RUN_EVAL=1 to run the eval-harness smoke test.",
    ),
]


# ---------------------------------------------------------------------------
# Fixture loading
# ---------------------------------------------------------------------------


def test_load_fixtures_all_agents() -> None:
    fixtures = load_fixtures()
    by_agent: dict[str, int] = {}
    for f in fixtures:
        by_agent[f.agent] = by_agent.get(f.agent, 0) + 1
    # Every agent in the registry must have at least 10 fixtures.
    for agent in AGENT_NAMES:
        assert by_agent.get(agent, 0) >= 10, (
            f"Agent {agent!r} has only {by_agent.get(agent, 0)} fixtures; "
            f"expected >= 10."
        )


def test_load_fixtures_filter_by_agent() -> None:
    chat_fixtures = load_fixtures("chat")
    assert chat_fixtures, "Expected at least one chat fixture."
    assert all(f.agent == "chat" for f in chat_fixtures)


def test_load_fixtures_rejects_unknown_agent() -> None:
    with pytest.raises(ValueError):
        load_fixtures("not-an-agent")


def test_agent_runtime_name_round_trip() -> None:
    assert agent_runtime_name("chat") == "chat-agent"
    assert agent_runtime_name("board_brief") == "board-brief-agent"
    assert agent_runtime_name("task_drafting") == "task-drafting-agent"
    with pytest.raises(ValueError):
        agent_runtime_name("nope")


# ---------------------------------------------------------------------------
# Rubrics validation
# ---------------------------------------------------------------------------


def test_rubrics_cover_every_agent() -> None:
    for agent in AGENT_NAMES:
        assert agent in RUBRICS, f"Missing rubric for {agent}"
        rubric = get_rubric(agent)
        total = sum(c.weight for c in rubric)
        assert abs(total - 1.0) < 1e-6, (
            f"Rubric for {agent} weights sum to {total}, expected 1.0"
        )


def test_rubric_overrides_apply_and_validate() -> None:
    # Override an existing criterion's weight; pair with a same-magnitude
    # reduction on another criterion so the weights still sum to 1.0.
    overrides = {
        "title_quality": {"weight": 0.40},
        "description_completeness": {"weight": 0.15},
    }
    rubric = get_rubric("task_drafting", overrides=overrides)
    by_name = {c.name: c for c in rubric}
    assert by_name["title_quality"].weight == 0.40
    assert by_name["description_completeness"].weight == 0.15


def test_rubric_overrides_rejected_when_weights_break_sum() -> None:
    with pytest.raises(ValueError):
        get_rubric(
            "task_drafting",
            overrides={"title_quality": {"weight": 0.99}},
        )


# ---------------------------------------------------------------------------
# Stub judge
# ---------------------------------------------------------------------------


def test_stub_judge_passes_when_must_have_all_match() -> None:
    fixture = EvalFixture(
        id="t",
        agent="task_drafting",
        input={"prompt": "x"},
        must_have=["alpha", "beta"],
        must_not=[],
    )
    rubric = get_rubric("task_drafting")
    judge = StubJudge()
    result = judge(fixture, {"prose": "alpha beta gamma"}, rubric)
    assert result.passed is True
    assert result.overall == pytest.approx(1.0)


def test_stub_judge_zero_score_when_must_not_present() -> None:
    fixture = EvalFixture(
        id="t",
        agent="chat",
        input={"messages": []},
        must_have=[],
        must_not=["leaked"],
    )
    judge = StubJudge()
    result = judge(fixture, {"reply": "leaked secret"}, get_rubric("chat"))
    assert result.passed is False
    assert result.overall == 0.0


def test_stub_judge_partial_score_when_some_must_have_missing() -> None:
    fixture = EvalFixture(
        id="t",
        agent="search",
        input={"query": "x"},
        must_have=["a", "b", "c", "d"],
        must_not=[],
    )
    judge = StubJudge()
    result = judge(fixture, {"text": "a only"}, get_rubric("search"))
    # 1/4 must_have matched → 0.25 per criterion → 0.25 overall.
    assert result.overall == pytest.approx(0.25)
    assert result.passed is False


def test_judge_output_dispatcher_defaults_to_stub() -> None:
    fixture = EvalFixture(id="t", agent="chat", input={"messages": []})
    result = judge_output(fixture, {"x": 1}, get_rubric("chat"))
    assert result.passed is True


# ---------------------------------------------------------------------------
# Runner — end-to-end with stub agent + stub judge
# ---------------------------------------------------------------------------


def _stub_agent_fn(fixture: EvalFixture) -> dict[str, Any]:
    """Echo the must_have substrings into the output so the stub judge passes.

    This keeps the smoke test deterministic and decouples the runner from
    the real agent runtime — which is exactly the contract the eval
    harness must support for CI.
    """
    return {
        "echo": " ".join(fixture.must_have),
        "fixture_id": fixture.id,
    }


def test_run_eval_aggregates_results_for_one_agent() -> None:
    report = asyncio.run(
        run_eval(
            "task_drafting",
            agent_fn=_stub_agent_fn,
            judge=StubJudge(),
            threshold=0.5,
        )
    )
    assert report.total >= 10
    assert report.judge == "stub"
    # Stub agent echoes must_have, so every non-adversarial fixture should
    # pass under the stub judge.  Adversarial fixtures may still pass when
    # must_not is empty (the stub judge is intentionally permissive).
    assert report.passed >= int(report.total * 0.7), (
        f"Expected >70% pass rate under stub judge; got {report.passed}/{report.total}"
    )
    # Per-criterion mean must be populated.
    rubric_names = {c.name for c in get_rubric("task_drafting")}
    assert set(report.mean_criteria) == rubric_names


def test_run_eval_records_must_not_failures() -> None:
    """A fixture whose must_not is non-empty and whose output contains the
    forbidden token must be recorded as a failure with overall=0."""

    def echo_forbidden(fixture: EvalFixture) -> dict[str, Any]:
        # Echo back every must_not token so any fixture with must_not
        # tokens fails the stub-judge gate.
        return {"text": " ".join(fixture.must_not)}

    report = asyncio.run(
        run_eval(
            "task_drafting",
            agent_fn=echo_forbidden,
            judge=StubJudge(),
            threshold=0.5,
        )
    )
    # The adversarial_prompt_injection fixture declares must_not tokens; the
    # echo_forbidden agent above leaks them, so the fixture must be marked
    # as failed.
    failures = {r.fixture_id for r in report.results if not r.passed}
    assert "adversarial_prompt_injection" in failures


def test_run_eval_handles_agent_exception() -> None:
    def broken_agent(_fixture: EvalFixture) -> Any:
        raise RuntimeError("provider went down")

    report = asyncio.run(
        run_eval(
            "chat",
            agent_fn=broken_agent,
            judge=StubJudge(),
            threshold=0.5,
            max_fixtures=2,
        )
    )
    assert report.failed == report.total
    assert all(r.error and "provider went down" in r.error for r in report.results)


def test_run_eval_max_fixtures_truncates() -> None:
    report = asyncio.run(
        run_eval(
            "board_brief",
            agent_fn=_stub_agent_fn,
            judge=StubJudge(),
            max_fixtures=2,
        )
    )
    assert report.total == 2


def test_run_eval_dry_run_skips_invocation() -> None:
    called: list[str] = []

    def tracker(fixture: EvalFixture) -> Any:
        called.append(fixture.id)
        return {}

    report = asyncio.run(
        run_eval(
            "search",
            agent_fn=tracker,
            judge=StubJudge(),
            dry_run=True,
        )
    )
    assert called == []
    assert report.total > 0
    assert report.passed == report.total  # dry-run records every fixture as planned


def test_run_eval_all_aggregates_across_agents() -> None:
    report = asyncio.run(
        run_eval(
            "all",
            agent_fn=_stub_agent_fn,
            judge=StubJudge(),
            max_fixtures=6,
        )
    )
    assert sorted(report.agents) == sorted(AGENT_NAMES)
    assert report.total == 6


def test_run_eval_report_is_json_serialisable() -> None:
    report = asyncio.run(
        run_eval(
            "triage",
            agent_fn=_stub_agent_fn,
            judge=StubJudge(),
            max_fixtures=2,
        )
    )
    payload = report.to_dict()
    serialised = json.dumps(payload, default=str)
    parsed = json.loads(serialised)
    assert parsed["total"] == 2
    assert parsed["judge"] == "stub"


# ---------------------------------------------------------------------------
# CLI invocation
# ---------------------------------------------------------------------------


def test_cli_dry_run_loads_fixtures(tmp_path: Path) -> None:
    """`python -m app.eval --dry-run --agent all` should exit 0 and list every fixture."""

    backend_root = Path(__file__).resolve().parent.parent
    output = tmp_path / "report.json"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "app.eval",
            "--dry-run",
            "--agent",
            "all",
            "--output",
            str(output),
        ],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"CLI dry-run failed.\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert output.exists()
    payload = json.loads(output.read_text())
    assert payload["total"] >= 60


def test_cli_stub_judge_returns_zero_on_pass(tmp_path: Path) -> None:
    """Running the CLI with --judge stub against the live agent runtime is
    expensive; instead, we drive it via --dry-run which still exercises
    argparse, judge construction, and exit codes."""

    backend_root = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "app.eval",
            "--dry-run",
            "--agent",
            "chat",
            "--judge",
            "stub",
            "--threshold",
            "0.5",
        ],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "Eval summary" in result.stdout
