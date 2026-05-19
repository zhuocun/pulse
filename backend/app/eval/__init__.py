"""Board Copilot evaluation harness.

This package adds an *outcome* evaluation layer on top of the existing
structure tests in ``backend/tests/``.  Structure tests grade SSE wire
format, schema shape, and deterministic baselines; the eval harness
grades the **quality** of LLM output against fixture-defined rubrics.

The harness is intentionally separable from production code:

- :mod:`app.eval.fixtures` defines :class:`EvalFixture` and loads JSON
  files from ``backend/tests/eval/fixtures/<agent>/*.json``.
- :mod:`app.eval.rubrics` declares per-agent scoring criteria.
- :mod:`app.eval.judge` runs the LLM-as-judge pass.  A
  :class:`StubJudge` deterministically scores the same shape for CI.
- :mod:`app.eval.runner` ties fixtures + judge into an
  :class:`EvalReport`.
- ``python -m app.eval`` exposes a CLI with cost guard rails.

The harness *does not* hit any provider API at test collection time —
the CI smoke test runs the runner against an in-process stub agent and
the :class:`StubJudge`.  Real-judge runs are opt-in (``--judge claude``)
and bounded by ``--max-fixtures``.
"""

from app.eval.fixtures import EvalFixture, load_fixtures
from app.eval.judge import JudgeResult, StubJudge, judge_output
from app.eval.rubrics import RUBRICS, RubricCriterion, get_rubric
from app.eval.runner import EvalReport, FixtureResult, run_eval

__all__ = [
    "EvalFixture",
    "EvalReport",
    "FixtureResult",
    "JudgeResult",
    "RUBRICS",
    "RubricCriterion",
    "StubJudge",
    "get_rubric",
    "judge_output",
    "load_fixtures",
    "run_eval",
]
