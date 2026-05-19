# Board Copilot eval harness

The `app.eval` package adds an *outcome* evaluation layer on top of the
existing structure tests in `backend/tests/`.

Structure tests (in `tests/test_agent_*.py`) grade:
- SSE wire format
- JSON schema shape
- Deterministic baselines

The eval harness grades:
- **Quality** of LLM output against fixture-defined rubrics
- Per-criterion scoring (0..1) via an LLM-as-judge
- Aggregate pass/fail with a configurable threshold

## Running

The CLI lives at `python -m app.eval`. The bash wrapper
`scripts/run_eval.sh` forwards extra args.

```bash
# Plan only — no API calls, no agent invocation
python -m app.eval --dry-run --agent all

# CI smoke run — stub judge (no provider key required)
python -m app.eval --agent task_drafting --judge stub

# Live judge run for one agent with cost protection
python -m app.eval --agent chat --judge claude --max-fixtures 10 \
    --output reports/eval-chat.json
```

CLI flags:

| Flag | Default | Notes |
|------|---------|-------|
| `--agent` | `all` | One of `chat`, `board_brief`, `search`, `triage`, `task_drafting`, `task_estimation`, or `all`. |
| `--max-fixtures` | none | Cost guard rail. Truncates after the first N fixtures. |
| `--judge` | `stub` | `stub` (deterministic, no API) or `claude` (LLM-as-judge). |
| `--judge-model` | `claude-sonnet-4-6` | Model id passed to the LLM judge. |
| `--judge-provider` | `anthropic` | `anthropic` or `openai`. |
| `--threshold` | `0.7` | Overall score required to mark a fixture as passed. |
| `--output` | none | JSON report path. |
| `--dry-run` | off | Load fixtures, print plan, do not invoke anything. |

The CLI exits non-zero on any fixture failure, so it composes with CI
gates and `make` targets.

## Fixture format

Fixtures are individual JSON files under
`backend/tests/eval/fixtures/<agent>/<id>.json`. Adding a fixture is a
file-system operation; no Python edits required.

```json
{
  "agent": "task_drafting",
  "input": { "prompt": "Set up CI ...", "board_snapshot": { ... } },
  "must_have": ["CI", "staging"],
  "must_not": ["TODO", "lorem ipsum"],
  "rubric_overrides": null,
  "notes": "..."
}
```

The `agent` and `id` fields may be omitted; the loader infers them from
the parent directory and filename stem.

## Rubrics

Per-agent rubrics live in `app/eval/rubrics.py`. Each rubric is a list
of `RubricCriterion(name, weight, description)`. Weights for an agent
must sum to 1.0 (validated at import time).

A fixture may attach `rubric_overrides` to add or tweak criteria for
just that fixture. The merged weights must still sum to 1.0.

## Judge

The default judge is `StubJudge` (deterministic, no API). It scores
`1.0` only when every `must_have` substring is present in the rendered
output and no `must_not` substring appears.

`LLMJudge` uses LangChain's `with_structured_output` against a typed
Pydantic schema (`JudgeResult`). The prompt is laid out so the rubric
block forms a stable, cache-friendly prefix — Anthropic prompt-caching
amortises the rubric across a whole eval run.

The model defaults to `claude-sonnet-4-6`. For a cheaper run, use
`--judge-model claude-haiku-4-5-20251001`.

## Cost guidance

A full live eval (60+ fixtures × Sonnet judge) is roughly 60 short
chat-completion calls. Costs are dominated by the input tokens
(rubric ~ 1k tokens + fixture I/O ~ 1-3k tokens). With prompt caching
enabled (default), the rubric prefix is cached across calls so steady-state
cost is mostly the per-fixture content.

For lower-cost runs:
- Use `--judge-model claude-haiku-4-5-20251001`.
- Cap with `--max-fixtures` (e.g. 5 per agent for a smoke check).
- Or stay on `--judge stub` for CI.

## Programmatic use

```python
import asyncio
from app.eval import run_eval, StubJudge

report = asyncio.run(run_eval(
    "task_drafting",
    judge=StubJudge(),
    max_fixtures=3,
))
print(report.pass_rate, report.mean_overall)
```

You can pass an `agent_fn: Fixture -> output` callable to skip the live
agent runtime and feed pre-computed outputs into the judge — useful for
unit tests and for replaying captured transcripts.

## Smoke test

`backend/tests/test_eval_smoke.py` is marked `@pytest.mark.eval` and is
excluded from the default `pytest` run. It exercises fixture loading,
rubric validation, runner aggregation, and CLI invocation against a
stub agent + stub judge so CI never hits a provider.

```bash
cd backend
pytest tests/test_eval_smoke.py -m eval --no-cov
```
